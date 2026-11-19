-- Admin: product editor, staff roles and invites, activity log, discounts,
-- site content and store settings.

-- ---------- products ----------
alter table public.products
  add column if not exists category text not null default 'Wigs',
  add column if not exists compare_at_ngn integer,
  add column if not exists sku text,
  add column if not exists images text[] not null default '{}',
  add column if not exists length_prices jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();
alter table public.products add constraint products_category_check check (category in ('Wigs', 'Bundles', 'Hair care'));
alter table public.products add constraint products_compare_at_check check (compare_at_ngn is null or compare_at_ngn >= 0);

-- price for one length (falls back to the product price)
create or replace function public.product_price(p public.products, p_length text)
returns integer language sql immutable set search_path = '' as $$
  select coalesce(nullif(p.length_prices ->> coalesce(p_length, ''), '')::integer, p.price_ngn);
$$;

-- product photos: public bucket, staff with product access upload
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------- staff: roles, status, permissions ----------
alter table public.staff
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists status text not null default 'active',
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  -- the role used for permissions: owner, manager, sales or inventory
  -- (the older role column stays owner / manager / staff for compatibility)
  add column if not exists access text not null default 'manager';
alter table public.staff add constraint staff_access_check check (access in ('owner', 'manager', 'sales', 'inventory'));
alter table public.staff add constraint staff_status_check check (status in ('active', 'invited', 'suspended'));
update public.staff set access = case role when 'owner' then 'owner' else 'manager' end where access = 'manager' and role = 'owner';
update public.staff s set email = u.email, full_name = coalesce(s.full_name, initcap(split_part(u.email, '@', 1)))
from auth.users u where u.id = s.user_id and s.email is null;

create table if not exists public.staff_invites (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.staff_invites enable row level security; -- no policies: edge function only

-- only active staff count as staff
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and status = 'active');
$$;

create or replace function public.staff_role()
returns text language sql stable security definer set search_path = '' as $$
  select access from public.staff where user_id = (select auth.uid()) and status = 'active';
$$;

-- what a role may do in an area: 'full', 'view' or 'none'
create or replace function public.role_access(p_role text, p_area text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_role = 'owner' then 'full'
    when p_role = 'manager' then case p_area when 'staff' then 'none' when 'settings' then 'view' else 'full' end
    when p_role = 'sales' then case p_area
      when 'orders' then 'full' when 'customers' then 'full' when 'dashboard' then 'view'
      when 'products' then 'view' when 'discounts' then 'view' else 'none' end
    when p_role = 'inventory' then case p_area
      when 'products' then 'full' when 'dashboard' then 'view' when 'orders' then 'view' else 'none' end
    else 'none' end;
$$;

create or replace function public.can(p_area text, p_write boolean default true)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.role_access(public.staff_role(), p_area) = 'full'
    or (not p_write and public.role_access(public.staff_role(), p_area) = 'view'), false);
$$;

-- staff marks themselves as seen (admin pages call this on load)
create or replace function public.touch_staff()
returns jsonb language sql volatile security definer set search_path = '' as $$
  update public.staff set last_seen_at = now() where user_id = (select auth.uid()) and status = 'active'
  returning jsonb_build_object('role', access, 'full_name', full_name, 'email', email);
$$;

-- tighten writes to each area
alter policy "staff insert products" on public.products with check ((select public.can('products')));
alter policy "staff update products" on public.products using ((select public.can('products'))) with check ((select public.can('products')));
alter policy "staff delete products" on public.products using ((select public.can('products')));
alter policy "staff update orders" on public.orders using ((select public.can('orders'))) with check ((select public.can('orders')));
alter policy "staff update alert settings" on public.alert_settings using ((select public.can('settings'))) with check ((select public.can('settings')));
alter policy "staff update delivery options" on public.delivery_options using ((select public.can('settings'))) with check ((select public.can('settings')));

create policy "product staff upload images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.can('products')));
create policy "product staff change images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.can('products')));
create policy "product staff delete images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.can('products')));

