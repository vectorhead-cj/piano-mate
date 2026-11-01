# Skill Tree — Design

## Purpose

Add chords and two-hand reading to the curriculum without giving up single-line sight-reading as its core. The curriculum becomes a skill tree: a **trunk** of single-line reading levels, plus two side **lanes**, chords in one hand and two staves. You can go deeper on the trunk alone, or open the side lanes as you're ready.

Nothing here is implemented yet. The counts below come from a one-off analysis of PDMX (see [Corpus](#corpus)) and are meant to show that each node has real music behind it, not to be final numbers.

## Prerequisite: a polyphonic model

Chord and two-staff stages need the same model change as [custom sheet music](custom-sheet-music-design.md): onsets holding several pitches, tagged with staff (hand). Trunk stages keep working as they do today.

Grading follows from that design too:

- Chord and two-staff stages are **MIDI or on-screen keyboard only**. Whistling can't do chords, so the mic is offered on trunk stages only.
- An onset counts as played once all its pitches are down.

## Decisions

### 1. The trunk advances one hand at a time

You earn trunk levels only by reading single lines, in each clef. Side lanes never feed back into the trunk: passing two-line phrases at L5 doesn't earn L5. A trunk level keeps meaning "can read an L5 line", and the trunk can be finished from start to end without touching a side lane.

Side-lane progress is tracked per texture and level (stars or completion for "two lines at L5"), separately from the trunk.

### 2. Dependencies

A stage requires:

1. the stage that first introduces anything it uses (span, keys, notation, accidentals, clef), and
2. the previous stage in its own lane.

No readiness gates beyond that. A requirement marked *both clefs* needs that trunk level passed in treble and in bass.

Arrows only point from the trunk to the side lanes, never back.

### 3. Side stages follow the trunk level

A side stage defines only a **texture** (how the notes are stacked or split between hands). Keys, span, rhythm and accidentals come from your current trunk level. Practice is trunk level × unlocked texture: with Two lines unlocked and the trunk at L5, two-line phrases come at L5's span and rhythm.

So the material in a side stage gets harder as the trunk advances, without the side lanes needing their own levels.

### 4. "Continue"

"Continue" stays on the branch you're on. When the next step is ambiguous (several stages just unlocked, or the current lane is done), it shows a menu to pick from.

## The tree

### Trunk: single-line reading, per clef

Each level needs only the previous one. Two levels are new; the rest map onto today's chapters.

| Level | Title | Adds | Tags |
|---|---|---|---|
| L1 | First positions | five-note span, whole/half/quarter, 4/4 and 3/4 | 1-hand |
| L2 | One octave | octave span | 1-hand |
| L3 | Eighth notes | eighths, dotted quarter | eighths |
| L4 | 2/4 and 6/8 | 2/4, 6/8, 3/8, 12/8 | meter, **new** |
| L5 | Wider reach | twelfth span | 1-hand |
| L6 | Accidentals | up to two chromatic notes | accidentals |
| L7 | Minor keys | minor keys | minor |
| L8 | Sixteenths | sixteenths, dotted eighths | sixteenths, **new** |
| L9 | Ledger lines | two-octave span | ledger lines |
| L10 | Busy rhythms | busy rhythm, 2/2 | rhythm |
| L11 | All keys | any key, any accidentals | keys |

L11 merges today's three key chapters (B♭ and A…, E♭ and E…, Far keys). Whether they stay as sub-steps is open.

The two new levels exist because the app's meters and note values block about 60% of PDMX windows. Today there are no sixteenths and no 2/4 or compound meters. Rests are still absent everywhere and would block more.

### Chord lane: one hand

| Stage | Title | Texture | Needs | Tags |
|---|---|---|---|---|
| C1 | LH pairs | two-note intervals in the bass, single notes otherwise | L2 (bass) | 1-hand, intervals |
| C2 | LH chords | triads in the bass | C1 | 1-hand, triads |
| C3 | RH pairs and chords | intervals and triads in the treble | C2 | 1-hand, triads |
| C4 | Two voices | two independent voices on one staff | C3 | 1-hand, voices (optional leaf) |

Chords start in the left hand because that's where they appear in real music (accompaniment); right-hand chords come once chord shapes are familiar.

### Two-staff lane: grand staff

| Stage | Title | Texture | Needs | Tags |
|---|---|---|---|---|
| H1 | Taking turns | hands alternate, never together | L1 (both clefs) | 2-hand |
| H2 | LH holds | RH line over long held LH notes | H1 | 2-hand |
| H3 | Two lines | one line per hand, moving together | H2, L2 (both clefs) | 2-hand |
| H4 | Tune over LH chords | RH melody, LH chords | H3, C2 | 2-hand, triads |
| H5 | Chords in both hands | hymn-style, chords in both staves | H4, C3 | 2-hand, triads |

H4 and H5 are where the two lanes meet.

## Corpus

### Source

Chords and two hands need piano scores; the music21 corpus is mostly single parts (choir, quartets) and barely covers them. The analysis used **PDMX** (Zenodo record 15571083, public domain / CC0), restricted to:

- the `no_license_conflict` subset, deduplicated;
- solo piano (tracks `0` or `0-0`), complexity 0–1;
- genres excluding pop, rock, soundtrack, jazz, electronic and similar.

That's 31,436 scores; 10,070 have exactly two staves and give 60,035 four-bar windows (45,908 after dropping duplicates and unusable windows). PDMX is user transcriptions: quality varies, hymn writers and folk-tune books dominate, and some game and pop arrangements slip past the genre filter. A curated quality filter is needed before shipping.

PianoML was considered and dropped: downloads need a login and its terms forbid reproduction.

### Matching

Windows are cut per staff, each staff chordified into slices. A texture matches when it holds for **most** of a hand's sounding slices (75%). "Two lines" means 90% single notes in each hand. Strict four-bar matching undercounts badly and was rejected.

### Counts per node

Phrases available for each texture at each trunk level, cumulative (a level includes the material from easier ones). An entry under 50, today's `MIN_STAGE_POOL`, means the app would fall back to generated phrases.

| Texture | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | L11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Line (trunk) | 173 | 657 | 1084 | 1277 | 1835 | 2132 | 3225 | 4300 | 4789 | 8972 | 9428 |
| C1 LH pairs | 14 | 138 | 221 | 270 | 910 | 1152 | 1378 | 1663 | 2159 | 2877 | 3097 |
| C2 LH chords | 8 | 98 | 110 | 146 | 362 | 463 | 657 | 699 | 854 | 997 | 1133 |
| C3 RH chords | 12 | 161 | 260 | 305 | 1180 | 1732 | 2006 | 2443 | 3092 | 4227 | 4956 |
| C4 Two voices | 0 | 26 | 61 | 66 | 212 | 302 | 370 | 412 | 454 | 579 | 651 |
| H1 Taking turns | 1 | 13 | 19 | 19 | 19 | 19 | 30 | 30 | 30 | 98 | 102 |
| H2 LH holds | 22 | 47 | 64 | 64 | 74 | 84 | 103 | 117 | 121 | 174 | 180 |
| H3 Two lines | 28 | 83 | 151 | 158 | 254 | 328 | 500 | 762 | 903 | 2535 | 2688 |
| H4 Tune over chords | 5 | 51 | 82 | 88 | 215 | 288 | 386 | 498 | 611 | 1005 | 1098 |
| H5 Both hands chords | 0 | 15 | 33 | 42 | 404 | 668 | 743 | 931 | 1284 | 1890 | 2355 |

What this says:

- **Every lane is well supplied from its opening level onward**, except at the very start.
- **Early, narrow-span material is thin in any corpus.** L1 has few chords or two-hand windows, and H1 and H2 stay small throughout: real music rarely alternates hands strictly or holds the LH that long. These stages need generated phrases, at least at first.
- **Counts jump at L5 and L10**, where the twelfth span and busy rhythms unlock most real piano writing.

## Implementation notes

- **Corpus pipeline:** a separate PDMX extractor alongside `tools/corpus/extract.py`, not merged into it. It keeps both staves and chords (`extract.py` skips multi-voice staves and keeps one pitch per chord). The scratch analysis cut non-overlapping four-bar windows per two-staff score, skipped a pickup bar, and reused `extract.key_of`.
- **Facts:** texture classification belongs in `facts.ts` next to today's phrase facts, so it reuses the app's span, rhythm and key code.
- **Stage pools:** `corpusSource.ts`'s `stagePool` gains a texture dimension, looked up as (trunk level, texture).
- **Generator:** needs textures for the thin early stages: alternating hands, held LH notes, LH intervals and triads.
- **Progress:** side-lane progress is stored per (texture, level), using the same practice event log as the trunk.

## Open questions

- **Rests.** Real piano music is full of them, especially in two-hand textures. Add them as their own trunk level, or as part of an existing one?
- **Key chapters.** Keep today's three key chapters as sub-steps of L11, or merge them?
- **Corpus quality.** How to filter PDMX transcriptions: by composer, by a curated list, or by hand-checking the early pools?
- **Generated vs. corpus mix** in thin stages, and when to switch over.
- **Timed two-hand play.** The timing window in `src/practice/timing.ts` was sized for one note at a time; same issue as in the custom sheet music design.
