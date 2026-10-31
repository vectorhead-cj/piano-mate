# Corpus phrases

A one-off tool for building a curriculum from real phrases. It isn't part of the app.

1. `extract.py` (Python and music21) takes every single-voice line in the music21 corpus (Bach, Palestrina, folk-song collections, quartets and more) and cuts it into phrases: after fermatas where a line has them, at rests, and longer stretches into windows of up to 4 bars. Each collection is written to `data/collections/<name>.json`. Small collections are grouped as `other`.
2. `facts.ts` records raw facts for each phrase, reusing the app's pitch and key code: which range windows around the tonic it fits, how many chromatic notes it has, its note values, and the features the app can't play yet. It doesn't decide stages.
3. `report/` is a Vite page with collection toggles, a funnel, a card per blocker and count grids. It previews sample phrases with OpenSheetMusicDisplay.

```bash
npm run corpus:setup   # once: creates tools/corpus/.venv with music21
npm run corpus         # extract (cached per collection), then serve the report
npm run corpus:report  # serve the report from the last extract
```

`npm run corpus:extract -- --force palestrina` re-extracts one collection. `data/` and `.venv/` are git-ignored. The music21 corpus is public domain or freely licensed.
