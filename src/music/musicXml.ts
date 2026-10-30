import { accidentalsForBar, type AccidentalSymbol } from "./accidentals";
import { keyById } from "./keys";
import { noteName } from "./pitch";
import type { Clef, Duration, Exercise, Note } from "./types";

/** Divisions per quarter note so eighth notes are integer durations. */
const DIVISIONS = 2;

const CLEF_SIGNS: Record<Clef, { sign: string; line: number }> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
};

const DURATION_XML: Record<Duration, { duration: number; type: string }> = {
  w: { duration: 4 * DIVISIONS, type: "whole" },
  h: { duration: 2 * DIVISIONS, type: "half" },
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
  const measures = exercise.bars
    .map((bar, index) => measureXml(bar, index + 1, exercise, key.signature, options, accidentalsForBar(bar, key)))
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
  fifths: number,
  options: MusicXmlOptions,
  accidentals: readonly (AccidentalSymbol | null)[],
): string {
  const attributes =
    number === 1
      ? `      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key>
          <fifths>${fifths}</fifths>
        </key>
        <time>
          <beats>${exercise.beatsPerBar}</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>${CLEF_SIGNS[exercise.clef].sign}</sign>
          <line>${CLEF_SIGNS[exercise.clef].line}</line>
        </clef>
      </attributes>
`
      : "";

  const notes = bar
    .map((note, i) => noteXml(note, options, accidentals[i]))
    .join("\n");
  return `    <measure number="${number}">
${attributes}${notes}
    </measure>`;
}

function noteXml(
  note: Note,
  options: MusicXmlOptions,
  accidental: AccidentalSymbol | null,
): string {
  const { duration, type } = DURATION_XML[note.duration];
  const alter =
    note.alter !== 0 ? `\n          <alter>${note.alter}</alter>` : "";
  // OSMD draws printed accidentals from <accidental>, not from <alter> alone.
  const accidentalXml = accidental
    ? `\n        <accidental>${ACCIDENTAL_XML[accidental]}</accidental>`
    : "";
  const lyric = options.noteNames
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
        <duration>${duration}</duration>
        <type>${type}</type>${accidentalXml}${lyric}
      </note>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
