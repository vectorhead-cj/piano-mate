import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteStream } from "../src/input/noteStream";
import { BEATS } from "../src/music/rhythms";
import { midiOf, staffStep } from "../src/music/pitch";
import { levelById } from "../src/music/levels";
import {
  PHRASE_SCORE_DELAY_MS,
  PracticeController,
} from "../src/practice/practiceController";
import { DEFAULT_SETTINGS, type Settings } from "../src/practice/settings";
import { seeded } from "./helpers";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const stream = new NoteStream();
  const notation = { show: vi.fn(), setOptions: vi.fn(), setState: vi.fn(), flashWrong: vi.fn() };
  const keyboard = { setPressed: vi.fn(), flash: vi.fn() };
  const sound = { play: vi.fn(), click: vi.fn() };
  const score = { show: vi.fn(), setIncludeRhythm: vi.fn() };
  const controller = new PracticeController({
    stream,
    notation,
    keyboard,
    sound,
    settings,
    score,
    random: seeded(42),
  });

  const expectedPitches = () => controller.exercise.bars.flat().map(midiOf);
  const press = (pitch: number, time = 0) => {
    stream.emit({ kind: "on", pitch, time, source: "screen" });
    stream.emit({ kind: "off", pitch, time, source: "screen" });
    // handleNoteOn is deferred so sound can start before VexFlow work.
    vi.advanceTimersByTime(0);
  };

  return { controller, notation, keyboard, sound, score, expectedPitches, press, stream };
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

  it("scores first-try notes and advances after the score delay", () => {
    const { controller, notation, score, expectedPitches, press } = setup();
    const firstExercise = controller.exercise;
    const pitches = expectedPitches();

    press(pitches[0] + 1);
    pitches.forEach(press);
    expect(score.show).toHaveBeenLastCalledWith(pitches.length - 1, pitches.length, undefined);
    expect(score.setIncludeRhythm).toHaveBeenCalledWith(false);

    notation.setState.mockClear();
    notation.flashWrong.mockClear();
    press(60);
    expect(notation.setState).not.toHaveBeenCalled();
    expect(notation.flashWrong).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PHRASE_SCORE_DELAY_MS - 1);
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

  it("restarts the same phrase from the beginning", () => {
    const { controller, notation, expectedPitches, press } = setup();
    const first = controller.exercise;
    press(expectedPitches()[0]);
    notation.show.mockClear();
    notation.setState.mockClear();

    controller.restartExercise();

    expect(controller.exercise).toBe(first);
    expect(notation.show).toHaveBeenCalledWith(first, { showNames: false });
    expect(notation.setState).toHaveBeenCalledWith(0, "current");
  });

  it("regenerates on bar/key/frequency/rhythm/range changes but only redraws for name changes", () => {
    const { controller, notation } = setup();

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
      {
        ...DEFAULT_SETTINGS,
        bars: 4,
        key: "G",
        accidentalFrequency: "common",
        rhythm: "eighths",
      },
      "rhythm",
    );
    expect(notation.show).toHaveBeenCalledTimes(5);

    controller.updateSettings(
      {
        ...DEFAULT_SETTINGS,
        bars: 4,
        key: "G",
        accidentalFrequency: "common",
        rhythm: "eighths",
        range: "octave",
      },
      "range",
    );
    expect(notation.show).toHaveBeenCalledTimes(6);
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
      rhythm: "eighths",
      range: "octave",
      namesOnNotes: true,
    };
    controller.updateSettings(named, "namesOnNotes");
    expect(notation.show).toHaveBeenCalledTimes(6);
    expect(notation.setOptions).toHaveBeenLastCalledWith({ showNames: true });

    controller.updateSettings({ ...named, mode: "rhythm" }, "mode");
    expect(notation.show).toHaveBeenCalledTimes(7);

    controller.updateSettings({ ...named, mode: "rhythm", tempo: 80 }, "tempo");
    expect(notation.show).toHaveBeenCalledTimes(8);

    controller.updateSettings({ ...named, clef: "bass", range: "bass-octave" }, "clef");
    expect(notation.show).toHaveBeenCalledTimes(9);
    expect(controller.exercise.clef).toBe("bass");
  });
});

