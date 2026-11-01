import "./styles.css";
import { PhrasePlayer } from "./audio/phrasePlayer";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { MidiInput } from "./input/midiInput";
import { attachScreenInput } from "./input/screenInput";
import {
  ADVANCE_TEXT,
  MASTERY_ROUNDS,
  MISS_WINDOW,
  STAR_STREAK,
  placedStage,
  tierMode,
  tierTempo,
  type Tier,
} from "./curriculum/curriculum";
import { customSource, stageMidiRange, stageSource } from "./curriculum/corpusSource";
import { currentUser, signOut } from "./account";
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
import { INTRO_TEMPO, introMidiRange, introSteps, type IntroStep } from "./curriculum/intros";
import { milestoneBetween, recentHits, type Milestone, type TierProgress } from "./curriculum/progress";
import { ProgressStore } from "./curriculum/progressStore";
import { spanLevel } from "./curriculum/spans";
import { loadCorpus } from "./music/corpus";
import { levelById } from "./music/levels";
import { midiNoteName, midiOf } from "./music/pitch";
import type { Clef, Level, NoteSource } from "./music/types";
import { PracticeController, RETRY_PITCH, type PhraseResult } from "./practice/practiceController";
import { DEFAULT_SETTINGS, type Settings } from "./practice/settings";
import type { Mark } from "./practice/waitSession";
import { KeyboardView, keyboardRangeFor } from "./render/keyboardView";
import { NotationView } from "./render/notationView";
import { bindAccountDialog } from "./ui/accountDialog";
import { bindMidiDebug, type MidiDebug } from "./ui/midiDebug";
import { bindPhraseDebug } from "./ui/phraseDebug";
import { bindRetryKey } from "./ui/retryKey";
import { StreakDots, renderDots } from "./ui/scoreDots";
import {
  MASTERY_SYMBOL,
  MILESTONE_KEYS,
  PhraseResultBanner,
  masteryPips,
  milestoneChoices,
  nextStepAfter,
  renderHome,
  renderIntro,
  renderMilestone,
  renderPracticeBar,
  renderTrack,
  type MilestoneChoice,
  type ResultTone,
} from "./ui/curriculumViews";
import { bindSettingsBar } from "./ui/settingsBar";
import { bindKeyboardHeight } from "./ui/keyboardHeight";
import { bindPrefsPopover, bindTheme } from "./ui/theme";

/** Time to see a clean intro example turn green before the next one comes up. */
const INTRO_NEXT_DELAY_MS = 1500;

const UNLOCK_ALL_KEY = "piano-mate.unlockAll";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

