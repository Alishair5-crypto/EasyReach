import{createClient}from"@/lib/supabase/server";
import type{SupabaseClient}from"@supabase/supabase-js";
type Db=SupabaseClient;
type Product={id:string;name:string;description:string|null;category:string|null;price:number|null;sale_price:number|null;currency:string|null;images:unknown;availability:boolean|null;inventory_quantity:number|null;product_url:string|null;variants?:unknown[]};
function terms(q:string){return q.toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu," ").split(/\s+/).filter(x=>x.length>2&&!["mujhe","chahiye","wala","wali","wale","ke","andar","under","with","want","need","the","for","and","hai","ka","ki","kya","is","mein","me"].includes(x)).slice(0,5)}
export function extractBudget(q:string){const m=q.match(/(?:under|below|less than|within|under\s+rs|rs\.?|pkr\s*|budget\s*)\s*([0-9]{3,7})/i)||q.match(/([0-9]{3,7})\s*(?:ke|ka|ki)?\s*(?:andar|under|tak)/i);return m?Number(m[1]):null}
export async function searchProducts(tenantId:string,q:string,db?:Db){const s=db??await createClient();const words=terms(q);const budget=extractBudget(q);if(!words.length&&!budget)return[];let rows:Product[]=[];
for(const w of words){const x=w.replace(/[%_,()]/g,"").slice(0,40);if(!x)continue;const{data}=await s.from("products").select("id,name,description,category,price,sale_price,currency,images,availability,inventory_quantity,product_url").eq("tenant_id",tenantId).or(`name.ilike.%${x}%,description.ilike.%${x}%,category.ilike.%${x}%`).limit(12);rows.push(...((data??[]) as Product[]))}
const seen=new Set<string>();rows=rows.filter(p=>!seen.has(p.id)&&seen.add(p.id));
if(budget!==null)rows=rows.filter(p=>Number(p.sale_price??p.price??Number.POSITIVE_INFINITY)<=budget);
if(rows.length)return rows.slice(0,8);
if(budget!==null){const{data}=await s.from("products").select("id,name,description,category,price,sale_price,currency,images,availability,inventory_quantity,product_url").eq("tenant_id",tenantId).or(`sale_price.lte.${budget},price.lte.${budget}`).limit(8);return(data??[]) as Product[]}
return[]
}
export async function getProductVariants(tenantId:string,productIds:string[],db?:Db){if(!productIds.length)return[];const s=db??await createClient();const{data}=await s.from("product_variants").select("id,product_id,sku,name,price,sale_price,inventory_quantity,availability,attributes").eq("tenant_id",tenantId).in("product_id",productIds).limit(100);return data??[]}
export async function getBusinessPolicy(tenantId:string,db?:Db){const s=db??await createClient();const{data}=await s.from("knowledge_documents").select("title,content,verification_status,verified_at,last_synced_at,updated_at").eq("tenant_id",tenantId).eq("source_type","policy").eq("status","active").eq("verification_status","verified").limit(20);return data??[]}