// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pieceFeatures } from "../src/piece/features";
import { parsePiece, PieceError, readScoreFile } from "../src/piece/parseMusicXml";
import { playOrder, type PieceMeasure } from "../src/piece/piece";
import { scoreXml } from "../src/piece/scoreXml";

async function k208Xml(): Promise<string> {
  const bytes = readFileSync("tests/fixtures/scarlatti-k208.mxl");
  return readScoreFile("scarlatti-k208.mxl", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function k208() {
  return parsePiece(await k208Xml());
}

/** A two-staff score from bars of raw MusicXML notes, divisions 2 (an eighth is 1). */
function score(...bars: string[]): string {
  const measures = bars
    .map(
      (body, i) => `<measure number="${i + 1}">${
        i === 0
          ? "<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>"
          : ""
      }${body}</measure>`,
    )
    .join("");
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function note(step: string, octave: number, duration: number, extra = ""): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}</note>`;
}

describe("parsePiece", () => {
  it("reads Scarlatti's K.208 from its .mxl", async () => {
    const piece = await k208();
    expect(piece.title).toBe("Sonata K. 208");
    expect(piece.composer).toBe("Domenico Scarlatti");
    expect(piece.tempo).toBe(60);
    expect(piece.tempoText).toBe("Adagio e cantabile");
    expect(piece.measures).toHaveLength(25);
    expect(piece.measures[0]).toMatchObject({ fifths: 3, time: "4/4", timeSymbol: "common", beats: 4, start: 0, length: 4 });
    expect(piece.measures[0].clefs).toEqual({ right: "G2", left: "F4" });
    // Each bar is 4/4 and they follow on.
    piece.measures.forEach((m, i) => expect(m.start).toBe(4 * i));
    const left = piece.notes.filter((n) => n.hand === "left");
    const right = piece.notes.filter((n) => n.hand === "right");
    expect(left.filter((n) => n.chord).length).toBeGreaterThan(90);
    expect(right.filter((n) => n.grace)).toHaveLength(3);
    expect(right.filter((n) => n.ornament === "trill")).toHaveLength(2);
    // The first note: A4 on beat one.
    expect(right[0]).toMatchObject({ midi: 69, start: 0, length: 1 });
    // No note outside its bar.
    for (const n of piece.notes) {
      const m = piece.measures[n.measure];
      expect(n.start).toBeGreaterThanOrEqual(m.start);
      expect(n.start).toBeLessThan(m.start + m.length);
    }
  });

  it("plays K.208's two halves twice each", async () => {
    const piece = await k208();
    const order = playOrder(piece.measures);
    expect(order).toHaveLength(50);
    const firstHalfEnd = piece.measures.findIndex((m) => m.repeatEnd);
    expect(order.slice(0, firstHalfEnd + 1)).toEqual(order.slice(firstHalfEnd + 1, 2 * (firstHalfEnd + 1)));
  });

  it("lists the piece's notation as intro cards", async () => {
    const features = pieceFeatures(await k208());
    const ids = features.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["key", "time", "tempo", "note-values", "chords-left", "ties", "grace", "ornaments", "repeats"]));
    expect(features.find((f) => f.id === "key")!.title).toBe("Key: A major");
    expect(features.find((f) => f.id === "key")!.detail).toContain("F♯ C♯ G♯");
  });

  it("puts chord notes and backed-up voices at the right times", () => {
    const piece = parsePiece(
      score(
        note("C", 5, 4, "<staff>1</staff>") +
          note("E", 5, 4, "<chord/><staff>1</staff>") +
          note("G", 5, 4, "<staff>1</staff>") +
          "<backup><duration>8</duration></backup>" +
          note("C", 3, 8, "<staff>2</staff>"),
      ),
    );
    expect(piece.notes.map((n) => [n.midi, n.start, n.hand, n.chord])).toEqual([
      [72, 0, "right", true],
      [76, 0, "right", true],
      [79, 2, "right", false],
      [48, 0, "left", false],
    ]);
  });

  it("holds a tied note on instead of pressing it again", () => {
    const piece = parsePiece(
      score(note("C", 5, 8, '<tie type="start"/><staff>1</staff>'), note("C", 5, 4, '<tie type="stop"/><staff>1</staff>') + note("D", 5, 4, "<staff>1</staff>")),
    );
    expect(piece.notes[0].tieNext).toBe(1);
    expect(piece.notes[1].tiedFrom).toBe(true);
    expect(piece.notes[2].tiedFrom).toBe(false);
  });

  it("refuses what isn't MusicXML", () => {
    expect(() => parsePiece("<html><body>hi</body></html>")).toThrow(PieceError);
    expect(() => parsePiece("not xml at all <")).toThrow(PieceError);
  });
});

describe("playOrder", () => {
  const bar = (extra: Partial<PieceMeasure> = {}): PieceMeasure => ({
    label: "",
    start: 0,
    length: 4,
    beats: 4,
    time: "4/4",
    fifths: 0,
    mode: "major",
    repeatStart: false,
    repeatEnd: false,
    jump: false,
    clefs: { right: "G2", left: "F4" },
    ...extra,
  });

  it("takes 1st and 2nd endings on their own pass", () => {
    const measures = [bar({ repeatStart: true }), bar(), bar({ ending: [1], repeatEnd: true }), bar({ ending: [2] }), bar()];
    expect(playOrder(measures)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  it("repeats back to the start without a start sign", () => {
    expect(playOrder([bar(), bar({ repeatEnd: true }), bar()])).toEqual([0, 1, 0, 1, 2]);
  });

  it("falls back to written order for jumps", () => {
    expect(playOrder([bar(), bar({ repeatEnd: true, jump: true })])).toEqual([0, 1]);
  });
});

describe("scoreXml", () => {
  it("draws a phrase's bars with the signatures in force, and without repeats", async () => {
    const bytes = readFileSync("tests/fixtures/scarlatti-k208.mxl");
    const xml = await readScoreFile("k208.mxl", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const piece = parsePiece(xml);
    const repeatBar = piece.measures.findIndex((m) => m.repeatEnd);
    const excerpt = parsePiece(scoreXml(xml, { from: repeatBar - 1, to: repeatBar + 1 }));
    expect(excerpt.measures).toHaveLength(3);
    expect(excerpt.measures[0]).toMatchObject({ fifths: 3, time: "4/4", label: piece.measures[repeatBar - 1].label });
    expect(excerpt.measures.some((m) => m.repeatStart || m.repeatEnd)).toBe(false);
    // The same notes, in the same places in their bars.
    const notesOf = (p: typeof piece, from: number) =>
      p.notes.filter((n) => n.measure >= from && n.measure <= from + 2).map((n) => [n.measure - from, n.hand, n.offset, n.midi]);
    expect(notesOf(excerpt, 0)).toEqual(notesOf(piece, repeatBar - 1));
  });
});

describe("intro cards", () => {
  it("give K.208's cards examples and drills that can be played", async () => {
    const xml = await k208Xml();
    const piece = parsePiece(xml);
    const features = pieceFeatures(piece);
    const time = features.find((f) => f.id === "time")!;
    expect(time.title).toBe("Time: 4/4, written C");
    expect(time.detail).toContain("isn't a clef");
    expect(features.find((f) => f.id === "clefs")!.detail).toContain("treble (G) clef");
    for (const feature of features) {
      for (const score of [feature.example, feature.drill?.score]) {
        if (!score) continue;
        const music = score.kind === "xml" ? parsePiece(score.xml) : parsePiece(scoreXml(xml, score));
        expect(music.notes.length, feature.id).toBeGreaterThan(0);
      }
    }
    // The scale: A major up and down in the right hand, an octave lower in the left.
    const scale = parsePiece((features.find((f) => f.id === "key")!.drill!.score as { xml: string }).xml);
    const rightHand = scale.notes.filter((n) => n.hand === "right").map((n) => n.midi);
    expect(rightHand.slice(0, 8)).toEqual([69, 71, 73, 74, 76, 78, 80, 81]);
    expect(rightHand.slice(8)).toEqual([81, 80, 78, 76, 74, 73, 71, 69]);
    // Chords: the first bar with a left-hand chord, its chord notes picked out.
    const chords = features.find((f) => f.id === "chords-left")!;
    expect(chords.drill!.hand).toBe("left");
    const bar = chords.example as { kind: "bars"; from: number; highlight: number[] };
    expect(bar.highlight.every((i) => piece.notes[i].chord && piece.notes[i].measure === bar.from)).toBe(true);
  });
});
