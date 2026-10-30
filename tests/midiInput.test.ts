import { describe, expect, it } from "vitest";
import { parseMidiMessage } from "../src/input/midiInput";

describe("parseMidiMessage", () => {
  it("reads a note-on with its velocity", () => {
    expect(parseMidiMessage([0x90, 60, 127], 5)).toEqual({
      kind: "on",
      pitch: 60,
      time: 5,
      velocity: 1,
      source: "midi",
    });
  });

  it("accepts notes on any channel", () => {
    expect(parseMidiMessage([0x9f, 64, 100], 0)?.kind).toBe("on");
    expect(parseMidiMessage([0x83, 64, 0], 0)?.kind).toBe("off");
  });

  it("treats note-on with velocity 0 as note-off", () => {
    expect(parseMidiMessage([0x90, 60, 0], 0)).toEqual({ kind: "off", pitch: 60, time: 0, source: "midi" });
  });

  it("ignores everything that isn't a note", () => {
    expect(parseMidiMessage([0xb0, 64, 127], 0)).toBeNull(); // sustain pedal
    expect(parseMidiMessage([0xe0, 0, 64], 0)).toBeNull(); // pitch bend
    expect(parseMidiMessage([0xf8], 0)).toBeNull(); // clock
  });
});
