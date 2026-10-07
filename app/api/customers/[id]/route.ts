import {NextResponse} from "next/server";
import {getTenantContext} from "@/lib/auth";

type Ctx={params:Promise<{id:string}>};
const editable=["name","phone","email","preferred_language","consent","tags","notes"] as const;

export async function GET(_req:Request,{params}:Ctx){
  try{
    const {supabase,tenant}=await getTenantContext();
    if(!tenant)return NextResponse.json({error:"workspace_required"},{status:400});
    const {id}=await params;
    const {data:customer,error}=await supabase.from("customers").select("id,external_key,name,phone,email,preferred_language,consent,tags,notes,last_seen_at,created_at,updated_at").eq("tenant_id",tenant.id).eq("id",id).maybeSingle();
    if(error)throw error;
    if(!customer)return NextResponse.json({error:"customer_not_found"},{status:404});
    const [{data:identities},{data:conversations},{data:orders},{data:leads},{data:followups}]=await Promise.all([
      supabase.from("customer_identities").select("id,channel,external_id,display_name,phone,email,metadata,created_at,updated_at").eq("tenant_id",tenant.id).eq("customer_id",id).order("created_at",{ascending:true}),
      supabase.from("conversations").select("id,channel,status,priority,assigned_to,handoff,last_message_at,created_at").eq("tenant_id",tenant.id).eq("customer_id",id).order("last_message_at",{ascending:false}),
      supabase.from("orders").select("id,status,currency,subtotal,discount,total,payment_status,source_channel,metadata,created_at,updated_at").eq("tenant_id",tenant.id).eq("customer_id",id).order("created_at",{ascending:false}),
      supabase.from("leads").select("id,status,source_channel,budget,intent,notes,created_at,updated_at").eq("tenant_id",tenant.id).eq("customer_id",id).order("created_at",{ascending:false}),
      supabase.from("followups").select("id,conversation_id,channel,message,scheduled_for,status,attempts,last_error,created_at,updated_at").eq("tenant_id",tenant.id).eq("customer_id",id).order("scheduled_for",{ascending:true})
    ]);
    if([identities,conversations,orders,leads,followups].some(x=>x===null))throw new Error("customer_360_query_failed");
    const conversationIds=(conversations??[]).map(x=>x.id);
    let messages:any[]=[];
    if(conversationIds.length){
      const {data,error:messageError}=await supabase.from("messages").select("id,conversation_id,direction,sender_type,external_id,content,media,created_at").eq("tenant_id",tenant.id).in("conversation_id",conversationIds).order("created_at",{ascending:false}).limit(200);
      if(messageError)throw messageError;
      messages=data??[];
    }
    return NextResponse.json({customer,identities:identities??[],conversations:conversations??[],messages,orders:orders??[],leads:leads??[],followups:followups??[]});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"customer_360_failed"},{status:500});}
}

export async function PATCH(req:Request,{params}:Ctx){
  try{
    const {supabase,tenant,user}=await getTenantContext();
    if(!tenant||!user)return NextResponse.json({error:"workspace_required"},{status:400});
    const {id}=await params;
    const body=await req.json();
    const patch:Record<string,unknown>={};
    for(const key of editable)if(Object.prototype.hasOwnProperty.call(body,key))patch[key]=body[key];
    if(!Object.keys(patch).length)return NextResponse.json({error:"no_editable_fields"},{status:400});
    if("name" in patch&&patch.name!==null&&typeof patch.name!=="string")return NextResponse.json({error:"invalid_name"},{status:400});
    if("phone" in patch&&patch.phone!==null&&typeof patch.phone!=="string")return NextResponse.json({error:"invalid_phone"},{status:400});
    if("email" in patch&&patch.email!==null&&typeof patch.email!=="string")return NextResponse.json({error:"invalid_email"},{status:400});
    if("preferred_language" in patch&&patch.preferred_language!==null&&typeof patch.preferred_language!=="string")return NextResponse.json({error:"invalid_language"},{status:400});
    if("tags" in patch&&(!Array.isArray(patch.tags)||patch.tags.some(x=>typeof x!=="string")))return NextResponse.json({error:"invalid_tags"},{status:400});
    if("notes" in patch&&patch.notes!==null&&typeof patch.notes!=="string")return NextResponse.json({error:"invalid_notes"},{status:400});
    if("consent" in patch&&(patch.consent===null||typeof patch.consent!=="object"||Array.isArray(patch.consent)))return NextResponse.json({error:"invalid_consent"},{status:400});
    const {data:before,error:beforeError}=await supabase.from("customers").select("*").eq("tenant_id",tenant.id).eq("id",id).maybeSingle();
    if(beforeError)throw beforeError;
    if(!before)return NextResponse.json({error:"customer_not_found"},{status:404});
    patch.updated_at=new Date().toISOString();
    const {data:customer,error}=await supabase.from("customers").update(patch).eq("tenant_id",tenant.id).eq("id",id).select("id,external_key,name,phone,email,preferred_language,consent,tags,notes,last_seen_at,created_at,updated_at").single();
    if(error)throw error;
    const {error:auditError}=await supabase.from("audit_logs").insert({tenant_id:tenant.id,actor_id:user.id,action:"customer.updated",resource_type:"customer",resource_id:id,old_data:before,new_data:customer,reason:"Customer 360 profile update"});
    if(auditError)throw auditError;
    return NextResponse.json({customer});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"customer_update_failed"},{status:500});}
}