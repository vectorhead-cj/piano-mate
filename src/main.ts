import "./styles.css";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { MidiInput } from "./input/midiInput";
import { attachScreenInput } from "./input/screenInput";
import { levelById } from "./music/levels";
import { midiOf } from "./music/pitch";
import { PracticeController } from "./practice/practiceController";
import { DEFAULT_SETTINGS, type PracticeMode } from "./practice/settings";
import { KeyboardView, keyboardRangeFor } from "./render/keyboardView";
import { NotationView } from "./render/notationView";
import { bindMidiDebug, type MidiDebug } from "./ui/midiDebug";
import { bindPhraseDebug } from "./ui/phraseDebug";
import { bindSettingsBar } from "./ui/settingsBar";
import { bindPrefsPopover, bindTheme } from "./ui/theme";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

/** Shows MIDI status on the top-bar button; clicking it asks for MIDI access. */
function bindMidi(button: HTMLButtonElement, stream: NoteStream, debug: MidiDebug): MidiInput {
  const label = button.querySelector<HTMLElement>("[data-midi-label]")!;
  const show = (state: string, text: string, title = text) => {
    button.dataset.state = state;
    label.textContent = text;
    button.title = title;
  };
  const midi = new MidiInput(stream, (status) => {
    // Browsers without Web MIDI (Safari, iOS) just don't get the button.
    button.hidden = status.state === "unsupported";
    switch (status.state) {
      case "idle":
        show("idle", "Connect MIDI");
        break;
      case "requesting":
        show("waiting", "Connecting…");
        break;
      case "blocked":
        show("blocked", "MIDI blocked", `MIDI access was refused: ${status.reason.replace(/\.$/, "")}. Click to retry.`);
        break;
      case "ready":
        if (status.devices.length === 0) show("waiting", "No MIDI device", "MIDI is on; plug in or wake a device");
        else show("ready", status.devices.join(", "), `Listening to ${status.devices.join(", ")}`);
        break;
    }
    debug.onStatus(status);
  }, debug.onMessage);
  button.addEventListener("click", () => void midi.connect());
  // Skip the click when the browser already remembers permission from an earlier visit.
  void midi.isPermissionGranted().then((granted) => {
    if (granted) void midi.connect();
  });
  return midi;
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
  const notationView = new NotationView(notationElement);
  const keyboard = new KeyboardView(keyboardElement);
  let onPhraseShown: (() => void) | undefined;
  // Refresh the MusicXML dump whenever a phrase is drawn.
  const notation = {
    show(...args: Parameters<NotationView["show"]>) {
      notationView.show(...args);
      onPhraseShown?.();
    },
    setOptions(...args: Parameters<NotationView["setOptions"]>) {
      notationView.setOptions(...args);
    },
    setState(...args: Parameters<NotationView["setState"]>) {
      notationView.setState(...args);
    },
    flashWrong(...args: Parameters<NotationView["flashWrong"]>) {
      notationView.flashWrong(...args);
    },
  };
  attachScreenInput(keyboardElement, stream);
  // The panel reads from MIDI, the keyboard and practice, which are created around it.
  const late: { midi?: MidiInput; practice?: PracticeController } = {};
  const midiDebug = bindMidiDebug(
    element<HTMLFormElement>("settings").elements.namedItem("showMidiDebug") as HTMLInputElement,
    element("midi-debug"),
    {
      ports: () => late.midi?.ports() ?? [],
      keyboardRange: () => keyboard.visibleRange,
      expectedPitch: () => late.practice?.expectedPitch,
    },
  );
  late.midi = bindMidi(element<HTMLButtonElement>("midi-toggle"), stream, midiDebug);
  element("midi-toggle").addEventListener("click", () => synth.unlock());
  // Unlock on the same gesture as the keypress so the first note isn't waiting on resume.
  keyboardElement.addEventListener("pointerdown", () => synth.unlock(), { capture: true });

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
    transport.hidden = !rhythm;
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
  late.practice = practice;
  const lightMidiKeys = element<HTMLFormElement>("settings").elements.namedItem("lightMidiKeys") as HTMLInputElement;
  practice.lightMidiKeys = lightMidiKeys.checked;
  lightMidiKeys.addEventListener("change", () => {
    practice.lightMidiKeys = lightMidiKeys.checked;
  });
  syncTransport(practice.isRhythmRunning);

  const phraseDebug = bindPhraseDebug(
    element<HTMLFormElement>("settings").elements.namedItem("showPhraseXml") as HTMLInputElement,
    element("phrase-debug"),
    () => practice.exercise,
  );
  onPhraseShown = () => phraseDebug.refresh();

  bindTheme(element<HTMLFormElement>("settings"), () => notationView.refreshTheme());
  bindPrefsPopover(element<HTMLButtonElement>("prefs-toggle"), element("prefs"));

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
  // MIDI notes aren't user gestures, so audio for them relies on any earlier click or keypress.
  document.addEventListener("pointerdown", () => synth.unlock(), { once: true, capture: true });
  document.addEventListener("keydown", () => synth.unlock(), { once: true, capture: true });
  // Tab switches / iOS interruptions leave the context suspended; retry when visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") synth.unlock();
  });

  new ResizeObserver(() => {
    updateKeyboardRange();
    notationView.draw();
  }).observe(document.body);
}

void main();
