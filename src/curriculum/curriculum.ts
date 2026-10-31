import { generateExercise, type Random } from "../music/generator";
import { KEYS, keyById } from "../music/keys";
import { allowedDurations, type Notation } from "../music/notation";
import type { AccidentalFrequency, Clef, Exercise, RhythmFlavor } from "../music/types";
import { spanById, spanLevel, type SpanId } from "./spans";

/** ★ Read = wait mode, ★★ Play = rhythm at the stage tempo, ★★★ Fluent = rhythm at the target tempo. */
export type Tier = "read" | "play" | "fluent";

export const TIERS: readonly Tier[] = ["read", "play", "fluent"];

export const TIER_LABELS: Record<Tier, string> = { read: "Read", play: "Play", fluent: "Fluent" };

/** Perfect phrases in a row that earn a tier's star (★★ also opens the next stage). */
export const STAR_STREAK = 10;

/** Perfect phrases in a row, at Play or Fluent, that mark a stage complete. */
export const COMPLETE_STREAK = 50;

/**
 * One fixed configuration to practise. The id is what the event log stores, so it must
 * never change once released; everything else may be retuned.
 */
export interface Stage {
  id: string;
  keys: readonly string[];
  span: SpanId;
  accidentals: AccidentalFrequency;
  rhythm: RhythmFlavor;
  bars: number;
  /** Rhythm-mode tempo for ★★ Play. */
  tempo: number;
  /** Rhythm-mode tempo for ★★★ Fluent. */
  fluentTempo: number;
  /** Notation first met here; from then on phrases may use it (see stageNotations). */
  introduces: readonly Notation[];
}

export interface Chapter {
  title: string;
  stages: readonly Stage[];
}

/** Where a stage sits in its track, for display ("1.4"). */
export interface PlacedStage {
  stage: Stage;
  chapterIndex: number;
  /** "1.4" */
  number: string;
  /** Position in the whole track, from 0. */
  order: number;
}

const CORE = ["C", "G", "F", "D"] as const;

/** Relative minors of the core keys. */
const CORE_MINOR = ["Am", "Em", "Dm", "Bm"] as const;

const CORE_BOTH = [...CORE, ...CORE_MINOR];

const SIX_BOTH = [...CORE_BOTH, "Bb", "Gm", "A", "F#m"];

const EIGHT_BOTH = [...SIX_BOTH, "Eb", "Cm", "E", "C#m"];

/**
 * Every major key and its relative minor, except G♯ minor: its leading tone is F𝄪,
 * and notes here carry at most one sharp or flat.
 */
const ALL_KEYS = [...EIGHT_BOTH, "Ab", "Fm", "Db", "Bbm", "B", "Gb", "Ebm"];

/** Every curriculum phrase is four bars long. */
const PHRASE_BARS = 4;

function stage(
  id: string,
  keys: readonly string[],
  span: SpanId,
  options: Partial<Pick<Stage, "accidentals" | "rhythm" | "tempo" | "fluentTempo" | "introduces">> = {},
): Stage {
  return {
    id,
    keys,
    span,
    accidentals: options.accidentals ?? "none",
    rhythm: options.rhythm ?? "basic",
    bars: PHRASE_BARS,
    tempo: options.tempo ?? 60,
    fluentTempo: options.fluentTempo ?? 80,
    introduces: options.introduces ?? [],
  };
}

/**
 * Both clef tracks share these chapters. The core major keys (C, G, F, D) go deep first,
 * through wider spans, eighths and accidentals. Their relative minors follow once accidentals
 * are familiar, since minor's raised 7th is one; after that key sets mix major and minor, and
 * each new major key arrives with its relative minor, on spans already learned.
 */
