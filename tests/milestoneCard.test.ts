// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PLACED_STAGES } from "../src/curriculum/curriculum";
import { projectProgress } from "../src/curriculum/progress";
import { nextStepAfter, renderMilestone } from "../src/ui/curriculumViews";

const [first, second] = PLACED_STAGES.map((p) => p.stage.id);

function card(stars: number, kind: "star" | "complete" = "star") {
  const root = document.createElement("div");
  const choose = vi.fn();
  renderMilestone(root, { clef: "treble", stageId: first, milestone: { kind, stars }, progress: projectProgress([]) }, choose);
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  return { root, choose, buttons, keys: buttons.map((b) => b.querySelector("kbd")!.textContent) };
}

describe("milestone card", () => {
  it("offers Stay on C3 and Play on C4 after ★ Read", () => {
    const { root, buttons, keys } = card(1);
    expect(root.textContent).toContain("Next up is Play");
    expect(buttons.map((b) => b.dataset.choice)).toEqual(["stay", "advance"]);
    expect(keys).toEqual(["C3", "C4"]);
  });

  it("adds Fluent on C5, right-most, after ★★ Play", () => {
    const { buttons, keys, choose } = card(2);
    expect(buttons.map((b) => b.dataset.choice)).toEqual(["stay", "advance", "fluent"]);
    expect(keys).toEqual(["C3", "C4", "C5"]);
    buttons[2].click();
    expect(choose).toHaveBeenCalledWith("fluent");
  });

  it("leads to the next stage's intro while it hasn't been watched", () => {
    expect(nextStepAfter(projectProgress([]), "treble", first)).toEqual({ kind: "track" });
    const progress = projectProgress([]);
    progress.treble.stages[second] = { ...progress.treble.stages[second], introOpen: true };
    expect(nextStepAfter(progress, "treble", first)).toEqual({ kind: "intro", stageId: second });
    progress.treble.stages[second] = { ...progress.treble.stages[second], unlocked: true, stars: 1 };
    expect(nextStepAfter(progress, "treble", first)).toEqual({ kind: "stage", stageId: second, tier: "play" });
  });
});
