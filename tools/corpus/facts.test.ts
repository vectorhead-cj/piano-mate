import { describe, expect, it } from "vitest";
import { blockingNotes, degreeLabel, fitsWindow, melodicFailure, noteType, phraseFacts, RANGE_WINDOWS, type RawNote, type RawPhrase } from "./facts";

function note(measure: number, beat: number, ql: number, pitch: string, extra: Partial<RawNote> = {}): RawNote {
  const [, step, accidental, octave] = pitch.match(/^([A-G])([#b]?)(\d)$/)!;
  return {
    measure,
    beat,
    ql,
    dots: 0,
    tuplet: null,
    tie: null,
    grace: false,
    chord: false,
    step: step as RawNote["step"],
    alter: accidental === "#" ? 1 : accidental === "b" ? -1 : 0,
    octave: Number(octave),
    ...extra,
  };
}

function phrase(notes: RawNote[], overrides: Partial<RawPhrase> = {}): RawPhrase {
  return {
    id: "test",
    collection: "test",
    work: "w",
    title: null,
    voice: "soprano",
    clef: "treble",
    index: 1,
    keyFifths: 0,
    analyzedKey: { step: "C", alter: 0, mode: "major" },
    time: "4/4",
    times: ["4/4"],
    halved: false,
    cut: "fermata",
    notes,
    ...overrides,
  };
}

const window = (id: string) => RANGE_WINDOWS.find((w) => w.id === id)!;

describe("fitsWindow", () => {
  it("allows any octave shift", () => {
    expect(fitsWindow(7, 11, window("five"))).toBe(true);
    expect(fitsWindow(-3, 4, window("plagal"))).toBe(true);
    expect(fitsWindow(4, 11, window("plagal"))).toBe(true);
    expect(fitsWindow(-3, 4, window("authentic"))).toBe(false);
  });
});

describe("degreeLabel", () => {
  it("marks octaves below and above", () => {
    expect(degreeLabel(-3)).toBe("5,");
    expect(degreeLabel(0)).toBe("1");
    expect(degreeLabel(11)).toBe("5'");
  });
});

describe("phraseFacts", () => {
  it("places a C–G phrase of plain quarters in the five window with no blockers", () => {
    const facts = phraseFacts(
      phrase([note(1, 0, 1, "C4"), note(1, 1, 1, "E4"), note(1, 2, 1, "G4"), note(1, 3, 1, "D4"), note(2, 0, 4, "C4")]),
    );
    expect(facts.narrowest).toBe("five");
    expect(facts.chromatic).toBe(0);
    expect(facts.rhythm).toBe("basic");
    expect(facts.blockers).toEqual([]);
    expect(facts.bars).toBe(2);
  });

  it("recognises a plagal phrase, counts bars without the pickup and puts a dotted quarter at eighths", () => {
    const facts = phraseFacts(
      phrase([note(0, 3, 1, "G3"), note(1, 0, 1.5, "C4", { dots: 1 }), note(1, 1.5, 0.5, "D4"), note(1, 2, 2, "G4")]),
    );
    expect(facts.windows).toContain("plagal");
    expect(facts.windows).not.toContain("authentic");
    expect(facts.pickup).toBe(true);
    expect(facts.bars).toBe(1);
    expect(facts.blockers).toEqual([]);
    expect(facts.rhythm).toBe("eighths");
  });

  it("keeps a 3/4 phrase with a dotted half at basic, even ending mid-bar", () => {
    const facts = phraseFacts(
      phrase([note(1, 0, 1, "C4"), note(1, 1, 1, "D4"), note(1, 2, 1, "E4"), note(2, 0, 3, "D4"), note(3, 0, 2, "C4")], {
        time: "3/4",
        times: ["3/4"],
      }),
    );
    expect(facts.rhythm).toBe("basic");
    expect(facts.endsMidBar).toBe(true);
    expect(facts.blockers).toEqual([]);
  });

  it("blocks sixteenths and points at the notes that cause it", () => {
    const sixteenth = note(1, 1.75, 0.25, "D4");
    const p = phrase([note(1, 0, 1, "C4"), note(1, 1, 0.75, "C4", { dots: 1 }), sixteenth, note(1, 2, 2, "E4")]);
    expect(phraseFacts(p).blockers).toEqual(["note-value"]);
    expect(blockingNotes(p, "note-value")).toHaveLength(2);
    expect(blockingNotes(p, "note-value")).toContain(sixteenth);
  });

  it("rejects phrases with too few notes or too many repeats", () => {
    const seesaw = phraseFacts(phrase([note(1, 0, 1, "F4"), note(1, 1, 1, "G4"), note(1, 2, 1, "F4"), note(1, 3, 1, "G4"), note(2, 0, 4, "F4")]));
    expect(melodicFailure(seesaw, 4)).toBe("distinct");
    const drone = phraseFacts(
      phrase([note(1, 0, 1, "G4"), note(1, 1, 1, "G4"), note(1, 2, 1, "G4"), note(1, 3, 1, "G4"), note(2, 0, 1, "F4"), note(2, 1, 1, "E4"), note(2, 2, 2, "C4")]),
    );
    expect(drone.distinctNotes).toBe(4);
    expect(melodicFailure(drone, 4)).toBe("repeats");
    const scale = phraseFacts(phrase([note(1, 0, 1, "C4"), note(1, 1, 1, "D4"), note(1, 2, 1, "E4"), note(1, 3, 1, "F4"), note(2, 0, 4, "G4")]));
    // A five-note phrase can't have six different notes, so it only needs all five.
    expect(melodicFailure(scale, 6)).toBeNull();
  });

  it("derives note types from length, dots and tuplets", () => {
    expect(noteType(note(1, 0, 1.5, "C4", { dots: 1 }))).toBe("quarter");
    expect(noteType(note(1, 0, 1 / 3, "C4", { tuplet: "3:2" }))).toBe("eighth");
    expect(noteType(note(1, 0, 3, "C4", { dots: 1 }))).toBe("half");
  });

  it("blocks time signatures other than 4/4, 2/2 and 3/4", () => {
    const facts = phraseFacts(phrase([note(1, 0, 2, "C4"), note(1, 2, 2, "D4"), note(1, 4, 2, "E4")], { time: "3/2", times: ["3/2"] }));
    expect(facts.blockers).toEqual(["meter"]);
  });

  it("counts notes outside the key signature", () => {
    const facts = phraseFacts(
      phrase([note(1, 0, 1, "G4"), note(1, 1, 1, "F#4"), note(1, 2, 1, "G4"), note(1, 3, 1, "A4"), note(2, 0, 4, "G4")]),
    );
    expect(facts.chromatic).toBe(1);
  });

  it("flags a signature that doesn't match the analysed key", () => {
    const facts = phraseFacts(
      phrase([note(1, 0, 4, "G4")], { keyFifths: -1, analyzedKey: { step: "G", alter: 0, mode: "minor" } }),
    );
    expect(facts.blockers).toEqual(expect.arrayContaining(["minor", "modal-signature"]));
  });
});
