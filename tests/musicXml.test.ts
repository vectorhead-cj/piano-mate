import { describe, expect, it } from "vitest";
import { exerciseToMusicXml } from "../src/music/musicXml";
import type { Exercise } from "../src/music/types";

const sample: Exercise = {
  clef: "treble",
  key: "G",
  time: "4/4",
  pickup: 0,
  bars: [
    [
      { letter: "G", alter: 0, octave: 4, duration: "q" },
      { letter: "A", alter: 0, octave: 4, duration: "q" },
      { letter: "B", alter: 0, octave: 4, duration: "h" },
    ],
    [
      { letter: "C", alter: 1, octave: 5, duration: "8" },
      { letter: "D", alter: 0, octave: 5, duration: "8" },
      { letter: "E", alter: 0, octave: 5, duration: "q" },
      { letter: "D", alter: 0, octave: 5, duration: "q" },
      { letter: "B", alter: 0, octave: 4, duration: "q" },
    ],
  ],
};

describe("exerciseToMusicXml", () => {
  it("emits MusicXML 3.1 partwise with key, meter, and notes", () => {
    const xml = exerciseToMusicXml(sample);

    expect(xml).toContain('score-partwise version="3.1"');
    expect(xml).toContain("<fifths>1</fifths>");
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
    expect(xml).toContain("<sign>G</sign>");
    expect(xml).toContain('<measure number="1">');
    expect(xml).toContain('<measure number="2">');
    expect(xml).toContain("<step>G</step>");
    expect(xml).toContain("<octave>4</octave>");
    expect(xml).toContain("<type>quarter</type>");
    expect(xml).toContain("<type>half</type>");
    expect(xml).toContain("<type>eighth</type>");
    expect(xml).toContain("<alter>1</alter>");
    expect(xml).toContain("<divisions>2</divisions>");
    // Attributes only on the first measure.
    expect(xml.match(/<attributes>/g)).toHaveLength(1);
  });

  it("uses duration values consistent with divisions", () => {
    const xml = exerciseToMusicXml({
      clef: "treble",
      key: "C",
      time: "4/4",
      pickup: 0,
      bars: [
        [
          { letter: "C", alter: 0, octave: 4, duration: "w" },
        ],
      ],
    });
    expect(xml).toContain("<duration>8</duration>");
    expect(xml).toContain("<type>whole</type>");
    expect(xml).not.toContain("<alter>");
  });

  it("writes a G clef for treble and an F clef for bass", () => {
    expect(exerciseToMusicXml(sample)).toMatch(/<sign>G<\/sign>\s*<line>2<\/line>/);
    const bass = exerciseToMusicXml({ ...sample, clef: "bass" });
    expect(bass).toMatch(/<sign>F<\/sign>\s*<line>4<\/line>/);
  });

  it("can emit note-name lyrics", () => {
    const xml = exerciseToMusicXml(
      {
        clef: "treble",
        key: "C",
        time: "4/4",
        pickup: 0,
        bars: [[{ letter: "C", alter: 1, octave: 4, duration: "q" }]],
      },
      { noteNames: true },
    );
    expect(xml).toContain("<lyric number=\"1\">");
    expect(xml).toContain("<text>C♯</text>");
  });

  it("emits printed accidentals when spelling differs from the key", () => {
    const xml = exerciseToMusicXml({
      clef: "treble",
      key: "C",
      time: "4/4",
      pickup: 0,
      bars: [
        [
          { letter: "C", alter: 1, octave: 4, duration: "q" },
          { letter: "C", alter: 1, octave: 4, duration: "q" },
          { letter: "C", alter: 0, octave: 4, duration: "h" },
        ],
      ],
    });
    expect(xml).toContain("<accidental>sharp</accidental>");
    expect(xml).toContain("<accidental>natural</accidental>");
    // Second C♯ in the bar inherits the accidental — not re-printed.
    expect(xml.match(/<accidental>sharp<\/accidental>/g)).toHaveLength(1);
  });

  it("writes dotted notes, the time signature and a pickup bar numbered 0", () => {
    const xml = exerciseToMusicXml({
      clef: "treble",
      key: "C",
      time: "3/4",
      pickup: 1,
      bars: [
        [{ letter: "G", alter: 0, octave: 4, duration: "q" }],
        [
          { letter: "C", alter: 0, octave: 5, duration: "q." },
          { letter: "B", alter: 0, octave: 4, duration: "8" },
          { letter: "A", alter: 0, octave: 4, duration: "q" },
        ],
        [{ letter: "G", alter: 0, octave: 4, duration: "h." }],
      ],
    });
    expect(xml).toContain("<beats>3</beats>");
    expect(xml).toContain('<measure number="0" implicit="yes">');
    expect(xml).toContain('<measure number="1">');
    expect(xml).toContain('<measure number="2">');
    expect(xml).toMatch(/<duration>3<\/duration>\s*<type>quarter<\/type>\s*<dot\/>/);
    expect(xml).toMatch(/<duration>6<\/duration>\s*<type>half<\/type>\s*<dot\/>/);
  });

  it("prints 2/2 as two half-note beats", () => {
    const xml = exerciseToMusicXml({ ...sample, time: "2/2" });
    expect(xml).toContain("<beats>2</beats>");
    expect(xml).toContain("<beat-type>2</beat-type>");
  });
});
