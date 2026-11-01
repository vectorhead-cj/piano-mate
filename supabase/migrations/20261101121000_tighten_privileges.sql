-- The project's default privileges still hand anon and authenticated TRUNCATE, REFERENCES and
-- TRIGGER on new tables, and TRUNCATE ignores row-level security. Keep only what the app uses.
revoke all on public.practice_events from anon, authenticated;
grant select, insert on public.practice_events to authenticated;

-- Created by the project's "automatic RLS" option. It only runs as an event trigger, so nobody
-- needs to call it through the Data API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
