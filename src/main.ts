import "./styles.css";
import { PhrasePlayer } from "./audio/phrasePlayer";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { MidiInput } from "./input/midiInput";
import { attachScreenInput } from "./input/screenInput";
import {
  advanceStars,
  ADVANCE_TEXT,
  MASTERY_ROUNDS,
  maxStars,
  MISS_WINDOW,
  STAR_STREAK,
  placedStage,
  stageVersion,
  stageReviews,
  stageTiers,
  tierMixes,
  tierMode,
  tierTempo,
  type Stage,
  type Tier,
} from "./curriculum/curriculum";
import { customSource, mixedSource, stageMidiRange, stageSource } from "./curriculum/corpusSource";
import { currentUser, signOut } from "./account";
import { dailyMinutes } from "./curriculum/activity";
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
import type { Clef, Exercise, Level, NoteSource } from "./music/types";
import { FlashcardMode, flashcardSummary } from "./flashcards/flashcardMode";
import { PieceMode } from "./piece/pieceMode";
import { PracticeController, RETRY_PITCH, type PhraseResult } from "./practice/practiceController";
import { DEFAULT_SETTINGS, type Settings } from "./practice/settings";
import type { Mark } from "./practice/waitSession";
import { ScalePlayer } from "./audio/scalePlayer";
import type { KeyInfo } from "./music/keys";
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
  renderIntroDone,
  renderMilestone,
  renderPracticeBar,
  renderCurriculum,
  type StageRef,
  type MilestoneChoice,
  type ResultMessage,
  type ResultTone,
} from "./ui/curriculumViews";
import { bindSettingsBar } from "./ui/settingsBar";
import { bindKeyboardHeight } from "./ui/keyboardHeight";
import { bindPrefsPopover, bindTheme } from "./ui/theme";

