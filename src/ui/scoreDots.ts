import { MISS_WINDOW } from "../curriculum/curriculum";
import { recentHits } from "../curriculum/progress";
import type { Mark } from "../practice/waitSession";

/** Phrases the streak row shows, one window's worth: the newest pushes the oldest out once it's full. */
export const STREAK_DOTS = MISS_WINDOW;

/** One dot per mark: hollow while pending, green when correct, red when not. */
export function renderDots(container: HTMLElement, marks: readonly Mark[], label: string): void {
  while (container.children.length > marks.length) container.lastElementChild!.remove();
  while (container.children.length < marks.length) container.append(document.createElement("span"));
  marks.forEach((mark, i) => {
    const dot = container.children[i] as HTMLElement;
    dot.className = "score-dot";
    dot.dataset.mark = mark;
  });
  const correct = marks.filter((mark) => mark === "correct").length;
  container.setAttribute("role", "img");
  container.setAttribute("aria-label", `${label}: ${correct} of ${marks.length} correct`);
}

/** The last few phrases, oldest first; a failure stays up as a red dot until pushed out. */
export class StreakDots {
  private results: boolean[] = [];

  /** Starts over from the phrases already played, oldest first. */
  reset(recent: readonly boolean[] = []): void {
    this.results = recent.slice(-STREAK_DOTS);
  }

  /** Green dots: clean phrases out of the last STREAK_DOTS. */
  hits(): number {
    return recentHits(this.results);
  }

  push(perfect: boolean): void {
    this.results = [...this.results, perfect].slice(-STREAK_DOTS);
  }

  marks(): Mark[] {
    return Array.from({ length: STREAK_DOTS }, (_, i): Mark =>
      i >= this.results.length ? "pending" : this.results[i] ? "correct" : "wrong",
    );
  }
}
