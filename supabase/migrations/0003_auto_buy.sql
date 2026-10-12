-- =====================================================================
-- 0003: the "buy it for me" choice, saved for next time (apps/api, api.runs)
-- Applied once by the db-schema service in docker-compose.yaml.
--
-- The web app asks before it starts the buying agent. A user who says
-- "do this every time" gets auto_buy = true, and the app then starts the
-- agent without asking. The server only stores the choice: it never
-- starts a run by itself.
--
-- Not the same as shopping_mode, which decides whether the agent's picks
-- wait for the user's approval inside a run.
-- =====================================================================

alter table public.preferences
  add column auto_buy boolean not null default false;
