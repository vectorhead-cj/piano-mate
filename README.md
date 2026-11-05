# piano-mate

Sight-reading trainer: read a short fragment of notation, play it on the on-screen keyboard. See [piano-reader-brief.md](piano-reader-brief.md) for the full brief.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173/piano-mate/ (also on your LAN for iPad/iPhone)
npm test
```

The dev server keeps no progress and holds pieces for the page only. Add `?account` to the URL to use your signed-in account instead.

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

## Storage

Everything is in a Supabase account (project `piano_mate`), stored as events: append-only facts that are never changed (a trigger refuses updates and deletes for every role). Whatever is shown is folded from them.

- **Practice** is one stream, `practice_events`: curriculum phrases, intros and track starts, and passes at pieces (`piece-pass`). Curriculum progress and piece progress are folded from it in the app, so scoring rules can change and old practice is re-scored. Each screen loads only the event types it uses (`EventLog.load({ types })`). Signed out, curriculum practice stays in the browser and moves into the account on the next sign-in.
- **Entities** are a table of current state plus a table of its events: `users` / `user_events` and `pieces` / `piece_events`. The app only inserts events; a trigger in the database folds each one into its row (and refuses one that doesn't apply). A user is created with the account, by a `user-created` event.
- **Pieces** need an account. Each score is gzipped MusicXML in the private `scores` bucket at `<user id>/<hash>.musicxml.gz`, written once. A piece has its own id and points at its score, so the same piece could later take a corrected file.
- **Curriculum stages are versioned**: a stage whose definition changes bumps its `version` (`src/curriculum/curriculum.ts`), and practice recorded against the earlier version stops counting for it. Events from before versions were recorded count as version 1.
- **Device settings** (theme, keyboard height, the start key, which pieces were opened here) stay in the browser.

The schema lives in `supabase/migrations/` and the auth settings in `supabase/config.toml`, applied with the Supabase CLI:

```sh
supabase db push --linked   # apply new migrations
supabase config diff        # review auth/API setting changes, then: supabase config push
```
