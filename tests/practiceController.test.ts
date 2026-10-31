import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteStream } from "../src/input/noteStream";
import { BEATS } from "../src/music/rhythms";
import { midiOf, staffStep } from "../src/music/pitch";
import { levelById } from "../src/music/levels";
import {
  PHRASE_SCORE_DELAY_MS,
  PracticeController,
  RETRY_PITCH,
  SLOW_DOWN_AFTER_FAILURES,
} from "../src/practice/practiceController";
import { DEFAULT_SETTINGS, type Settings } from "../src/practice/settings";
import { seeded } from "./helpers";

function setup(settings: Settings = DEFAULT_SETTINGS) {
  const stream = new NoteStream();
  const notation = { show: vi.fn(), setOptions: vi.fn(), setState: vi.fn(), flashWrong: vi.fn() };
  const keyboard = { setPressed: vi.fn(), flash: vi.fn() };
  const sound = { play: vi.fn(), click: vi.fn() };
  const score = { show: vi.fn(), setIncludeRhythm: vi.fn() };
  const onPhraseComplete = vi.fn();
  const onHotChange = vi.fn();
  const controller = new PracticeController({
    stream,
    notation,
    keyboard,
    sound,
    settings,
    score,
    random: seeded(42),
    onPhraseComplete,
    onHotChange,
  });

  const expectedPitches = () => controller.exercise.bars.flat().map(midiOf);
  const press = (pitch: number, time = 0) => {
    stream.emit({ kind: "on", pitch, time, source: "screen" });
    stream.emit({ kind: "off", pitch, time, source: "screen" });
    // handleNoteOn is deferred so sound can start before VexFlow work.
    vi.advanceTimersByTime(0);
  };

  return { controller, notation, keyboard, sound, score, expectedPitches, press, stream, onPhraseComplete, onHotChange };
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
    // A clean pass then repaints every note green.
    const passCalls = pitches.map((_, i) => [i, "correct"]);
    expect(notation.setState.mock.calls).toEqual([...expectedStateCalls, ...passCalls]);
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
    // The note stays marked as an error once found.
    expect(notation.setState.mock.calls).toEqual([
      [0, "wrong"],
      [1, "current"],
    ]);

    press(second + 1);
    expect(notation.flashWrong).toHaveBeenLastCalledWith(1);
    expect(keyboard.flash).toHaveBeenLastCalledWith(second, "hint");
  });

  it("goes cold after a failed phrase, keeping its marks until going hot retries it clean", () => {
    const { controller, notation, keyboard, score, sound, expectedPitches, press } = setup();
    const firstExercise = controller.exercise;
    const pitches = expectedPitches();
    expect(controller.isHot).toBe(true);

    press(pitches[0] + 1);
    pitches.forEach(press);
    expect(score.show).toHaveBeenLastCalledWith(pitches.length - 1, pitches.length, undefined);
    expect(score.setIncludeRhythm).toHaveBeenCalledWith(false);
    expect(notation.setState).not.toHaveBeenCalledWith(0, "correct");
    expect(controller.isHot).toBe(false);

    // Free play: heard, never graded, and nothing moves on by itself.
    notation.setState.mockClear();
    notation.flashWrong.mockClear();
    keyboard.flash.mockClear();
    sound.play.mockClear();
    press(pitches[0] + 1);
    press(pitches[0]);
    vi.advanceTimersByTime(60_000);
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(notation.setState).not.toHaveBeenCalled();
    expect(notation.flashWrong).not.toHaveBeenCalled();
    expect(keyboard.flash).not.toHaveBeenCalled();
    expect(notation.show).toHaveBeenCalledTimes(1);

    controller.goHot();
    expect(controller.isHot).toBe(true);
    expect(controller.exercise).toBe(firstExercise);
    expect(notation.show).toHaveBeenCalledTimes(2);
    expect(notation.setState).toHaveBeenLastCalledWith(0, "current");
    expect(score.show).toHaveBeenLastCalledWith(0, pitches.length, undefined);
  });

  it("counts going cold mid-phrase as a failure, but not before the first note", () => {
    const { controller, onPhraseComplete, expectedPitches, press } = setup();
    controller.goCold();
    expect(onPhraseComplete).not.toHaveBeenCalled();

    controller.goHot();
    press(expectedPitches()[0]);
    controller.goCold();
    expect(onPhraseComplete).toHaveBeenCalledTimes(1);
    expect(onPhraseComplete.mock.calls[0][0]).toMatchObject({ passed: false, abandoned: true, next: "retry" });
    expect(controller.retry.failures).toBe(1);
  });

  it("moves on after one clean pass", () => {
    const { controller, expectedPitches, press } = setup();
    const firstExercise = controller.exercise;
    expectedPitches().forEach(press);

    vi.advanceTimersByTime(PHRASE_SCORE_DELAY_MS);
    expect(controller.exercise).not.toBe(firstExercise);
  });

  it("waits, cold, after a clean pass when told to, then starts the next phrase on going hot", () => {
    const { controller, expectedPitches, press, onHotChange } = setup();
    controller.pauseAfterPass = true;
    const firstExercise = controller.exercise;
    expectedPitches().forEach(press);

    vi.advanceTimersByTime(PHRASE_SCORE_DELAY_MS);
    expect(controller.exercise).toBe(firstExercise);
    expect(controller.isHot).toBe(false);
    expect(onHotChange).toHaveBeenLastCalledWith(false);
    controller.goHot();
    expect(controller.exercise).not.toBe(firstExercise);
  });

  it("toggles hot and cold from the bottom key of a MIDI keyboard without grading it", () => {
    const { controller, notation, sound, stream, onHotChange } = setup();
    const first = controller.exercise;
    notation.show.mockClear();
    const retryKey = () => {
      stream.emit({ kind: "on", pitch: RETRY_PITCH, time: 0, source: "midi" });
      stream.emit({ kind: "off", pitch: RETRY_PITCH, time: 0, source: "midi" });
      vi.advanceTimersByTime(0);
    };

    retryKey();
    expect(controller.isHot).toBe(false);
    expect(onHotChange).toHaveBeenLastCalledWith(false);
    retryKey();
    expect(controller.isHot).toBe(true);
    expect(controller.exercise).toBe(first);
    expect(notation.show).toHaveBeenCalledTimes(1);
    expect(notation.flashWrong).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("captures the next MIDI key for a new retry key without playing it", () => {
    const { controller, notation, sound, stream, expectedPitches, press } = setup();
    const midi = (pitch: number) => {
      stream.emit({ kind: "on", pitch, time: 0, source: "midi" });
      stream.emit({ kind: "off", pitch, time: 0, source: "midi" });
      vi.advanceTimersByTime(0);
    };
    const onKey = vi.fn();
    controller.captureMidiKey(onKey);

    // Screen keys play as usual while waiting.
    press(expectedPitches()[0]);
    expect(onKey).not.toHaveBeenCalled();
    sound.play.mockClear();
    notation.flashWrong.mockClear();

    midi(108);
    expect(onKey).toHaveBeenCalledExactlyOnceWith(108);
    expect(sound.play).not.toHaveBeenCalled();
    expect(notation.flashWrong).not.toHaveBeenCalled();

    controller.retryPitch = 108;
    midi(RETRY_PITCH);
    expect(controller.isHot).toBe(true);
    expect(sound.play).toHaveBeenCalledWith(RETRY_PITCH, undefined);
    midi(108);
    expect(controller.isHot).toBe(false);
  });

  it("stops waiting for a retry key when cancelled", () => {
    const { controller, sound, stream } = setup();
    const onKey = vi.fn();
    const cancel = controller.captureMidiKey(onKey);
    cancel();
    stream.emit({ kind: "on", pitch: 72, time: 0, source: "midi" });
    vi.advanceTimersByTime(0);
    expect(onKey).not.toHaveBeenCalled();
    expect(sound.play).toHaveBeenCalledWith(72, undefined);
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

  it("restarts the same phrase from the beginning by going cold and hot", () => {
    const { controller, notation, expectedPitches, press } = setup();
    const first = controller.exercise;
    press(expectedPitches()[0]);
    notation.show.mockClear();
    notation.setState.mockClear();

    controller.toggleHot();
    controller.toggleHot();

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

  it("loads rhythm mode cold so the metronome never starts unasked", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score, sound } = setup(settings);

    expect(controller.isHot).toBe(false);
    expect(notation.setState).toHaveBeenCalledWith(0, "current");
    expect(score.setIncludeRhythm).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(10_000);
    expect(sound.click).not.toHaveBeenCalled();
  });

  it("going hot rests a beat, then counts in a bar on the same phrase", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score, sound, onHotChange } = setup(settings);
    const first = controller.exercise;
    const total = first.bars.flat().length;
    notation.show.mockClear();
    score.show.mockClear();

    controller.goHot();
    expect(controller.isHot).toBe(true);
    expect(onHotChange).toHaveBeenLastCalledWith(true);
    expect(controller.exercise).toBe(first);
    expect(notation.show).toHaveBeenCalledWith(first, { showNames: false });
    expect(score.show).toHaveBeenCalledWith(0, total, 0);

    vi.advanceTimersByTime(999);
    expect(sound.click).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sound.click).toHaveBeenCalledWith(true);
  });

  it("stops the clock and ignores notes when going cold", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, sound, stream, onHotChange } = setup(settings);
    controller.goHot();
    controller.goCold();
    expect(controller.isHot).toBe(false);
    expect(onHotChange).toHaveBeenLastCalledWith(false);

    const pitch = midiOf(controller.exercise.bars.flat()[0]);
    stream.emit({ kind: "on", pitch, time: 5000, source: "screen" });
    vi.advanceTimersByTime(10_000);
    expect(notation.setState).not.toHaveBeenCalledWith(0, "correct");
    expect(sound.click).not.toHaveBeenCalled();
  });

  it("ignores notes during count-in, then scores on-time playing", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };
    const { controller, notation, score, press, expectedPitches } = setup(settings);

    controller.goHot();
    // Count-in starts after a one-beat rest.
    const armAt = performance.now() + 1000;
    const countIn = 4000;

    press(expectedPitches()[0], armAt + 1000);
    expect(notation.setState).not.toHaveBeenCalledWith(0, "correct");

    vi.advanceTimersByTime(1000 + countIn);

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
    expect(controller.isHot).toBe(true);
    expect(score.show).toHaveBeenCalledWith(0, expect.any(Number), 0);
  });
});

