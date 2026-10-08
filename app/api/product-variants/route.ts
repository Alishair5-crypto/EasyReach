import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requirePlanActive } from "@/lib/entitlements";

const ROLES = new Set(["owner","admin","manager"]);
const text = (v: unknown, n: number) => typeof v === "string" ? v.trim().slice(0,n) : "";
const num = (v: unknown) => v === null || v === undefined || v === "" ? null : Number(v);

export async function GET(req: Request) {
  try {
    const { tenant, supabase } = await getTenantContext();
    if (!tenant) return NextResponse.json({ error:"workspace_required" }, { status:400 });
    const u = new URL(req.url), productId = text(u.searchParams.get("product_id"),100);
    if (!productId) return NextResponse.json({ error:"product_id_required" }, { status:400 });
    const { data, error } = await supabase.from("product_variants").select("*")
      .eq("tenant_id",tenant.id).eq("product_id",productId).order("created_at",{ascending:true});
    if (error) throw error;
    return NextResponse.json({ variants:data??[] });
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"variants_load_failed"},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !user || !membership) return NextResponse.json({error:"workspace_required"},{status:400});
    if (!ROLES.has(membership.role)) return NextResponse.json({error:"forbidden"},{status:403});
    await requirePlanActive(tenant.id,supabase);
    const b=await req.json().catch(()=>({}));
    const productId=text(b.product_id,100), name=text(b.name,200);
    if (!productId || !name) return NextResponse.json({error:"product_id_and_name_required"},{status:400});
    const {data:product,error:pe}=await supabase.from("products").select("id").eq("tenant_id",tenant.id).eq("id",productId).maybeSingle();
    if(pe) throw pe; if(!product) return NextResponse.json({error:"product_not_found"},{status:404});
    const price=num(b.price), sale=num(b.sale_price), inventory=num(b.inventory_quantity);
    if([price,sale,inventory].some(v=>v!==null&&(!Number.isFinite(v)||v<0))) return NextResponse.json({error:"invalid_numeric_value"},{status:400});
    const payload={tenant_id:tenant.id,product_id:productId,name,sku:text(b.sku,120)||null,attributes:b.attributes&&typeof b.attributes==="object"&&!Array.isArray(b.attributes)?b.attributes:{},price,sale_price:sale,inventory_quantity:inventory,availability:b.availability===undefined?true:Boolean(b.availability),images:Array.isArray(b.images)?b.images:[],external_id:text(b.external_id,200)||null,source:"manual"};
    const {data,error}=await supabase.from("product_variants").insert(payload).select("*").single();
    if(error) throw error;
    const audit=await supabase.from("audit_logs").insert({tenant_id:tenant.id,actor_id:user.id,action:"product_variant.created",resource_type:"product_variant",resource_id:data.id,new_data:data,reason:"Manual verified variant created"});
    if(audit.error) throw audit.error;
    return NextResponse.json({variant:data},{status:201});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"variant_create_failed"},{status:500}); }
}

export async function PATCH(req: Request) {
  try {
    const { tenant, user, membership, supabase } = await getTenantContext();
    if (!tenant || !user || !membership) return NextResponse.json({error:"workspace_required"},{status:400});
    if (!ROLES.has(membership.role)) return NextResponse.json({error:"forbidden"},{status:403});
    const b=await req.json().catch(()=>({})), id=text(b.id,100);
    if(!id) return NextResponse.json({error:"variant_id_required"},{status:400});
    const {data:before,error:be}=await supabase.from("product_variants").select("*").eq("tenant_id",tenant.id).eq("id",id).maybeSingle();
    if(be) throw be; if(!before) return NextResponse.json({error:"variant_not_found"},{status:404});
    const patch:Record<string,unknown>={};
    for(const k of ["sku","name","external_id"]) if(k in b) patch[k]=text(b[k],k==="name"?200:200)||null;
    for(const k of ["price","sale_price","inventory_quantity"]) if(k in b){const v=num(b[k]);if(v!==null&&(!Number.isFinite(v)||v<0))return NextResponse.json({error:"invalid_numeric_value"},{status:400});patch[k]=v;}
    if("availability" in b) patch.availability=Boolean(b.availability);
    if("images" in b&&Array.isArray(b.images)) patch.images=b.images;
    if("attributes" in b&&b.attributes&&typeof b.attributes==="object"&&!Array.isArray(b.attributes)) patch.attributes=b.attributes;
    if(!Object.keys(patch).length)return NextResponse.json({error:"no_changes"},{status:400});
    patch.updated_at=new Date().toISOString();
    const {data,error}=await supabase.from("product_variants").update(patch).eq("tenant_id",tenant.id).eq("id",id).select("*").single();
    if(error) throw error;
    const audit=await supabase.from("audit_logs").insert({tenant_id:tenant.id,actor_id:user.id,action:"product_variant.updated",resource_type:"product_variant",resource_id:id,old_data:before,new_data:data,reason:typeof b.reason==="string"?b.reason.slice(0,500):"Verified variant update"});
    if(audit.error) throw audit.error;
    return NextResponse.json({variant:data});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"variant_update_failed"},{status:500}); }
}