export const CHAPTERS: readonly Chapter[] = [
  {
    title: "First positions",
    stages: [
      stage("five-c", ["C"], "five", { introduces: ["quarter", "half", "whole"] }),
      stage("five-g", ["G"], "five", { introduces: ["dotted-half"] }),
      stage("five-f", ["F"], "five"),
      stage("five-cgf", ["C", "G", "F"], "five", { introduces: ["three-four"] }),
      stage("five-d", ["D"], "five", { introduces: ["pickup"] }),
      stage("five-core", CORE, "five"),
    ],
  },
  {
    title: "One octave",
    stages: [
      stage("octave-c", ["C"], "octave"),
      stage("octave-gf", ["G", "F"], "octave"),
      stage("octave-d", ["D"], "octave"),
      stage("octave-core", CORE, "octave"),
    ],
  },
  {
    title: "Eighth notes",
    stages: [
      stage("five-core-eighths", CORE, "five", { rhythm: "eighths", introduces: ["eighth"] }),
      stage("octave-cg-eighths", ["C", "G"], "octave", { rhythm: "eighths", introduces: ["dotted-quarter"] }),
      stage("octave-core-eighths", CORE, "octave", { rhythm: "eighths", introduces: ["tie"] }),
    ],
  },
  {
    title: "Wider reach",
    stages: [
      stage("twelfth-cg", ["C", "G"], "twelfth"),
      stage("twelfth-core", CORE, "twelfth"),
      stage("twelfth-core-eighths", CORE, "twelfth", { rhythm: "eighths" }),
    ],
  },
  {
    title: "Accidentals",
    stages: [
      stage("octave-c-rare", ["C"], "octave", { accidentals: "rare" }),
      stage("octave-core-rare", CORE, "octave", { accidentals: "rare" }),
      stage("twelfth-core-medium", CORE, "twelfth", { accidentals: "medium" }),
    ],
  },
  {
    title: "Minor keys",
    stages: [
      stage("five-am", ["Am"], "five"),
      stage("five-em-dm", ["Em", "Dm"], "five"),
      stage("octave-am-em-dm", ["Am", "Em", "Dm"], "octave"),
      stage("octave-bm", ["Bm"], "octave"),
      stage("octave-core-minor", CORE_MINOR, "octave"),
      stage("octave-core-both", CORE_BOTH, "octave"),
      stage("twelfth-core-both-eighths", CORE_BOTH, "twelfth", { rhythm: "eighths" }),
    ],
  },
  {
    title: "Ledger lines",
    stages: [
      stage("two-core", CORE, "two-octaves"),
      stage("two-core-both-eighths", CORE_BOTH, "two-octaves", { rhythm: "eighths" }),
      stage("two-core-both-eighths-rare", CORE_BOTH, "two-octaves", { rhythm: "eighths", accidentals: "rare" }),
    ],
  },
  {
    title: "Busy rhythms",
    stages: [
      stage("octave-core-both-busy", CORE_BOTH, "octave", { rhythm: "busy", fluentTempo: 72, introduces: ["cut-time"] }),
      stage("two-core-both-busy-medium", CORE_BOTH, "two-octaves", { rhythm: "busy", accidentals: "medium", fluentTempo: 72 }),
    ],
  },
  {
    title: "B♭ and A, G minor and F♯ minor",
    stages: [
      stage("octave-bb-gm", ["Bb", "Gm"], "octave"),
      stage("octave-a-fsm", ["A", "F#m"], "octave"),
      stage("twelfth-six-both-eighths", SIX_BOTH, "twelfth", { rhythm: "eighths" }),
      stage("two-six-both-busy-medium", SIX_BOTH, "two-octaves", { rhythm: "busy", accidentals: "medium", fluentTempo: 72 }),
    ],
  },
  {
    title: "E♭ and E, C minor and C♯ minor",
    stages: [
      stage("octave-eb-cm", ["Eb", "Cm"], "octave"),
      stage("octave-e-csm", ["E", "C#m"], "octave"),
      stage("twelfth-eight-both-eighths-rare", EIGHT_BOTH, "twelfth", { rhythm: "eighths", accidentals: "rare" }),
    ],
  },
  {
    title: "Far keys",
    stages: [
      stage("octave-ab-db-minors", ["Ab", "Fm", "Db", "Bbm"], "octave"),
      stage("octave-b-gb-minors", ["B", "Gb", "Ebm"], "octave"),
      stage("two-all-busy-common", ALL_KEYS, "two-octaves", { rhythm: "busy", accidentals: "common", fluentTempo: 72 }),
    ],
  },
];

