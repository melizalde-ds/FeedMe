-- =====================================================================
-- AI Meal Planner: Supabase schema
-- This is the baseline. Later changes are in supabase/migrations/*.sql:
-- add a new numbered file there instead of editing this one.
-- Applied automatically by the one-shot `db-schema` service in
-- docker-compose.yaml, after auth is healthy (it creates auth.users).
-- That service skips if public.profiles already exists. The file itself
-- is not idempotent. To apply by hand instead (PowerShell):
--   Get-Content supabase/schema.sql -Raw | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 --single-transaction
-- Accounts (register/login) are handled by Supabase Auth (auth.users).
-- Recipes live in the vector DB and are referenced by recipe_id (text).
--
-- 2026-10-10 additions (search "ADDED"):
--   * meal_plan_slots must come from a validated meal_option (allergen net)
--   * meal_plans snapshot household_size + budget
--   * grocery_lists / grocery_items + build_grocery_list() RPC
--   * orders / order_items for the FastAPI buying agent (client read-only)
--   * allergies split into allergens (common list) + allergen_aliases +
--     user_allergens + user_custom_allergens, combined in view my_allergies
--   * text hygiene: custom allergens and preference lists are normalized
--     and validated against prompt-injection-shaped input
-- =====================================================================

-- ---------- Helpers ---------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Text hygiene (prompt-injection guard) ---------------------
-- Anything a user types that can reach the LLM (custom allergens, food
-- and cuisine preferences) must be a short plain term: lowercase letters,
-- digits, spaces, ' & -; 2-40 chars; at most 4 words; no instruction-like
-- words. Normalized on write, rejected with a readable error otherwise.
-- This is the first layer only. FastAPI must still pass these values to
-- the LLM as quoted data (e.g. a JSON list), never inside the instructions.

create or replace function public.normalize_term(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
           btrim(
             regexp_replace(
               lower(translate(normalize(coalesce(t, ''), NFKC), '’‘`´', '''''''''')),
               '\s+', ' ', 'g'),
             ' ''-&'),
           '')
$$;

-- null = clean, otherwise the reason it was rejected
create or replace function public.term_problem(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when t is null or length(t) < 2 then 'is too short'
    when length(t) > 40 then 'is longer than 40 characters'
    when t !~ '^[a-z0-9][a-z0-9 ''&-]*[a-z0-9]$'
      then 'can only contain letters, numbers, spaces, hyphens, apostrophes and &'
    when cardinality(regexp_split_to_array(t, ' ')) > 4 then 'has more than 4 words'
    when regexp_split_to_array(t, '[ ''&-]+') && array[
      'ignore', 'disregard', 'forget', 'override', 'bypass', 'instruction', 'instructions',
      'prompt', 'prompts', 'system', 'assistant', 'developer', 'previous', 'above',
      'pretend', 'roleplay', 'jailbreak', 'respond', 'response', 'output', 'return',
      'reply', 'json', 'http', 'https', 'www', 'script', 'select', 'insert', 'delete',
      'drop', 'update', 'safe', 'unsafe', 'allow', 'allowed', 'approve', 'approved'
    ]::text[] then 'contains a word that is not allowed'
    else null
  end
$$;

create or replace function public.is_clean_term(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.term_problem(t) is null
$$;

-- normalize every item, drop blanks and duplicates, sort
create or replace function public.clean_terms(arr text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x order by x), '{}')
    from (select public.normalize_term(u) as x from unnest(arr) as u) s
   where x is not null
$$;

-- null = every item clean, otherwise the first problem found
create or replace function public.terms_problem(arr text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when cardinality(arr) > 30 then 'has more than 30 items'
    else (select '"' || u || '" ' || public.term_problem(u)
            from unnest(arr) as u
           where public.term_problem(u) is not null
           limit 1)
  end
$$;

-- ---------- 1. Profiles (endpoints #1-4) ------------------------------
-- One row per Supabase Auth user. Deleting the auth user cascades to
-- every table below (DELETE /users/me).

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when someone registers.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users who registered before this schema existed.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- ---------- 2. Allergies (endpoints #5-6): STRICT, ADD-ONLY -----------
-- Two kinds, both add-only: no update or delete for client roles; rows
-- only disappear when the account is deleted.
--   user_allergens        -> picked from the common list (allergens)
--   user_custom_allergens -> anything else, stored as a cleaned short term
-- Typing a known name as custom ('dairy', 'peanuts', 'shrimp') is redirected
-- into user_allergens, so it gets the proper Qdrant filter. The insert then
-- returns no row; re-read my_allergies afterwards.
-- my_allergies (view) = one combined list for the UI and for FastAPI.

create table public.allergens (
  id    text primary key check (id ~ '^[a-z_]+$'),
  label text not null,
  sort  int  not null default 0
);

insert into public.allergens (id, label, sort) values
  ('milk',      'Milk / dairy', 1),
  ('egg',       'Eggs',         2),
  ('peanut',    'Peanuts',      3),
  ('tree_nut',  'Tree nuts',    4),
  ('wheat',     'Wheat',        5),
  ('gluten',    'Gluten',       6),
  ('soy',       'Soy',          7),
  ('fish',      'Fish',         8),
  ('shellfish', 'Shellfish',    9),
  ('sesame',    'Sesame',      10);

-- Common ways people type the above. Mapping is deliberately broad
-- (e.g. 'almond' -> all tree nuts): stricter is safer.
create table public.allergen_aliases (
  alias       text primary key check (alias = public.normalize_term(alias)),
  allergen_id text not null references public.allergens (id) on delete cascade
);

insert into public.allergen_aliases (alias, allergen_id) values
  ('dairy', 'milk'), ('lactose', 'milk'), ('cheese', 'milk'), ('butter', 'milk'),
  ('cream', 'milk'), ('whey', 'milk'), ('casein', 'milk'), ('yogurt', 'milk'),
  ('eggs', 'egg'), ('egg white', 'egg'), ('egg yolk', 'egg'),
  ('peanuts', 'peanut'), ('groundnut', 'peanut'), ('peanut butter', 'peanut'),
  ('nuts', 'tree_nut'), ('tree nuts', 'tree_nut'), ('almond', 'tree_nut'), ('almonds', 'tree_nut'),
  ('cashew', 'tree_nut'), ('cashews', 'tree_nut'), ('walnut', 'tree_nut'), ('walnuts', 'tree_nut'),
  ('pecan', 'tree_nut'), ('pecans', 'tree_nut'), ('pistachio', 'tree_nut'), ('pistachios', 'tree_nut'),
  ('hazelnut', 'tree_nut'), ('hazelnuts', 'tree_nut'), ('macadamia', 'tree_nut'),
  ('flour', 'wheat'),
  ('celiac', 'gluten'), ('coeliac', 'gluten'), ('barley', 'gluten'), ('rye', 'gluten'),
  ('soya', 'soy'), ('soybean', 'soy'), ('soybeans', 'soy'), ('tofu', 'soy'), ('edamame', 'soy'),
  ('salmon', 'fish'), ('tuna', 'fish'), ('cod', 'fish'), ('tilapia', 'fish'), ('anchovy', 'fish'), ('anchovies', 'fish'),
  ('shrimp', 'shellfish'), ('prawn', 'shellfish'), ('prawns', 'shellfish'), ('crab', 'shellfish'),
  ('lobster', 'shellfish'), ('crawfish', 'shellfish'), ('crayfish', 'shellfish'),
  ('sesame seeds', 'sesame'), ('tahini', 'sesame');

create table public.user_allergens (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  allergen_id text not null references public.allergens (id),
  created_at  timestamptz not null default now(),
  primary key (user_id, allergen_id)
);

create table public.user_custom_allergens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  constraint custom_allergen_clean check (public.is_clean_term(name))
);

create index user_custom_allergens_user_idx on public.user_custom_allergens (user_id);

-- Normalize + validate custom input; redirect known names to the common list.
create or replace function public.clean_custom_allergen()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problem text;
  v_common  text;
  v_key     text;
begin
  new.name  := public.normalize_term(new.name);
  v_problem := public.term_problem(new.name);
  if v_problem is not null then
    raise exception 'Allergen "%" %', coalesce(new.name, ''), v_problem
      using errcode = '22023';
  end if;

  v_key := replace(new.name, ' ', '_');
  select id into v_common from public.allergens
   where id in (v_key, regexp_replace(v_key, 's$', ''))
  union all
  select allergen_id from public.allergen_aliases where alias = new.name
  limit 1;

  if v_common is not null then
    insert into public.user_allergens (user_id, allergen_id)
    values (new.user_id, v_common)
    on conflict do nothing;
    return null;  -- stored as a common allergen instead
  end if;
  return new;
end;
$$;

create trigger user_custom_allergens_clean
  before insert on public.user_custom_allergens
  for each row execute function public.clean_custom_allergen();

create view public.my_allergies with (security_invoker = true) as
  select ua.user_id, ua.allergen_id as allergen, a.label, 'common'::text as kind, ua.created_at
    from public.user_allergens ua
    join public.allergens a on a.id = ua.allergen_id
  union all
  select c.user_id, c.name, c.name, 'custom'::text, c.created_at
    from public.user_custom_allergens c;

-- ---------- 3. Preferences (endpoints #7-9): FLEXIBLE -----------------

create table public.preferences (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  diet_styles           text[] not null default '{}',   -- e.g. vegetarian, low-carb
  liked_foods           text[] not null default '{}',
  disliked_foods        text[] not null default '{}',
  liked_cuisines        text[] not null default '{}',
  disliked_cuisines     text[] not null default '{}',
  household_size        int    not null default 1 check (household_size between 1 and 20),
  weekly_budget         numeric(10, 2) check (weekly_budget is null or weekly_budget >= 0),
  max_cook_time_minutes int    check (max_cook_time_minutes is null or max_cook_time_minutes > 0),
  plan_days             int    not null default 7 check (plan_days between 1 and 31),
  -- capped by the four meal_plan_slots.meal_type values
  meals_per_day         int    not null default 3 check (meals_per_day between 1 and 4),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- backstop for the trigger below (applies to the service role too)
  constraint preferences_terms_clean check (
    public.terms_problem(diet_styles)       is null and
    public.terms_problem(liked_foods)       is null and
    public.terms_problem(disliked_foods)    is null and
    public.terms_problem(liked_cuisines)    is null and
    public.terms_problem(disliked_cuisines) is null
  )
);

create trigger preferences_updated_at
  before update on public.preferences
  for each row execute function public.set_updated_at();

-- Normalize the free-text lists and reject anything that isn't a plain term.
create or replace function public.clean_preferences()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problem text;
begin
  new.diet_styles       := public.clean_terms(new.diet_styles);
  new.liked_foods       := public.clean_terms(new.liked_foods);
  new.disliked_foods    := public.clean_terms(new.disliked_foods);
  new.liked_cuisines    := public.clean_terms(new.liked_cuisines);
  new.disliked_cuisines := public.clean_terms(new.disliked_cuisines);

  v_problem := coalesce(
    'diet_styles: '       || public.terms_problem(new.diet_styles),
    'liked_foods: '       || public.terms_problem(new.liked_foods),
    'disliked_foods: '    || public.terms_problem(new.disliked_foods),
    'liked_cuisines: '    || public.terms_problem(new.liked_cuisines),
    'disliked_cuisines: ' || public.terms_problem(new.disliked_cuisines));
  if v_problem is not null then
    raise exception 'Invalid preference %', v_problem using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger preferences_clean
  before insert or update on public.preferences
  for each row execute function public.clean_preferences();

-- ---------- 4. Nutrition goals (endpoints #10-14) ---------------------
-- Body stats are optional and only used by POST .../calculate.
-- The check constraints are the same rules as POST .../check, so an
-- inconsistent or unsafe target can never be saved.

create table public.nutrition_goals (
  user_id        uuid primary key references public.profiles (id) on delete cascade,

  -- targets (per day)
  calories       int not null check (calories >= 1200),
  protein_g      int not null check (protein_g >= 0),
  carbs_g        int not null check (carbs_g >= 0),
  fat_g          int not null check (fat_g >= 0),
  fiber_g        int check (fiber_g is null or fiber_g >= 0),
  sodium_mg_max  int check (sodium_mg_max is null or sodium_mg_max > 0),

  -- optional inputs for the calculator
  age            int check (age is null or age between 1 and 120),
  sex            text check (sex is null or sex in ('female', 'male', 'other')),
  height_cm      numeric(5, 1) check (height_cm is null or height_cm > 0),
  weight_kg      numeric(5, 1) check (weight_kg is null or weight_kg > 0),
  activity_level text check (activity_level is null or activity_level in
                   ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  goal           text check (goal is null or goal in ('lose', 'maintain', 'gain')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- macro calories (4/4/9) must land within 10% of the calorie target
  constraint macros_match_calories check (
    abs((protein_g * 4 + carbs_g * 4 + fat_g * 9) - calories) <= calories * 0.10
  )
);

create trigger nutrition_goals_updated_at
  before update on public.nutrition_goals
  for each row execute function public.set_updated_at();

-- ---------- 5. Meal option sessions (endpoints #15-20) ----------------
-- Snapshots freeze what the pipeline used, so reloading a session
-- (GET /meal-options/{session_id}) is stable even if the user later
-- edits preferences.

create table public.meal_option_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  status                text not null default 'pending'
                        check (status in ('pending', 'ready', 'failed')),
  allergies_snapshot    text[] not null default '{}',  -- from my_allergies: common ids + custom names
  preferences_snapshot  jsonb  not null default '{}',
  nutrition_snapshot    jsonb  not null default '{}',
  overrides             jsonb  not null default '{}',  -- preferences/macros only, never allergies
  relaxed_constraints   text[] not null default '{}',  -- which soft prefs were relaxed to reach 7+
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id)  -- target for child composite FKs
);

create index meal_option_sessions_user_idx
  on public.meal_option_sessions (user_id, created_at desc);

create trigger meal_option_sessions_updated_at
  before update on public.meal_option_sessions
  for each row execute function public.set_updated_at();

create table public.meal_options (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null,
  user_id                uuid not null references public.profiles (id) on delete cascade,

  recipe_id              text not null,                 -- id in the vector DB
  title                  text not null,
  image_url              text,
  source_name            text,
  source_url             text,
  cook_time_minutes      int,
  servings               int,
  nutrition              jsonb not null default '{}',   -- per serving: calories, protein_g, carbs_g, fat_g...

  -- compliance results from the code filter + LLM check
  allergen_safe          boolean not null,
  compliance             jsonb not null default '{}',   -- per-constraint pass/fail + reason
  preference_match_score numeric(5, 2),                 -- how well soft preferences matched
  preferences_matched    int,
  preferences_total      int,
  macro_status           text check (macro_status is null or macro_status in ('under', 'on_target', 'over')),

  rank                   int not null,
  is_headline            boolean not null default false,

  -- queued = validated but not yet shown (feeds /more and /replace)
  status                 text not null default 'queued'
                         check (status in ('queued', 'shown', 'selected', 'accepted', 'rejected', 'replaced')),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Safety net: an option that failed the allergen check can never be stored.
  constraint option_must_be_allergen_safe check (allergen_safe = true),
  unique (session_id, recipe_id),
  unique (id, user_id, recipe_id),  -- ADDED: target for meal_plan_slots.option_id FK

  -- FK checks bypass RLS, so tie the parent to the same owner explicitly.
  foreign key (session_id, user_id)
    references public.meal_option_sessions (id, user_id) on delete cascade
);

create index meal_options_session_idx on public.meal_options (session_id, status, rank);
create index meal_options_user_idx on public.meal_options (user_id);

create trigger meal_options_updated_at
  before update on public.meal_options
  for each row execute function public.set_updated_at();

-- ---------- 6. Meal plans (endpoints #22-28) --------------------------

create table public.meal_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  session_id uuid,
  name       text not null default 'My meal plan',
  start_date date,
  num_days   int not null default 7 check (num_days between 1 and 31),
  status     text not null default 'draft' check (status in ('draft', 'saved', 'archived')),
  -- ADDED: snapshots so grocery scaling and budget checks don't move when preferences change
  household_size int not null default 1 check (household_size between 1 and 20),
  budget         numeric(10, 2) check (budget is null or budget >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),  -- target for meal_plan_slots composite FK

  -- Same owner as the session; deleting the session clears only session_id.
  foreign key (session_id, user_id)
    references public.meal_option_sessions (id, user_id) on delete set null (session_id)
);

create index meal_plans_user_idx on public.meal_plans (user_id, created_at desc);

create trigger meal_plans_updated_at
  before update on public.meal_plans
  for each row execute function public.set_updated_at();

-- Slots snapshot the recipe so saved plans survive vector DB re-ingestion,
-- and so the grocery list (#29) and summary (#30) can be computed from here.
create table public.meal_plan_slots (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null,
  user_id           uuid not null references public.profiles (id) on delete cascade,

  day_index         int  not null check (day_index >= 0),       -- 0 = first day of the plan
  meal_type         text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),

  -- ADDED: the validated option this slot came from. Required on insert
  -- (trigger below), cleared if the session is later deleted.
  option_id         uuid,

  recipe_id         text not null,
  title             text not null,
  image_url         text,
  source_url        text,
  cook_time_minutes int,
  servings          int,
  ingredients       jsonb not null default '[]',   -- [{name, quantity, unit, est_cost}]
  nutrition         jsonb not null default '{}',   -- per serving
  estimated_cost    numeric(10, 2),

  status            text not null default 'accepted'
                    check (status in ('accepted', 'rejected', 'replaced')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  foreign key (plan_id, user_id)
    references public.meal_plans (id, user_id) on delete cascade,

  -- ADDED: same owner AND same recipe as a stored (therefore allergen_safe) option
  foreign key (option_id, user_id, recipe_id)
    references public.meal_options (id, user_id, recipe_id) on delete set null (option_id)
);

create index meal_plan_slots_plan_idx on public.meal_plan_slots (plan_id);
create index meal_plan_slots_option_idx on public.meal_plan_slots (option_id);

-- ADDED: a slot can only be created from a validated option, so nothing that
-- skipped the allergen filter + LLM check can land in a plan.
create or replace function public.slot_requires_option()
returns trigger
language plpgsql
as $$
begin
  if new.option_id is null then
    raise exception 'meal_plan_slots.option_id is required: slots must come from a validated meal_option'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger meal_plan_slots_require_option
  before insert on public.meal_plan_slots
  for each row execute function public.slot_requires_option();

-- One accepted meal per slot. Rejected/replaced rows stay as history, so a
-- replacement can be inserted alongside the row it replaces.
create unique index meal_plan_slots_one_accepted
  on public.meal_plan_slots (plan_id, day_index, meal_type)
  where status = 'accepted';

create trigger meal_plan_slots_updated_at
  before update on public.meal_plan_slots
  for each row execute function public.set_updated_at();

-- ---------- 7. Favorites and feedback (endpoints #31-34) --------------

create table public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index favorites_recipe_idx on public.favorites (recipe_id);

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  text not null,
  rating     text not null check (rating in ('like', 'dislike')),
  reason     text check (reason is null or length(reason) <= 280),  -- free text: never put into LLM instructions
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, recipe_id)
);

create trigger feedback_updated_at
  before update on public.feedback
  for each row execute function public.set_updated_at();

-- GET /recipes/popular: aggregate-only view, so no one's individual
-- favorites are exposed. (Runs as owner, bypassing per-user RLS.)
create view public.recipe_popularity as
  select
    recipe_id,
    count(*) as favorite_count
  from public.favorites
  group by recipe_id;

revoke all on public.recipe_popularity from anon;
grant select on public.recipe_popularity to authenticated;

-- ---------- 8. Row Level Security -------------------------------------
-- Every table is locked to the owning user. Note: if FastAPI connects with
-- the service-role key, RLS is bypassed, so also filter by user_id in code.
-- To have RLS enforced, forward the user's JWT to Supabase instead.

alter table public.profiles             enable row level security;
alter table public.allergens             enable row level security;
alter table public.allergen_aliases      enable row level security;
alter table public.user_allergens        enable row level security;
alter table public.user_custom_allergens enable row level security;
alter table public.preferences          enable row level security;
alter table public.nutrition_goals      enable row level security;
alter table public.meal_option_sessions enable row level security;
alter table public.meal_options         enable row level security;
alter table public.meal_plans           enable row level security;
alter table public.meal_plan_slots      enable row level security;
alter table public.favorites            enable row level security;
alter table public.feedback             enable row level security;

-- profiles
create policy "profiles: read own"   on public.profiles for select using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update using ((select auth.uid()) = id);

-- common allergen list + aliases: readable by anyone (form can load before login), never writable
create policy "allergens: read"        on public.allergens        for select using (true);
create policy "allergen_aliases: read" on public.allergen_aliases for select using (true);
revoke insert, update, delete on public.allergens, public.allergen_aliases from anon, authenticated;

-- user allergies (common + custom): SELECT and INSERT only. No update or delete = strict.
create policy "user_allergens: read own"   on public.user_allergens for select using ((select auth.uid()) = user_id);
create policy "user_allergens: insert own" on public.user_allergens for insert with check ((select auth.uid()) = user_id);
create policy "user_custom_allergens: read own"   on public.user_custom_allergens for select using ((select auth.uid()) = user_id);
create policy "user_custom_allergens: insert own" on public.user_custom_allergens for insert with check ((select auth.uid()) = user_id);
revoke update, delete on public.user_allergens, public.user_custom_allergens from anon, authenticated;

revoke all on public.my_allergies from anon;
grant select on public.my_allergies to authenticated;

-- full-access-to-own-rows policies for everything else
create policy "preferences: own" on public.preferences
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "nutrition_goals: own" on public.nutrition_goals
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "meal_option_sessions: own" on public.meal_option_sessions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "meal_options: own" on public.meal_options
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "meal_plans: own" on public.meal_plans
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "meal_plan_slots: own" on public.meal_plan_slots
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "favorites: own" on public.favorites
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "feedback: own" on public.feedback
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- =====================================================================
-- ADDED 2026-10-10: Grocery list + orders (FastAPI buying agent)
-- =====================================================================

-- ---------- 9. Grocery list ------------------------------------------
-- Built from a plan's accepted slots by build_grocery_list(plan_id).
-- The user can tick, edit, add and remove items before the agent buys.

create table public.grocery_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  plan_id    uuid not null unique,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (plan_id, user_id)
    references public.meal_plans (id, user_id) on delete cascade
);

create table public.grocery_items (
  id                uuid primary key default gen_random_uuid(),
  list_id           uuid not null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  name              text not null,                  -- normalized ingredient, e.g. 'cabbage'
  quantity_estimate numeric(10, 2),                 -- best-effort sum; dataset quantities are unit-less
  unit              text,
  needed_for        jsonb not null default '[]',    -- [{slot_id, recipe_id, title, quantity, raw, scale}]
  note              text,
  checked           boolean not null default false, -- "already have it" / skip
  added_by_user     boolean not null default true,
  est_cost          numeric(10, 2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, user_id),
  foreign key (list_id, user_id)
    references public.grocery_lists (id, user_id) on delete cascade
);

create index grocery_items_list_idx on public.grocery_items (list_id);

create trigger grocery_items_updated_at
  before update on public.grocery_items
  for each row execute function public.set_updated_at();

-- ---------- 10. Orders (written by the buying agent) -----------------

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  plan_id         uuid,
  grocery_list_id uuid,
  status          text not null default 'pending'
                  check (status in ('pending', 'shopping', 'placed', 'delivered', 'failed', 'cancelled')),
  store_name      text,
  subtotal        numeric(10, 2),
  fees            numeric(10, 2),
  total           numeric(10, 2),
  currency        text not null default 'USD',
  external_ref    text,            -- store / agent order id
  receipt_url     text,            -- e.g. storage path receipts/<user_id>/<order_id>.pdf
  receipt         jsonb,           -- raw receipt payload from the agent
  error_message   text,
  placed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (plan_id, user_id)
    references public.meal_plans (id, user_id) on delete set null (plan_id),
  foreign key (grocery_list_id, user_id)
    references public.grocery_lists (id, user_id) on delete set null (grocery_list_id)
);

create index orders_user_idx on public.orders (user_id, created_at desc);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  grocery_item_id   uuid references public.grocery_items (id) on delete set null,
  product_name      text not null,
  quantity          numeric(10, 2),
  unit_price        numeric(10, 2),
  line_total        numeric(10, 2),
  status            text not null default 'pending'
                    check (status in ('pending', 'found', 'substituted', 'unavailable')),
  substitution_note text,
  created_at        timestamptz not null default now(),
  foreign key (order_id, user_id)
    references public.orders (id, user_id) on delete cascade
);

create index order_items_order_idx on public.order_items (order_id);

-- ---------- 11. build_grocery_list(plan_id) --------------------------

-- "1/4" -> 0.25, "1 1/2" -> 1.5, "2-3" -> 3, "46" -> 46, anything else -> null
create or replace function public.parse_qty(q text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := btrim(coalesce(q, ''));
  m text[];
begin
  if s = '' then return null; end if;
  if s ~ '^[^-]+-[^-]+$' then s := btrim(split_part(s, '-', 2)); end if;  -- range: take the upper bound
  m := regexp_match(s, '^(\d+)\s+(\d+)/(\d+)$');
  if m is not null then return m[1]::numeric + m[2]::numeric / nullif(m[3]::numeric, 0); end if;
  m := regexp_match(s, '^(\d+)/(\d+)$');
  if m is not null then return m[1]::numeric / nullif(m[2]::numeric, 0); end if;
  m := regexp_match(s, '^(\d+(\.\d+)?)$');
  if m is not null then return m[1]::numeric; end if;
  return null;
end;
$$;

-- Rebuilds the list from accepted slots, scaling each recipe from its own
-- servings to the plan's household_size. Expects slot ingredients shaped
-- like [{name, quantity, unit?, raw?}]. Callable by the owner (supabase.rpc)
-- or by FastAPI with the service key. Locked once an active order exists.
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
             where o.plan_id = p.id and o.status not in ('failed', 'cancelled')) then
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

revoke execute on function public.build_grocery_list(uuid) from public, anon;
grant execute on function public.build_grocery_list(uuid) to authenticated, service_role;

-- ---------- 12. RLS for the new tables -------------------------------

alter table public.grocery_lists enable row level security;
alter table public.grocery_items enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;

-- grocery lists: read only (created by build_grocery_list)
create policy "grocery_lists: read own" on public.grocery_lists
  for select using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.grocery_lists from anon, authenticated;

-- grocery items: user can tick / edit / add / remove on their own list
-- (the composite FK guarantees list_id belongs to the same user_id)
create policy "grocery_items: own" on public.grocery_items
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- orders: read only for the user; the buying agent writes with the service key
create policy "orders: read own" on public.orders
  for select using ((select auth.uid()) = user_id);
create policy "order_items: read own" on public.order_items
  for select using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.orders, public.order_items from anon, authenticated;