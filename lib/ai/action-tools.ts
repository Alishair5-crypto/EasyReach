import{createClient}from"@/lib/supabase/server";import type{SupabaseClient}from"@supabase/supabase-js";import{searchProducts,getProductVariants,getBusinessPolicy}from"./tools";import{annotateKnowledgeTrust}from"./knowledge-trust";import{requireFeature}from"@/lib/entitlements";

export type SalesToolName=
|"search_products"|"get_product"|"check_inventory"|"get_price"|"get_variant"
|"search_knowledge"|"get_business_policy"|"create_lead"|"create_order"
|"get_order"|"get_customer"|"send_product"|"send_checkout"|"handoff_to_human"|"schedule_followup";

export type ToolContext={tenantId:string;userId:string;agentId?:string;conversationId?:string;customerId?:string};

type ToolResult={ok:true;tool:string;data:unknown}|{ok:false;tool:string;code:string;message:string};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown)=>typeof v==="string"&&uuid.test(v);
const text=(v:unknown,max=4000)=>typeof v==="string"?v.trim().slice(0,max):"";

function fail(tool:string,code:string,message:string):ToolResult{return{ok:false,tool,code,message}}

async function customer(s:any,tenantId:string,customerId:string){
 const{data}=await s.from("customers").select("id,external_key,name,phone,email,preferred_language,consent,tags,notes,last_seen_at").eq("tenant_id",tenantId).eq("id",customerId).maybeSingle();
 return data??null;
}