/** Time to see a clean intro example turn green before the next one comes up. */
const INTRO_NEXT_DELAY_MS = 1500;
/** Days of practice the home page charts, ending today. */
const ACTIVITY_DAYS = 14;
/** Words for a clean phrase, taken in turn so the fortieth doesn't read like the first. */
const CLEAN_WORDS = ["Perfect", "Spot on", "Clean", "Nailed it"];
/** Clean phrases in a row that swap the sparkle for a flame. */
const HOT_RUN = 5;
/** How long a star or mastery is cheered on the staff before its card comes up. */
const CELEBRATE_MS = 2200;
/** Space between the result and the top of the music below it. */
const RESULT_GAP_PX = 16;
/** The result never sits closer than this to the top of the notation panel. */
const RESULT_MIN_TOP_PX = 8;

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
        else show("ready", "MIDI ON", `Listening to ${status.devices.join(", ")}`);
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
  const scalePlayer = new ScalePlayer(synth, keyboard);
  const keyScale = { play: (key: KeyInfo) => scalePlayer.play(key), preview: (key: KeyInfo | null) => scalePlayer.preview(key) };
  notationView.setKeyScale(keyScale);
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
    circleSignatures(...args: Parameters<NotationView["circleSignatures"]>) {
      notationView.circleSignatures(...args);
    },
    setHold(...args: Parameters<NotationView["setHold"]>) {
      notationView.setHold(...args);
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
  const resultElement = element("phrase-result");
  const banner = new PhraseResultBanner(resultElement);
  const eventLog = openEventLog();
  const store = new ProgressStore(eventLog);
  const accountDialog = bindAccountDialog(element<HTMLDialogElement>("account-dialog"));
  let account: string | null = null;
  void currentUser()
    .then((user) => {
      account = user ? (user.email ?? "signed in") : null;
      if (viewsReady && view.name === "home") renderView();
    })
    .catch((error) => console.warn("Could not read the signed-in account", error));
  const session = newId();

  type View =
    | { name: "home" }
    | { name: "curriculum"; selected: StageRef | null }
    | { name: "practice" }
    | { name: "pieces" }
    | { name: "flashcards" };
  let view: View = { name: "home" };
  let context: PracticeContext = { kind: "custom" };
  /** What the settings bar shows; curriculum stages override most of it while they run. */
  let customSettings: Settings = DEFAULT_SETTINGS;
  let settings: Settings = DEFAULT_SETTINGS;
  /** A star or completed stage just earned: its card stands in for the staff until a choice is made. */
  let milestone: Milestone | null = null;
  /** A milestone being celebrated on the staff; its card follows after CELEBRATE_MS. */
  let celebrating: Milestone | null = null;
  const streakDots = new StreakDots();
  /** Clean phrases so far, to take the headline words in turn. */
  let cleanCount = 0;
  /** A stage's intro, while it runs; its phrases are echoed, not recorded. */
  let intro: {
    clef: Clef;
    stageId: string;
    steps: IntroStep[];
    index: number;
    replay: boolean;
    /** Every example played clean: its card asks to repeat the intro or go on. */
    finished: boolean;
  } | null = null;
  let keyboardSpan = levelMidiRange(levelById(DEFAULT_SETTINGS.range));
  /** Each stage's phrases by "clef stage", kept for the page so its tiers, and later stages' mixes, deal from one deck. */
  const stageSources = new Map<string, () => Exercise>();
  /** Phrases a mixing tier dealt from an earlier stage, and which. */
  const reviewStages = new WeakMap<Exercise, Stage>();

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
    // Cold also covers a star being cheered and the cards after it; only real free play shows played notes.
    notationView.setFreePlay(!hot && !celebrating && !milestone && !intro?.finished);
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
        // Playing the last example again, instead of choosing.
        if (intro?.finished) {
          intro.finished = false;
          renderView();
        }
      }
      syncHot(hot);
    },
    onPlayed: (pitch, down) => notationView.setPlayed(pitch, down),
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
  const highlightPlayed = element<HTMLFormElement>("settings").elements.namedItem("highlightPlayed") as HTMLInputElement;
  notationView.setHighlightPlayed(highlightPlayed.checked);
  highlightPlayed.addEventListener("change", () => notationView.setHighlightPlayed(highlightPlayed.checked));
  const holdGuide = element<HTMLFormElement>("settings").elements.namedItem("holdGuide") as HTMLInputElement;
  practice.holdGuide = holdGuide.checked;
  holdGuide.addEventListener("change", () => {
    practice.holdGuide = holdGuide.checked;
  });
  for (const mode of ["wait", "rhythm"] as const) {
    const name = mode === "wait" ? "failAtOnceWait" : "failAtOnceRhythm";
    const box = element<HTMLFormElement>("settings").elements.namedItem(name) as HTMLInputElement;
    practice.failAtOnce[mode] = box.checked;
    box.addEventListener("change", () => {
      practice.failAtOnce[mode] = box.checked;
    });
  }
  bindRetryKey(element<HTMLButtonElement>("retry-key"), practice, () => syncHot(practice.isHot));
  const piecesView = element("pieces");
  const pieceMode = new PieceMode({
    root: piecesView,
    stream,
    synth,
    soundMidiKeys: () => soundMidiKeys.checked,
    startKey: () => practice.retryPitch,
    keyScale,
    log: eventLog,
    session,
    signIn: () => accountDialog.open(),
  });
  const flashcardsView = element("flashcards");
  const flashcardMode = new FlashcardMode({
    root: flashcardsView,
    stream,
    synth,
    store,
    session,
    soundMidiKeys: () => soundMidiKeys.checked,
    openCurriculum: () => showView({ name: "curriculum", selected: null }),
  });
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
    if (view.name === "home") renderView();
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
      showResult(
        result,
        result.passed
          ? { emoji: "🐇", title: `Clean at ${result.tempo} bpm`, detail: "now at full tempo", tone: "info" }
          : faultMessage(result, `at ${result.tempo} bpm`, "info"),
      );
      return;
    }
    const { exercise } = result;
    const review = reviewStages.get(exercise);
    const stage = context.kind === "curriculum" ? (review ?? placedStage(context.stageId)?.stage) : undefined;
    const level = stage ? spanLevel(exercise.clef, exercise.key, stage.span) : levelById(settings.range);
    const notes = exercise.bars.flat();
    const at = Date.now();
    const event: PhraseCompleted = {
      type: "phrase-completed",
      v: 1,
      id: newId(),
      at,
      startedAt: at - result.playedMs,
      session,
      context,
      mode: result.mode,
      tempo: result.tempo,
      holds: result.holds,
      input: inputKind(result.sources),
      devices: midiDevices && midiDevices.length > 0 ? midiDevices : undefined,
      config: {
        clef: exercise.clef,
        key: exercise.key,
        lowest: spellingText(level.lowest),
        highest: spellingText(level.highest),
        accidentals: stage?.accidentals ?? settings.accidentalFrequency,
        rhythm: stage?.rhythm ?? settings.rhythm,
        bars: settings.bars,
        time: exercise.time,
      },
      phraseId: exercise.source?.id,
      reviewStageId: review?.id,
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
    const again = perfect && result.passesNeeded > 0;
    const outcome = (detail: string): ResultMessage =>
      perfect ? cleanMessage(withHoldTip(result, detail), again) : faultMessage(result, detail);

    if (context.kind === "custom") {
      streakDots.push(perfect);
      showResult(result, outcome(hitsText()));
      renderStreak();
      return;
    }

    const { clef, stageId } = context;
    let message: ResultMessage;
    if (!countsForProgress(event)) {
      message = { ...outcome("screen keys don't count towards progress"), emoji: "🖱️", tone: "info" };
    } else {
      streakDots.push(perfect);
      const earned = milestoneBetween(before, store.progress, clef, stageId);
      if (earned) {
        celebrate(result, earned);
        return;
      }
      message = outcome(roundText(before[clef].stages[stageId].tiers.fluent, perfect) ?? hitsText());
    }
    showResult(result, message);
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
    } else if (choice === "advance" && earned.kind === "star" && earned.stars < advanceStars(placedStage(stageId)!.stage)) {
      startStage(clef, stageId, stageTiers(placedStage(stageId)!.stage)[earned.stars]);
    } else if (choice === "advance") {
      const next = nextStepAfter(store.progress, clef, stageId);
      if (next.kind === "stage") startStage(clef, next.stageId, next.tier);
      else if (next.kind === "intro") startIntro(clef, next.stageId);
      else showView({ name: "curriculum", selected: { clef, stageId } });
    } else {
      renderView();
      // Wait mode carries straight on; rhythm waits for Start so the metronome never starts unasked.
      if (settings.mode === "wait") practice.goHot();
    }
  }

  /** The choices on the card standing in for the staff, if one is up. */
  function cardChoices(): MilestoneChoice[] | null {
    if (milestone && context.kind === "curriculum") return milestoneChoices(milestone, context.stageId);
    return intro?.finished ? ["stay", "advance"] : null;
  }

  function chooseCard(choice: MilestoneChoice): void {
    if (!intro?.finished) {
      chooseMilestone(choice);
      return;
    }
    if (choice === "advance") finishIntro(false);
    else startIntro(intro.clef, intro.stageId);
  }

  /**
   * Cheers a star or a mastered stage on the staff first; then its card stands in for the
   * staff. The next phrase waits throughout, until a choice is made.
   */
  function celebrate(result: PhraseResult, earned: Milestone): void {
    celebrating = earned;
    practice.pauseAfterPass = true;
    const title = earned.kind === "mastered" ? "Mastered" : `${"★".repeat(earned.stars)} earned`;
    showResult(result, { emoji: earned.kind === "mastered" ? "👑" : "🌟", title, detail: hitsText(), tone: "perfect" });
    renderView();
    setTimeout(() => {
      if (celebrating !== earned) return;
      celebrating = null;
      milestone = earned;
      banner.hide();
      renderView();
    }, CELEBRATE_MS);
  }

  function closeMilestone(): void {
    if (!milestone && !celebrating) return;
    milestone = null;
    celebrating = null;
    practice.pauseAfterPass = intro !== null;
    renderView();
  }

  /** The Fluent tier while a mastery round is under way: every star earned, not yet mastered. */
  function masteryUnderWay(): TierProgress | null {
    if (context.kind !== "curriculum" || context.tier !== "fluent") return null;
    const stage = store.progress[context.clef].stages[context.stageId];
    return stage.stars === maxStars(placedStage(context.stageId)!.stage) && !stage.mastered ? stage.tiers.fluent : null;
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

  /** Where a failed attempt first went wrong: what to say, and the bar to wash on the staff. */
  function faultOf(result: PhraseResult): { emoji: string; text: string; bar?: number } {
    const fault = firstFault({ notes: result.notes, barSizes: result.exercise.bars.map((bar) => bar.length), holds: result.holds });
    // Stopping leaves the rest unplayed, so only a key pressed before it is the real fault.
    if (result.abandoned && fault?.kind !== "wrong" && fault?.kind !== "early") return { emoji: "✋", text: "Stopped mid-phrase" };
    if (!fault) return { emoji: "❌", text: "Not quite" };
    switch (fault.kind) {
      case "wrong":
        return { emoji: "❌", text: `Wrong note in bar ${fault.bar}`, bar: fault.bar };
      case "early":
        return { emoji: "⏩", text: `Too early in bar ${fault.bar}`, bar: fault.bar };
      case "missed":
        return { emoji: "🙈", text: `Missed a note in bar ${fault.bar}`, bar: fault.bar };
      case "short":
        return { emoji: "⏱️", text: `Let go too soon in bar ${fault.bar}`, bar: fault.bar };
      case "long":
        return { emoji: "🐢", text: `Held too long in bar ${fault.bar}`, bar: fault.bar };
    }
  }

  /** While holds are coached, a clean phrase with holds that were off gets a tip about them. */
  function withHoldTip(result: PhraseResult, detail: string): string {
    const holds = result.notes.map((n) => n.hold);
    if (holds.includes("short")) return `${detail} · hold long notes their full length`;
    if (holds.includes("long")) return `${detail} · let go as the next note starts`;
    return detail;
  }

  function faultMessage(result: PhraseResult, detail: string, tone: ResultTone = "fault"): ResultMessage {
    const { emoji, text } = faultOf(result);
    return { emoji, title: text, detail, tone };
  }

  /** A clean phrase's message; its headline word changes each time, and a run of them catches fire. */
  function cleanMessage(detail: string, again = false): ResultMessage {
    if (again) return { emoji: "🔁", title: "Clean", detail: `once more · ${detail}`, tone: "perfect" };
    const title = CLEAN_WORDS[cleanCount++ % CLEAN_WORDS.length];
    return { emoji: streakDots.run() >= HOT_RUN ? "🔥" : "✨", title, detail, tone: "perfect" };
  }

  /** Sets the result just above the music, a little clear of it. */
  function placeResult(): void {
    const inkTop = notationView.inkTop();
    if (inkTop === null) return;
    const musicTop = inkTop - notationPanel.getBoundingClientRect().top;
    resultElement.style.top = `${Math.max(RESULT_MIN_TOP_PX, musicTop - resultElement.offsetHeight - RESULT_GAP_PX)}px`;
  }

  /** Writes the message on the panel; the notes hop for a clean phrase, and a fault washes its bar. */
  function showResult(result: PhraseResult, message: ResultMessage): void {
    banner.show(message);
    placeResult();
    if (result.passed) {
      notationView.celebrate();
      return;
    }
    notationView.markBar(faultOf(result).bar ?? null);
    delete notationPanel.dataset.nudge;
    void notationPanel.offsetWidth;
    notationPanel.dataset.nudge = "";
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
      showResult(result, faultMessage(result, "listen again, or press Start to retry"));
      return;
    }
    if (result.next !== "new") {
      showResult(
        result,
        result.slowed
          ? { emoji: "🐇", title: `Clean at ${result.tempo} bpm`, detail: "now at full tempo", tone: "info" }
          : { emoji: "🔁", title: "Clean", detail: "once more", tone: "info" },
      );
      return;
    }
    if (run.index === run.steps.length - 1) {
      // A pause before the stage: the card asks to watch it again or go on.
      run.finished = true;
      banner.hide();
      renderView();
      return;
    }
    showResult(result, { emoji: "👂", title: "Clean", detail: `next: ${run.steps[run.index + 1].title}`, tone: "perfect" });
    // The next explanation shows at once; Start plays its example even before it's drawn.
    run.index++;
    renderView();
    setTimeout(() => {
      if (intro === run && !practice.isHot) practice.startNewExercise();
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
    celebrating = null;
    intro = { clef, stageId, steps, index: 0, replay: store.progress[clef].stages[stageId].introDone, finished: false };
    context = { kind: "curriculum", clef, stageId, stageVersion: stageVersion(stage), tier: "read" };
    practice.holdStrictness = "coach";
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
      showView({ name: "curriculum", selected: { clef, stageId } });
      return;
    }
    const { stage } = placedStage(stageId)!;
    store.record({ type: "intro-completed", v: 1, id: newId(), at: Date.now(), session, clef, stageId, stageVersion: stageVersion(stage), skipped });
    startStage(clef, stageId, stageTiers(stage)[0]);
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
    celebrating = null;
    context = { kind: "curriculum", clef, stageId, stageVersion: stageVersion(stage), tier };
    practice.holdStrictness = tier === "fluent" ? "strict" : "coach";
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
    const reviews = tierMixes(tier) ? stageReviews(stage) : [];
    keyboardSpan = [stage, ...reviews.map((r) => r.stage)]
      .map((s) => stageMidiRange(corpus, clef, s))
      .reduce((a, b) => ({ lowest: Math.min(a.lowest, b.lowest), highest: Math.max(a.highest, b.highest) }));
    practice.exerciseSource = tierMixes(tier)
      ? mixedSource(
          sourceFor(clef, stage),
          reviews.map((r) => ({
            weight: r.weight,
            source: () => {
              const exercise = sourceFor(clef, r.stage)();
              reviewStages.set(exercise, r.stage);
              return exercise;
            },
          })),
        )
      : sourceFor(clef, stage);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
  }

  /** A stage's own phrases in a track, dealt from one deck wherever they're played. */
  function sourceFor(clef: Clef, stage: Stage): () => Exercise {
    const key = `${clef} ${stage.id}`;
    if (!stageSources.has(key)) stageSources.set(key, stageSource(corpus, clef, stage));
    return stageSources.get(key)!;
  }

  function openCustom(): void {
    stopIntro();
    milestone = null;
    celebrating = null;
    context = { kind: "custom" };
    practice.holdStrictness = "coach";
    streakDots.reset();
    settings = customSettings;
    keyboardSpan = levelMidiRange(levelById(settings.range));
    practice.exerciseSource = customSource(corpus, () => settings);
    showView({ name: "practice" });
    practice.updateSettings(settings, "mode");
  }

  function showView(next: View): void {
    if (view.name === "pieces" && next.name !== "pieces") pieceMode.hide();
    if (view.name === "flashcards" && next.name !== "flashcards") flashcardMode.hide();
    // Pieces and flashcards take the note stream for themselves while they're up.
    practice.muted = next.name === "pieces" || next.name === "flashcards";
    if (view.name === "practice" && next.name !== "practice") {
      milestone = null;
      celebrating = null;
      stopIntro();
      practice.goCold();
      banner.hide();
    }
    view = next;
    renderView();
    if (view.name === "pieces") void pieceMode.show();
    if (view.name === "flashcards") flashcardMode.show();
    if (view.name === "practice") {
      // The keyboard and staff measure themselves; they were hidden until now.
      updateKeyboardRange();
      notationView.draw();
    }
  }

  function renderView(): void {
    const practising = view.name === "practice";
    menu.hidden = practising || view.name === "pieces" || view.name === "flashcards";
    piecesView.hidden = view.name !== "pieces";
    flashcardsView.hidden = view.name !== "flashcards";
    practiceView.hidden = !practising;
    navBack.hidden = view.name === "home";
    customControls.hidden = !(practising && context.kind === "custom");
    practiceBar.hidden = !(practising && context.kind === "curriculum" && !intro);
    introPanel.hidden = !(practising && intro);
    const showCard = practising && context.kind === "curriculum" && (milestone !== null || intro?.finished === true);
    milestonePanel.hidden = !showCard;
    if (showCard) notationPanel.dataset.milestone = "";
    else delete notationPanel.dataset.milestone;
    if (showCard && intro) {
      renderIntroDone(milestonePanel, intro, chooseCard);
    } else if (showCard && context.kind === "curriculum") {
      const { clef, stageId } = context;
      renderMilestone(milestonePanel, { clef, stageId, milestone: milestone!, progress: store.progress }, chooseCard);
    }
    if (intro) app.dataset.intro = "";
    else delete app.dataset.intro;
    // A stage moves on only once the phrase is played clean.
    nextPhrase.hidden = context.kind === "curriculum";
    syncHot(practice.isHot);
    app.dataset.view = view.name;

    if (view.name === "home") {
      renderHome(menu, { progress: store.progress, activity: dailyMinutes(store.history, ACTIVITY_DAYS), flashcards: flashcardSummary(store), status: store.status, storage: store.storage, account }, {
        openCurriculum: () => showView({ name: "curriculum", selected: null }),
        openCustom,
        openPieces: () => showView({ name: "pieces" }),
        openFlashcards: () => showView({ name: "flashcards" }),
        signIn: () => accountDialog.open(),
        signOut: () => {
          signOut()
            .then(() => location.reload())
            .catch((error) => console.warn("Could not sign out", error));
        },
      });
    } else if (view.name === "curriculum") {
      renderCurriculum(menu, store.progress, view.selected, (clef) => ({
        select: (stageId) => showView({ name: "curriculum", selected: { clef, stageId } }),
        start: (stageId, tier) => startStage(clef, stageId, tier),
        intro: (stageId) => startIntro(clef, stageId),
        startHere: (stageId) => {
          store.record({ type: "track-started", v: 1, id: newId(), at: Date.now(), session, clef, stageId });
          showView({ name: "curriculum", selected: { clef, stageId } });
        },
      }));
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
      showView({ name: "curriculum", selected: { clef: context.clef, stageId: context.stageId } });
    } else if (view.name === "pieces" && pieceMode.back()) {
      // Up a screen within pieces.
    } else {
      showView({ name: "home" });
    }
  });
  store.subscribe(() => {
    // Flashcards redraw themselves as cards are answered.
    if (view.name !== "practice" && view.name !== "flashcards") renderView();
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
  // C3 stays (or repeats the intro), C4 moves on, C5 (after ★★★) goes to Fluent; practice is
  // cold while a card is up, so they can't be notes.
  stream.subscribe((event) => {
    const choices = cardChoices();
    if (!choices || event.kind !== "on" || event.source !== "midi") return;
    const choice = choices.find((c) => MILESTONE_KEYS[c] === event.pitch);
    if (choice) chooseCard(choice);
  });
  document.addEventListener("keydown", (event) => {
    if (!cardChoices() || view.name !== "practice" || (event.key !== "Enter" && event.key !== "Escape")) return;
    if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
    event.preventDefault();
    chooseCard(event.key === "Enter" ? "advance" : "stay");
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
