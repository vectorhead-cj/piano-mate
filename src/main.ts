import "./styles.css";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { attachScreenInput } from "./input/screenInput";
import { levelById } from "./music/levels";
import { midiOf } from "./music/pitch";
import { PracticeController } from "./practice/practiceController";
import { DEFAULT_SETTINGS, type PracticeMode } from "./practice/settings";
import { KeyboardView, keyboardRangeFor } from "./render/keyboardView";
import { NotationView } from "./render/notationView";
import { bindSettingsBar } from "./ui/settingsBar";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

async function main(): Promise<void> {
  // VexFlow draws with the Bravura music font; drawing before it loads gives empty boxes.
  await document.fonts.load("30px Bravura");

  const notationElement = element("notation");
  const keyboardElement = element("keyboard");
  const transport = element<HTMLButtonElement>("transport");
  const scoreElement = element<HTMLElement>("phrase-score");

  const stream = new NoteStream();
  const synth = new Synth();
  const notation = new NotationView(notationElement);
  const keyboard = new KeyboardView(keyboardElement);
  attachScreenInput(keyboardElement, stream);

  let rangeId = DEFAULT_SETTINGS.range;
  let mode: PracticeMode = DEFAULT_SETTINGS.mode;

  function updateKeyboardRange(): void {
    const level = levelById(rangeId);
    const { lowest, highest } = keyboardRangeFor(
      midiOf(level.lowest),
      midiOf(level.highest),
      keyboardElement.clientWidth,
    );
    keyboard.setRange(lowest, highest);
  }
  updateKeyboardRange();

  function syncTransport(running: boolean): void {
    const rhythm = mode === "rhythm";
    transport.disabled = !rhythm;
    transport.textContent = running ? "Stop" : "Play";
    transport.setAttribute("aria-label", running ? "Stop rhythm" : "Play rhythm");
  }

  function setScoreText(key: string, value: string | number): void {
    const node = scoreElement.querySelector(`[data-score="${key}"]`);
    if (node) node.textContent = String(value);
  }

  const practice = new PracticeController({
    stream,
    notation,
    keyboard,
    sound: synth,
    settings: DEFAULT_SETTINGS,
    score: {
      setIncludeRhythm(include) {
        scoreElement.dataset.mode = include ? "rhythm" : "wait";
      },
      show(notesCorrect, total, rhythmOnTime) {
        setScoreText("notes", notesCorrect);
        setScoreText("notes-total", total);
        if (rhythmOnTime !== undefined) {
          setScoreText("rhythm", rhythmOnTime);
          setScoreText("rhythm-total", total);
        }
      },
    },
    onRhythmPlaybackChange: syncTransport,
  });
  syncTransport(practice.isRhythmRunning);

  bindSettingsBar(element<HTMLFormElement>("settings"), DEFAULT_SETTINGS, (settings, changed) => {
    if (changed === "range") {
      rangeId = settings.range;
      updateKeyboardRange();
    }
    if (changed === "mode") mode = settings.mode;
    practice.updateSettings(settings, changed);
    syncTransport(practice.isRhythmRunning);
  });

  transport.addEventListener("click", () => {
    synth.unlock();
    practice.toggleRhythmPlayback();
  });
  element("restart").addEventListener("click", () => {
    synth.unlock();
    practice.restartExercise();
  });
  element("next").addEventListener("click", () => {
    synth.unlock();
    practice.startNewExercise(true);
  });

  // Older iOS versions only unlock audio on touchend, not on pointerdown.
  document.addEventListener("touchend", () => synth.unlock(), { once: true });
  // Tab switches / iOS interruptions leave the context suspended; retry when visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") synth.unlock();
  });

  new ResizeObserver(() => {
    updateKeyboardRange();
    notation.draw();
  }).observe(document.body);
}

void main();
