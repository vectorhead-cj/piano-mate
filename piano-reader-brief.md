# Piano Sight-Reading Trainer — Project Brief

## Purpose

A small personal app for a beginner pianist to learn to read sheet music. The app shows a short fragment of notation (1–4 bars) at the top of the screen and a piano keyboard at the bottom. The user plays what they see, and the app gives immediate feedback.

The goal is to build the direct link "see the note → press the key".

## Core screen

- **Top: notation.** 1–4 bars of a simple melody, rendered as proper engraved notation:
  - Clef (treble first, bass later)
  - Time signature
  - Note values: whole, half, quarter, eighth, dotted notes, and rests
  - Accidentals: sharp (♯), flat (♭), natural (♮)
  - Key signatures (later level)
  - Ledger lines (later level)
- **Bottom: piano keyboard.** Clickable / touchable on-screen keyboard, ~2 octaves to start, sized for iPad and desktop.
- A cursor or highlight shows which note is expected next.

## Practice modes

### Phase 1: Wait mode (build first)
- The app waits until the correct key is pressed, then advances to the next note.
- No time pressure; rhythm is shown but not graded.
- Correct note: green. Wrong note: red, and briefly show the correct key on the keyboard.

### Phase 2: Rhythm mode (later)
- Metronome and a moving cursor at a set tempo.
- Grade each note as early / on time / late.
- This is where note values and rests start to matter for scoring.

### Other practice features (later)
- **Note drill / flashcards:** single notes shown one at a time, answered fast. Separate from the phrase mode.
- **Loop a section** and **slow down tempo** (e.g. 50% and step up).
- **Hands separately:** user plays one hand while the app plays the other (needs grand staff and real pieces).

## Feedback and settings

- Play a sound when a key is pressed (piano sample or simple synth).
- Optional "hear it first" button that plays the fragment.
- Toggle to show note names on notes and/or keys.
- Note-name convention setting: **English** (C D E F G A B) or **Swedish** (C D E F G A H, with B = B♭).
- Accidentals on/off.

## Difficulty progression

Levels should unlock gradually:

1. Treble clef, C4–G4, quarter/half/whole notes
2. Full treble staff
3. Ledger lines above/below the treble staff
4. Bass clef
5. Grand staff (both hands)
6. Accidentals
7. Key signatures (the user must remember e.g. that every F is sharp)

## Adaptive practice / statistics

- Track per-note accuracy and reaction time (time from note shown to correct key).
- Generate more exercises on weak notes (spaced-repetition style).
- Show simple progress stats over time.

## Exercise content

### Generated exercises (Phase 1)
- Generate melodies that sound musical rather than random notes: mostly stepwise motion, occasional leaps, phrases ending on the tonic.
- Constrained by the current level (range, note values, accidentals, key).

### Real music (later phase)
- Import pieces as **MusicXML** (the standard notation exchange format).
- Slice pieces into 1–4 bar fragments, graded by difficulty.
- Allow extracting a single hand (e.g. right-hand melody only).
- Free sources: OpenScore (CC0, MusicXML), IMSLP (mostly PDF), MuseScore.com (public-domain scores downloadable as MusicXML).
- PDFs: not parsed in-app. Convert offline with optical music recognition (e.g. Audiveris), fix errors in MuseScore, then import the MusicXML.
- Long-term target piece: **Scarlatti, Sonata in A major, K. 208**. No verified keyboard MusicXML source yet; likely route is the IMSLP scan → Audiveris → hand-correct in MuseScore.

## Input methods (in this order)

The architecture must support all three, but only build them one at a time.

### 1. Screen input (build first)
- Mouse click on desktop, touch on iPad.
- Support multi-touch so chords can be played later.

### 2. MIDI (second)
- The user has a **digital piano**, so MIDI will become the main input once added.
- Use the browser **Web MIDI API** (USB, or Bluetooth MIDI if supported).
- Gives exact pitch, onset, duration and velocity; supports chords and rhythm grading.
- On-screen keyboard then mirrors what is played.
- Velocity could later be used to check dynamics (forte/piano).

### 3. Listening via microphone (third, optional)
- **Whistle input:** for practicing away from the piano.
  - A whistle is close to a pure sine wave, so monophonic pitch detection is easy.
  - Whistling is typically 1–2 octaves above the treble staff, so compare **octave-agnostic** (pitch class only) or shift down.
  - Use a pitch tolerance (about ±30–40 cents) and require the pitch to be stable for ~100 ms before accepting.
  - Split notes on "pitch has settled on a new value", since whistlers glide between notes.
- **Piano via mic** is low priority, since MIDI exists. If needed: monophonic only, onset detection plus checking the expected pitch.
- Candidate libraries: `pitchy` (JS, real-time monophonic), CREPE via ml5 (neural, monophonic), aubio / Essentia.js (onset + pitch), Spotify Basic Pitch (`@spotify/basic-pitch`, polyphonic, TF.js, file-oriented rather than real-time).

### Key architectural requirement
All inputs feed a **single internal note-event stream**, e.g.:

```
NoteEvent { pitch (MIDI number), onsetTime, duration?, velocity?, source: "screen" | "midi" | "mic" }
```

The exercise and grading logic only consumes NoteEvents and does not care where they come from. Grading should support both exact-pitch matching (screen, MIDI) and pitch-class matching with tolerance (whistle).

## Technical suggestions (agent may decide)

- Web app, so it runs on desktop and iPad in the browser (Web MIDI works in Chromium-based browsers; check iPad support when MIDI is added).
- Notation rendering: **VexFlow** for generated exercises; **OpenSheetMusicDisplay** (MusicXML, built on VexFlow) or **Verovio** for imported scores. Both can highlight the current note.
- **ABC notation** could be a convenient internal format for generated exercises.
- Audio: Web Audio API with a piano sample set, or a simple synth to start.

## Suggested v1 scope

- Web app, desktop + iPad layout
- Treble clef, 1–4 bars, quarter/half/whole notes
- Generated musical melodies, accidentals toggle
- On-screen keyboard (click/touch) as the only input
- Wait mode with green/red feedback
- Sound on key press
- Note-name toggle with English/Swedish setting
- NoteEvent abstraction in place so MIDI can be added without restructuring

Everything else comes in later phases.
