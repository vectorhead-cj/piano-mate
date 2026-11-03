import type { Piece, PieceNote } from "./piece";
import type { Target } from "./targets";

/** How long each note of a trill sounds: about nine a second, whatever the tempo. */
const TRILL_NOTE_SECONDS = 0.11;
/** How long each quick note of a mordent or turn sounds. */
const FLICK_SECONDS = 0.075;
/** Loudness of the passing notes of an ornament, and of a note an appoggiatura resolves into, against the note's own. */
const LIGHT = 0.8;

/** One note the synth sounds. Times are in quarter beats from the span's start, like Target's. */
export interface Sound {
  pitch: number;
  at: number;
  /** Its written length; legato notes are held all of it, others a little less. */
  length: number;
  /** Against the playback's own loudness: 1, or less for passing notes. */
  velocity: number;
  /** Held into the next note: under a slur, or inside an ornament. */
  legato: boolean;
}

/**
 * The notes the synth plays for these targets, with grace notes and ornaments played out:
 * appoggiaturas lean on the beat, trills start from the note above unless it was just played,
 * and mordents and turns flick through their neighbours on the beat.
 */
export function soundsOf(piece: Piece, targets: readonly Target[], tempo: number): Sound[] {
  const beatsPerSecond = tempo / 60;
  const sounds: Sound[] = [];
  for (const target of targets) {
    const note = piece.notes[target.notes[0]];
    const legato = piece.notes[target.notes[target.notes.length - 1]].slurred === true;
    let velocity = 1;
    if (target.graces) {
      const { notes, lead } = target.graces;
      const leaning = notes.length === 1 && !piece.notes[notes[0]].acciaccatura;
      const each = lead / notes.length;
      notes.forEach((g, i) =>
        sounds.push({ pitch: piece.notes[g].midi, at: target.due - lead + i * each, length: each, velocity: leaning ? 1 : LIGHT, legato: true }),
      );
      // An appoggiatura takes the stress; the note it falls to is softer.
      if (leaning) velocity = LIGHT;
    }
    const steps = note.ornament ? ornamentSteps(piece, target, note, beatsPerSecond) : [{ pitch: note.midi, length: target.length }];
    let at = target.due;
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      sounds.push({ pitch: step.pitch, at, length: step.length, velocity: i === 0 ? velocity : velocity * LIGHT, legato: !last || legato });
      at += step.length;
    });
  }
  return sounds.sort((a, b) => a.at - b.at || a.pitch - b.pitch);
}

interface Step {
  pitch: number;
  length: number;
}

/** An ornamented note played out as the notes that sound, filling its length. */
function ornamentSteps(piece: Piece, target: Target, note: PieceNote, beatsPerSecond: number): Step[] {
  const main = note.midi;
  const upper = note.upper ?? main + 2;
  const lower = note.lower ?? main - 2;
  const length = target.length;
  const flicks = (pitches: number[], share: number): Step[] => {
    const quick = Math.min(FLICK_SECONDS * beatsPerSecond, length / share);
    return [...pitches.map((pitch) => ({ pitch, length: quick })), { pitch: main, length: length - quick * pitches.length }];
  };
  switch (note.ornament) {
    case "trill":
      return trillSteps(main, upper, length, TRILL_NOTE_SECONDS * beatsPerSecond, previousPitch(piece, target) !== upper);
    case "mordent":
      return flicks([main, lower], 4);
    case "upper-mordent":
      return flicks([main, upper], 4);
    case "turn":
      return flicks([upper, main, lower], 5);
    case "inverted-turn":
      return flicks([lower, main, upper], 5);
    case "delayed-turn":
    case "delayed-inverted-turn": {
      // The note first, then the turn in the time left, ending back on it.
      const quick = Math.min(FLICK_SECONDS * beatsPerSecond, length / 6);
      const turn = note.ornament === "delayed-turn" ? [upper, main, lower, main] : [lower, main, upper, main];
      return [{ pitch: main, length: length - quick * 4 }, ...turn.map((pitch) => ({ pitch, length: quick }))];
    }
    default:
      return [{ pitch: main, length }];
  }
}

/**
 * Alternates the note with the one above at about `unit` beats a note, ending on the note.
 * From above, a long trill leans on its first note for two.
 */
export function trillSteps(main: number, upper: number, length: number, unit: number, fromAbove: boolean): Step[] {
  const units = Math.max(fromAbove ? 2 : 3, Math.round(length / unit));
  const counts: number[] = [];
  let used = 0;
  if (fromAbove && units >= 6) {
    counts.push(2);
    used = 2;
  }
  while (used < units) {
    counts.push(1);
    used++;
  }
  const pitchAt = (i: number) => ((i % 2 === 0) === fromAbove ? upper : main);
  // Ending on the note above, the last two join into a longer last note.
  if (pitchAt(counts.length - 1) !== main) counts[counts.length - 2] += counts.pop()!;
  return counts.map((count, i) => ({ pitch: pitchAt(i), length: (count * length) / units }));
}

/** The note played just before in the same hand, for whether a trill starts from above. */
function previousPitch(piece: Piece, target: Target): number | undefined {
  const index = target.notes[0];
  const note = piece.notes[index];
  for (let j = index - 1; j >= 0 && piece.notes[j].measure >= note.measure - 1; j--) {
    const other = piece.notes[j];
    if (other.hand === note.hand && !other.grace && Math.abs(other.start + other.length - note.start) < 1e-6) return other.midi;
  }
  return undefined;
}
