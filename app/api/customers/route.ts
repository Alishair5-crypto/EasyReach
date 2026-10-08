import {NextResponse} from "next/server";
import {getTenantContext} from "@/lib/auth";

const cleanQuery=(value:string)=>value.replace(/[,%()]/g," ").trim().slice(0,120);

export async function GET(req:Request){
  try{
    const {supabase,tenant}=await getTenantContext();
    if(!tenant)return NextResponse.json({error:"workspace_required"},{status:400});
    const url=new URL(req.url);
    const q=cleanQuery(url.searchParams.get("q")??"");
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit")??25)||25));
    let query=supabase.from("customers").select("id,external_key,name,phone,email,preferred_language,consent,tags,notes,last_seen_at,created_at,updated_at").eq("tenant_id",tenant.id).order("last_seen_at",{ascending:false,nullsFirst:false}).order("created_at",{ascending:false}).limit(limit);
    if(q)query=query.or("name.ilike.%"+q+"%,phone.ilike.%"+q+"%,email.ilike.%"+q+"%,external_key.ilike.%"+q+"%");
    const {data,error}=await query;
    if(error)throw error;
    const customers=data??[];
    const ids=customers.map(c=>c.id);
    if(!ids.length)return NextResponse.json({customers:[]});
    const [identityResult,conversationResult,orderResult,leadResult,followupResult]=await Promise.all([
      supabase.from("customer_identities").select("id,customer_id,channel,external_id,display_name,phone,email,metadata").eq("tenant_id",tenant.id).in("customer_id",ids),
      supabase.from("conversations").select("id,customer_id,channel,status,priority,assigned_to,handoff,last_message_at,created_at").eq("tenant_id",tenant.id).in("customer_id",ids).order("last_message_at",{ascending:false}),
      supabase.from("orders").select("id,customer_id,status,currency,total,payment_status,source_channel,created_at,updated_at").eq("tenant_id",tenant.id).in("customer_id",ids).order("created_at",{ascending:false}),
      supabase.from("leads").select("id,customer_id,status,source_channel,budget,intent,notes,created_at,updated_at").eq("tenant_id",tenant.id).in("customer_id",ids).order("created_at",{ascending:false}),
      supabase.from("followups").select("id,customer_id,conversation_id,channel,scheduled_for,status,attempts,last_error,created_at").eq("tenant_id",tenant.id).in("customer_id",ids).order("scheduled_for",{ascending:true})
    ]);
    if([identityResult,conversationResult,orderResult,leadResult,followupResult].some(x=>x.error))throw new Error("customer_360_query_failed");
    const identities=identityResult.data??[],conversations=conversationResult.data??[],orders=orderResult.data??[],leads=leadResult.data??[],followups=followupResult.data??[];
    const map=new Map(customers.map(c=>[c.id,{...c,identities:(identities??[]).filter(x=>x.customer_id===c.id),conversations:(conversations??[]).filter(x=>x.customer_id===c.id),orders:(orders??[]).filter(x=>x.customer_id===c.id),leads:(leads??[]).filter(x=>x.customer_id===c.id),followups:(followups??[]).filter(x=>x.customer_id===c.id)}]));
    return NextResponse.json({customers:Array.from(map.values())});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"customer_list_failed"},{status:500});
  }
}