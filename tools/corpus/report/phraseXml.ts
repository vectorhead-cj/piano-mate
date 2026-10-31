import { noteType, type RawNote, type RawPhrase } from "../facts";

/** Enough divisions per quarter for triplets and 32nds to be whole numbers. */
const DIVISIONS = 24;

const ACCIDENTALS: Record<number, string> = { [-2]: "flat-flat", [-1]: "flat", 0: "natural", 1: "sharp", 2: "double-sharp" };

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];

function signatureAlter(fifths: number, step: string): number {
  const i = SHARP_ORDER.indexOf(step);
  if (fifths > 0) return i < fifths ? 1 : 0;
  if (fifths < 0) return 6 - i < -fifths ? -1 : 0;
  return 0;
}

/** Colour for notes that a blocker points at. */
export const HIGHLIGHT_COLOR = "#D0402A";

/** A phrase as a one-part MusicXML score in its original key, for previewing; highlighted notes are drawn in red. */
export function phraseToMusicXml(phrase: RawPhrase, highlight: ReadonlySet<RawNote> = new Set()): string {
  const [beats, beatType] = phrase.time.split("/");
  const clef = phrase.clef === "treble" ? { sign: "G", line: 2 } : { sign: "F", line: 4 };
  const measures = new Map<number, RawNote[]>();
  for (const n of phrase.notes) {
    if (!measures.has(n.measure)) measures.set(n.measure, []);
    measures.get(n.measure)!.push(n);
  }
  const lastNote = phrase.notes[phrase.notes.length - 1];

  const body = [...measures.values()]
    .map((notes, index) => {
      const attributes =
        index === 0
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${phrase.keyFifths}</fifths></key>` +
            `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
            `<clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef></attributes>`
          : "";
      // A phrase starting mid-bar is written as a short pickup bar.
      const implicit = index === 0 && notes[0].beat > 0 ? ` implicit="yes"` : "";
      const active = new Map<string, number>();
      const xml = notes.map((n) => noteXml(n, phrase.keyFifths, active, n === lastNote, highlight.has(n))).join("");
      return `<measure number="${index + 1}"${implicit}>${attributes}${xml}</measure>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
<part id="P1">${body}</part></score-partwise>`;
}

function noteXml(n: RawNote, fifths: number, active: Map<string, number>, last: boolean, highlighted: boolean): string {
  const open = highlighted ? `<note color="${HIGHLIGHT_COLOR}">` : "<note>";
  const duration = `<duration>${Math.round(n.ql * DIVISIONS)}</duration>`;
  const type = `<type>${noteType(n)}</type>`;
  const dots = "<dot/>".repeat(n.dots);
  const tuplet = n.tuplet ? `<time-modification><actual-notes>${n.tuplet.split(":")[0]}</actual-notes><normal-notes>${n.tuplet.split(":")[1]}</normal-notes></time-modification>` : "";
  const notations: string[] = [];
  if (last) notations.push("<fermata/>");
  const alter = n.alter;
  const position = `${n.step}${n.octave}`;
  const current = active.get(position) ?? signatureAlter(fifths, n.step);
  let accidental = "";
  if (alter !== current && n.tie !== "stop" && n.tie !== "continue") {
    accidental = `<accidental>${ACCIDENTALS[alter]}</accidental>`;
    active.set(position, alter);
  }
  const ties: string[] = [];
  if (n.tie === "start" || n.tie === "continue") ties.push("start");
  if (n.tie === "stop" || n.tie === "continue") ties.push("stop");
  const tieXml = ties.map((t) => `<tie type="${t}"/>`).join("");
  for (const t of ties) notations.push(`<tied type="${t}"/>`);
  const grace = n.grace ? "<grace/>" : "";
  const pitch = `<pitch><step>${n.step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${n.octave}</octave></pitch>`;
  const notehead = highlighted ? `<notehead color="${HIGHLIGHT_COLOR}">normal</notehead>` : "";
  return `${open}${grace}${pitch}${n.grace ? "" : duration}${tieXml}${type}${dots}${accidental}${tuplet}${notehead}${
    notations.length ? `<notations>${notations.join("")}</notations>` : ""
  }</note>`;
}
