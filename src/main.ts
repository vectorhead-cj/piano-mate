import "./styles.css";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { MidiInput } from "./input/midiInput";
import { attachScreenInput } from "./input/screenInput";
import {
  COMPLETE_STREAK,
  STAR_STREAK,
  placedStage,
  tierMode,
  tierTempo,
  type Tier,
} from "./curriculum/curriculum";
import { customSource, stageMidiRange, stageSource } from "./curriculum/corpusSource";
import { openEventLog } from "./curriculum/eventLog";
import {
  countsForProgress,
  firstFault,
  isPerfect,
  newId,
  spellingText,
  type InputKind,
  type PhraseCompleted,
  type PracticeContext,
} from "./curriculum/events";
import { milestoneBetween } from "./curriculum/progress";
import { ProgressStore } from "./curriculum/progressStore";
import { spanLevel } from "./curriculum/spans";
import { loadCorpus } from "./music/corpus";
import { levelById } from "./music/levels";
import { midiOf } from "./music/pitch";
import type { Clef, Level, NoteSource } from "./music/types";
import { PracticeController, type PhraseResult } from "./practice/practiceController";
import { DEFAULT_SETTINGS, type PracticeMode, type Settings } from "./practice/settings";
import { KeyboardView, keyboardRangeFor } from "./render/keyboardView";
import { NotationView } from "./render/notationView";
import { bindMidiDebug, type MidiDebug } from "./ui/midiDebug";
import { bindPhraseDebug } from "./ui/phraseDebug";
import {
  PhraseResultBanner,
  renderHome,
  renderPracticeBar,
  renderTrack,
  type ResultTone,
} from "./ui/curriculumViews";
import { bindSettingsBar } from "./ui/settingsBar";
import { bindPrefsPopover, bindTheme } from "./ui/theme";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