export const CLEF_TRACKS: readonly Clef[] = ["treble", "bass"];

export const TRACK_LABELS: Record<Clef, string> = { treble: "Treble", bass: "Bass" };

/** Every stage in track order with its display number. */
export const PLACED_STAGES: readonly PlacedStage[] = CHAPTERS.flatMap((chapter, chapterIndex) =>
  chapter.stages.map((stage, i) => ({ stage, chapterIndex, number: `${chapterIndex + 1}.${i + 1}`, order: 0 })),
).map((placed, order) => ({ ...placed, order }));

export function placedStage(stageId: string): PlacedStage | undefined {
  return PLACED_STAGES.find((p) => p.stage.id === stageId);
}

/** Notation a stage's phrases may use: everything introduced up to and including it. */
export function stageNotations(stage: Stage): Set<Notation> {
  const order = placedStage(stage.id)?.order ?? PLACED_STAGES.length;
  const notations = new Set<Notation>(stage.introduces);
  for (const placed of PLACED_STAGES.slice(0, order)) for (const n of placed.stage.introduces) notations.add(n);
  return notations;
}

/** "B♭" from a key id, "F♯m" for F♯ minor. */
export function keyName(keyId: string): string {
  return keyId.replace("b", "♭").replace("#", "♯");
}

/** "C G F D + minors" when a set is some majors plus exactly their relative minors. */
function keySetName(keys: readonly string[]): string {
  if (keys.length > 12) return "all keys";
  const majors = keys.filter((k) => keyById(k).mode === "major");
  const minors = keys.filter((k) => keyById(k).mode === "minor");
  const relativeMajors = new Set(
    minors.map((m) => KEYS.find((k) => k.signature === keyById(m).signature)!.id),
  );
  const paired =
    majors.length > 1 &&
    minors.length === majors.length &&
    majors.every((k) => relativeMajors.has(k));
  return paired ? `${majors.map(keyName).join(" ")} + minors` : keys.map(keyName).join(" ");
}

/** "One octave · C G F D", naming the span and the key set. */
export function stageTitle(stage: Stage): string {
  return [spanById(stage.span).label, keySetName(stage.keys)].join(" · ");
}

const RHYTHM_NAMES: Record<RhythmFlavor, string> = {
  basic: "Whole, half, quarter",
  eighths: "With eighths",
  busy: "Busy eighths",
};

const ACCIDENTAL_NAMES: Record<AccidentalFrequency, string> = {
  none: "No accidentals",
  rare: "Rare accidentals",
  medium: "Some accidentals",
  common: "Many accidentals",
};

/** Short facts about a stage, for chips on the stage card. */
export function stageFacts(stage: Stage): string[] {
  return [
    `Keys ${stage.keys.map(keyName).join(" ")}`,
    spanById(stage.span).label,
    RHYTHM_NAMES[stage.rhythm],
    ACCIDENTAL_NAMES[stage.accidentals],
    `${stage.bars} bars`,
  ];
}

export function tierMode(tier: Tier): "wait" | "rhythm" {
  return tier === "read" ? "wait" : "rhythm";
}

export function tierTempo(stage: Stage, tier: Tier): number | undefined {
  if (tier === "read") return undefined;
  return tier === "fluent" ? stage.fluentTempo : stage.tempo;
}

/**
 * Phrases for a stage, picking a key from its set each time and avoiding the same key twice
 * in a row so a mixed stage really mixes.
 */
export function stageExercises(clef: Clef, stage: Stage, random: Random = Math.random): () => Exercise {
  const durations = allowedDurations(stageNotations(stage));
  let previousKey: string | undefined;
  return () => {
    const choices = stage.keys.length > 1 ? stage.keys.filter((k) => k !== previousKey) : stage.keys;
    const key = choices[Math.floor(random() * choices.length)];
    previousKey = key;
    return generateExercise(
      spanLevel(clef, key, stage.span),
      { bars: stage.bars, key, accidentalFrequency: stage.accidentals, rhythm: stage.rhythm, durations },
      random,
    );
  };
}