describe("PracticeController (rhythm mode)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads rhythm mode stopped so mode switches do not eat the first note", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score } = setup(settings);

    expect(controller.isRhythmRunning).toBe(false);
    expect(notation.setState).toHaveBeenCalledWith(0, "current");
    expect(score.setIncludeRhythm).toHaveBeenCalledWith(true);
  });

  it("restarts the same phrase and starts the clock", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score } = setup(settings);
    const first = controller.exercise;
    const total = first.bars.flat().length;
    notation.show.mockClear();
    score.show.mockClear();

    controller.restartExercise();

    expect(controller.exercise).toBe(first);
    expect(controller.isRhythmRunning).toBe(true);
    expect(notation.show).toHaveBeenCalledWith(first, { showNames: false });
    expect(score.show).toHaveBeenCalledWith(0, total, 0);
  });

  it("stops and plays the rhythm clock", () => {
    const onRhythmPlaybackChange = vi.fn();
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const stream = new NoteStream();
    const notation = { show: vi.fn(), setOptions: vi.fn(), setState: vi.fn(), flashWrong: vi.fn() };
    const keyboard = { setPressed: vi.fn(), flash: vi.fn() };
    const controller = new PracticeController({
      stream,
      notation,
      keyboard,
      sound: { play: vi.fn(), click: vi.fn() },
      settings,
      score: { show: vi.fn(), setIncludeRhythm: vi.fn() },
      random: seeded(42),
      onRhythmPlaybackChange,
    });

    expect(controller.isRhythmRunning).toBe(false);

    controller.playRhythm();
    expect(controller.isRhythmRunning).toBe(true);
    expect(onRhythmPlaybackChange).toHaveBeenLastCalledWith(true);

    const first = controller.exercise;
    controller.stopRhythm();
    expect(controller.isRhythmRunning).toBe(false);
    expect(onRhythmPlaybackChange).toHaveBeenLastCalledWith(false);
    expect(notation.setState).toHaveBeenCalledWith(0, "current");

    // Notes are ignored while stopped.
    const pitch = midiOf(first.bars.flat()[0]);
    stream.emit({ kind: "on", pitch, time: 5000, source: "screen" });
    expect(notation.setState).not.toHaveBeenCalledWith(0, "correct");

    notation.show.mockClear();
    controller.playRhythm();
    expect(controller.isRhythmRunning).toBe(true);
    expect(controller.exercise).toBe(first);
    expect(notation.show).toHaveBeenCalledWith(first, { showNames: false });
  });

  it("ignores stop/play in wait mode", () => {
    const { controller } = setup();
    expect(controller.isRhythmRunning).toBe(false);
    controller.playRhythm();
    expect(controller.isRhythmRunning).toBe(false);
    controller.stopRhythm();
    expect(controller.isRhythmRunning).toBe(false);
  });

  it("ignores notes during count-in, then scores on-time playing", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score, press, expectedPitches } = setup(settings);

    controller.playRhythm();
    const armAt = performance.now();
    const countIn = 4000;

    press(expectedPitches()[0], armAt + 1000);
    expect(notation.setState).not.toHaveBeenCalledWith(0, "correct");

    vi.advanceTimersByTime(countIn);

    const notes = controller.exercise.bars.flat();
    let onset = countIn;
    for (const note of notes) {
      press(midiOf(note), armAt + onset);
      onset += BEATS[note.duration] * 1000;
    }

    expect(score.show).toHaveBeenLastCalledWith(notes.length, notes.length, notes.length);
    expect(score.setIncludeRhythm).toHaveBeenCalledWith(true);

    const first = controller.exercise;
    const phraseMs = notes.reduce((sum, note) => sum + BEATS[note.duration] * 1000, 0);
    // Next phrase begins with a 1-bar count-in when this phrase's duration ends.
    vi.advanceTimersByTime(phraseMs);
    expect(controller.exercise).not.toBe(first);
    expect(controller.isRhythmRunning).toBe(true);
    expect(score.show).toHaveBeenCalledWith(0, expect.any(Number), 0);
  });
});
