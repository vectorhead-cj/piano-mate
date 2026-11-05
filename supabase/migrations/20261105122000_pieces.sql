-- A player's imported piece: the `pieces` row is the current state, folded from `piece_events`.
-- The score file itself sits in the `scores` storage bucket, named by its content hash and never
-- changed; a piece points at the one it uses now. Practice on a piece goes to practice_events
-- (type piece-pass), like the rest of practice.

create table public.pieces (
  -- Made in the app; the piece keeps it whatever score it later points at.
  id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  composer text not null default '',
  file_name text not null,
  -- Hash of the score's MusicXML text: importing the same file again finds the piece.
  score_hash text not null,
  -- Object path in the `scores` bucket: <user id>/<score hash>.musicxml.gz
  score_path text not null,
  measure_count integer not null,
  -- Measure indices that start a phrase, after the first bar.
  phrase_starts integer[] not null default '{}',
  -- How the piece is practised (src/piece/pieceProgress.ts PieceSettings).
  settings jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz,
  constraint pieces_score_in_own_folder check (split_part(score_path, '/', 1) = user_id::text)
);

-- One live piece per score and player, however the imports race.
create unique index pieces_one_per_score on public.pieces (user_id, score_hash) where archived_at is null;
create index pieces_user on public.pieces (user_id);

create table public.piece_events (
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  -- Made in the app, so a retried insert can't add it twice.
  id text not null,
  type text not null,
  at timestamptz not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint piece_events_matches_event check (
    event ->> 'type' = type and event ->> 'id' = id and event ->> 'pieceId' = piece_id::text
  )
);

create index piece_events_piece_at on public.piece_events (piece_id, at);

-- Folds each event into its piece as it's written; an event for a piece that isn't the
-- player's, or is archived, is refused. Security definer: players write pieces only through
-- their events.
create function public.apply_piece_event() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  e jsonb := new.event;
begin
  -- A retried write of an event already stored: leave it be (the insert's ON CONFLICT DO
  -- NOTHING would skip the row, but only after this trigger had folded it in again).
  if exists (select 1 from public.piece_events where user_id = new.user_id and id = new.id) then
    return null;
  end if;
  if new.type = 'piece-imported' then
    insert into public.pieces (
      id, user_id, title, composer, file_name, score_hash, score_path, measure_count,
      phrase_starts, settings, created_at, updated_at
    ) values (
      new.piece_id, new.user_id, e ->> 'title', coalesce(e ->> 'composer', ''), e ->> 'fileName',
      e ->> 'scoreHash', e ->> 'scorePath', (e ->> 'measureCount')::integer,
      array(select jsonb_array_elements_text(coalesce(e -> 'phraseStarts', '[]'))::integer),
      e -> 'settings', new.at, new.at
    );
    return new;
  end if;

  perform 1 from public.pieces
    where id = new.piece_id and user_id = new.user_id and archived_at is null
    for update;
  if not found then
    raise exception 'No such piece: %', new.piece_id using errcode = 'foreign_key_violation';
  end if;

  case new.type
    when 'piece-renamed' then
      update public.pieces
        set title = e ->> 'title', composer = coalesce(e ->> 'composer', composer)
        where id = new.piece_id;
    when 'phrases-changed' then
      update public.pieces
        set phrase_starts = array(select jsonb_array_elements_text(e -> 'phraseStarts')::integer)
        where id = new.piece_id;
    when 'settings-changed' then
      update public.pieces set settings = e -> 'settings' where id = new.piece_id;
    when 'score-replaced' then
      update public.pieces
        set score_hash = e ->> 'scoreHash', score_path = e ->> 'scorePath',
            measure_count = (e ->> 'measureCount')::integer, file_name = coalesce(e ->> 'fileName', file_name)
        where id = new.piece_id;
    when 'piece-archived' then
      update public.pieces set archived_at = new.at where id = new.piece_id;
    else
      raise exception 'Unknown piece event type: %', new.type using errcode = 'check_violation';
  end case;
  update public.pieces set updated_at = greatest(updated_at, new.at) where id = new.piece_id;
  return new;
end;
$$;

revoke execute on function public.apply_piece_event() from public, anon, authenticated;

create trigger piece_events_apply
  before insert on public.piece_events
  for each row execute function public.apply_piece_event();

create trigger piece_events_append_only
  before update or delete on public.piece_events
  for each row execute function public.reject_event_change();

create trigger piece_events_no_truncate
  before truncate on public.piece_events
  for each statement execute function public.reject_event_change();

alter table public.pieces enable row level security;
alter table public.piece_events enable row level security;

create policy "Read own pieces"
  on public.pieces for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Read own piece events"
  on public.piece_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own piece events"
  on public.piece_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.pieces, public.piece_events from anon, authenticated;
grant select on public.pieces to authenticated;
grant select, insert on public.piece_events to authenticated;

-- Score files: private, each player in their own folder, written once and never changed
-- (no update or delete policy). Gzipped MusicXML.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scores', 'scores', false, 10485760, array['application/gzip'])
on conflict (id) do nothing;

create policy "Read own scores"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Add own scores"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'scores' and (storage.foldername(name))[1] = (select auth.uid())::text);