export async function executeSalesTool(ctx:ToolContext,name:SalesToolName,args:unknown,db?:SupabaseClient):Promise<ToolResult>{
 const s=db??await createClient();
 if(!ctx.tenantId||!ctx.userId)return fail(name,"not_authorized","Authenticated tenant context is required.");
 if(!name)return fail("unknown","invalid_tool","Tool name is required.");
 const a=(args&&typeof args==="object"&&!Array.isArray(args))?args as Record<string,unknown>:{};

 try{
  if(name==="search_products"){
   const q=text(a.query,1000);if(!q)return fail(name,"invalid_arguments","query is required.");
   const data=await searchProducts(ctx.tenantId,q,s);
   return{ok:true,tool:name,data:data.map(p=>({id:p.id,name:p.name,description:p.description,category:p.category,price:p.price,sale_price:p.sale_price,currency:p.currency,images:p.images,availability:p.availability,inventory_quantity:p.inventory_quantity,product_url:p.product_url}))};
  }

  if(name==="get_product"){
   const productId=a.product_id;if(!id(productId))return fail(name,"invalid_product_id","A valid product_id is required.");
   const{data,error}=await s.from("products").select("id,name,description,category,price,sale_price,currency,images,attributes,availability,inventory_quantity,product_url,source,last_synced_at,updated_at").eq("tenant_id",ctx.tenantId).eq("id",productId).maybeSingle();
   if(error)throw error;if(!data)return fail(name,"product_not_found","Product was not found in this business.");
   const variants=await getProductVariants(ctx.tenantId,[productId as string],s);
   return{ok:true,tool:name,data:{...data,variants}};
  }

  if(name==="check_inventory"){
   const variantId=a.variant_id,productId=a.product_id;
   if(variantId!==undefined&&!id(variantId))return fail(name,"invalid_variant_id","Invalid variant_id.");
   if(productId!==undefined&&!id(productId))return fail(name,"invalid_product_id","Invalid product_id.");
   if(variantId===undefined&&productId===undefined)return fail(name,"product_or_variant_required","product_id or variant_id is required.");
   if(variantId){
    const{data,error}=await s.from("product_variants").select("id,product_id,sku,name,attributes,inventory_quantity,availability,updated_at").eq("tenant_id",ctx.tenantId).eq("id",variantId).maybeSingle();
    if(error)throw error;if(!data)return fail(name,"variant_not_found","Variant was not found.");
    return{ok:true,tool:name,data:{id:data.id,type:"variant",inventory_quantity:data.inventory_quantity,availability:data.availability,updated_at:data.updated_at}};
   }
   const{data,error}=await s.from("products").select("id,inventory_quantity,availability,updated_at").eq("tenant_id",ctx.tenantId).eq("id",productId as string).maybeSingle();
   if(error)throw error;if(!data)return fail(name,"product_not_found","Product was not found.");
   return{ok:true,tool:name,data:{id:data.id,type:"product",inventory_quantity:data.inventory_quantity,availability:data.availability,updated_at:data.updated_at}};
  }

  if(name==="get_price"){
   const variantId=a.variant_id,productId=a.product_id;
   if(variantId!==undefined&&!id(variantId))return fail(name,"invalid_variant_id","Invalid variant_id.");
   if(productId!==undefined&&!id(productId))return fail(name,"invalid_product_id","Invalid product_id.");
   if((variantId===undefined)===(productId===undefined))return fail(name,"one_product_reference_required","Provide exactly one product_id or variant_id.");
   if(variantId){
    const{data,error}=await s.from("product_variants").select("id,product_id,name,price,currency,updated_at").eq("tenant_id",ctx.tenantId).eq("id",variantId as string).maybeSingle();
    if(error)throw error;if(!data)return fail(name,"variant_not_found","Variant was not found.");
    return{ok:true,tool:name,data};
   }
   const{data,error}=await s.from("products").select("id,name,price,sale_price,currency,updated_at").eq("tenant_id",ctx.tenantId).eq("id",productId as string).maybeSingle();
   if(error)throw error;if(!data)return fail(name,"product_not_found","Product was not found.");
   return{ok:true,tool:name,data};
  }

  if(name==="get_variant"){
   const variantId=a.variant_id;if(!id(variantId))return fail(name,"invalid_variant_id","A valid variant_id is required.");
   const{data,error}=await s.from("product_variants").select("id,product_id,external_id,sku,name,price,inventory_quantity,availability,attributes,updated_at").eq("tenant_id",ctx.tenantId).eq("id",variantId).maybeSingle();
   if(error)throw error;if(!data)return fail(name,"variant_not_found","Variant was not found.");
   return{ok:true,tool:name,data};
  }

  if(name==="search_knowledge"){
   const q=text(a.query,1000);if(!q)return fail(name,"invalid_arguments","query is required.");
   const words=q.toLowerCase().split(/\s+/).filter(x=>x.length>2).slice(0,6);
   let rows:any[]=[];
   for(const w of words){
    const safe=w.replace(/[%_,()]/g,"").slice(0,50);if(!safe)continue;
    const{data,error}=await s.from("knowledge_documents").select("id,title,source_type,content,source_url,last_synced_at,verification_status,verified_at,created_at").eq("tenant_id",ctx.tenantId).eq("status","active").eq("verification_status","verified").or(`title.ilike.%${safe}%,content.ilike.%${safe}%`).limit(10);
    if(error)throw error;rows.push(...(data??[]));
   }
   const seen=new Set<string>();rows=rows.filter(x=>!seen.has(x.id)&&seen.add(x.id)).slice(0,20);
   return{ok:true,tool:name,data:annotateKnowledgeTrust(rows)};
  }

  if(name==="get_business_policy"){
   return{ok:true,tool:name,data:await getBusinessPolicy(ctx.tenantId,s)};
  }

  if(name==="get_customer"){
   const customerId=a.customer_id??ctx.customerId;
   if(!id(customerId))return fail(name,"invalid_customer_id","A valid customer_id is required.");
   const c=await customer(s,ctx.tenantId,customerId as string);if(!c)return fail(name,"customer_not_found","Customer was not found.");
   const[{data:identities},{data:orders},{data:leads},{data:followups}]=await Promise.all([
    s.from("customer_identities").select("id,channel,external_id,display_name,phone,email,metadata").eq("tenant_id",ctx.tenantId).eq("customer_id",customerId),
    s.from("orders").select("id,status,total,currency,payment_status,source_channel,created_at,updated_at").eq("tenant_id",ctx.tenantId).eq("customer_id",customerId).order("created_at",{ascending:false}).limit(20),
    s.from("leads").select("id,status,source_channel,budget,intent,notes,created_at,updated_at").eq("tenant_id",ctx.tenantId).eq("customer_id",customerId).order("created_at",{ascending:false}).limit(20),
    s.from("followups").select("id,channel,message,scheduled_for,status,attempts,last_error").eq("tenant_id",ctx.tenantId).eq("customer_id",customerId).order("scheduled_for",{ascending:true}).limit(20)
   ]);
   return{ok:true,tool:name,data:{customer:c,identities:identities??[],orders:orders??[],leads:leads??[],followups:followups??[]}};
  }

  if(name==="create_lead"){
   await requireFeature(ctx.tenantId,"core_ai",s);
   const customerId=a.customer_id??ctx.customerId;
   if(!id(customerId))return fail(name,"customer_required","A valid customer_id is required.");
   if(!await customer(s,ctx.tenantId,customerId as string))return fail(name,"customer_not_found","Customer was not found.");
   const status=a.status??"new";if(!["new","qualified","won","lost"].includes(String(status)))return fail(name,"invalid_status","Invalid lead status.");
   const budget=a.budget==null?null:Number(a.budget);if(budget!==null&&(!Number.isFinite(budget)||budget<0))return fail(name,"invalid_budget","Invalid lead budget.");
   const payload={tenant_id:ctx.tenantId,customer_id:customerId,status:String(status),source_channel:text(a.source_channel,100),budget,intent:text(a.intent,500)||null,notes:text(a.notes,2000)||null};
   const{data,error}=await s.from("leads").insert(payload).select("id,status,customer_id,source_channel,budget,intent,notes,created_at,updated_at").single();
   if(error)throw error;
   return{ok:true,tool:name,data};
  }

  if(name==="create_order"){
   await requireFeature(ctx.tenantId,"orders",s);
   const customerId=a.customer_id??ctx.customerId;if(!id(customerId))return fail(name,"customer_required","A valid customer_id is required.");
   if(!await customer(s,ctx.tenantId,customerId as string))return fail(name,"customer_not_found","Customer was not found.");
   if(!Array.isArray(a.items)||!a.items.length||a.items.length>50)return fail(name,"invalid_items","1 to 50 items are required.");
   const items=a.items.map((x:any)=>({product_id:x?.product_id??null,variant_id:x?.variant_id??null,quantity:x?.quantity}));
   if(items.some((x:any)=>!id(x.product_id)&&!id(x.variant_id)))return fail(name,"invalid_items","Each item needs a valid product_id or variant_id.");
   if(items.some((x:any)=>id(x.product_id)&&id(x.variant_id)))return fail(name,"invalid_items","Each item must use either product_id or variant_id, not both.");
   if(items.some((x:any)=>!Number.isInteger(Number(x.quantity))||Number(x.quantity)<=0||Number(x.quantity)>1000))return fail(name,"invalid_quantity","Invalid quantity.");
   const confirmationTokenHash=text(a.confirmation_token_hash,128);
   if(confirmationTokenHash && !/^[0-9a-f]{64}$/i.test(confirmationTokenHash))return fail(name,"invalid_confirmation_token","A valid server-issued confirmation token hash is required.");
   if(!confirmationTokenHash)return fail(name,"confirmation_required","An explicit server-issued order confirmation is required.");
   const{data,error}=await s.rpc("execute_confirmed_order_atomic",{p_tenant_id:ctx.tenantId,p_token_hash:confirmationTokenHash});
   if(error)return fail(name,"order_confirmation_failed",error.message.includes("already_used")?"The confirmation has already been used.":error.message.includes("expired")?"The confirmation has expired.":error.message.includes("required")?"Explicit confirmation is required.":error.message.includes("integrity_failure")?"The confirmation integrity check failed.":"The confirmed order could not be created safely.");
   if(!data?.order_id)return fail(name,"order_read_failed","The order action completed without a verified order result.");
   const{data:order}=await s.from("orders").select("id,status,total,currency,payment_status,source_channel,created_at,updated_at").eq("tenant_id",ctx.tenantId).eq("id",data.order_id).maybeSingle();
   if(!order)return fail(name,"order_read_failed","Order action completed but the order could not be verified.");
   return{ok:true,tool:name,data:{order,confirmation_id:data.confirmation_id}};
  }

  if(name==="get_order"){
   const orderId=a.order_id;if(!id(orderId))return fail(name,"invalid_order_id","A valid order_id is required.");
   const{data,error}=await s.from("orders").select("id,tenant_id,customer_id,status,currency,subtotal,discount,total,payment_status,source_channel,metadata,created_at,updated_at,order_items(*)").eq("tenant_id",ctx.tenantId).eq("id",orderId).maybeSingle();
   if(error)throw error;if(!data)return fail(name,"order_not_found","Order was not found.");
   return{ok:true,tool:name,data};
  }

  if(name==="handoff_to_human"){
   await requireFeature(ctx.tenantId,"handoff",s);
   const conversationId=a.conversation_id??ctx.conversationId;
   if(!id(conversationId))return fail(name,"conversation_required","A valid conversation_id is required.");
   const{data:conversation,error}=await s.from("conversations").select("id,customer_id,handoff,status,assigned_to").eq("tenant_id",ctx.tenantId).eq("id",conversationId).maybeSingle();
   if(error)throw error;if(!conversation)return fail(name,"conversation_not_found","Conversation was not found.");
   const patch:any={handoff:true,status:"open",assigned_to:null};
   const{data:updated,error:updateError}=await s.from("conversations").update(patch).eq("tenant_id",ctx.tenantId).eq("id",conversationId).select("id,handoff,status,assigned_to").single();
   if(updateError)throw updateError;
   await s.from("audit_logs").insert({tenant_id:ctx.tenantId,actor_id:ctx.userId,action:"conversation.handoff_to_human",resource_type:"conversation",resource_id:conversationId,old_data:conversation,new_data:updated,reason:text(a.reason,1000)||"AI requested human handoff"});
   return{ok:true,tool:name,data:updated};
  }

  if(name==="schedule_followup"){
   const customerId=a.customer_id??ctx.customerId;if(!id(customerId))return fail(name,"customer_required","A valid customer_id is required.");
   if(!await customer(s,ctx.tenantId,customerId as string))return fail(name,"customer_not_found","Customer was not found.");
   const channel=text(a.channel,50);if(!["whatsapp","website","instagram","facebook","email"].includes(channel))return fail(name,"invalid_channel","Unsupported follow-up channel.");
   const message=text(a.message,4000);if(!message)return fail(name,"message_required","Follow-up message is required.");
   const when=text(a.scheduled_for,100);const dt=new Date(when);if(!when||Number.isNaN(dt.getTime())||dt.getTime()<=Date.now())return fail(name,"invalid_schedule","scheduled_for must be a valid future timestamp.");
   const{data,error}=await s.rpc("schedule_followup_atomic",{p_tenant_id:ctx.tenantId,p_customer_id:customerId,p_conversation_id:id(a.conversation_id)?a.conversation_id:null,p_channel:channel,p_message:message,p_scheduled_for:dt.toISOString()});
   if(error)return fail(name,"followup_creation_failed",error.message.includes("usage_limit_exceeded")?"The follow-up limit has been reached.":error.message.includes("conversation_not_found")?"The conversation does not belong to this customer.":"The follow-up could not be scheduled safely.");
   if(!data?.followup_id)return fail(name,"followup_creation_failed","The follow-up was not verified after scheduling.");
   const{data:followup}=await s.from("followups").select("id,customer_id,conversation_id,channel,message,scheduled_for,status,created_at,updated_at").eq("tenant_id",ctx.tenantId).eq("id",data.followup_id).maybeSingle();
   if(!followup)return fail(name,"followup_read_failed","Follow-up was scheduled but could not be verified.");
   return{ok:true,tool:name,data:followup};
  }

  if(name==="send_product"||name==="send_checkout"){
   return fail(name,"channel_not_configured","A real outbound channel adapter is required before this action can execute.");
  }

  return fail(name,"unsupported_tool","Tool is not registered.");
 }catch(e){
  return fail(name,"tool_execution_failed","The tool failed safely; no unverified success is reported.");
 }
}

