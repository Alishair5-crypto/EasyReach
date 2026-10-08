alter table public.ai_action_confirmations add column if not exists payload_hash text;
update public.ai_action_confirmations set payload_hash=encode(digest(payload::text,'sha256'),'hex') where payload_hash is null;
alter table public.ai_action_confirmations alter column payload_hash set not null;
create unique index if not exists ai_action_confirmations_payload_hash_idx on public.ai_action_confirmations(id,payload_hash);
create or replace function public.ai_action_confirmations_immutable_guard() returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
 if new.tenant_id<>old.tenant_id or new.agent_id is distinct from old.agent_id or new.conversation_id is distinct from old.conversation_id or new.customer_id is distinct from old.customer_id or new.action_type<>old.action_type or new.payload<>old.payload or new.payload_hash<>old.payload_hash or new.token_hash<>old.token_hash or new.expires_at<>old.expires_at or new.created_at<>old.created_at then raise exception 'confirmation_immutable'; end if;
 return new;
end
$function$;
drop trigger if exists ai_action_confirmations_immutable on public.ai_action_confirmations;
create trigger ai_action_confirmations_immutable before update on public.ai_action_confirmations for each row execute function public.ai_action_confirmations_immutable_guard();

create or replace function public.execute_confirmed_order_atomic(p_tenant_id uuid,p_token_hash text) returns jsonb language plpgsql set search_path=public,pg_temp as $function$
declare c public.ai_action_confirmations%rowtype; v_order uuid; v_key text; v_hash text;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=p_tenant_id and user_id=auth.uid() and role in ('owner','admin','manager','sales')) then raise exception 'not_authorized'; end if;
 if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'invalid_confirmation_token'; end if;
 select * into c from public.ai_action_confirmations where tenant_id=p_tenant_id and token_hash=p_token_hash for update;
 if not found then raise exception 'confirmation_not_found'; end if;
 if c.action_type<>'create_order' then raise exception 'unsupported_confirmation_action'; end if;
 if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
 if c.confirmed_at is null then raise exception 'confirmation_required'; end if;
 if c.expires_at<=now() then raise exception 'confirmation_expired'; end if;
 v_hash:=encode(digest(c.payload::text,'sha256'),'hex'); if v_hash<>c.payload_hash then raise exception 'confirmation_integrity_failure'; end if;
 v_key:='ai-confirmation:'||c.id::text;
 v_order:=public.create_order_atomic(p_tenant_id,c.customer_id,coalesce(c.payload->>'source_channel','dashboard'),coalesce(c.payload->>'currency','PKR'),coalesce(c.payload->'items','[]'::jsonb),v_key);
 update public.ai_action_confirmations set consumed_at=now(),confirmed_by=auth.uid() where id=c.id;
 insert into public.order_action_receipts(tenant_id,order_id,action_key,action_type,result) values(p_tenant_id,v_order,v_key,'create_order',jsonb_build_object('confirmation_id',c.id,'confirmed_by',auth.uid())) on conflict do nothing;
 insert into public.audit_logs(tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason) values(p_tenant_id,auth.uid(),'ai.confirmed_order_created','order',v_order,jsonb_build_object('confirmation_id',c.id,'payload_hash',c.payload_hash),jsonb_build_object('order_id',v_order),'Explicit server-issued action confirmation');
 return jsonb_build_object('confirmation_id',c.id,'order_id',v_order,'action_type','create_order','consumed_at',now());
end
$function$;

create or replace function public.schedule_followup_atomic(p_tenant_id uuid,p_customer_id uuid,p_conversation_id uuid,p_channel text,p_message text,p_scheduled_for timestamptz) returns jsonb language plpgsql set search_path=public,pg_temp as $function$
declare v_followup uuid; v_allowed boolean; v_quantity bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=p_tenant_id and user_id=auth.uid() and role in ('owner','admin','manager','sales')) then raise exception 'not_authorized'; end if;
 if not exists(select 1 from public.subscriptions sub join public.plans pl on pl.id=sub.plan_id where sub.tenant_id=p_tenant_id and sub.status in ('active','trial') and sub.starts_at<=now() and (sub.ends_at is null or sub.ends_at>now())) then raise exception 'plan_inactive'; end if;
 if not exists(select 1 from public.customers where tenant_id=p_tenant_id and id=p_customer_id) then raise exception 'customer_not_found'; end if;
 if p_conversation_id is not null and not exists(select 1 from public.conversations where tenant_id=p_tenant_id and id=p_conversation_id and customer_id=p_customer_id) then raise exception 'conversation_not_found'; end if;
 if p_channel not in ('whatsapp','website','instagram','facebook','email') then raise exception 'invalid_channel'; end if;
 if p_message is null or length(trim(p_message))=0 or length(p_message)>4000 then raise exception 'message_required'; end if;
 if p_scheduled_for is null or p_scheduled_for<=now() then raise exception 'invalid_schedule'; end if;
 select allowed,quantity into v_allowed,v_quantity from public.consume_usage(p_tenant_id,'followups',1,0); if not v_allowed then raise exception 'usage_limit_exceeded'; end if;
 insert into public.followups(tenant_id,customer_id,conversation_id,channel,message,scheduled_for,status,attempts,last_error) values(p_tenant_id,p_customer_id,p_conversation_id,p_channel,trim(p_message),p_scheduled_for,'scheduled',0,null) returning id into v_followup;
 return jsonb_build_object('followup_id',v_followup,'quantity',v_quantity);
