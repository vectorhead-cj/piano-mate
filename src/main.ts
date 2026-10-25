import "./styles.css";
import { Synth } from "./audio/synth";
import { NoteStream } from "./input/noteStream";
import { attachScreenInput } from "./input/screenInput";
import { levelById } from "./music/levels";
import { midiOf } from "./music/pitch";
import { PracticeController } from "./practice/practiceController";
import { DEFAULT_SETTINGS } from "./practice/settings";
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

  const stream = new NoteStream();
  const synth = new Synth();
  const notation = new NotationView(notationElement);
  const keyboard = new KeyboardView(keyboardElement);
  attachScreenInput(keyboardElement, stream);

  let rangeId = DEFAULT_SETTINGS.range;

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

  const practice = new PracticeController({
    stream,
    notation,
    keyboard,
    sound: synth,
    settings: DEFAULT_SETTINGS,
  });

  bindSettingsBar(element<HTMLFormElement>("settings"), DEFAULT_SETTINGS, (settings, changed) => {
    if (changed === "range") {
      rangeId = settings.range;
      updateKeyboardRange();
    }
    practice.updateSettings(settings, changed);
  });
  element("next").addEventListener("click", () => practice.startNewExercise());

  // Older iOS versions only unlock audio on touchend, not on pointerdown.
  document.addEventListener("touchend", () => synth.unlock(), { once: true });

  new ResizeObserver(() => {
    updateKeyboardRange();
    notation.draw();
  }).observe(document.body);
}

void main();
