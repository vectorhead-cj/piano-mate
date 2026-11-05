-- Events are facts: once written, never changed. The grants already keep the app to select and
-- insert; this holds for every role, the dashboard and the service role included.

create function public.reject_event_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Deleting an account (or anything else events hang off) cascades to its events. That delete
  -- runs inside the foreign key's own trigger, so it arrives here one trigger deep.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only: events are never changed or removed', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.reject_event_change() from public, anon, authenticated;

create trigger practice_events_append_only
  before update or delete on public.practice_events
  for each row execute function public.reject_event_change();

create trigger practice_events_no_truncate
  before truncate on public.practice_events
  for each statement execute function public.reject_event_change();
