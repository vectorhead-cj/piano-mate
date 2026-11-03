# Custom Sheet Music — Design

## Purpose

Let the user bring their own piece: upload a MusicXML file, see it engraved, play it on a MIDI keyboard with error feedback, and practise chosen sections in a loop.

MusicXML comes first. PDF import (optical music recognition) is parked for later.

## Prerequisite: a polyphonic model

Today's `Exercise` is one clef, one voice, single notes in six durations, and `WaitSession` grades a flat list of pitches. Real pieces need two staves, chords, several voices, and arbitrary durations. That model change is being worked on separately; this feature targets whatever comes out of it.

What this feature needs from the model is thin: an ordered list of **onsets**, each the set of pitches that start at the same moment, tagged with staff (hand) and timing, plus a reference to the OSMD note each pitch came from. It does not need to describe engraving, since OSMD draws from the original file.

The generated and corpus phrases keep their current path (our model → MusicXML → OSMD). They need our own model for generation, transposing into any key, and curriculum facts, so the round trip through MusicXML is just how they reach the renderer.

## Decisions

### 1. Grading scope

- Both hands, including chords.
- **MIDI input only.** The microphone can't reliably separate chords, and on-screen multi-touch is out of scope.
- Wait mode exists only when practising one hand. Two-hand play is timed: a cursor moves at a set tempo.
- An onset counts as played once all its pitches are down. Inner voices that keep sounding are graded at their onset; holding them for the full length isn't graded at first, though the release events `NoteEvent` already records make that possible later.

### 2. Parsing: OSMD is the parser

OSMD loads the user's file once. A converter walks OSMD's parsed model (measures → entries per moment in time → notes, with fraction-based timestamps) and builds our model, keeping a reference from each of our notes to OSMD's note.

- What we grade is exactly what's drawn, and hit/miss colouring goes straight through the reference.
- We get OSMD's handling of MusicXML's quirks (`<backup>`/`<forward>`, `<chord/>`, varying `divisions`, voices, hands written as two parts) for free.
- The coupling to OSMD's internals stays in this one converter module, which is tested against a set of real MusicXML files.

### 3. Timeline: written measures plus a play order

The model holds the written measures once, plus a **play order**: a list of measure indices.

- A full play-through uses the unrolled order: repeats, voltas (1st and 2nd endings), D.C./D.S./Coda.
- A focused section uses written order, except inside a repeat, where it takes one pass through the volta.
- Unrolling is our own logic, working from the repeat markings OSMD has parsed for each measure. If a file has jumps we can't resolve, fall back to written order and show a notice.

Defaults for the rest:

- **Ties:** one press, held through (as the app already does).
- **Grace notes:** required in order in wait mode. In timed mode they don't count against you, because their timing is loose.
- **Trills and other ornaments:** grade only the written main note.
- **Arpeggiated (rolled) chords:** accept the notes spread over a short time window instead of requiring them together.
- **Rests:** nothing to play. In timed mode, a note played during a rest counts as an extra note.

### 4. Display

Two layouts, chosen with a toggle in settings:

- **Scrolling page:** OSMD's normal vertical layout, scrolling to keep the current line in view.
- **Half-page turns:** show as many lines as fit. When the player moves onto the last visible line, the lines above it are swapped for the next ones, so the next line is always visible before it's needed.

Notes:

- Hit/miss colours change the drawn noteheads directly instead of triggering a full OSMD redraw, which is slow for long pieces. Verify how the current code does this before relying on it.
- Rotating or resizing changes line breaks, so the view keeps its place by measure, not by line.
- The cursor follows progress in wait mode and the clock in timed mode.

### 5. Focused practice

**Picking a section:** tap the first bar, then the last, directly on the score; handles at each end adjust it. Selection snaps to whole bars. Shortcuts (this line, repeat section, trouble spots) are a possible later upgrade.

**The loop:**

- The section repeats until the user stops. After each pass, a short result: notes right, notes missed, timing in timed mode, plus a running count of clean passes.
- Misses are marked on the score after each pass.
- In timed mode, a one-bar count-in before each pass and a short gap between passes.
- **Temporary tempo override:** -50%, -40% … up to the written tempo. It applies only inside the loop and resets when you leave loop mode.

**Hands:**

- Choose right hand, left hand, or both. Treble staff = right hand, bass staff = left hand. Cross-staff notation isn't handled at first.
- When practising one hand, a toggle chooses whether the synth plays the other hand. It defaults to played: at tempo in timed mode, and in wait mode each of its notes sounds as you reach that point.
- Pressing a key that belongs to the other hand at that moment is ignored, not marked wrong.

### 6. Import and storage

**Import:** file upload only (file picker, plus drag-and-drop on desktop), accepting `.musicxml`, `.xml` and `.mxl`. Check that OSMD opens `.mxl` itself. Links are left out: most sheet music sites block direct downloads from other sites (CORS), and the app has no server to proxy them.

Import feedback:

- A file that won't parse: say so.
- No piano part: offer to pick a part to use instead.
- More than two staves: ask which two to use.
- Things we skip, such as unresolvable jumps: list them once after import.

**Storage:** follows the practice-event log (`src/curriculum/eventLog.ts`): saved to the player's Supabase account when signed in, falling back to the browser otherwise. The piece library and its history follow the user across devices.