export const SALES_TOOL_REGISTRY:Record<SalesToolName,{description:string;mutating:boolean}>={
 search_products:{description:"Search verified tenant catalog products.",mutating:false},
 get_product:{description:"Read one verified tenant product and variants.",mutating:false},
 check_inventory:{description:"Read live tenant inventory for a product or variant.",mutating:false},
 get_price:{description:"Read live tenant price for a product or variant.",mutating:false},
 get_variant:{description:"Read one verified tenant variant.",mutating:false},
 search_knowledge:{description:"Search active tenant business knowledge.",mutating:false},
 get_business_policy:{description:"Read verified tenant policies.",mutating:false},
 create_lead:{description:"Create a tenant-scoped lead after customer qualification.",mutating:true},
 create_order:{description:"Create an atomic tenant-scoped order using server-verified catalog data.",mutating:true},
 get_order:{description:"Read a tenant-scoped order.",mutating:false},
 get_customer:{description:"Read tenant-scoped Customer 360 context.",mutating:false},
 send_product:{description:"Send a product through a configured outbound channel.",mutating:true},
 send_checkout:{description:"Send checkout through a configured outbound channel.",mutating:true},
 handoff_to_human:{description:"Transfer a tenant conversation to a human.",mutating:true},
 schedule_followup:{description:"Schedule a tenant-scoped follow-up.",mutating:true}
};


