-- The practice event log (src/curriculum/events.ts). Append-only: rows are inserted and read,
-- never changed. The event itself is kept whole in `event`; `type` and `at` are copied out so
-- one kind of event can be loaded or queried without reading the rest.

create table public.practice_events (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The event's own id, made in the app, so a retried insert can't add it twice.
  id text not null,
  type text not null,
  at timestamptz not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index practice_events_user_type_at on public.practice_events (user_id, type, at);

alter table public.practice_events enable row level security;

create policy "Read own practice events"
  on public.practice_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own practice events"
  on public.practice_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.practice_events to authenticated;