-- ---------- activity log ----------
create table if not exists public.staff_activity (
  id bigint generated always as identity primary key,
  user_id uuid,
  actor text,
  action text not null,
  target text,
  target_url text,
  created_at timestamptz not null default now()
);
alter table public.staff_activity enable row level security;
create policy "staff read activity" on public.staff_activity for select to authenticated using ((select public.can('staff', false)));
create index if not exists staff_activity_created_idx on public.staff_activity (created_at desc);

create or replace function public.log_activity(p_action text, p_target text, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_name text;
begin
  if v_uid is null then return; end if;           -- system changes (payments, cron) aren't staff activity
  select coalesce(full_name, email) into v_name from public.staff where user_id = v_uid;
  if v_name is null then return; end if;           -- customers editing their own things
  insert into public.staff_activity (user_id, actor, action, target, target_url) values (v_uid, v_name, p_action, p_target, p_url);
end $$;

create or replace function public.orders_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform public.log_activity('marked order ' || new.status, '#' || new.number, '/admin/orders?q=' || new.number);
  end if;
  if new.payment_status is distinct from old.payment_status then
    perform public.log_activity('set payment to ' || new.payment_status, '#' || new.number, '/admin/orders?q=' || new.number);
  end if;
  return new;
end $$;
create trigger orders_activity after update on public.orders for each row execute function public.orders_activity();

create or replace function public.products_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('added product', new.name, '/admin/product-edit?id=' || new.id);
  elsif tg_op = 'DELETE' then
    perform public.log_activity('deleted product', old.name, null);
    return old;
  elsif new.stock is distinct from old.stock and new.price_ngn is not distinct from old.price_ngn then
    perform public.log_activity('updated stock for', new.name, '/admin/product-edit?id=' || new.id);
  else
    perform public.log_activity('edited product', new.name, '/admin/product-edit?id=' || new.id);
  end if;
  return new;
end $$;
create trigger products_activity after insert or update or delete on public.products for each row execute function public.products_activity();

create or replace function public.products_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger products_touch before update on public.products for each row execute function public.products_touch();

-- ---------- discounts ----------
create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind text not null default 'percent' check (kind in ('percent', 'fixed')),
  value integer not null check (value > 0),
  min_subtotal_ngn integer not null default 0 check (min_subtotal_ngn >= 0),
  first_order_only boolean not null default false,
  featured boolean not null default false,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint discounts_percent_range check (kind <> 'percent' or value <= 90)
);
alter table public.discounts enable row level security;
create policy "staff read discounts" on public.discounts for select to authenticated using ((select public.can('discounts', false)));
create policy "discount staff write discounts" on public.discounts for all to authenticated
  using ((select public.can('discounts'))) with check ((select public.can('discounts')));
create unique index if not exists discounts_one_featured on public.discounts (featured) where featured;

alter table public.orders
  add column if not exists discount_code text,
  add column if not exists discount_ngn integer not null default 0;

