-- =====================================================================
-- 0001: tables for the buying agent (apps/api)
-- Applied once by the db-schema service in docker-compose.yaml, on top of
-- supabase/schema.sql. Recorded in migrations.applied.
--
--   * preferences.shopping_mode: manual or auto
--   * cart_items: the agent's cart, one per grocery list (client read-only)
--   * orders: one row per agent run and payment, money in whole cents
--   * order_items: the store, UPC and the store's own order number per line
--   * build_grocery_list(): a run that paid nothing no longer locks the list
--
-- orders and order_items must be empty: columns are replaced, not converted.
-- Nothing wrote to them before this migration.
-- =====================================================================

-- ---------- 1. Shopping mode -----------------------------------------
-- manual: the agent proposes every item. auto: clean matches go straight
-- into the cart (needs a budget on the plan). A run can override it.

alter table public.preferences
  add column shopping_mode text not null default 'manual'
    check (shopping_mode in ('manual', 'auto'));

-- ---------- 2. Cart ---------------------------------------------------
-- Written only by FastAPI with the service key: the server sets the price
-- and the pack count, so a client must not be able to edit a row.

create table public.cart_items (
  id               uuid primary key default gen_random_uuid(),
  list_id          uuid not null,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  store            text not null,                  -- store slug, e.g. 'staplemart'
  upc              text not null,
  name             text not null,
  brand            text not null,
  size             text not null,                  -- e.g. '12 count'
  unit_price_cents int  not null check (unit_price_cents >= 0),
  quantity         int  not null check (quantity > 0),      -- packs
  for_ingredient   text not null,                  -- grocery_items.name it covers
  status           text not null default 'proposed'
                   check (status in ('proposed', 'in_cart')),
  -- why an item waits for the user's check, even in auto mode
  hold_reasons     text[] not null default '{}'
                   check (hold_reasons <@ array[
                     'store_brand', 'out_of_stock_replacement', 'over_budget',
                     'unsure_match', 'large_quantity', 'unknown_quantity'
                   ]::text[]),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (list_id, store, upc),
  -- rebuilding or deleting the grocery list empties its cart
  foreign key (list_id, user_id)
    references public.grocery_lists (id, user_id) on delete cascade
);

create trigger cart_items_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

alter table public.cart_items enable row level security;

create policy "cart_items: read own" on public.cart_items
  for select using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.cart_items from anon, authenticated;

-- ---------- 3. Orders: one row per agent run -------------------------
-- A run starts as 'shopping' and ends as:
--   placed  - at least one store was paid
--   unpaid  - the run finished and nothing was paid (the cart is saved)
--   failed  - the run broke off
-- One payment covers every store, so the per-store order numbers and
-- totals are on order_items and in receipt.

alter table public.orders
  drop column subtotal,
  drop column fees,
  drop column total,
  drop column store_name,
  add column mode               text not null default 'manual'
                                check (mode in ('manual', 'auto')),
  add column budget_cents       int check (budget_cents is null or budget_cents >= 0),
  add column subtotal_cents     int not null default 0 check (subtotal_cents >= 0),
  add column delivery_fee_cents int not null default 0 check (delivery_fee_cents >= 0),
  add column total_cents        int not null default 0 check (total_cents >= 0),
  add column payment_reference  text,           -- the Stripe PaymentIntent
  add column finish_reason      text check (finish_reason is null or finish_reason in
                                  ('completed', 'stopped_early', 'step_limit')),
  add column summary            jsonb;          -- the run's final summary, for a page reload

comment on column public.orders.receipt is
  'Every paid checkout of the run, as the stores returned it: [{payment_reference, total_cents, orders: [...]}]';

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'shopping', 'placed', 'delivered', 'failed', 'cancelled', 'unpaid'));

-- One run at a time per grocery list, so two runs can never both pay for it.
create unique index orders_one_active_run
  on public.orders (grocery_list_id)
  where status in ('pending', 'shopping');

-- A payment belongs to one run.
create unique index orders_payment_reference_key
  on public.orders (payment_reference)
  where payment_reference is not null;

alter table public.order_items
  drop column unit_price,
  drop column line_total,
  alter column quantity type int using round(quantity)::int,
  alter column quantity set not null,
  add constraint order_items_quantity_check check (quantity > 0),
  add column store             text not null,   -- store slug
  add column upc               text not null,
  add column store_order_id    text not null,   -- the store's own order number
  add column payment_reference text not null,
  add column for_ingredient    text,
  add column unit_price_cents  int not null check (unit_price_cents >= 0),
  add column line_total_cents  int not null check (line_total_cents >= 0),
  -- saving the same paid line twice (a retry) is a no-op
  add constraint order_items_line_key unique (store, store_order_id, upc);

create index order_items_grocery_item_idx on public.order_items (grocery_item_id);

-- ---------- 4. build_grocery_list(): unpaid runs don't lock ----------
-- Same function as in schema.sql; only the order check changed, to leave
-- out 'unpaid'. Rebuilding the list also empties its cart (cascade).

create or replace function public.build_grocery_list(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.meal_plans;
  v_list uuid;
begin
  select * into p from public.meal_plans where id = p_plan_id for update;
  if p.id is null then
    raise exception 'Plan % not found', p_plan_id;
  end if;
  if auth.uid() is not null and p.user_id <> auth.uid() then
    raise exception 'Not your plan' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders o
             where o.plan_id = p.id and o.status not in ('failed', 'cancelled', 'unpaid')) then
    raise exception 'This plan already has an order; its grocery list is locked';
  end if;

  delete from public.grocery_lists where plan_id = p.id;
  insert into public.grocery_lists (user_id, plan_id)
  values (p.user_id, p.id)
  returning id into v_list;

  insert into public.grocery_items (list_id, user_id, name, unit, quantity_estimate, needed_for, added_by_user)
  select v_list, p.user_id, x.name, x.unit,
         round(sum(public.parse_qty(x.quantity) * x.scale), 2),
         jsonb_agg(jsonb_build_object('slot_id', x.slot_id, 'recipe_id', x.recipe_id, 'title', x.title,
                                      'quantity', x.quantity, 'raw', x.raw, 'scale', round(x.scale, 2))),
         false
  from (
    select lower(btrim(i ->> 'name'))                         as name,
           nullif(btrim(coalesce(i ->> 'unit', '')), '')       as unit,
           i ->> 'quantity'                                   as quantity,
           i ->> 'raw'                                        as raw,
           s.id as slot_id, s.recipe_id, s.title,
           p.household_size::numeric / greatest(coalesce(s.servings, 1), 1) as scale
    from public.meal_plan_slots s
    cross join lateral jsonb_array_elements(s.ingredients) as i
    where s.plan_id = p.id
      and s.status = 'accepted'
      and coalesce(btrim(i ->> 'name'), '') <> ''
  ) x
  group by x.name, x.unit
  order by x.name;

  return v_list;
end;
$$;
