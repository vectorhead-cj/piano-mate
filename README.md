# piano-mate

Sight-reading trainer: read a short fragment of notation, play it on the on-screen keyboard. See [piano-reader-brief.md](piano-reader-brief.md) for the full brief.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173/piano-mate/ (also on your LAN for iPad/iPhone)
npm test
```

The dev server keeps no progress. Add `?account` to the URL to save to your signed-in account instead.

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

## Progress storage

Signed in, practice is saved to a Supabase account (project `piano_mate`); signed out, it stays in the browser and moves into the account on the next sign-in. The schema lives in `supabase/migrations/` and the auth settings in `supabase/config.toml`, applied with the Supabase CLI:

```sh
supabase db push --linked   # apply new migrations
supabase config diff        # review auth/API setting changes, then: supabase config push
```
