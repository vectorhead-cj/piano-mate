import { advanceStars, CLEF_TRACKS, hasIntro, PLACED_STAGES, placedStage, type PlacedStage } from "../curriculum/curriculum";
import type { Progress, TrackProgress } from "../curriculum/progress";
import { spanById, type SpanId } from "../curriculum/spans";
import type { Clef } from "../music/types";

/**
 * What a flashcard tests, and what the schedule is kept for: reading in a clef, in a key, over a
 * range, with or without accidentals. Every bar a card shows is new; the concept is what the
 * player gets right or wrong. The curriculum's stages define the concepts: each stage practises
 * its keys over its range, so each (key, range, accidentals) it brings is one.
 */
export interface Concept {
  /** What the event log stores, so it must never change once released: "treble/G/octave", "bass/Bb/octave/acc". */
  id: string;
  clef: Clef;
  /** A key id (src/music/keys.ts): "G", "Bb", "F#m". */
  key: string;
  span: SpanId;
  /** Cards have accidentals in them: notes the key signature doesn't give. */
  accidentals: boolean;
  /** The first stage (in track order) that practises it. */
  stageId: string;
  /** Position among the clef's concepts, earliest first. */
  order: number;
}

export function conceptId(clef: Clef, key: string, span: SpanId, accidentals: boolean): string {
  return `${clef}/${key}/${span}${accidentals ? "/acc" : ""}`;
}

function derive(clef: Clef): Concept[] {
  const seen = new Set<string>();
  const concepts: Concept[] = [];
  for (const { stage } of PLACED_STAGES) {
    const variants = stage.accidentals === "none" ? [false] : [false, true];
    for (const key of stage.keys) {
      for (const accidentals of variants) {
        const id = conceptId(clef, key, stage.span, accidentals);
        if (seen.has(id)) continue;
        seen.add(id);
        concepts.push({ id, clef, key, span: stage.span, accidentals, stageId: stage.id, order: concepts.length });
      }
    }
  }
  return concepts;
}

/** Every concept in each clef, in the order the curriculum brings them. */
export const CONCEPTS: Record<Clef, readonly Concept[]> = {
  treble: derive("treble"),
  bass: derive("bass"),
};

export const ALL_CONCEPTS: readonly Concept[] = CLEF_TRACKS.flatMap((clef) => CONCEPTS[clef]);

const BY_ID = new Map(ALL_CONCEPTS.map((c) => [c.id, c]));

export function conceptById(id: string): Concept | undefined {
  return BY_ID.get(id);
}

/** "G major · One octave", "B♭ major · Octave and a fifth · with accidentals" */
export function conceptTitle(concept: Concept, keyName: (key: string) => string): string {
  return [keyName(concept.key), spanById(concept.span).label, concept.accidentals ? "with accidentals" : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Whether a concept's cards are in play. The player has to have been through its stage: its
 * intro done (watched, skipped, or the stage practised before the intro existed), or, where the
 * stage has no intro, that stage or any later one cleared. Clearing a stage is what opens the
 * next, so a cleared stage always follows an intro that was done (or a track started further on).
 */
export function conceptUnlocked(concept: Concept, track: TrackProgress): boolean {
  const placed = placedStage(concept.stageId)!;
  if (hasIntro(placed.stage) && track.stages[placed.stage.id].introDone) return true;
  return PLACED_STAGES.some((later: PlacedStage) => later.order >= placed.order && cleared(later, track));
}

function cleared({ stage }: PlacedStage, track: TrackProgress): boolean {
  return track.stages[stage.id].stars >= advanceStars(stage);
}

/**
 * The concepts open to practise now, earliest first, in both clefs. `all` opens every one, for
 * the debug switch that unlocks the whole curriculum.
 */
export function unlockedConcepts(progress: Progress, all = false): Concept[] {
  return CLEF_TRACKS.flatMap((clef) => CONCEPTS[clef].filter((c) => all || conceptUnlocked(c, progress[clef])));
}
