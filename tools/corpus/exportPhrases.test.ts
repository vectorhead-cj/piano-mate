import { describe, expect, it } from "vitest";
import { encodeNotes, readableTitle } from "./exportPhrases";
import { phraseFacts, type RawNote, type RawPhrase } from "./facts";

function note(measure: number, beat: number, ql: number, step: RawNote["step"], octave: number, alter = 0): RawNote {
  return { measure, beat, ql, dots: ql === 1.5 || ql === 3 ? 1 : 0, tuplet: null, tie: null, grace: false, chord: false, step, alter, octave };
}

function phrase(notes: RawNote[], time = "4/4"): RawPhrase {
  return {
    id: "t",
    collection: "bach",
    work: "w",
    title: null,
    voice: "Soprano",
    clef: "treble",
    index: 1,
    keyFifths: 1,
    analyzedKey: { step: "G", alter: 0, mode: "major" },
    time,
    times: [time],
    halved: false,
    cut: "fermata",
    notes,
  };
}

describe("encodeNotes", () => {
  it("writes steps from the tonic inside the narrowest window, with the pickup's length", () => {
    // G major: D4 pickup, then G A B C♯ (a sharp against the signature), then D.
    const p = phrase([note(0, 3, 1, "D", 4), note(1, 0, 1, "G", 4), note(1, 1, 1, "A", 4), note(1, 2, 1, "B", 4), note(1, 3, 1, "C", 5, 1), note(2, 0, 2, "D", 5)]);
    const encoded = encodeNotes(phraseFacts(p))!;
    expect(encoded.pickup).toBe(1);
    // Plagal: D4 is the fifth below the tonic.
    expect(encoded.notes).toBe("-3q|0q 1q 2q 3#q|4h");
  });

  it("doesn't count a minor key's raised 6th and 7th as chromatic", () => {
    // A minor: A G♯ A F♯ G♯ A, then a B♭ that is chromatic.
    const p = phrase([note(1, 0, 1, "A", 4), note(1, 1, 1, "G", 4, 1), note(1, 2, 1, "A", 4), note(1, 3, 1, "F", 4, 1), note(2, 0, 1, "G", 4, 1), note(2, 1, 1, "A", 4), note(2, 2, 2, "B", 4, -1)]);
    const facts = phraseFacts({ ...p, keyFifths: 0, analyzedKey: { step: "A", alter: 0, mode: "minor" } });
    expect(facts.chromatic).toBe(4);
    expect(encodeNotes(facts)!.chromatic).toBe(1);
  });

  it("rejects a middle bar that doesn't add up", () => {
    const p = phrase([note(1, 0, 1, "G", 4), note(1, 1, 1, "A", 4), note(2, 0, 4, "B", 4), note(3, 0, 4, "G", 4)]);
    expect(encodeNotes(phraseFacts(p))).toBeNull();
  });
});

describe("readableTitle", () => {
  it("puts all-capital titles in sentence case and leaves others alone", () => {
    expect(readableTitle("ICH FAHR DAHIN")).toBe("Ich fahr dahin");
    expect(readableTitle("Agnus Dei")).toBe("Agnus Dei");
  });
});
