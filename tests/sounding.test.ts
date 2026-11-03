// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePiece, readScoreFile } from "../src/piece/parseMusicXml";
import type { Piece } from "../src/piece/piece";
import { soundsOf, trillSteps, type Sound } from "../src/piece/sounding";
import { barRange, playSpan } from "../src/piece/targets";

async function k208(): Promise<Piece> {
  const bytes = readFileSync("tests/fixtures/scarlatti-k208.mxl");
  return parsePiece(await readScoreFile("scarlatti-k208.mxl", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}

/** The right hand of a bar as the synth plays it while the left is practised, at K.208's 60 bpm. */
async function rightHandOf(bar: number): Promise<Sound[]> {
  const piece = await k208();
  return soundsOf(piece, playSpan(piece, barRange(bar - 1, bar - 1), "left").others, 60);
}

const pitches = (sounds: Sound[]) => sounds.map((s) => s.pitch);

describe("soundsOf", () => {
  it("leans K.208's opening appoggiatura on the beat for its eighth, softening the E it falls to", async () => {
    const bar1 = await rightHandOf(1);
    expect(bar1.map((s) => [s.pitch, s.at, s.length])).toEqual([
      [69, 0, 1],
      [73, 1, 1],
      [78, 2, 0.5], // F♯5, the grace note
      [76, 2.5, 1], // E5, half a beat late
      [74, 3.5, 0.25],
      [73, 3.75, 0.25],
    ]);
    expect(bar1[2].velocity).toBeGreaterThan(bar1[3].velocity);
  });

  it("turns bar 2's grace notes into a falling line of eighths", async () => {
    // B4, F♯5, then E–D and C♯–B from the appoggiaturas, and A4.
    expect((await rightHandOf(2)).map((s) => [s.pitch, s.at, s.length])).toEqual([
      [71, 0, 0.5],
      [78, 0.5, 1],
      [76, 1.5, 0.5],
      [74, 2, 0.5],
      [73, 2.5, 0.5],
      [71, 3, 0.5],
      [69, 3.5, 0.5],
    ]);
  });

  it("trills bar 15's B from C♯ above, through to its written ending", async () => {
    const bar15 = await rightHandOf(15);
    const trill = bar15.filter((s) => s.at >= 2 && s.at < 3.5);
    expect(trill[0].pitch).toBe(73);
    expect(trill.at(-1)!.pitch).toBe(71);
    expect(new Set(pitches(trill))).toEqual(new Set([71, 73]));
    // Alternating every note, at around nine a second.
    trill.slice(1).forEach((s, i) => expect(s.pitch).not.toBe(trill[i].pitch));
    expect(trill.length).toBeGreaterThanOrEqual(10);
    expect(trill.reduce((sum, s) => sum + s.length, 0)).toBeCloseTo(1.5);
    // Then the C♯–D the score writes out.
    expect(bar15.filter((s) => s.at >= 3.5).map((s) => [s.pitch, s.at])).toEqual([
      [73, 3.5],
      [74, 3.75],
    ]);
  });

  it("flicks bar 11's upper mordent up to G♯ and back on the beat", async () => {
    const mordent = (await rightHandOf(11)).filter((s) => s.at >= 3 && s.at < 3.75);
    expect(pitches(mordent)).toEqual([66, 68, 66]);
    expect(mordent[0].at).toBe(3);
    expect(mordent[1].length).toBeCloseTo(0.075);
    expect(mordent.reduce((sum, s) => sum + s.length, 0)).toBeCloseTo(0.75);
  });

  it("plays K.208's 32nd and 64th tuplets at their written times", async () => {
    const bar25 = await rightHandOf(25);
    expect(bar25.slice(0, 6).map((s) => [s.pitch, +s.at.toFixed(3)])).toEqual([
      [69, 0],
      [71, 0.375],
      [69, 0.5],
      [68, 0.667],
      [69, 0.833],
      [71, 0.917],
    ]);
  });

  it("keeps the trill's speed in time, not beats, at a slower tempo", async () => {
    const piece = await k208();
    const span = playSpan(piece, barRange(14, 14), "left");
    const trillNotes = (tempo: number) => soundsOf(piece, span.others, tempo).filter((s) => s.at >= 2 && s.at < 3.5).length;
    expect(trillNotes(30)).toBeGreaterThan(trillNotes(60));
  });
});

describe("trillSteps", () => {
  it("starts on the note when the note above was just played", () => {
    const steps = trillSteps(71, 73, 1, 0.25, false);
    expect(steps.map((s) => s.pitch)).toEqual([71, 73, 71]);
    expect(steps.map((s) => s.length)).toEqual([0.25, 0.25, 0.5]);
  });

  it("always ends on the note", () => {
    for (const length of [0.3, 0.5, 0.75, 1, 1.5, 2]) {
      expect(trillSteps(71, 73, length, 0.11, true).at(-1)!.pitch).toBe(71);
      expect(trillSteps(71, 73, length, 0.11, false).at(-1)!.pitch).toBe(71);
    }
  });
});
