import { describe, expect, it } from "vitest";
import { isBlackKey, midiOf, noteName, staffStep, naturalFromStaffStep, whiteKeyName } from "../src/music/pitch";

describe("midiOf", () => {
  it("maps middle C and neighbours", () => {
    expect(midiOf({ letter: "C", alter: 0, octave: 4 })).toBe(60);
    expect(midiOf({ letter: "A", alter: 0, octave: 4 })).toBe(69);
    expect(midiOf({ letter: "F", alter: 1, octave: 4 })).toBe(66);
    expect(midiOf({ letter: "G", alter: -1, octave: 4 })).toBe(66);
    expect(midiOf({ letter: "B", alter: 0, octave: 3 })).toBe(59);
  });
});

describe("staff steps", () => {
  it("round-trips through naturals", () => {
    const e4 = { letter: "E", alter: 0, octave: 4 } as const;
    expect(naturalFromStaffStep(staffStep(e4))).toEqual(e4);
    expect(naturalFromStaffStep(staffStep(e4) + 4)).toEqual({ letter: "B", alter: 0, octave: 4 });
    expect(naturalFromStaffStep(staffStep(e4) + 5)).toEqual({ letter: "C", alter: 0, octave: 5 });
  });
});

describe("noteName", () => {
  it("uses ♯/♭ in English", () => {
    expect(noteName({ letter: "F", alter: 1, octave: 4 }, "english")).toBe("F♯");
    expect(noteName({ letter: "B", alter: -1, octave: 4 }, "english")).toBe("B♭");
    expect(noteName({ letter: "B", alter: 0, octave: 4 }, "english")).toBe("B");
  });

  it("uses H and B in Swedish", () => {
    expect(noteName({ letter: "B", alter: 0, octave: 4 }, "swedish")).toBe("H");
    expect(noteName({ letter: "B", alter: -1, octave: 4 }, "swedish")).toBe("B");
    expect(noteName({ letter: "E", alter: -1, octave: 4 }, "swedish")).toBe("E♭");
  });
});

describe("keys", () => {
  it("knows black and white keys", () => {
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(70)).toBe(true);
    expect(whiteKeyName(71, "english")).toBe("B");
    expect(whiteKeyName(71, "swedish")).toBe("H");
    expect(() => whiteKeyName(61, "english")).toThrow();
  });
});