describe("PracticeController rhythm retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const settings: Settings = { ...DEFAULT_SETTINGS, mode: "rhythm", tempo: 60, bars: 1 };

  /**
   * Runs one attempt, going hot first if cold: plays every note on time, or lets the
   * phrase pass silently. Either way the count-in starts a beat from now.
   */
  function attempt(ctx: ReturnType<typeof setup>, tempo: number, clean: boolean): void {
    const beat = 60_000 / tempo;
    if (!ctx.controller.isHot) ctx.controller.goHot();
    const notes = ctx.controller.exercise.bars.flat();
    const start = performance.now() + beat;
    let onset = 4 * beat;
    for (const note of notes) {
      vi.advanceTimersByTime(start + onset - performance.now());
      if (clean) ctx.press(midiOf(note), start + onset);
      onset += BEATS[note.duration] * beat;
    }
    // Through the end of the phrase's last bar.
    vi.advanceTimersByTime(Math.max(0, start + Math.ceil(onset / (4 * beat)) * 4 * beat - performance.now()));
  }

  it("goes cold after a failure, with the metronome stopped", () => {
    const ctx = setup(settings);
    const first = ctx.controller.exercise;
    attempt(ctx, 60, false);
    expect(ctx.controller.isHot).toBe(false);
    ctx.notation.show.mockClear();
    ctx.sound.click.mockClear();

    vi.advanceTimersByTime(10_000);
    expect(ctx.notation.show).not.toHaveBeenCalled();
    expect(ctx.sound.click).not.toHaveBeenCalled();
    expect(ctx.controller.exercise).toBe(first);
  });

  it("offers a slow-down after repeated failures, then needs two clean passes at full tempo", () => {
    const ctx = setup(settings);
    const first = ctx.controller.exercise;
    ctx.controller.slowDown();
    expect(ctx.controller.retry.slowTempo).toBeUndefined();

    for (let i = 0; i < SLOW_DOWN_AFTER_FAILURES; i++) {
      expect(ctx.controller.retry.canSlowDown).toBe(false);
      attempt(ctx, 60, false);
    }
    expect(ctx.controller.retry.canSlowDown).toBe(true);

    ctx.controller.slowDown();
    expect(ctx.controller.isHot).toBe(false);
    expect(ctx.controller.retry.slowTempo).toBe(51);
    attempt(ctx, 51, true);
    expect(ctx.controller.retry.slowTempo).toBeUndefined();

    // A clean slow pass goes straight on, hot, to full tempo.
    expect(ctx.controller.isHot).toBe(true);
    attempt(ctx, 60, true);
    expect(ctx.controller.isHot).toBe(true);
    expect(ctx.controller.exercise).toBe(first);

    attempt(ctx, 60, true);
    expect(ctx.controller.exercise).not.toBe(first);
    expect(ctx.controller.isHot).toBe(true);
  });

  it("slowing down mid-attempt counts as bailing out", () => {
    const ctx = setup(settings);
    for (let i = 0; i < SLOW_DOWN_AFTER_FAILURES; i++) attempt(ctx, 60, false);
    ctx.controller.goHot();
    vi.advanceTimersByTime(1000 + 4000);
    ctx.press(midiOf(ctx.controller.exercise.bars.flat()[0]), performance.now());
    ctx.controller.slowDown();
    expect(ctx.controller.retry.failures).toBe(SLOW_DOWN_AFTER_FAILURES + 1);
    expect(ctx.onPhraseComplete).toHaveBeenLastCalledWith(expect.objectContaining({ abandoned: true }));
  });
});

