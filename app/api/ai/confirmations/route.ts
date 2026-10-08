import {createHash,randomBytes} from "crypto";
import {NextResponse} from "next/server";
import {getTenantContext} from "@/lib/auth";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["owner","admin","manager","sales"]);
const MAX_ITEMS=50;
const text=(v:unknown,max=4000)=>typeof v==="string"?v.trim().slice(0,max):"";
const validId=(v:unknown)=>typeof v==="string"&&UUID.test(v);
const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");

function canonicalPayload(input:Record<string,unknown>){
 const items=Array.isArray(input.items)?input.items.map((x:any)=>({product_id:x?.product_id??null,variant_id:x?.variant_id??null,quantity:Number(x?.quantity)})):[];
 return {customer_id:input.customer_id??null,source_channel:text(input.source_channel,100)||"dashboard",currency:text(input.currency,10)||"PKR",items};
}

export async function POST(req:Request){
 try{
  const {supabase,tenant,membership,user}=await getTenantContext();
  if(!tenant||!membership)return NextResponse.json({error:"workspace_required"},{status:400});
  if(!ROLES.has(membership.role))return NextResponse.json({error:"forbidden"},{status:403});
  const body=await req.json();
  const action=body?.action;
  if(action!=="prepare"&&action!=="confirm")return NextResponse.json({error:"invalid_action"},{status:400});

  if(action==="prepare"){
   const p=canonicalPayload(body);
   if(p.customer_id!==null&&!validId(p.customer_id))return NextResponse.json({error:"invalid_customer_id"},{status:400});
   if(!Array.isArray(p.items)||p.items.length<1||p.items.length>MAX_ITEMS)return NextResponse.json({error:"invalid_items"},{status:400});
   if(p.items.some((x:any)=>!validId(x.product_id)&&!validId(x.variant_id)))return NextResponse.json({error:"invalid_items"},{status:400});
   if(p.items.some((x:any)=>validId(x.product_id)&&validId(x.variant_id)))return NextResponse.json({error:"invalid_items"},{status:400});
   if(p.items.some((x:any)=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>10000))return NextResponse.json({error:"invalid_quantity"},{status:400});
   if(p.customer_id!==null){const {data,error}=await supabase.from("customers").select("id").eq("tenant_id",tenant.id).eq("id",p.customer_id).maybeSingle();if(error)throw error;if(!data)return NextResponse.json({error:"customer_not_found"},{status:404});}
   const token=randomBytes(32).toString("hex");
   const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
   const payloadHash=createHash("sha256").update(JSON.stringify(p)).digest("hex");
   const {data,error}=await supabase.from("ai_action_confirmations").insert({tenant_id:tenant.id,agent_id:validId(body.agent_id)?body.agent_id:null,conversation_id:validId(body.conversation_id)?body.conversation_id:null,customer_id:p.customer_id,action_type:"create_order",payload:p,token_hash:hashToken(token),payload_hash:payloadHash,expires_at:expiresAt}).select("id,action_type,payload,payload_hash,expires_at,created_at").single();
   if(error)throw error;
   await supabase.from("audit_logs").insert({tenant_id:tenant.id,actor_id:user.id,action:"ai.order_confirmation_prepared",resource_type:"ai_action_confirmation",resource_id:data.id,new_data:{action_type:data.action_type,payload_hash:payloadHash,expires_at:expiresAt},reason:"Explicit order confirmation prepared"});
   return NextResponse.json({confirmation:{...data,token,expires_at:expiresAt}});
  }

  const token=text(body.token,128);
  if(token.length<64)return NextResponse.json({error:"invalid_confirmation_token"},{status:400});
  const tokenHash=hashToken(token);
  const {data:confirmation,error:loadError}=await supabase.from("ai_action_confirmations").select("id,action_type,payload,payload_hash,expires_at,confirmed_at,consumed_at").eq("tenant_id",tenant.id).eq("token_hash",tokenHash).maybeSingle();
  if(loadError)throw loadError;
  if(!confirmation)return NextResponse.json({error:"confirmation_not_found"},{status:404});
  if(confirmation.action_type!=="create_order")return NextResponse.json({error:"unsupported_confirmation_action"},{status:400});
  if(confirmation.consumed_at)return NextResponse.json({error:"confirmation_already_used"},{status:409});
  if(confirmation.confirmed_at)return NextResponse.json({error:"confirmation_already_confirmed"},{status:409});
  if(new Date(confirmation.expires_at).getTime()<=Date.now())return NextResponse.json({error:"confirmation_expired"},{status:409});
  const expectedHash=createHash("sha256").update(JSON.stringify(confirmation.payload)).digest("hex");
  if(expectedHash!==confirmation.payload_hash)return NextResponse.json({error:"confirmation_integrity_failure"},{status:409});
  const {data:updated,error}=await supabase.from("ai_action_confirmations").update({confirmed_at:new Date().toISOString(),confirmed_by:user.id}).eq("tenant_id",tenant.id).eq("id",confirmation.id).is("confirmed_at",null).is("consumed_at",null).select("id,action_type,payload_hash,confirmed_at,expires_at").maybeSingle();
  if(error)throw error;
  if(!updated)return NextResponse.json({error:"confirmation_state_changed"},{status:409});
  await supabase.from("audit_logs").insert({tenant_id:tenant.id,actor_id:user.id,action:"ai.order_confirmation_confirmed",resource_type:"ai_action_confirmation",resource_id:updated.id,new_data:{action_type:updated.action_type,payload_hash:updated.payload_hash,confirmed_at:updated.confirmed_at},reason:"Explicit order confirmation received"});
  return NextResponse.json({confirmation:updated});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"confirmation_failed"},{status:500})}
}
