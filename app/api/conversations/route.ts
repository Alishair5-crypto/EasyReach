import {NextResponse} from "next/server";
import {getTenantContext} from "@/lib/auth";

const allowedStatuses=["open","pending","closed"] as const;
const allowedPriorities=["low","normal","high","urgent"] as const;
const allowedChannels=["whatsapp","website","shopify","woocommerce","instagram","facebook","email","google_sheets","crm","pos","custom_api"] as const;
const clean=(v:string)=>v.replace(/[,%()]/g," ").trim().slice(0,120);

export async function GET(req:Request){
  try{
    const {supabase,tenant}=await getTenantContext();
    if(!tenant)return NextResponse.json({error:"workspace_required"},{status:400});
    const u=new URL(req.url),q=clean(u.searchParams.get("q")??""),status=u.searchParams.get("status")??"",priority=u.searchParams.get("priority")??"",channel=u.searchParams.get("channel")??"",assignment=u.searchParams.get("assignment")??"all";
    const limit=Math.min(50,Math.max(1,Number(u.searchParams.get("limit")??30)||30));
    let query=supabase.from("conversations").select("id,customer_id,channel,external_id,status,priority,assigned_to,handoff,last_message_at,created_at").eq("tenant_id",tenant.id).order("last_message_at",{ascending:false,nullsFirst:false}).limit(limit);
    if(status&&allowedStatuses.includes(status as typeof allowedStatuses[number]))query=query.eq("status",status);
    if(priority&&allowedPriorities.includes(priority as typeof allowedPriorities[number]))query=query.eq("priority",priority);
    if(channel&&allowedChannels.includes(channel as typeof allowedChannels[number]))query=query.eq("channel",channel);
    if(assignment==="unassigned")query=query.is("assigned_to",null); else if(assignment==="mine")query=query.eq("assigned_to",(await getTenantContext()).user.id);
    const {data:conversations,error}=await query;if(error)throw error;
    const rows=conversations??[], customerIds=rows.map(x=>x.customer_id).filter(Boolean) as string[], ids=rows.map(x=>x.id);
    const [{data:customers},{data:members},{data:messages}]=await Promise.all([
      customerIds.length?supabase.from("customers").select("id,name,phone,email,preferred_language,tags").eq("tenant_id",tenant.id).in("id",customerIds):Promise.resolve({data:[]}),
      supabase.from("tenant_members").select("user_id,role").eq("tenant_id",tenant.id),
      ids.length?supabase.from("messages").select("id,conversation_id,direction,sender_type,content,media,created_at,read_at").eq("tenant_id",tenant.id).in("conversation_id",ids).order("created_at",{ascending:false}):Promise.resolve({data:[]})
    ]);
    const customerMap=new Map((customers??[]).map(x=>[x.id,x]));
    const memberIds=(members??[]).map(x=>x.user_id);
    const {data:profiles}=memberIds.length?await supabase.from("profiles").select("id,email,full_name").in("id",memberIds):{data:[]};
    const profileMap=new Map((profiles??[]).map(x=>[x.id,x]));
    const lastBy=new Map<string,any>(); for(const m of messages??[])if(!lastBy.has(m.conversation_id))lastBy.set(m.conversation_id,m);
    const unread=new Map<string,number>(); for(const m of messages??[])if(m.direction==="inbound"&&!m.read_at)unread.set(m.conversation_id,(unread.get(m.conversation_id)??0)+1);
    const result=rows.map(c=>({...c,customer:c.customer_id?customerMap.get(c.customer_id)??null:null,assignee:c.assigned_to?profileMap.get(c.assigned_to)??null:null,lastMessage:lastBy.get(c.id)??null,unreadCount:unread.get(c.id)??0}));
    if(q){const qq=q.toLowerCase();return NextResponse.json({conversations:result.filter(x=>[x.customer?.name,x.customer?.phone,x.customer?.email,x.channel,x.external_id].some(v=>String(v??"").toLowerCase().includes(qq)))});}
    return NextResponse.json({conversations:result,members:members??[]});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"conversation_list_failed"},{status:500});}
}