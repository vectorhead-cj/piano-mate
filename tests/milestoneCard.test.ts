// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PLACED_STAGES } from "../src/curriculum/curriculum";
import { projectProgress } from "../src/curriculum/progress";
import { nextStepAfter, renderMilestone } from "../src/ui/curriculumViews";

const [first, second] = PLACED_STAGES.map((p) => p.stage.id);

function card(stars: number, kind: "star" | "mastered" = "star") {
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

  it("pops in the star just earned, or the crown when mastered", () => {
    const stars = [...card(2).root.querySelectorAll(".star")];
    expect(stars.map((star) => star.classList.contains("fresh"))).toEqual([false, true, false, false]);
    expect(card(4, "mastered").root.querySelector(".mastery-mark")?.classList.contains("fresh")).toBe(true);
  });

  it("offers Mix on C4 after ★★ Play", () => {
    const { root, buttons } = card(2);
    expect(root.textContent).toContain("Next up is Mix");
    expect(buttons.map((b) => b.dataset.choice)).toEqual(["stay", "advance"]);
  });

  it("adds Fluent on C5, right-most, after ★★★ Mix", () => {
    const { buttons, keys, choose } = card(3);
    expect(buttons.map((b) => b.dataset.choice)).toEqual(["stay", "advance", "fluent"]);
    expect(keys).toEqual(["C3", "C4", "C5"]);
    buttons[2].click();
    expect(choose).toHaveBeenCalledWith("fluent");
  });

  it("asks to stay and master the stage after ★★★★", () => {
    const { root, buttons } = card(4);
    expect(buttons[0].textContent).toContain("Master 1.1");
    expect(root.querySelector(".mastery-mark")?.classList.contains("on")).toBe(false);
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

describe("stage detail", () => {
  it("says Continue on a tier that has been played, Start on one that hasn't", async () => {
    const { renderTrack } = await import("../src/ui/curriculumViews");
    const played = {
      type: "phrase-completed" as const,
      v: 1 as const,
      id: "e1",
      at: 1,
      session: "s",
      context: { kind: "curriculum" as const, clef: "treble" as const, stageId: first, tier: "read" as const },
      mode: "wait" as const,
      input: "midi" as const,
      config: {} as never,
      barSizes: [1],
      notes: [{ pitch: "C4", duration: "q" as const, wrong: 0, hit: true }],
    };
    const root = document.createElement("div");
    const actions = { select() {}, start() {}, intro() {}, startHere() {} };
    renderTrack(root, "treble", projectProgress([played]), first, actions);
    const labels = [...root.querySelectorAll(".tier-card button")].map((b) => b.textContent);
    expect(labels).toEqual(["Continue Read", "Locked", "Locked", "Locked"]);
  });
});
