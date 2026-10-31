import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhrasePlayer } from "../src/audio/phrasePlayer";
import type { Exercise } from "../src/music/types";

const C4 = { letter: "C", alter: 0, octave: 4 } as const;
const E4 = { letter: "E", alter: 0, octave: 4 } as const;

function setup() {
  const sound = { play: vi.fn(), click: vi.fn() };
  const player = new PhrasePlayer(sound, () => Date.now());
  const listener = { onNote: vi.fn(), onKey: vi.fn(), onEnd: vi.fn() };
  return { sound, player, listener };
}

describe("PhrasePlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts in a bar, plays each note on time and held, and clicks to the barline", () => {
    const { sound, player, listener } = setup();
    // At 60 bpm a beat is a second: count-in 0–4 s, C held 2 beats from 4 s, E tied through 2 more from 6 s.
    const exercise: Exercise = {
      clef: "treble",
      key: "C",
      time: "4/4",
      pickup: 0,
      bars: [[{ ...C4, duration: "h" }, { ...E4, duration: "q", tie: true }, { ...E4, duration: "q" }]],
    };
    player.play(exercise, 60, listener);
    vi.advanceTimersByTime(3999);
    expect(sound.play).not.toHaveBeenCalled();
    expect(sound.click).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1);
    expect(sound.play).toHaveBeenLastCalledWith(60, 0.8, 1.8);
    expect(listener.onNote).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(2000);
    expect(sound.play).toHaveBeenLastCalledWith(64, 0.8, 1.8);
    vi.advanceTimersByTime(1000);
    // The tied note is shown but not struck again.
    expect(listener.onNote).toHaveBeenLastCalledWith(2);
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(listener.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(sound.click).toHaveBeenCalledTimes(8);
    expect(listener.onKey.mock.calls).toEqual([[60, true], [60, false], [64, true], [64, false]]);
    expect(listener.onEnd).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(false);
  });

  it("counts in through the bar before a pickup", () => {
    const { sound, player } = setup();
    const exercise: Exercise = { clef: "treble", key: "C", time: "3/4", pickup: 1, bars: [[{ ...C4, duration: "q" }], [{ ...E4, duration: "h." }]] };
    player.play(exercise, 60);
    vi.advanceTimersByTime(4999);
    expect(sound.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("stops at once, letting go of keys and not reporting an end", () => {
    const { sound, player, listener } = setup();
    const exercise: Exercise = { clef: "treble", key: "C", time: "4/4", pickup: 0, bars: [[{ ...C4, duration: "w" }]] };
    player.play(exercise, 60, listener);
    vi.advanceTimersByTime(4500);
    player.stop();
    vi.advanceTimersByTime(10_000);
    expect(listener.onKey.mock.calls).toEqual([[60, true], [60, false]]);
    expect(listener.onEnd).not.toHaveBeenCalled();
    expect(sound.click).toHaveBeenCalledTimes(5);
  });
});