describe("PracticeController phrase reports", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports a finished wait phrase with wrong presses and input sources", () => {
    const stream = new NoteStream();
    const onPhraseComplete = vi.fn();
    const controller = new PracticeController({
      stream,
      notation: { show: vi.fn(), setOptions: vi.fn(), setState: vi.fn(), flashWrong: vi.fn() },
      keyboard: { setPressed: vi.fn(), flash: vi.fn() },
      sound: { play: vi.fn() },
      settings: DEFAULT_SETTINGS,
      random: seeded(42),
      onPhraseComplete,
    });
    const pitches = controller.exercise.bars.flat().map(midiOf);
    const press = (pitch: number, source: "midi" | "screen") => {
      stream.emit({ kind: "on", pitch, time: 0, source });
      vi.advanceTimersByTime(0);
    };

    press(pitches[0] + 1, "midi");
    pitches.forEach((p, i) => press(p, i === 0 ? "midi" : "screen"));

    expect(onPhraseComplete).toHaveBeenCalledTimes(1);
    const result = onPhraseComplete.mock.calls[0][0];
    expect(result.mode).toBe("wait");
    expect(result.notes[0]).toEqual({ wrong: 1, hit: true });
    expect(result.notes.slice(1).every((n: { wrong: number }) => n.wrong === 0)).toBe(true);
    expect(result.sources.sort()).toEqual(["midi", "screen"]);
  });
});