/** Shows MIDI status on the top-bar button; clicking it asks for MIDI access, or rescans once granted. */
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
        if (status.devices.length === 0) show("waiting", "No MIDI device", "MIDI is on; plug in or wake a device. Click to rescan.");
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
  const hotToggle = element<HTMLButtonElement>("hot-toggle");
  const notationPanel = element("notation-panel");
  const hotState = element("hot-state");
  const scoreElement = element<HTMLElement>("phrase-score");
  const slowDown = element<HTMLButtonElement>("slow-down");
  const nextPhrase = element<HTMLButtonElement>("next");

  const stream = new NoteStream();
  const synth = new Synth();
  const player = new PhrasePlayer(synth);
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
    element<HTMLDialogElement>("midi-debug"),
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
  const introPanel = element("intro-panel");
  const milestonePanel = element("milestone");
  element("dev-notice").hidden = !import.meta.env.DEV;
  const banner = new PhraseResultBanner(element("phrase-result"));
  const store = new ProgressStore(openEventLog());
  const accountDialog = bindAccountDialog(element<HTMLDialogElement>("account-dialog"));
  let account: string | null = null;
  void currentUser()
    .then((user) => {
      account = user ? (user.email ?? "signed in") : null;
      if (viewsReady && view.name === "home") renderView();
    })
    .catch((error) => console.warn("Could not read the signed-in account", error));
  const session = newId();

  type View = { name: "home" } | { name: "track"; clef: Clef; selected: string } | { name: "practice" };
  let view: View = { name: "home" };
  let context: PracticeContext = { kind: "custom" };
  /** What the settings bar shows; curriculum stages override most of it while they run. */
  let customSettings: Settings = DEFAULT_SETTINGS;
  let settings: Settings = DEFAULT_SETTINGS;
  /** A star or completed stage just earned: its card stands in for the staff until a choice is made. */
  let milestone: Milestone | null = null;
  const streakDots = new StreakDots();
  /** A stage's intro, while it runs; its phrases are echoed, not recorded. */
  let intro: { clef: Clef; stageId: string; steps: IntroStep[]; index: number; replay: boolean } | null = null;
  let keyboardSpan = levelMidiRange(levelById(DEFAULT_SETTINGS.range));

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

  /** Hot: attempts are graded. Cold: free play, waiting for the player to start. */
  function syncHot(hot: boolean): void {
    hotToggle.textContent = hot ? "Stop" : "Start";
    hotToggle.setAttribute("aria-label", hot ? "Stop and play freely" : "Start a graded attempt");
    notationPanel.dataset.hot = String(hot);
    const midi = midiDevices !== null && midiDevices.length > 0;
    const key = midiNoteName(late.practice?.retryPitch ?? RETRY_PITCH);
    hotState.textContent = hot ? "● Live" : `Free play · ${midi ? `${key} or Space` : "Space"} to start`;
  }

  function setScoreText(key: string, value: string | number): void {
    const node = scoreElement.querySelector(`[data-score="${key}"]`);
    if (node) node.textContent = String(value);
  }

  function dotsOf(key: string): HTMLElement {
    return scoreElement.querySelector<HTMLElement>(`[data-dots="${key}"]`)!;
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
      show({ notes, rhythm }) {
        renderDots(dotsOf("notes"), notes, "Notes");
        if (rhythm) renderDots(dotsOf("rhythm"), rhythm, "Rhythm");
      },
    },
    onHotChange(hot) {
      // Going hot from the MIDI start key interrupts a playback; it also means staying put.
      if (hot) {
        player.stop();
        closeMilestone();
      }
      syncHot(hot);
    },
    onPhraseComplete: recordPhrase,
    onRetryChange(state) {
      slowDown.hidden = !state.canSlowDown;
      slowDown.title = state.slowTempo ? `Practising at ${state.slowTempo} bpm; slow down further` : "Retry this phrase slower";
    },
  });
  late.practice = practice;
  const lightMidiKeys = element<HTMLFormElement>("settings").elements.namedItem("lightMidiKeys") as HTMLInputElement;
  practice.lightMidiKeys = lightMidiKeys.checked;
  lightMidiKeys.addEventListener("change", () => {
    practice.lightMidiKeys = lightMidiKeys.checked;
  });
  const soundMidiKeys = element<HTMLFormElement>("settings").elements.namedItem("soundMidiKeys") as HTMLInputElement;
  practice.soundMidiKeys = soundMidiKeys.checked;
  soundMidiKeys.addEventListener("change", () => {
    practice.soundMidiKeys = soundMidiKeys.checked;
  });
  const staffLetters = element<HTMLFormElement>("settings").elements.namedItem("staffLetters") as HTMLInputElement;
  notationView.setStaffLetters(staffLetters.checked);
  staffLetters.addEventListener("change", () => notationView.setStaffLetters(staffLetters.checked));
  bindRetryKey(element<HTMLButtonElement>("retry-key"), practice, () => syncHot(practice.isHot));
  const unlockAllBox = element<HTMLFormElement>("settings").elements.namedItem("unlockAll") as HTMLInputElement;
  try {
    unlockAllBox.checked = localStorage.getItem(UNLOCK_ALL_KEY) === "true";
  } catch {
    // Storage can be unavailable; the box starts off.
  }
  store.setUnlockAll(unlockAllBox.checked);
  unlockAllBox.addEventListener("change", () => {
    try {
      localStorage.setItem(UNLOCK_ALL_KEY, String(unlockAllBox.checked));
    } catch {
      // It still applies for this page.
    }
    store.setUnlockAll(unlockAllBox.checked);
    if (view.name === "practice") renderView();
  });

  function inputKind(sources: NoteSource[]): InputKind {
    if (sources.every((s) => s === "midi")) return "midi";
    return sources.includes("midi") ? "mixed" : "screen";
  }

  /** Turns a finished phrase into an event, records it, and tells the player how it went. */
  function recordPhrase(result: PhraseResult): void {
    // Nothing played (rhythm mode left running), or practice hidden behind the menu.
    if (result.sources.length === 0 || view.name !== "practice") return;
    if (intro) {
      introPhrase(result);
      return;
    }
    // Slowed-down attempts are practice towards the real tempo, not progress.
    if (result.slowed) {
      banner.show(
        result.passed
          ? `Clean at ${result.tempo} bpm · now at full tempo`
          : `${faultOf(result)} at ${result.tempo} bpm`,
        "info",
      );
      return;
    }
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
    const faultText = faultOf(result);
    const again = perfect && result.passesNeeded > 0 ? " · once more" : "";

    if (context.kind === "custom") {
      streakDots.push(perfect);
      banner.show(`${perfect ? "Perfect" : faultText} · ${hitsText()}${again}`, perfect ? "perfect" : "fault");
      renderStreak();
      return;
    }

    const { clef, stageId } = context;
    let text: string;
    let tone: ResultTone;
    if (!countsForProgress(event)) {
      text = `${perfect ? "Perfect" : faultText} · screen keys don't count towards progress${again}`;
      tone = "info";
    } else {
      streakDots.push(perfect);
      const earned = milestoneBetween(before, store.progress, clef, stageId);
      if (earned) {
        // The card says it all; the next phrase waits until a choice is made.
        milestone = earned;
        practice.pauseAfterPass = true;
        banner.hide();
        renderView();
        return;
      }
      text = `${perfect ? "Perfect" : faultText} · ${roundText(before[clef].stages[stageId].tiers.fluent, perfect) ?? hitsText()}${again}`;
      tone = perfect ? "perfect" : "fault";
    }
    banner.show(text, tone);
    renderView();
  }

  /** Acts on the milestone card: stay on this tier, or move on to the next tier, stage or intro. */
  function chooseMilestone(choice: MilestoneChoice): void {
    if (!milestone || context.kind !== "curriculum") return;
    const { clef, stageId } = context;
    const earned = milestone;
    closeMilestone();
    if (choice === "fluent") {
      startStage(clef, stageId, "fluent");
    } else if (choice === "advance" && earned.kind === "star" && earned.stars === 1) {
      startStage(clef, stageId, "play");
    } else if (choice === "advance") {
      const next = nextStepAfter(store.progress, clef, stageId);
      if (next.kind === "stage") startStage(clef, next.stageId, next.tier);
      else if (next.kind === "intro") startIntro(clef, next.stageId);
      else showView({ name: "track", clef, selected: stageId });
    } else {
      renderView();
      // Wait mode carries straight on; rhythm waits for Start so the metronome never starts unasked.
      if (settings.mode === "wait") practice.goHot();
    }
  }

  function closeMilestone(): void {
    if (!milestone) return;
    milestone = null;
    practice.pauseAfterPass = intro !== null;
    renderView();
  }

  /** The Fluent tier while a mastery round is under way: ★★★ earned, not yet mastered. */
  function masteryUnderWay(): TierProgress | null {
    if (context.kind !== "curriculum" || context.tier !== "fluent") return null;
    const stage = store.progress[context.clef].stages[context.stageId];
    return stage.stars === 3 && !stage.mastered ? stage.tiers.fluent : null;
  }

  /** How the mastery round went with this phrase, when one is under way; `was` is before it. */
  function roundText(was: TierProgress, perfect: boolean): string | null {
    const now = masteryUnderWay();
    if (!now || was.best < STAR_STREAK) return null;
    if (now.round.length > 0) return `round ${recentHits(now.round)}/${MISS_WINDOW}`;
    const hits = recentHits([...was.round, perfect]);
    return now.rounds > was.rounds
      ? `round passed ${hits}/${MISS_WINDOW} · ${now.rounds} of ${MASTERY_ROUNDS} to master`
      : `round ${hits}/${MISS_WINDOW} · mastery starts over`;
  }

  /** Clean phrases out of the last few, as the streak dots show them. */
  function hitsText(): string {
    return `${streakDots.hits()}/${MISS_WINDOW}`;
  }

  /** Where a failed attempt first went wrong, for the result banner. */
  function faultOf(result: PhraseResult): string {
    if (result.abandoned) return "Stopped mid-phrase";
    const fault = firstFault({ notes: result.notes, barSizes: result.exercise.bars.map((bar) => bar.length) });
    if (!fault) return "";
    return fault.kind === "wrong" ? `Wrong note in bar ${fault.bar}` : `Missed a note in bar ${fault.bar}`;
  }

  /**
   * The score row's streak: clean phrases out of the last few and what they're working
   * towards, or, while mastering, the round under way and the rounds passed.
   */
  function renderStreak(): void {
    const pips = scoreElement.querySelector<HTMLElement>("[data-mastery-pips]")!;
    const mastering = masteryUnderWay();
    let caption = "";
    if (mastering) {
      const marks = Array.from({ length: MISS_WINDOW }, (_, i): Mark =>
        i >= mastering.round.length ? "pending" : mastering.round[i] ? "correct" : "wrong",
      );
      renderDots(dotsOf("streak"), marks, "Mastery round");
      setScoreText("streak-label", `Round ${mastering.rounds + 1}`);
      setScoreText("streak", recentHits(mastering.round));
      pips.replaceChildren(masteryPips(mastering.rounds));
      caption = `${mastering.rounds} of ${MASTERY_ROUNDS} to master`;
    } else {
      renderDots(dotsOf("streak"), streakDots.marks(), "Last phrases");
      setScoreText("streak-label", "Streak");
      setScoreText("streak", streakDots.hits());
      pips.replaceChildren();
      if (context.kind === "curriculum") {
        const stageProgress = store.progress[context.clef].stages[context.stageId];
        if (stageProgress.tiers[context.tier].best < STAR_STREAK) caption = ADVANCE_TEXT;
        else if (stageProgress.mastered) caption = `${MASTERY_SYMBOL} Mastered`;
      }
    }
    setScoreText("streak-goal", `/${MISS_WINDOW}`);
    setScoreText("streak-caption", caption);
    scoreElement.querySelector<HTMLElement>("[data-streak-caption]")!.hidden = caption === "";
  }

  /** Moves through an intro: each example passed clean leads to the next, the last to the stage. */
  function introPhrase(result: PhraseResult): void {
    const run = intro!;
    if (!result.passed) {
      banner.show(`${faultOf(result)} · listen again, or press Start to retry`, "fault");
      return;
    }
    if (result.next !== "new") {
      banner.show(result.slowed ? `Clean at ${result.tempo} bpm · now at full tempo` : "Clean · once more", "info");
      return;
    }
    const last = run.index === run.steps.length - 1;
    banner.show(last ? "Clean · on to the stage" : `Clean · next: ${run.steps[run.index + 1].title}`, "perfect");
    if (!last) {
      // The next explanation shows at once; Start plays its example even before it's drawn.
      run.index++;
      renderView();
    }
    setTimeout(() => {
      if (intro !== run) return;
      if (last) finishIntro(false);
      else if (!practice.isHot) practice.startNewExercise();
    }, INTRO_NEXT_DELAY_MS);
  }

  /** Shows a stage's intro to its new notation; the first time through, the stage follows. */
  function startIntro(clef: Clef, stageId: string): void {
    const placed = placedStage(stageId);
    if (!placed) return;
    const { stage } = placed;
    const steps = introSteps(corpus, clef, stage);
    if (steps.length === 0) return;
    player.stop();
    milestone = null;
    intro = { clef, stageId, steps, index: 0, replay: store.progress[clef].stages[stageId].introDone };
    context = { kind: "curriculum", clef, stageId, tier: "read" };
    settings = {
      ...customSettings,
      mode: "rhythm",
      tempo: INTRO_TEMPO,
      clef,
      key: stage.keys[0],
      accidentalFrequency: stage.accidentals,
      rhythm: stage.rhythm,
      bars: stage.bars,
    };
    keyboardSpan = introMidiRange(steps, stageMidiRange(corpus, clef, stage));
    practice.exerciseSource = () => (intro ? intro.steps[intro.index].exercise : null);
    practice.pauseAfterPass = true;
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
  }

  /** Records the intro as done, which opens its stage; a replay goes back to the track. */
  function finishIntro(skipped: boolean): void {
    if (!intro) return;
    const { clef, stageId, replay } = intro;
    if (replay) {
      showView({ name: "track", clef, selected: stageId });
      return;
    }
    store.record({ type: "intro-completed", v: 1, id: newId(), at: Date.now(), session, clef, stageId, skipped });
    startStage(clef, stageId, "read");
  }

  function stopIntro(): void {
    player.stop();
    intro = null;
    practice.pauseAfterPass = false;
  }

  /** Plays the intro's example with the cursor and keys following along. */
  function listen(): void {
    if (!intro) return;
    synth.unlock();
    practice.resetCold();
    banner.hide();
    const exercise = practice.exercise;
    let previous = -1;
    player.play(exercise, INTRO_TEMPO, {
      onNote(index) {
        if (previous >= 0) notation.setState(previous, "pending");
        notation.setState(index, "current");
        previous = index;
      },
      onKey: (pitch, down) => keyboard.setPressed(pitch, down),
      onEnd: () => practice.resetCold(),
    });
  }

  function startStage(clef: Clef, stageId: string, tier: Tier): void {
    const placed = placedStage(stageId);
    if (!placed) return;
    const { stage } = placed;
    stopIntro();
    milestone = null;
    context = { kind: "curriculum", clef, stageId, tier };
    streakDots.reset(store.progress[clef].stages[stageId].tiers[tier].recent);
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
    keyboardSpan = stageMidiRange(corpus, clef, stage);
    practice.exerciseSource = stageSource(corpus, clef, stage);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
  }

  function openCustom(): void {
    stopIntro();
    milestone = null;
    context = { kind: "custom" };
    streakDots.reset();
    settings = customSettings;
    keyboardSpan = levelMidiRange(levelById(settings.range));
    practice.exerciseSource = customSource(corpus, () => settings);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
  }

  function showView(next: View): void {
    if (view.name === "practice" && next.name !== "practice") {
      milestone = null;
      stopIntro();
      practice.goCold();
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
    practiceBar.hidden = !(practising && context.kind === "curriculum" && !intro);
    introPanel.hidden = !(practising && intro);
    const showMilestone = practising && milestone !== null && context.kind === "curriculum";
    milestonePanel.hidden = !showMilestone;
    if (showMilestone) notationPanel.dataset.milestone = "";
    else delete notationPanel.dataset.milestone;
    if (showMilestone && context.kind === "curriculum") {
      const { clef, stageId } = context;
      renderMilestone(milestonePanel, { clef, stageId, milestone: milestone!, progress: store.progress }, chooseMilestone);
    }
    if (intro) app.dataset.intro = "";
    else delete app.dataset.intro;
    // A stage moves on only once the phrase is played clean.
    nextPhrase.hidden = context.kind === "curriculum";
    syncHot(practice.isHot);
    app.dataset.view = view.name;

    if (view.name === "home") {
      renderHome(menu, { progress: store.progress, status: store.status, storage: store.storage, account }, {
        openTrack: (clef) => showView({ name: "track", clef, selected: store.progress[clef].currentStageId }),
        openCustom,
        signIn: () => accountDialog.open(),
        signOut: () => {
          signOut()
            .then(() => location.reload())
            .catch((error) => console.warn("Could not sign out", error));
        },
      });
    } else if (view.name === "track") {
      const { clef } = view;
      renderTrack(menu, clef, store.progress, view.selected, {
        select: (stageId) => showView({ name: "track", clef, selected: stageId }),
        start: (stageId, tier) => startStage(clef, stageId, tier),
        intro: (stageId) => startIntro(clef, stageId),
        startHere: (stageId) => {
          store.record({ type: "track-started", v: 1, id: newId(), at: Date.now(), session, clef, stageId });
          showView({ name: "track", clef, selected: stageId });
        },
      });
    } else if (intro) {
      renderIntro(introPanel, intro, { listen, skip: () => finishIntro(true) });
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
  bindKeyboardHeight(element<HTMLFormElement>("settings"));
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
    if (changed !== "namesOnNotes") streakDots.reset();
    renderStreak();
    practice.updateSettings(next, changed);
  });

  hotToggle.addEventListener("click", () => {
    synth.unlock();
    player.stop();
    practice.toggleHot();
  });
  // C3 stays, C4 moves on, C5 (after ★★) goes to Fluent; practice is cold, so they can't be notes.
  stream.subscribe((event) => {
    if (!milestone || event.kind !== "on" || event.source !== "midi") return;
    const choice = milestoneChoices(milestone).find((c) => MILESTONE_KEYS[c] === event.pitch);
    if (choice) chooseMilestone(choice);
  });
  document.addEventListener("keydown", (event) => {
    if (!milestone || view.name !== "practice" || (event.key !== "Enter" && event.key !== "Escape")) return;
    if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
    event.preventDefault();
    chooseMilestone(event.key === "Enter" ? "advance" : "stay");
  });
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat || view.name !== "practice") return;
    // Leave Space alone where it already means something (a focused button clicks itself).
    if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
    event.preventDefault();
    synth.unlock();
    player.stop();
    practice.toggleHot();
  });
  slowDown.addEventListener("click", () => {
    synth.unlock();
    practice.slowDown();
  });
  nextPhrase.addEventListener("click", () => {
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

  new ResizeObserver(() => updateKeyboardRange()).observe(document.body);
  // The music fits its sheet, which also resizes without the window (keyboard height, intro layout).
  new ResizeObserver(() => notationView.draw()).observe(document.querySelector(".notation-sheet")!);
}

void main();
