// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteStream } from "../src/input/noteStream";
import { attachScreenInput } from "../src/input/screenInput";
import type { NoteEvent } from "../src/music/types";

let keyboard: HTMLElement;
let events: Pick<NoteEvent, "kind" | "pitch" | "source">[];
let detach: () => void;

function key(midi: number): HTMLElement {
  return keyboard.querySelector(`[data-midi="${midi}"]`)!;
}

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: 1, ...init }),
  );
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="keyboard">
      <div data-midi="60"><span class="label">C</span></div>
      <div data-midi="61"></div>
      <div data-midi="62"></div>
    </div>`;
  keyboard = document.getElementById("keyboard")!;
  events = [];
  const stream = new NoteStream();
  stream.subscribe(({ kind, pitch, source }) => events.push({ kind, pitch, source }));
  detach = attachScreenInput(keyboard, stream);
});

afterEach(() => detach());

describe("attachScreenInput", () => {
  it("emits on for a press and off for the release", () => {
    pointer("pointerdown", key(60));
    pointer("pointerup", window);
    expect(events).toEqual([
      { kind: "on", pitch: 60, source: "screen" },
      { kind: "off", pitch: 60, source: "screen" },
    ]);
  });

  it("finds the key when the press lands on a child element", () => {
    pointer("pointerdown", key(60).querySelector(".label")!);
    expect(events).toEqual([{ kind: "on", pitch: 60, source: "screen" }]);
  });

  it("tracks each finger separately so chords work", () => {
    pointer("pointerdown", key(60), { pointerId: 1 });
    pointer("pointerdown", key(62), { pointerId: 2 });
    pointer("pointerup", window, { pointerId: 2 });
    pointer("pointercancel", window, { pointerId: 1 });
    expect(events.map((e) => [e.kind, e.pitch])).toEqual([
      ["on", 60],
      ["on", 62],
      ["off", 62],
      ["off", 60],
    ]);
  });

  it("ignores right clicks, presses between keys and stray releases", () => {
    pointer("pointerdown", key(61), { pointerType: "mouse", button: 2 });
    pointer("pointerdown", keyboard);
    pointer("pointerup", window, { pointerId: 99 });
    expect(events).toEqual([]);
  });
});
