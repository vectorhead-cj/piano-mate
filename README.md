# piano-mate

Sight-reading trainer: read a short fragment of notation, play it on the on-screen keyboard. See [piano-reader-brief.md](piano-reader-brief.md) for the full brief.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173/piano-mate/ (also on your LAN for iPad/iPhone)
npm test
```

The dev server keeps no progress and holds pieces for the page only. Add `?account` to the URL to use your signed-in account instead.

## Flashcards

A phone-friendly drill: one bar of four quarter notes, numbered 1–4, and the on-screen keyboard to answer on. Press the keys in the order of the notes; each key shows its place, and pressing it again takes it out. **Answer** marks the whole bar; with nothing entered the button reads **I don't know**, which counts as a miss.

- **What is tested** is a *concept*: a clef, key and range, with or without accidentals (`src/flashcards/concepts.ts`, derived from the curriculum's stages). A concept opens once its stage's intro is done, or, for a stage with no intro, once that stage or a later one is cleared. The result counts against the concept, never the particular bar.
- **When** is classic Anki-style spaced repetition (`src/flashcards/scheduler.ts`): learning steps of 1 and 10 minutes, a day, then intervals that grow by the concept's ease; a miss relearns it and lowers the ease. Up to 3 new concepts a day; the rest of the day's cards are whatever is due.
- **Storage:** answers are `card-answered` events in the same log as practice. The schedule is folded from them, so nothing extra is stored and no migration is needed. Flashcards never touch curriculum stars, and screen-keyboard play stays out of progress as before.
- The home page's activity chart shows flashcard minutes in their own colour.

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

## Storage

Everything is in a Supabase account (project `piano_mate`), stored as events: append-only facts that are never changed (a trigger refuses updates and deletes for every role). Whatever is shown is folded from them.

- **Practice** is one stream, `practice_events`: curriculum phrases, intros and track starts, passes at pieces (`piece-pass`) and flashcard answers (`card-answered`). Curriculum progress, piece progress and the flashcard schedule are folded from it in the app, so scoring rules can change and old practice is re-scored. Each screen loads only the event types it uses (`EventLog.load({ types })`). Signed out, curriculum practice stays in the browser and moves into the account on the next sign-in.
- **Entities** are a table of current state plus a table of its events: `users` / `user_events` and `pieces` / `piece_events`. The app only inserts events; a trigger in the database folds each one into its row (and refuses one that doesn't apply). A user is created with the account, by a `user-created` event.
- **Pieces** need an account. Each score is gzipped MusicXML in the private `scores` bucket at `<user id>/<hash>.musicxml.gz`, written once. A piece has its own id and points at its score, so the same piece could later take a corrected file.
- **Curriculum stages are versioned**: a stage whose definition changes bumps its `version` (`src/curriculum/curriculum.ts`), and practice recorded against the earlier version stops counting for it. Events from before versions were recorded count as version 1.
- **Device settings** (theme, keyboard height, the start key, which pieces were opened here) stay in the browser.

The schema lives in `supabase/migrations/` and the auth settings in `supabase/config.toml`, applied with the Supabase CLI:

```sh
supabase db push --linked   # apply new migrations
supabase config diff        # review auth/API setting changes, then: supabase config push
```
