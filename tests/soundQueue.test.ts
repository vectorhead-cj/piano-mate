import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundQueue } from "../src/audio/soundQueue";

describe("SoundQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const note = (at: number, pitch = 60) => ({ pitch, velocity: 0.5, holdSeconds: 0.1, at });

  it("hands each note to the synth a little ahead, with its exact time", () => {
    const sound = { play: vi.fn(), cancelPending: vi.fn() };
    const queue = new SoundQueue(sound, () => Date.now());
    const start = Date.now();
    queue.play([note(start + 1000, 62), note(start, 60)]);
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenLastCalledWith(60, 0.5, 0.1, start);
    vi.advanceTimersByTime(800);
    expect(sound.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(sound.play).toHaveBeenLastCalledWith(62, 0.5, 0.1, start + 1000);
  });

  it("calls off what hasn't started when stopped", () => {
    const sound = { play: vi.fn(), cancelPending: vi.fn() };
    const queue = new SoundQueue(sound, () => Date.now());
    queue.play([note(Date.now() + 1000)]);
    queue.stop();
    expect(sound.cancelPending).toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(sound.play).not.toHaveBeenCalled();
  });
});