export const AI_TOOL_DEFINITIONS:AIToolDefinition[]=[
 {type:"function",function:{name:"search_products",description:"Search verified products in the current business catalog.",parameters:{type:"object",properties:{query:{type:"string",maxLength:1000}},required:["query"],additionalProperties:false}}},
 {type:"function",function:{name:"get_product",description:"Read one verified product and its variants.",parameters:{type:"object",properties:{product_id:{type:"string"}},required:["product_id"],additionalProperties:false}}},
 {type:"function",function:{name:"check_inventory",description:"Read live inventory for one product or variant.",parameters:{type:"object",properties:{product_id:{type:"string"},variant_id:{type:"string"}},additionalProperties:false}}},
 {type:"function",function:{name:"get_price",description:"Read live price for one product or variant.",parameters:{type:"object",properties:{product_id:{type:"string"},variant_id:{type:"string"}},additionalProperties:false}}},
 {type:"function",function:{name:"get_variant",description:"Read one verified product variant.",parameters:{type:"object",properties:{variant_id:{type:"string"}},required:["variant_id"],additionalProperties:false}}},
 {type:"function",function:{name:"search_knowledge",description:"Search active business knowledge for the current tenant.",parameters:{type:"object",properties:{query:{type:"string",maxLength:1000}},required:["query"],additionalProperties:false}}},
 {type:"function",function:{name:"get_business_policy",description:"Read verified business policies.",parameters:{type:"object",properties:{},additionalProperties:false}}},
 {type:"function",function:{name:"create_lead",description:"Create a qualified sales lead for the current customer when sales intent is clear.",parameters:{type:"object",properties:{customer_id:{type:"string"},status:{type:"string",enum:["new","qualified","won","lost"]},source_channel:{type:"string"},budget:{type:"number"},intent:{type:"string",maxLength:500},notes:{type:"string",maxLength:2000}},additionalProperties:false}}},
 {type:"function",function:{name:"create_order",description:"Create an order only through an explicit server-issued confirmation token; direct execution is blocked.",parameters:{type:"object",properties:{customer_id:{type:"string"},source_channel:{type:"string"},currency:{type:"string"},items:{type:"array",minItems:1,maxItems:50,items:{type:"object",properties:{product_id:{type:"string"},variant_id:{type:"string"},quantity:{type:"integer",minimum:1}},additionalProperties:false}}},required:["items"],additionalProperties:false}}},
 {type:"function",function:{name:"get_order",description:"Read one verified order.",parameters:{type:"object",properties:{order_id:{type:"string"}},required:["order_id"],additionalProperties:false}}},
 {type:"function",function:{name:"get_customer",description:"Read Customer 360 data for the current tenant.",parameters:{type:"object",properties:{customer_id:{type:"string"}},additionalProperties:false}}},
 {type:"function",function:{name:"send_product",description:"Send a product through a configured outbound channel; never claim success unless the adapter confirms it.",parameters:{type:"object",properties:{product_id:{type:"string"},variant_id:{type:"string"},conversation_id:{type:"string"}},additionalProperties:false}}},
 {type:"function",function:{name:"send_checkout",description:"Send a checkout action through a configured outbound channel; never claim success unless the adapter confirms it.",parameters:{type:"object",properties:{order_id:{type:"string"},conversation_id:{type:"string"}},required:["order_id"],additionalProperties:false}}},
 {type:"function",function:{name:"handoff_to_human",description:"Transfer the current conversation to a human when needed.",parameters:{type:"object",properties:{conversation_id:{type:"string"},reason:{type:"string",maxLength:1000}},additionalProperties:false}}},
 {type:"function",function:{name:"schedule_followup",description:"Schedule a future follow-up only when the customer has requested or clearly consented to follow-up.",parameters:{type:"object",properties:{customer_id:{type:"string"},conversation_id:{type:"string"},channel:{type:"string"},message:{type:"string",maxLength:4000},scheduled_for:{type:"string"}},required:["message","scheduled_for","channel"],additionalProperties:false}}}
];

export type AIToolDefinition={type:"function";function:{name:string;description:string;parameters:Record<string,unknown>}};
