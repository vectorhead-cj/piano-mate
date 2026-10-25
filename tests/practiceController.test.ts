import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteStream } from "../src/input/noteStream";
import { midiOf, staffStep } from "../src/music/pitch";
import { levelById } from "../src/music/levels";
import {
  NEXT_EXERCISE_DELAY_MS,
  PracticeController,
} from "../src/practice/practiceController";
import { DEFAULT_SETTINGS, type Settings } from "../src/practice/settings";
import { seeded } from "./helpers";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const stream = new NoteStream();
  const notation = { show: vi.fn(), setOptions: vi.fn(), setState: vi.fn(), flashWrong: vi.fn() };
  const keyboard = { setPressed: vi.fn(), flash: vi.fn(), setLabels: vi.fn() };
  const sound = { play: vi.fn() };
  const controller = new PracticeController({
    stream,
    notation,
    keyboard,
    sound,
    settings,
    random: seeded(42),
  });

  const expectedPitches = () => controller.exercise.bars.flat().map(midiOf);
  const press = (pitch: number) => {
    stream.emit({ kind: "on", pitch, time: 0, source: "screen" });
    stream.emit({ kind: "off", pitch, time: 0, source: "screen" });
  };

  return { controller, notation, keyboard, sound, expectedPitches, press };
}

describe("PracticeController (wait mode)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a new exercise with the first note as current", () => {
    const { controller, notation } = setup();
    expect(notation.show).toHaveBeenCalledWith(controller.exercise, {
      showNames: false,
    });
    expect(notation.setState).toHaveBeenCalledWith(0, "current");
    expect(controller.exercise.bars).toHaveLength(DEFAULT_SETTINGS.bars);
    expect(controller.exercise.key).toBe("C");
  });

  it("walks through a full sequence of correct notes", () => {
    const { notation, keyboard, sound, expectedPitches, press } = setup();
    const pitches = expectedPitches();
    notation.setState.mockClear();

    pitches.forEach(press);

    const expectedStateCalls = pitches.flatMap((_, i) =>
      i < pitches.length - 1
        ? [
            [i, "correct"],
            [i + 1, "current"],
          ]
        : [[i, "correct"]],
    );
    expect(notation.setState.mock.calls).toEqual(expectedStateCalls);
    expect(keyboard.flash.mock.calls).toEqual(pitches.map((p) => [p, "correct"]));
    expect(sound.play).toHaveBeenCalledTimes(pitches.length);
    expect(notation.flashWrong).not.toHaveBeenCalled();
  });

  it("stays on the note after a wrong key and hints the right one", () => {
    const { notation, keyboard, expectedPitches, press } = setup();
    const [first, second] = expectedPitches();
    const wrong = first + 1;
    notation.setState.mockClear();

    press(wrong);
    expect(notation.flashWrong).toHaveBeenCalledWith(0);
    expect(keyboard.flash).toHaveBeenCalledWith(wrong, "wrong");
    expect(keyboard.flash).toHaveBeenCalledWith(first, "hint");
    expect(notation.setState).not.toHaveBeenCalled();

    press(first);
    expect(notation.setState.mock.calls).toEqual([
      [0, "correct"],
      [1, "current"],
    ]);

    press(second + 1);
    expect(notation.flashWrong).toHaveBeenLastCalledWith(1);
    expect(keyboard.flash).toHaveBeenLastCalledWith(second, "hint");
  });

  it("starts the next exercise after a short pause and ignores input meanwhile", () => {
    const { controller, notation, expectedPitches, press } = setup();
    const firstExercise = controller.exercise;
    expectedPitches().forEach(press);
    notation.setState.mockClear();
    notation.flashWrong.mockClear();

    press(60);
    expect(notation.setState).not.toHaveBeenCalled();
    expect(notation.flashWrong).not.toHaveBeenCalled();

    vi.advanceTimersByTime(NEXT_EXERCISE_DELAY_MS - 1);
    expect(controller.exercise).toBe(firstExercise);

    vi.advanceTimersByTime(1);
    expect(controller.exercise).not.toBe(firstExercise);
    expect(notation.show).toHaveBeenCalledTimes(2);
    expect(notation.setState).toHaveBeenLastCalledWith(0, "current");
  });

  it("tracks pressed keys from on/off events without grading releases", () => {
    const { keyboard, notation, press } = setup();
    press(61);
    expect(keyboard.setPressed.mock.calls).toEqual([
      [61, true],
      [61, false],
    ]);
    expect(notation.flashWrong).toHaveBeenCalledTimes(1);
  });

  it("regenerates on bar/key/frequency/range changes but only redraws for name changes", () => {
    const { controller, notation, keyboard } = setup();

    controller.updateSettings({ ...DEFAULT_SETTINGS, bars: 4 }, "bars");
    expect(controller.exercise.bars).toHaveLength(4);
    expect(notation.show).toHaveBeenCalledTimes(2);

    controller.updateSettings({ ...DEFAULT_SETTINGS, bars: 4, key: "G" }, "key");
    expect(controller.exercise.key).toBe("G");
    expect(notation.show).toHaveBeenCalledTimes(3);

    controller.updateSettings(
      { ...DEFAULT_SETTINGS, bars: 4, key: "G", accidentalFrequency: "common" },
      "accidentalFrequency",
    );
    expect(notation.show).toHaveBeenCalledTimes(4);

    controller.updateSettings(
      { ...DEFAULT_SETTINGS, bars: 4, key: "G", accidentalFrequency: "common", range: "octave" },
      "range",
    );
    expect(notation.show).toHaveBeenCalledTimes(5);
    const level = levelById("octave");
    const low = staffStep(level.lowest);
    const high = staffStep(level.highest);
    for (const note of controller.exercise.bars.flat()) {
      expect(staffStep(note)).toBeGreaterThanOrEqual(low);
      expect(staffStep(note)).toBeLessThanOrEqual(high);
    }

    const named: Settings = {
      ...DEFAULT_SETTINGS,
      bars: 4,
      key: "G",
      accidentalFrequency: "common",
      range: "octave",
      namesOnNotes: true,
      namesOnKeys: true,
    };
    controller.updateSettings(named, "namesOnNotes");
    expect(notation.show).toHaveBeenCalledTimes(5);
    expect(notation.setOptions).toHaveBeenLastCalledWith({ showNames: true });
    expect(keyboard.setLabels).toHaveBeenLastCalledWith(true);
  });
});
