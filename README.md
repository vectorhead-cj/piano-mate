# piano-mate

Sight-reading trainer: read a short fragment of notation, play it on the on-screen keyboard. See [piano-reader-brief.md](piano-reader-brief.md) for the full brief.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173/piano-mate/ (also on your LAN for iPad/iPhone)
npm test
```

## Deploy

Pushing to `master` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.