-- shopper-side check of a code against a subtotal (no list of codes is ever exposed)
create or replace function public.check_discount(p_code text, p_subtotal integer, p_email text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.discounts; v_amount integer;
begin
  select * into d from public.discounts where code = upper(trim(coalesce(p_code, '')));
  if not found or not d.active or (d.starts_at is not null and d.starts_at > now()) or (d.ends_at is not null and d.ends_at < now()) then
    return jsonb_build_object('ok', false, 'error', 'That code isn’t valid');
  end if;
  if d.max_uses is not null and d.uses >= d.max_uses then return jsonb_build_object('ok', false, 'error', 'That code has been used up'); end if;
  if p_subtotal < d.min_subtotal_ngn then
    return jsonb_build_object('ok', false, 'error', 'This code needs a bag of at least ₦' || to_char(d.min_subtotal_ngn, 'FM999,999,999'));
  end if;
  if d.first_order_only and nullif(trim(coalesce(p_email, '')), '') is not null
     and exists (select 1 from public.orders where email = lower(trim(p_email)) and status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'This code is for your first order');
  end if;
  v_amount := case when d.kind = 'percent' then floor(p_subtotal * d.value / 100.0)::int else least(d.value, p_subtotal) end;
  return jsonb_build_object('ok', true, 'code', d.code, 'amount_ngn', v_amount, 'first_order_only', d.first_order_only,
    'label', case when d.kind = 'percent' then d.value || '% off' else '₦' || to_char(d.value, 'FM999,999,999') || ' off' end);
end $$;

-- ---------- store settings and site content ----------
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  free_delivery_over_ngn integer check (free_delivery_over_ngn is null or free_delivery_over_ngn >= 0),
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (1) on conflict do nothing;
alter table public.store_settings enable row level security;
create policy "anyone reads store settings" on public.store_settings for select using (true);
create policy "settings staff update store settings" on public.store_settings for update to authenticated
  using ((select public.can('settings'))) with check ((select public.can('settings')));

create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  value text not null default '' check (char_length(value) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.site_content enable row level security;
create policy "anyone reads site content" on public.site_content for select using (true);
create policy "content staff write site content" on public.site_content for all to authenticated
  using ((select public.can('content'))) with check ((select public.can('content')));

-- what the announcement bar can show, for shoppers
create or replace function public.store_promos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'free_delivery_over_ngn', (select free_delivery_over_ngn from public.store_settings where id = 1),
    'featured', (select jsonb_build_object('code', code, 'kind', kind, 'value', value, 'first_order_only', first_order_only)
                 from public.discounts where featured and active and (starts_at is null or starts_at <= now())
                   and (ends_at is null or ends_at > now()) and (max_uses is null or uses < max_uses) limit 1));
$$;

-- ---------- place_order: per-length prices, discount codes, free delivery ----------
create or replace function public.place_order(customer jsonb, items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_delivery public.delivery_options;
  v_settings public.payment_settings;
  v_store public.store_settings;
  v_order public.orders;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_price integer;
  v_subtotal integer := 0;
  v_fee integer;
  v_discount jsonb;
  v_discount_ngn integer := 0;
  v_code text;
  v_lines jsonb := '[]'::jsonb;
  v_pay text := coalesce(customer->>'payment_method', 'bank_transfer');
  v_provider text := 'manual';
  v_amount bigint;
  v_try integer := 0;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 or jsonb_array_length(items) > 20 then
    raise exception 'Your bag is empty';
  end if;
  if coalesce(trim(customer->>'email'),'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email'; end if;
  if char_length(coalesce(trim(customer->>'phone'),'')) < 7 then raise exception 'Please enter your phone number'; end if;
  if coalesce(trim(customer->>'first_name'),'') = '' or coalesce(trim(customer->>'last_name'),'') = '' then raise exception 'Please enter your name'; end if;
  if coalesce(trim(customer->>'address'),'') = '' or coalesce(trim(customer->>'city'),'') = '' or coalesce(trim(customer->>'state'),'') = '' then
    raise exception 'Please enter your delivery address';
  end if;
  if v_pay not in ('bank_transfer','pay_on_pickup') then raise exception 'That payment method is not available yet'; end if;

  select * into v_delivery from public.delivery_options where code = customer->>'delivery_code' and active;
  if not found then raise exception 'Please choose a delivery option'; end if;
  if v_pay = 'pay_on_pickup' and v_delivery.code <> 'pickup' then raise exception 'Pay on pick-up is only for orders you collect'; end if;

  select * into v_settings from public.payment_settings where id = 1;
  if v_pay = 'bank_transfer' and v_settings.account_number is not null then v_provider := 'cheqpay'; end if;

  for v_item in select * from jsonb_array_elements(items) loop
    select * into v_product from public.products where slug = v_item->>'slug' and active;
    if not found then raise exception 'A product in your bag is no longer available'; end if;
    v_qty := greatest(1, least(20, coalesce((v_item->>'quantity')::int, 1)));
    if v_product.stock < v_qty then raise exception '% is out of stock', v_product.name; end if;
    v_price := public.product_price(v_product, v_item->>'length');
    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'image', v_product.image,
      'options', left(coalesce(v_item->>'options',''), 200), 'unit_price_ngn', v_price, 'quantity', v_qty);
  end loop;

  v_code := nullif(upper(trim(coalesce(customer->>'discount_code', ''))), '');
  if v_code is not null then
    v_discount := public.check_discount(v_code, v_subtotal, customer->>'email');
    if not (v_discount->>'ok')::boolean then raise exception '%', v_discount->>'error'; end if;
    v_discount_ngn := (v_discount->>'amount_ngn')::int;
    update public.discounts set uses = uses + 1 where code = v_code;
  end if;

  select * into v_store from public.store_settings where id = 1;
  v_fee := v_delivery.fee_ngn;
  if v_store.free_delivery_over_ngn is not null and v_delivery.code = 'standard' and v_subtotal >= v_store.free_delivery_over_ngn then
    v_fee := 0;
  end if;

  loop
    v_try := v_try + 1;
    v_amount := case when v_provider = 'cheqpay' then (v_subtotal - v_discount_ngn + v_fee)::bigint * 100 + 1 + floor(random() * 999)::bigint end;
    begin
      insert into public.orders (email, phone, first_name, last_name, address, address2, city, state,
        delivery_code, delivery_fee_ngn, payment_method, payment_provider, pay_amount_kobo, subtotal_ngn, total_ngn, marketing_opt_in,
        discount_code, discount_ngn)
      values (lower(trim(customer->>'email')), left(trim(customer->>'phone'),40), left(trim(customer->>'first_name'),100),
        left(trim(customer->>'last_name'),100), left(trim(customer->>'address'),300), left(nullif(trim(customer->>'address2'),''),300),
        left(trim(customer->>'city'),100), left(trim(customer->>'state'),100), v_delivery.code, v_fee, v_pay,
        v_provider, v_amount, v_subtotal, v_subtotal - v_discount_ngn + v_fee, coalesce((customer->>'marketing_opt_in')::boolean, false),
        v_code, v_discount_ngn)
      returning * into v_order;
      exit;
    exception when unique_violation then
      if v_try >= 25 then raise exception 'We are busy right now — please try again in a minute'; end if;
    end;
  end loop;

  insert into public.order_items (order_id, product_id, name, image, options, unit_price_ngn, quantity)
  select v_order.id, (l->>'product_id')::uuid, l->>'name', l->>'image', l->>'options', (l->>'unit_price_ngn')::int, (l->>'quantity')::int
  from jsonb_array_elements(v_lines) l;

  update public.products p set stock = p.stock - (l->>'quantity')::int
  from jsonb_array_elements(v_lines) l where p.id = (l->>'product_id')::uuid;

  if v_order.marketing_opt_in then
    insert into public.subscribers (email) values (v_order.email) on conflict do nothing;
  end if;

  return jsonb_build_object('number', v_order.number, 'token', v_order.access_token, 'first_name', v_order.first_name, 'email', v_order.email,
    'address', concat_ws(', ', v_order.address, v_order.address2, v_order.city, v_order.state),
    'delivery', v_delivery.name, 'delivery_fee_ngn', v_order.delivery_fee_ngn, 'payment_method', v_order.payment_method,
    'payment_provider', v_order.payment_provider, 'payment_status', v_order.payment_status, 'pay_amount_kobo', v_order.pay_amount_kobo,
    'bank', case when v_provider = 'cheqpay' then jsonb_build_object('account_number', v_settings.account_number,
      'bank_name', v_settings.bank_name, 'account_name', v_settings.account_name) end,
    'discount_code', v_order.discount_code, 'discount_ngn', v_order.discount_ngn,
    'subtotal_ngn', v_order.subtotal_ngn, 'total_ngn', v_order.total_ngn, 'created_at', v_order.created_at, 'items', v_lines);
end;
$function$;
