import { describe, expect, it } from "vitest";
import { spellInKey } from "../src/music/accidentals";
import { inScale, keyById } from "../src/music/keys";

describe("spellInKey", () => {
  const spell = (midi: number, key: string) => {
    const { spelling, accidental } = spellInKey(midi, keyById(key));
    return `${spelling.letter}${spelling.alter === 1 ? "#" : spelling.alter === -1 ? "b" : ""}${spelling.octave} ${accidental ?? "-"}`;
  };

  it("uses the key signature's spelling without a sign", () => {
    expect(spell(60, "C")).toBe("C4 -");
    expect(spell(66, "G")).toBe("F#4 -");
    expect(spell(70, "F")).toBe("Bb4 -");
    expect(spell(70, "Dm")).toBe("Bb4 -");
  });

  it("cancels the key with a natural", () => {
    expect(spell(65, "G")).toBe("F4 n");
    expect(spell(71, "F")).toBe("B4 n");
  });

  it("spells other black keys from the signature's side", () => {
    expect(spell(61, "C")).toBe("C#4 #");
    expect(spell(68, "G")).toBe("G#4 #");
    expect(spell(66, "F")).toBe("Gb4 b");
  });

  it("keeps the written octave across B#/C and Cb/B", () => {
    expect(spell(60, "C#")).toBe("B#3 -");
    expect(spell(59, "Cb")).toBe("Cb4 -");
  });
});

describe("inScale", () => {
  it("takes a major key's seven notes and no others", () => {
    expect([60, 62, 64, 65, 67, 69, 71].every((midi) => inScale(midi, keyById("C")))).toBe(true);
    expect([61, 63, 66, 68, 70].some((midi) => inScale(midi, keyById("C")))).toBe(false);
    expect(inScale(66, keyById("G"))).toBe(true);
    expect(inScale(65, keyById("G"))).toBe(false);
  });

  it("lets a minor key borrow its raised sixth and seventh", () => {
    expect(inScale(68, keyById("Am"))).toBe(true);
    expect(inScale(66, keyById("Am"))).toBe(true);
    expect(inScale(61, keyById("Am"))).toBe(false);
  });
});
