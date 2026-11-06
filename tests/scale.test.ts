import { describe, expect, it } from "vitest";
import { keyById } from "../src/music/keys";
import { ascendingScale } from "../src/music/scale";

describe("ascendingScale", () => {
  it("plays C major on the white keys, tonic to tonic", () => {
    expect(ascendingScale(keyById("C"), 60)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it("plays A minor as natural minor, with no raised seventh", () => {
    expect(ascendingScale(keyById("Am"), 60)).toEqual([69, 71, 72, 74, 76, 77, 79, 81]);
  });

  it("follows the key signature in F# major", () => {
    expect(ascendingScale(keyById("F#"), 60)).toEqual([66, 68, 70, 71, 73, 75, 77, 78]);
  });
});