- **Files:** in a private Supabase Storage bucket, at `<user id>/<hash>.mxl` (or `.musicxml.gz`), with storage policies that let each user reach only their own folder, like the row-level security on `practice_events`. The free plan allows 50 MB per file, far more than any score. Storage takes raw bytes, so no base64.
- **Piece records:** a `pieces` table keyed by user and hash, holding the title, the file path and when it was added. A migration in `supabase/migrations/`, with row-level security and explicit grants like `practice_events`.
- **Compression:** gzip plain `.musicxml`/`.xml` with the browser's built-in `CompressionStream`. Store `.mxl` exactly as uploaded, since it's already zipped.
- **Identity:** a piece is identified by a hash of its decompressed MusicXML, so re-uploading or re-exporting it reconnects to its history.
- **History:** one event per pass in the same `practice_events` table: piece, bar range, hand, mode, tempo, and the notes missed. A new event `type` alongside the curriculum ones. Each event is a row with its `type` and time copied into columns, so a piece's passes can be queried for trouble spots later without a migration.
- **Signed out:** files would have to stay in the browser (IndexedDB, since localStorage is too small) and move to the account on sign-in, as practice events do. Or import could simply require signing in, which is simpler. To be decided.

## v0.1: a piece curriculum (built)

The first version narrows and reshapes the decisions above around learning one piece at a time. The code is in `src/piece/`.

**Flow.** *Pieces* on the home page → import a file → split it into phrases → a piece page → practice. The piece page lists:

- **Before you start:** a foldable section with a card for each thing the piece uses, found by the parser. The cards cover clefs, key, time (including the C and ¢ signs), tempo, range, fast note values, tuplets, chords per hand, ties, accidentals, grace notes, ornaments and repeats. Each card shows an example: the first bar where the thing appears, with its notes picked out, or a small score of its own (the key's scale, a beat pattern, the range). Where it helps, a card also has an intro to play: the scale, a beat pattern, a ladder of note values, or that first bar in its hand. An intro is graded like a phrase and passes on one clean run.
- **Phrases:** a table of every phrase × step with its streak.
- **Full piece:** the final stage.
- **How to learn it:** the settings below.

**Phrases.** Phrases are shaded in alternating colours and numbered. The player drags across bars to make them one phrase, taps a bar to start a phrase there, or uses the "every 2/4/8 bars" shortcuts. On touch screens, dragging works along a line; a vertical swipe scrolls the score. Progress is kept by the bars a phrase spans, so re-splitting other phrases keeps it.

**Steps.** Each phrase goes left hand → right hand → both hands. With *slow first*, each hand is earned at the slow tempo and then at the standard one. With *standard directly*, only at the standard tempo. A step passes after a streak of N passes with at most M misses; both are set per piece (default 10 and 1). A phrase repeats until stopped or passed. *Next phrase* moves on at any time. The full piece is both hands at the standard tempo, repeats taken, played through clean once.

**Timed only.** There is no wait mode: decision 1 changed. Right and wrong follow rhythm mode: a wrong key, a right key before its window, or a note left unplayed spoils the pass; a late hit inside the window counts. Each press is matched to the nearest unplayed note at that pitch. The window is rhythm mode's, narrowed to half the gap to the next same-pitch note, so fast runs resolve. This answers the timing-window open question for now. Grace notes and ornaments are not graded. Ties are held. Holds aren't graded yet.

**Tempo.** The standard tempo comes from the file and can be typed or tapped in. The slow tempo is a share of it (40–80%).

**Hands.** By default the synth plays the other hand at tempo, and that hand's keys are ignored.

**Parsing.** We parse MusicXML ourselves rather than through OSMD's model (decision 2 changed). This keeps parsing testable without a renderer. OSMD still draws, and the drawn notes are found again by bar, staff, place in the bar and pitch; every note of K.208 maps. `.mxl` is unzipped with JSZip.

**Display.** Phrases are drawn as an excerpt of their own bars, with the signatures in force and without repeat signs. The full piece is the whole score, scrolling to the bar being played, with the current bar washed. Half-page turns are not built.

**Storage.** For now in the browser's IndexedDB, keyed by a hash of the MusicXML. The Supabase bucket and `pieces` table of decision 6 come next, so pieces follow the player across devices.

**Next:**

- Supabase storage and sync.
- Playable intros: a scale for the key, or a sample bar for a new note value.
- Hold grading.
- An on-screen keyboard for single-note steps.
- A passed step no longer counting after the tempo is raised.

## Open questions

- **Timing window for timed mode.** The current window, ±max(350 ms, half a beat) in `src/practice/timing.ts`, was sized for the generated music: at most eighth notes, one at a time. In real pieces (sixteenths, two hands, chords) it overlaps neighbouring onsets, so a press can't be reliably matched to the note it was meant for. The window must adapt to the piece, by tempo and how close together its notes are, and a press should be matched to the nearest onset not yet played. Details to be decided.
- **PDF import.** Parked.

## Later upgrades

- Section shortcuts: this line, repeat section, trouble spots ranked by past misses.
- Tempo ramp in the loop as a single on/off switch.
- Grading how long notes are held.
- Cross-staff notation.
- Best-effort links, for direct file URLs from sites that allow it.