end
$function$;

create or replace function public.create_order_atomic(p_tenant_id uuid,p_customer_id uuid,p_source_channel text,p_currency text,p_items jsonb,p_idempotency_key text) returns uuid language plpgsql set search_path=public,pg_temp as $function$
declare v_order uuid; v_item jsonb; v_product uuid; v_variant uuid; v_qty numeric; v_unit numeric; v_total numeric:=0; v_name text; v_avail boolean; v_inv numeric; v_variant_inv numeric;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members where tenant_id=p_tenant_id and user_id=auth.uid() and role in ('owner','admin','manager','sales')) then raise exception 'not_authorized'; end if;
 if not exists(select 1 from public.subscriptions sub join public.plans pl on pl.id=sub.plan_id where sub.tenant_id=p_tenant_id and sub.status in ('active','trial') and sub.starts_at<=now() and (sub.ends_at is null or sub.ends_at>now()) and coalesce((pl.features->>'orders')::boolean,false)=true) then raise exception 'plan_inactive'; end if;
 if p_idempotency_key is null or length(trim(p_idempotency_key))<8 or length(trim(p_idempotency_key))>200 then raise exception 'invalid_idempotency_key'; end if;
 select id into v_order from public.orders where tenant_id=p_tenant_id and creation_idempotency_key=trim(p_idempotency_key) limit 1; if v_order is not null then return v_order; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where tenant_id=p_tenant_id and id=p_customer_id) then raise exception 'customer_not_found'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>50 then raise exception 'invalid_items'; end if;
 v_order:=gen_random_uuid();
 insert into public.orders(id,tenant_id,customer_id,status,currency,subtotal,discount,total,payment_status,source_channel,metadata,creation_idempotency_key) values(v_order,p_tenant_id,p_customer_id,'pending',coalesce(nullif(p_currency,''),'PKR'),0,0,0,'unpaid',nullif(p_source_channel,''),'{}'::jsonb,trim(p_idempotency_key));
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_product:=nullif(v_item->>'product_id','')::uuid; v_variant:=nullif(v_item->>'variant_id','')::uuid; v_qty:=coalesce((v_item->>'quantity')::numeric,0); if v_qty<=0 or v_qty>10000 then raise exception 'invalid_quantity'; end if;
  if v_variant is not null then
   select coalesce(pv.sale_price,pv.price),pv.availability,pv.inventory_quantity,pv.product_id,p.name into v_unit,v_avail,v_variant_inv,v_product,v_name from public.product_variants pv join public.products p on p.id=pv.product_id and p.tenant_id=pv.tenant_id where pv.tenant_id=p_tenant_id and pv.id=v_variant for update;
   if v_unit is null then raise exception 'variant_price_unavailable'; end if; if v_avail is false or (v_variant_inv is not null and v_variant_inv<v_qty) then raise exception 'insufficient_inventory'; end if;
   update public.product_variants set inventory_quantity=case when inventory_quantity is null then null else inventory_quantity-v_qty end where tenant_id=p_tenant_id and id=v_variant;
  elsif v_product is not null then
   select coalesce(sale_price,price),availability,inventory_quantity,name into v_unit,v_avail,v_inv,v_name from public.products where tenant_id=p_tenant_id and id=v_product for update;
   if v_unit is null then raise exception 'product_price_unavailable'; end if; if v_avail is false or (v_inv is not null and v_inv<v_qty) then raise exception 'insufficient_inventory'; end if;
   update public.products set inventory_quantity=case when inventory_quantity is null then null else inventory_quantity-v_qty end where tenant_id=p_tenant_id and id=v_product;
  else raise exception 'product_required'; end if;
  v_total:=v_total+(v_unit*v_qty); insert into public.order_items(tenant_id,order_id,product_id,variant_id,quantity,unit_price,total,metadata) values(p_tenant_id,v_order,v_product,v_variant,v_qty,v_unit,v_unit*v_qty,jsonb_build_object('product_name',v_name));
 end loop;
 update public.orders set subtotal=v_total,total=v_total where id=v_order and tenant_id=p_tenant_id; return v_order;
exception when unique_violation then select id into v_order from public.orders where tenant_id=p_tenant_id and creation_idempotency_key=trim(p_idempotency_key) limit 1; if v_order is not null then return v_order; end if; raise;
when invalid_text_representation then raise exception 'invalid_item_id'; end
$function$;