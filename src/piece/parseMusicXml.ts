import JSZip from "jszip";
import { handOfStaff, type Ornament, type Piece, type PieceMeasure, type PieceNote } from "./piece";

/** A file that can't be used, with what to tell the player. */
export class PieceError extends Error {}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Quarter beats a beat-unit is worth, for metronome marks such as "dotted quarter = 60". */
const UNIT_QUARTERS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };

/** The MusicXML text of a .musicxml/.xml file, or of the score inside a compressed .mxl. */
export async function readScoreFile(name: string, bytes: ArrayBuffer): Promise<string> {
  const view = new Uint8Array(bytes);
  // Zip files start "PK"; .mxl is one whatever it's called.
  if (view[0] === 0x50 && view[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes).catch(() => {
      throw new PieceError(`${name} looks compressed, but couldn't be opened.`);
    });
    const container = await zip.file("META-INF/container.xml")?.async("string");
    const rootPath = container?.match(/full-path="([^"]+)"/)?.[1];
    const root =
      (rootPath && zip.file(rootPath)) ||
      zip.file(/\.(musicxml|xml)$/i).find((entry) => !entry.name.startsWith("META-INF/"));
    if (!root) throw new PieceError(`${name} has no score inside.`);
    return root.async("string");
  }
  // UTF-16 files carry a byte order mark; everything else is read as UTF-8.
  const utf16 = (view[0] === 0xff && view[1] === 0xfe) || (view[0] === 0xfe && view[1] === 0xff);
  return new TextDecoder(utf16 ? "utf-16" : "utf-8").decode(view);
}

function child(parent: Element, name: string): Element | undefined {
  for (const node of parent.children) if (node.tagName === name) return node;
  return undefined;
}

function children(parent: Element, name: string): Element[] {
  return [...parent.children].filter((node) => node.tagName === name);
}

function text(parent: Element, name: string): string | undefined {
  return child(parent, name)?.textContent?.trim() || undefined;
}

function number(parent: Element, name: string): number | undefined {
  const value = Number(text(parent, name));
  return Number.isFinite(value) && text(parent, name) !== undefined ? value : undefined;
}

/** The part to practise: the first with two staves, else the first part. */
export function pianoPart(root: Element, warnings: string[] = []): Element {
  const parts = children(root, "part");
  if (parts.length === 0) throw new PieceError("The file has no music in it.");
  const staves = (part: Element) => Number(part.querySelector("attributes > staves")?.textContent ?? 1);
  const piano = parts.find((part) => staves(part) >= 2) ?? parts[0];
  if (parts.length > 1) warnings.push(`Only the first piano part is used; ${parts.length - 1} other part(s) are left out.`);
  if (staves(piano) > 2) warnings.push("Only the top two staves are used.");
  if (staves(piano) < 2) warnings.push("The music has one staff, so it is all right hand.");
  return piano;
}

function ornamentOf(note: Element): Ornament | undefined {
  const ornaments = note.querySelector("notations > ornaments");
  if (!ornaments) return undefined;
  if (child(ornaments, "trill-mark") || child(ornaments, "wavy-line")) return "trill";
  if (child(ornaments, "mordent") || child(ornaments, "inverted-mordent")) return "mordent";
  if (child(ornaments, "turn") || child(ornaments, "inverted-turn") || child(ornaments, "delayed-turn")) return "turn";
  return undefined;
}

/** Rounds away float noise from tuplet divisions, so equal times compare equal. */
function tidy(quarters: number): number {
  return Math.round(quarters * 9600) / 9600;
}

/**
 * Reads a partwise MusicXML score into the notes to play. The notes are graded against this
 * and coloured on the drawn score through their bar, staff, offset and pitch.
 */
