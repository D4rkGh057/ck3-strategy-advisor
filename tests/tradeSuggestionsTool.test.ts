import { describe, expect, it } from "vitest";
import { line } from "../src/tools/tradeSuggestions.js";
import type { Suggestion } from "../src/extract/tradeSuggestions.js";

const cache = { loc: { resolve: (k: string) => k } } as any;

function suggestion(flows: Suggestion["flows"]): Suggestion {
  return {
    anchor: { id: 100, place: "Anchor" },
    other: { id: 101, place: "Other" },
    score: flows.reduce((t, f) => t + f.profit, 0),
    distance: null,
    flows,
    existingRoutes: 0,
    xpCategories: [],
  };
}

describe("trade_suggestions line", () => {
  it("keeps rendering a normal flow as before", () => {
    const out = line(
      cache,
      suggestion([{ good: "trade_good_salt", amount: 20, direction: "in", profit: 1.6 }]),
    );
    expect(out).toBe(
      "- Anchor (100) ↔ Other (101) — score 1.6: 20 salt (buy Other, sell Anchor, +1.60)",
    );
  });

  it("still shows a flow that rounds to one unit", () => {
    const out = line(
      cache,
      suggestion([{ good: "trade_good_salt", amount: 0.5, direction: "in", profit: 0.04 }]),
    );
    expect(out).toContain("1 salt (buy Other, sell Anchor, +0.04)");
  });

  it("hides a flow that would render as 0 units, keeping the visible ones", () => {
    const out = line(
      cache,
      suggestion([
        { good: "trade_good_salt", amount: 20, direction: "in", profit: 1.6 },
        { good: "trade_good_leather", amount: 0.3, direction: "out", profit: 0.001 },
      ]),
    );
    expect(out).toContain("20 salt");
    expect(out).not.toContain("leather");
    expect(out).not.toMatch(/\b0 \w+ \(/);
    expect(out).not.toContain("+0.00");
  });

  it("returns null when no flow is visible, so the pair is skipped", () => {
    const out = line(
      cache,
      suggestion([{ good: "trade_good_leather", amount: 0.3, direction: "out", profit: 0.001 }]),
    );
    expect(out).toBeNull();
  });
});
