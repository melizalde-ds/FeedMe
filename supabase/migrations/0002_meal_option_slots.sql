-- =====================================================================
-- 0002: which meal and day a meal option is for (apps/api, api.meals)
-- Applied once by the db-schema service in docker-compose.yaml.
--
-- The meal planner chooses the options of a session per meal type, and
-- sets the best of each on the days of the plan. Both columns stay empty
-- for options saved another way, such as by POST /api/shopping-runs.
-- =====================================================================

alter table public.meal_options
  add column meal_type text
    check (meal_type is null or meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  -- 0 = first day of the plan. Empty for an alternative not set on a day.
  add column day_index int check (day_index is null or day_index >= 0);

-- The planner reads what a user was shown lately, to leave it out.
create index meal_options_user_recent_idx on public.meal_options (user_id, updated_at desc);