export function parsePiece(xml: string): Piece {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length > 0) {
    throw new PieceError("The file isn't readable MusicXML.");
  }
  if (root.tagName === "score-timewise") throw new PieceError("Timewise MusicXML isn't supported; export it as partwise.");
  if (root.tagName !== "score-partwise") throw new PieceError("The file isn't a MusicXML score.");

  const warnings: string[] = [];
  const part = pianoPart(root, warnings);
  const title =
    root.querySelector("work > work-title")?.textContent?.trim() ||
    root.querySelector("movement-title")?.textContent?.trim() ||
    root.querySelector('credit-type + credit-words, credit[page="1"] credit-words')?.textContent?.trim() ||
    "Untitled";
  const composer = root.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ?? "";

  const measures: PieceMeasure[] = [];
  const notes: PieceNote[] = [];
  let divisions = 1;
  let fifths = 0;
  let mode: "major" | "minor" = "major";
  let beats = 4;
  let time = "4/4";
  let timeSymbol: PieceMeasure["timeSymbol"];
  let clefs = { right: "G2", left: "F4" };
  let tempo: number | undefined;
  let tempoText: string | undefined;
  let start = 0;
  let skippedStaves = false;
  /** The open ending a bar belongs to until its stop or discontinue. */
  let ending: number[] | undefined;

  for (const measureElement of children(part, "measure")) {
    const index = measures.length;
    const measure: PieceMeasure = {
      label: measureElement.getAttribute("number") ?? String(index + 1),
      start,
      length: 0,
      beats,
      time,
      ...(timeSymbol && { timeSymbol }),
      clefs,
      fifths,
      mode,
      repeatStart: false,
      repeatEnd: false,
      jump: false,
    };
    let position = 0;
    let furthest = 0;
    /** Start of the last note, for <chord/> notes that share it. */
    let lastStart = 0;

    for (const node of measureElement.children) {
      switch (node.tagName) {
        case "attributes": {
          divisions = number(node, "divisions") ?? divisions;
          const key = child(node, "key");
          if (key) {
            fifths = number(key, "fifths") ?? fifths;
            mode = text(key, "mode") === "minor" ? "minor" : "major";
          }
          const timeElement = child(node, "time");
          if (timeElement && number(timeElement, "beats") !== undefined) {
            const top = number(timeElement, "beats")!;
            const bottom = number(timeElement, "beat-type") ?? 4;
            time = `${top}/${bottom}`;
            beats = (top * 4) / bottom;
            const symbol = timeElement.getAttribute("symbol");
            timeSymbol = symbol === "common" || symbol === "cut" ? symbol : undefined;
          }
          for (const clef of children(node, "clef")) {
            const sign = `${text(clef, "sign") ?? "G"}${text(clef, "line") ?? ""}`;
            const hand = handOfStaff(Number(clef.getAttribute("number") ?? 1));
            clefs = { ...clefs, [hand]: sign };
          }
          // Signatures and clefs at the start of a bar belong to it.
          if (position === 0) {
            Object.assign(measure, { fifths, mode, time, beats, clefs });
            if (timeSymbol) measure.timeSymbol = timeSymbol;
            else delete measure.timeSymbol;
          }
          break;
        }
        case "backup":
          position -= (number(node, "duration") ?? 0) / divisions;
          break;
        case "forward":
          position += (number(node, "duration") ?? 0) / divisions;
          furthest = Math.max(furthest, position);
          break;
        case "direction": {
          const sound = child(node, "sound");
          const soundTempo = sound ? Number(sound.getAttribute("tempo")) : NaN;
          const metronome = node.querySelector("direction-type > metronome");
          const perMinute = metronome ? number(metronome, "per-minute") : undefined;
          const unit = metronome ? (UNIT_QUARTERS[text(metronome, "beat-unit") ?? "quarter"] ?? 1) : 1;
          const dotted = metronome && child(metronome, "beat-unit-dot") ? 1.5 : 1;
          // The first tempo given is the piece's; later changes aren't followed yet.
          if (tempo === undefined && Number.isFinite(soundTempo) && soundTempo > 0) tempo = soundTempo;
          if (tempo === undefined && perMinute) tempo = perMinute * unit * dotted;
          const words = node.querySelector("direction-type > words")?.textContent?.trim();
          if (tempoText === undefined && words && index === 0 && position === 0) tempoText = words;
          if (node.querySelector("direction-type > segno, direction-type > coda")) measure.jump = true;
          if (sound && ["dacapo", "dalsegno", "tocoda", "fine"].some((name) => sound.hasAttribute(name))) measure.jump = true;
          break;
        }
        case "sound":
          if (["dacapo", "dalsegno", "tocoda", "fine"].some((name) => node.hasAttribute(name))) measure.jump = true;
          break;
        case "barline": {
          const repeat = child(node, "repeat")?.getAttribute("direction");
          if (repeat === "forward") measure.repeatStart = true;
          if (repeat === "backward") measure.repeatEnd = true;
          const endingElement = child(node, "ending");
          if (endingElement) {
            const type = endingElement.getAttribute("type");
            const passes = (endingElement.getAttribute("number") ?? "1")
              .split(/[,\s]+/)
              .map(Number)
              .filter((n) => n > 0);
            if (type === "start") ending = passes;
            measure.ending = ending;
            if (type === "stop" || type === "discontinue") ending = undefined;
          }
          if (child(node, "segno") || child(node, "coda")) measure.jump = true;
          break;
        }
        case "note": {
          if (child(node, "cue")) break;
          const grace = child(node, "grace") !== undefined;
          const isChord = child(node, "chord") !== undefined;
          const length = grace ? 0 : (number(node, "duration") ?? 0) / divisions;
          const noteStart = isChord ? lastStart : position;
          if (!isChord) {
            lastStart = position;
            position += length;
            furthest = Math.max(furthest, position);
          }
          const pitch = child(node, "pitch");
          if (!pitch || child(node, "rest")) break;
          const staff = number(node, "staff") ?? 1;
          if (staff > 2) {
            skippedStaves = true;
            break;
          }
          const step = STEPS[text(pitch, "step") ?? "C"];
          const midi = 12 * ((number(pitch, "octave") ?? 4) + 1) + step + Math.round(number(pitch, "alter") ?? 0);
          const ties = children(node, "tie").map((tie) => tie.getAttribute("type"));
          if (isChord) {
            for (let j = notes.length - 1; j >= 0 && notes[j].measure === index; j--) {
              if (notes[j].hand === handOfStaff(staff) && notes[j].offset === tidy(noteStart)) notes[j].chord = true;
            }
          }
          notes.push({
            hand: handOfStaff(staff),
            midi,
            start: tidy(start + noteStart),
            length: tidy(length),
            measure: index,
            offset: tidy(noteStart),
            type: text(node, "type"),
            tiedFrom: ties.includes("stop"),
            grace,
            chord: isChord,
            tuplet: child(node, "time-modification") !== undefined,
            ornament: ornamentOf(node),
            ...(ties.includes("start") && { tieNext: -1 }),
          });
          break;
        }
      }
    }
    // A pickup or a short last bar is as long as its notes; a full bar keeps its signature's length.
    measure.length = tidy(furthest > 0 ? furthest : beats);
    // An ending without a barline of its own carries on over the bars it spans.
    if (!measure.ending && ending) measure.ending = ending;
    measures.push(measure);
    start = tidy(start + measure.length);
  }

  if (measures.length === 0) throw new PieceError("The file has no bars in it.");
  if (skippedStaves) warnings.push("Notes on a third staff are left out.");
  linkTies(notes);
  if (notes.length === 0) throw new PieceError("The file has no notes to play.");
  if (measures.some((m) => m.jump)) warnings.push("D.C., D.S. and coda jumps aren't followed; the full piece plays in written order.");
  return { title, composer, tempo, tempoText, measures, notes, warnings };
}

/** Points each tie start at the note it's held on into: the next note in its hand at that pitch. */
function linkTies(notes: PieceNote[]): void {
  const heldOn = new Set<number>();
  notes.forEach((note, i) => {
    if (note.tieNext === undefined) return;
    const end = tidy(note.start + note.length);
    const next = notes.findIndex((n, j) => j > i && n.hand === note.hand && n.midi === note.midi && n.tiedFrom && tidy(n.start) === end);
    if (next >= 0) {
      note.tieNext = next;
      heldOn.add(next);
    } else delete note.tieNext;
  });
  // A tie that ends on a note nothing was tied from is pressed like any other note.
  notes.forEach((note, i) => {
    if (note.tiedFrom && !heldOn.has(i)) note.tiedFrom = false;
  });
}
