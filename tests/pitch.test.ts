import { describe, expect, it } from "vitest";
import { isBlackKey, midiOf, noteName, staffStep, naturalFromStaffStep, whiteKeyName } from "../src/music/pitch";
import { KEYS, keyAlter, majorTriadLetters, relativeMinorTonic } from "../src/music/keys";

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
  it("uses ♯/♭", () => {
    expect(noteName({ letter: "F", alter: 1, octave: 4 })).toBe("F♯");
    expect(noteName({ letter: "B", alter: -1, octave: 4 })).toBe("B♭");
    expect(noteName({ letter: "B", alter: 0, octave: 4 })).toBe("B");
  });
});

describe("keys", () => {
  it("knows black and white keys", () => {
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(70)).toBe(true);
    expect(whiteKeyName(71)).toBe("B");
    expect(() => whiteKeyName(61)).toThrow();
  });

  it("covers the western major / relative-minor pairs", () => {
    expect(KEYS.map((k) => k.id)).toEqual([
      "C",
      "G",
      "D",
      "A",
      "E",
      "B",
      "F#",
      "C#",
      "F",
      "Bb",
      "Eb",
      "Ab",
      "Db",
      "Gb",
      "Cb",
    ]);
    expect(keyAlter(KEYS[1], "F")).toBe(1);
    expect(keyAlter(KEYS[9], "B")).toBe(-1);
    expect(majorTriadLetters("G")).toEqual(["G", "B", "D"]);
    expect(relativeMinorTonic("G")).toBe("E");
  });
});