/** Shows MIDI status on the top-bar button; clicking it asks for MIDI access. */
function bindMidi(
  button: HTMLButtonElement,
  stream: NoteStream,
  debug: MidiDebug,
  onDevices: (devices: string[] | null) => void,
): MidiInput {
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
    onDevices(status.state === "ready" ? status.devices : null);
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
  // The phrase corpus loads alongside; without it, practice falls back to generated phrases.
  const [, corpus] = await Promise.all([document.fonts.load("30px Bravura"), loadCorpus()]);

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
  let midiDevices: string[] | null = null;
  // MIDI reports its first status while it is created, before the views exist.
  let viewsReady = false;
  late.midi = bindMidi(element<HTMLButtonElement>("midi-toggle"), stream, midiDebug, (devices) => {
    midiDevices = devices;
    if (viewsReady) renderView();
  });
  element("midi-toggle").addEventListener("click", () => synth.unlock());
  // Unlock on the same gesture as the keypress so the first note isn't waiting on resume.
  keyboardElement.addEventListener("pointerdown", () => synth.unlock(), { capture: true });

  const app = document.querySelector<HTMLElement>(".app")!;
  const menu = element("menu");
  const practiceView = element("practice");
  const practiceBar = element("practice-bar");
  const customControls = element("custom-controls");
  const navBack = element<HTMLButtonElement>("nav-back");
  element("dev-notice").hidden = !import.meta.env.DEV;
  const banner = new PhraseResultBanner(element("phrase-result"));
  const store = new ProgressStore(openEventLog());
  const session = newId();

  type View = { name: "home" } | { name: "track"; clef: Clef; selected: string } | { name: "practice" };
  let view: View = { name: "home" };
  let context: PracticeContext = { kind: "custom" };
  /** What the settings bar shows; curriculum stages override most of it while they run. */
  let customSettings: Settings = DEFAULT_SETTINGS;
  let settings: Settings = DEFAULT_SETTINGS;
  let customStreak = 0;
  let keyboardSpan = levelMidiRange(levelById(DEFAULT_SETTINGS.range));
  let mode: PracticeMode = DEFAULT_SETTINGS.mode;

  function levelMidiRange(level: Level): { lowest: number; highest: number } {
    return { lowest: midiOf(level.lowest), highest: midiOf(level.highest) };
  }

  function updateKeyboardRange(): void {
    const { lowest, highest } = keyboardRangeFor(
      keyboardSpan.lowest,
      keyboardSpan.highest,
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
    onPhraseComplete: recordPhrase,
  });
  late.practice = practice;
  const lightMidiKeys = element<HTMLFormElement>("settings").elements.namedItem("lightMidiKeys") as HTMLInputElement;
  practice.lightMidiKeys = lightMidiKeys.checked;
  lightMidiKeys.addEventListener("change", () => {
    practice.lightMidiKeys = lightMidiKeys.checked;
  });
  const staffLetters = element<HTMLFormElement>("settings").elements.namedItem("staffLetters") as HTMLInputElement;
  notationView.setStaffLetters(staffLetters.checked);
  staffLetters.addEventListener("change", () => notationView.setStaffLetters(staffLetters.checked));
  syncTransport(practice.isRhythmRunning);

  function inputKind(sources: NoteSource[]): InputKind {
    if (sources.every((s) => s === "midi")) return "midi";
    return sources.includes("midi") ? "mixed" : "screen";
  }

  /** Turns a finished phrase into an event, records it, and tells the player how it went. */
  function recordPhrase(result: PhraseResult): void {
    // Nothing played (rhythm mode left running), or practice hidden behind the menu.
    if (result.sources.length === 0 || view.name !== "practice") return;
    const { exercise } = result;
    const stage = context.kind === "curriculum" ? placedStage(context.stageId)?.stage : undefined;
    const level = stage ? spanLevel(exercise.clef, exercise.key, stage.span) : levelById(settings.range);
    const notes = exercise.bars.flat();
    const event: PhraseCompleted = {
      type: "phrase-completed",
      v: 1,
      id: newId(),
      at: Date.now(),
      session,
      context,
      mode: result.mode,
      tempo: result.tempo,
      input: inputKind(result.sources),
      devices: midiDevices && midiDevices.length > 0 ? midiDevices : undefined,
      config: {
        clef: exercise.clef,
        key: exercise.key,
        lowest: spellingText(level.lowest),
        highest: spellingText(level.highest),
        accidentals: settings.accidentalFrequency,
        rhythm: settings.rhythm,
        bars: settings.bars,
        time: exercise.time,
      },
      phraseId: exercise.source?.id,
      barSizes: exercise.bars.map((bar) => bar.length),
      notes: notes.map((note, i) => ({
        pitch: spellingText(note),
        duration: note.duration,
        ...result.notes[i],
      })),
    };

    const before = store.progress;
    store.record(event);
    const perfect = isPerfect(event);
    const fault = firstFault(event);
    const faultText = fault
      ? fault.kind === "wrong"
        ? `Wrong note in bar ${fault.bar}`
        : `Missed a note in bar ${fault.bar}`
      : "";

    if (context.kind === "custom") {
      customStreak = perfect ? customStreak + 1 : 0;
      banner.show(perfect ? `Perfect · streak ${customStreak}` : `${faultText} · streak back to 0`, perfect ? "perfect" : "fault");
      renderStreak();
      return;
    }

    const { clef, stageId, tier } = context;
    let text: string;
    let tone: ResultTone;
    if (!countsForProgress(event)) {
      text = `${perfect ? "Perfect" : faultText} · screen keys don't count towards progress`;
      tone = "info";
    } else {
      const milestone = milestoneBetween(before, store.progress, clef, stageId);
      const streak = store.progress[clef].stages[stageId].tiers[tier].streak;
      if (milestone?.kind === "star") {
        const opened = milestone.openedStageId ? placedStage(milestone.openedStageId) : undefined;
        text = `${"★".repeat(milestone.stars)} earned · ${STAR_STREAK} in a row${opened ? ` · stage ${opened.number} is open` : ""}`;
        tone = "milestone";
      } else if (milestone?.kind === "complete") {
        text = `Stage complete · ${COMPLETE_STREAK} in a row`;
        tone = "milestone";
      } else if (perfect) {
        text = `Perfect · streak ${streak}`;
        tone = "perfect";
      } else {
        text = `${faultText} · streak back to 0`;
        tone = "fault";
      }
    }
    banner.show(text, tone, tone === "milestone" ? 4000 : 2400);
    renderView();
  }

  /** Streak in the score row: the curriculum goal for this tier, or a plain count in custom. */
  function renderStreak(): void {
    if (context.kind === "custom") {
      setScoreText("streak", customStreak);
      setScoreText("streak-goal", "");
      return;
    }
    const stageProgress = store.progress[context.clef].stages[context.stageId];
    const tierProgress = stageProgress.tiers[context.tier];
    const starEarned = tierProgress.best >= STAR_STREAK;
    const goal = !starEarned ? STAR_STREAK : context.tier !== "read" && !stageProgress.complete ? COMPLETE_STREAK : null;
    setScoreText("streak", tierProgress.streak);
    setScoreText("streak-goal", goal ? `/${goal}` : "");
  }

  function startStage(clef: Clef, stageId: string, tier: Tier): void {
    const placed = placedStage(stageId);
    if (!placed) return;
    const { stage } = placed;
    context = { kind: "curriculum", clef, stageId, tier };
    settings = {
      ...customSettings,
      mode: tierMode(tier),
      tempo: tierTempo(stage, tier) ?? customSettings.tempo,
      clef,
      key: stage.keys[0],
      accidentalFrequency: stage.accidentals,
      rhythm: stage.rhythm,
      bars: stage.bars,
    };
    mode = settings.mode;
    keyboardSpan = stageMidiRange(corpus, clef, stage);
    practice.exerciseSource = stageSource(corpus, clef, stage);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
    syncTransport(practice.isRhythmRunning);
  }

  function openCustom(): void {
    context = { kind: "custom" };
    customStreak = 0;
    settings = customSettings;
    mode = settings.mode;
    keyboardSpan = levelMidiRange(levelById(settings.range));
    practice.exerciseSource = customSource(corpus, () => settings);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
    syncTransport(practice.isRhythmRunning);
  }

  function showView(next: View): void {
    if (view.name === "practice" && next.name !== "practice") {
      practice.stopRhythm();
      banner.hide();
    }
    view = next;
    renderView();
    if (view.name === "practice") {
      // The keyboard and staff measure themselves; they were hidden until now.
      updateKeyboardRange();
      notationView.draw();
    }
  }

  function renderView(): void {
    const practising = view.name === "practice";
    menu.hidden = practising;
    practiceView.hidden = !practising;
    navBack.hidden = view.name === "home";
    customControls.hidden = !(practising && context.kind === "custom");
    practiceBar.hidden = !(practising && context.kind === "curriculum");
    app.dataset.view = view.name;

    if (view.name === "home") {
      renderHome(menu, { progress: store.progress, status: store.status, storage: store.storage }, {
        openTrack: (clef) => showView({ name: "track", clef, selected: store.progress[clef].currentStageId }),
        openCustom,
      });
    } else if (view.name === "track") {
      const { clef } = view;
      renderTrack(menu, clef, store.progress, view.selected, {
        select: (stageId) => showView({ name: "track", clef, selected: stageId }),
        start: (stageId, tier) => startStage(clef, stageId, tier),
      });
    } else if (context.kind === "curriculum") {
      const { clef, stageId, tier } = context;
      renderPracticeBar(
        practiceBar,
        { clef, stageId, tier, progress: store.progress[clef].stages[stageId], midiReady: (midiDevices?.length ?? 0) > 0 },
        (next) => startStage(clef, stageId, next),
      );
    }
    if (practising) renderStreak();
  }

  navBack.addEventListener("click", () => {
    if (view.name === "practice" && context.kind === "curriculum") {
      showView({ name: "track", clef: context.clef, selected: context.stageId });
    } else {
      showView({ name: "home" });
    }
  });
  store.subscribe(() => {
    if (view.name !== "practice") renderView();
  });
  viewsReady = true;
  renderView();

  const phraseDebug = bindPhraseDebug(
    element<HTMLFormElement>("settings").elements.namedItem("showPhraseXml") as HTMLInputElement,
    element("phrase-debug"),
    () => practice.exercise,
  );
  const phraseSource = element("phrase-source");
  onPhraseShown = () => {
    phraseDebug.refresh();
    phraseSource.textContent = practice.exercise.source?.label ?? "";
  };

  bindTheme(element<HTMLFormElement>("settings"), () => notationView.refreshTheme());
  bindPrefsPopover(element<HTMLButtonElement>("prefs-toggle"), element("prefs"));

  bindSettingsBar(element<HTMLFormElement>("settings"), DEFAULT_SETTINGS, (next, changed) => {
    customSettings = next;
    if (context.kind === "curriculum") {
      // Only display options reach a stage; its music settings are fixed.
      if (changed === "namesOnNotes") {
        settings = { ...settings, namesOnNotes: next.namesOnNotes };
        practice.updateSettings(settings, changed);
      }
      return;
    }
    settings = next;
    if (changed === "range" || changed === "clef") {
      keyboardSpan = levelMidiRange(levelById(next.range));
      updateKeyboardRange();
    }
    if (changed === "mode") mode = next.mode;
    if (changed !== "namesOnNotes") customStreak = 0;
    renderStreak();
    practice.updateSettings(next, changed);
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
