import { describe, expect, it } from "vitest";
import { STREAK_DOTS, StreakDots } from "../src/ui/scoreDots";

describe("StreakDots", () => {
  it("fills from the left and keeps a failure up as a red dot", () => {
    const dots = new StreakDots();
    dots.push(true);
    dots.push(false);
    dots.push(true);
    expect(dots.marks()).toEqual(["correct", "wrong", "correct", ...Array(STREAK_DOTS - 3).fill("pending")]);
  });

  it("pushes the oldest out once full, so a full streak clears the last failure", () => {
    const dots = new StreakDots();
    dots.push(false);
    for (let i = 0; i < STREAK_DOTS - 1; i++) dots.push(true);
    expect(dots.marks()[0]).toBe("wrong");
    dots.push(true);
    expect(dots.marks()).toEqual(Array(STREAK_DOTS).fill("correct"));
  });

  it("starts from the phrases already played and counts their hits", () => {
    const dots = new StreakDots();
    dots.reset([true, false, true]);
    expect(dots.marks().slice(0, 4)).toEqual(["correct", "wrong", "correct", "pending"]);
    expect(dots.hits()).toBe(2);
  });
});
