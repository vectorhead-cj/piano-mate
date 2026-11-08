import { describe, expect, it } from "vitest";
import { KeyboardSink, noteOffMessage, noteOnMessage } from "../src/audio/keyboardSink";
import { Synth } from "../src/audio/synth";

function fakePort() {
  const sent: { data: number[]; at?: number }[] = [];
  const port = { send: (data: number[], at?: number) => sent.push({ data, at }) } as unknown as MIDIOutput;
  return { port, sent };
}

describe("KeyboardSink", () => {
  it("encodes notes", () => {
    expect(noteOnMessage(60, 1)).toEqual([0x90, 60, 127]);
    expect(noteOnMessage(60, 0)).toEqual([0x90, 60, 1]);
    expect(noteOffMessage(60)).toEqual([0x80, 60, 0]);
  });

  it("sends a timed on and off to every port", () => {
    const { port, sent } = fakePort();
    const sink = new KeyboardSink(() => [port]);
    const at = performance.now() + 500;
    sink.play(64, 0.5, 1, at);
    expect(sent).toEqual([
      { data: [0x90, 64, 64], at },
      { data: [0x80, 64, 0], at: at + 1000 },
    ]);
  });

  it("is unavailable and silent without outputs", () => {
    const sink = new KeyboardSink(() => []);
    expect(sink.available).toBe(false);
    sink.play(60, 1, undefined, undefined);
  });

  it("keyboard-only output skips the speakers when a keyboard is connected", () => {
    const { port, sent } = fakePort();
    const synth = new Synth();
    synth.keyboard = new KeyboardSink(() => [port]);
    synth.output = "keyboard";
    synth.play(60); // would throw on AudioContext in this environment if it fell through
    expect(sent.length).toBe(2);
  });
});

describe("KeyboardSink volume", () => {
  it("scales velocity and clamps at 127", () => {
    const { port, sent } = fakePort();
    const sink = new KeyboardSink(() => [port]);
    sink.volume = 0.5;
    sink.play(60, 0.8, 1, undefined);
    sink.volume = 1.5;
    sink.play(62, 0.8, 1, undefined);
    sink.play(64, 1, 1, undefined);
    const velocities = sent.filter((m) => m.data[0] === 0x90).map((m) => m.data[2]);
    expect(velocities).toEqual([51, 127, 127]);
  });
});
