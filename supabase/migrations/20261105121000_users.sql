-- A player: the `users` row is the current state, folded from `user_events`, which is what's
-- true. The app only ever inserts events; the row follows from them in apply_user_event.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- Settings that belong to the player rather than the device, as the last preferences-changed
  -- event left them.
  preferences jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_events (
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  -- Made in the app (or here, for user-created), so a retried insert can't add it twice.
  id text not null,
  type text not null,
  at timestamptz not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint user_events_matches_event check (event ->> 'type' = type and event ->> 'id' = id)
);

create index user_events_user_type_at on public.user_events (user_id, type, at);

-- Folds each event into the user row as it's written. Security definer: players can't write
-- to `users` themselves, only through their events.
create function public.apply_user_event() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- A retried write of an event already stored: leave it be (the insert's ON CONFLICT DO
  -- NOTHING would skip the row, but only after this trigger had folded it in again).
  if exists (select 1 from public.user_events where user_id = new.user_id and id = new.id) then
    return null;
  end if;
  case new.type
    when 'user-created' then
      insert into public.users (id, created_at, updated_at) values (new.user_id, new.at, new.at)
        on conflict (id) do nothing;
      return new;
    when 'profile-changed' then
      update public.users set display_name = new.event ->> 'displayName' where id = new.user_id;
    when 'preferences-changed' then
      update public.users set preferences = coalesce(new.event -> 'preferences', '{}') where id = new.user_id;
    else
      raise exception 'Unknown user event type: %', new.type using errcode = 'check_violation';
  end case;
  update public.users set updated_at = greatest(updated_at, new.at) where id = new.user_id;
  return new;
end;
$$;

revoke execute on function public.apply_user_event() from public, anon, authenticated;

create trigger user_events_apply
  before insert on public.user_events
  for each row execute function public.apply_user_event();

create trigger user_events_append_only
  before update or delete on public.user_events
  for each row execute function public.reject_event_change();

create trigger user_events_no_truncate
  before truncate on public.user_events
  for each statement execute function public.reject_event_change();

-- Every account gets its user, by a user-created event, when it's made.
create function public.create_user_for_account() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  event_id text := 'user-created-' || new.id::text;
  at_ms bigint := floor(extract(epoch from now()) * 1000);
begin
  insert into public.user_events (user_id, id, type, at, event)
  values (
    new.id, event_id, 'user-created', now(),
    jsonb_build_object('type', 'user-created', 'v', 1, 'id', event_id, 'at', at_ms)
  );
  return new;
end;
$$;

revoke execute on function public.create_user_for_account() from public, anon, authenticated;

create trigger create_user_for_account
  after insert on auth.users
  for each row execute function public.create_user_for_account();

-- Accounts made before this migration.
insert into public.user_events (user_id, id, type, at, event)
select
  u.id,
  'user-created-' || u.id::text,
  'user-created',
  u.created_at,
  jsonb_build_object('type', 'user-created', 'v', 1, 'id', 'user-created-' || u.id::text, 'at', floor(extract(epoch from u.created_at) * 1000))
from auth.users u
on conflict do nothing;

alter table public.users enable row level security;
alter table public.user_events enable row level security;

create policy "Read own user"
  on public.users for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Read own user events"
  on public.user_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- user-created comes only from the account trigger above.
create policy "Add own user events"
  on public.user_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id and type <> 'user-created');

revoke all on public.users, public.user_events from anon, authenticated;
grant select on public.users to authenticated;
grant select, insert on public.user_events to authenticated;
