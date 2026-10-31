import { accidentalsForBar, type AccidentalSymbol } from "./accidentals";
import { keyById, type KeyInfo } from "./keys";
import { noteName } from "./pitch";
import { timeParts } from "./rhythms";
import { isTieContinuation } from "./ties";
import type { Clef, Duration, Exercise, Note } from "./types";

/** Divisions per quarter note so eighths and dotted quarters are integer durations. */
const DIVISIONS = 2;

const CLEF_SIGNS: Record<Clef, { sign: string; line: number }> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
};

const DURATION_XML: Record<Duration, { duration: number; type: string; dotted?: boolean }> = {
  w: { duration: 4 * DIVISIONS, type: "whole" },
  "h.": { duration: 3 * DIVISIONS, type: "half", dotted: true },
  h: { duration: 2 * DIVISIONS, type: "half" },
  "q.": { duration: 1.5 * DIVISIONS, type: "quarter", dotted: true },
  q: { duration: 1 * DIVISIONS, type: "quarter" },
  "8": { duration: DIVISIONS / 2, type: "eighth" },
};

const ACCIDENTAL_XML: Record<AccidentalSymbol, string> = {
  "#": "sharp",
  b: "flat",
  n: "natural",
};

export interface MusicXmlOptions {
  /** Emit note-name lyrics under each note (for OSMD "names on notes"). */
  noteNames?: boolean;
}

/** Serialize an Exercise to MusicXML 3.1 partwise (monophonic, one part). */
export function exerciseToMusicXml(
  exercise: Exercise,
  options: MusicXmlOptions = {},
): string {
  const key = keyById(exercise.key);
  // Whether each note is held on from the one before, across barlines too.
  const flat = exercise.bars.flat();
  let start = 0;
  const measures = exercise.bars
    .map((bar, index) => {
      const held = bar.map((_, i) => isTieContinuation(flat, start + i));
      start += bar.length;
      // A note held over the barline keeps its pitch without printing the accidental again.
      const accidentals = accidentalsForBar(bar, key).map((a, i) => (held[i] ? null : a));
      return measureXml(bar, index + 1, exercise, key, options, accidentals, held);
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name></part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures}
  </part>
</score-partwise>
`;
}

function measureXml(
  bar: readonly Note[],
  number: number,
  exercise: Exercise,
  key: KeyInfo,
  options: MusicXmlOptions,
  accidentals: readonly (AccidentalSymbol | null)[],
  held: readonly boolean[],
): string {
  const { beats, beatType } = timeParts(exercise.time);
  const attributes =
    number === 1
      ? `      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key>
          <fifths>${key.signature}</fifths>
          <mode>${key.mode}</mode>
        </key>
        <time>
          <beats>${beats}</beats>
          <beat-type>${beatType}</beat-type>
        </time>
        <clef>
          <sign>${CLEF_SIGNS[exercise.clef].sign}</sign>
          <line>${CLEF_SIGNS[exercise.clef].line}</line>
        </clef>
      </attributes>
`
      : "";

  const notes = bar
    .map((note, i) => noteXml(note, options, accidentals[i], held[i]))
    .join("\n");
  // A pickup bar is numbered 0 and marked as incomplete, as engravers do.
  const pickup = exercise.pickup > 0;
  const label = pickup ? number - 1 : number;
  const implicit = pickup && number === 1 ? ` implicit="yes"` : "";
  return `    <measure number="${label}"${implicit}>
${attributes}${notes}
    </measure>`;
}

function noteXml(
  note: Note,
  options: MusicXmlOptions,
  accidental: AccidentalSymbol | null,
  held: boolean,
): string {
  const { duration, type, dotted } = DURATION_XML[note.duration];
  const ties = [...(held ? ["stop"] : []), ...(note.tie ? ["start"] : [])];
  const tieXml = ties.map((t) => `\n        <tie type="${t}"/>`).join("");
  const notations = ties.length
    ? `\n        <notations>${ties.map((t) => `<tied type="${t}"/>`).join("")}</notations>`
    : "";
  const alter =
    note.alter !== 0 ? `\n          <alter>${note.alter}</alter>` : "";
  // OSMD draws printed accidentals from <accidental>, not from <alter> alone.
  const accidentalXml = accidental
    ? `\n        <accidental>${ACCIDENTAL_XML[accidental]}</accidental>`
    : "";
  // A held note is the same key as the one before, so it isn't named again.
  const lyric = options.noteNames && !held
    ? `
        <lyric number="1">
          <syllabic>single</syllabic>
          <text>${escapeXml(noteName(note))}</text>
        </lyric>`
    : "";
  return `      <note>
        <pitch>
          <step>${note.letter}</step>${alter}
          <octave>${note.octave}</octave>
        </pitch>
        <duration>${duration}</duration>${tieXml}
        <type>${type}</type>${dotted ? "\n        <dot/>" : ""}${accidentalXml}${notations}${lyric}
      </note>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
