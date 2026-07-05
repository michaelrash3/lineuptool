import {
  avgUniversal,
  computeFlags,
  fmtDelta,
  formatRoundName,
  pitcherPremium,
  sanitizeGrades,
  DEFAULT_GRADES,
} from "./evalScoring";
import { EVAL_CATEGORIES } from "../constants/ui";
import type { Player } from "../types";

const universalIds = EVAL_CATEGORIES.filter((c) => !c.addOn).map((c) => c.id);

describe("sanitizeGrades", () => {
  it("clamps grades into [1, EVAL_SCALE_MAX] and coerces numeric strings", () => {
    const out = sanitizeGrades({
      [universalIds[0]]: "4",
      [universalIds[1]]: 99,
      [universalIds[2]]: 0,
    });
    expect(out[universalIds[0]]).toBe(4);
    expect(out[universalIds[1]]).toBe(5); // clamped to max
    expect(out[universalIds[2]]).toBe(1); // clamped to min
  });

  it("falls back to defaults for missing/blank categories and keeps notes", () => {
    const out = sanitizeGrades({ notes: " solid glove " });
    // Every non-mph category gets its default seed.
    expect(out[universalIds[0]]).toBe(DEFAULT_GRADES[universalIds[0]]);
    expect(out.notes).toBe(" solid glove ");
  });

  it("drops blank notes", () => {
    expect(sanitizeGrades({ notes: "   " }).notes).toBeUndefined();
    expect(sanitizeGrades(null).notes).toBeUndefined();
  });
});

describe("avgUniversal", () => {
  it("averages only the universal categories, ignoring blanks/out-of-range", () => {
    const grades: Record<string, number> = {};
    universalIds.forEach((id, i) => {
      grades[id] = i === 0 ? 99 : 4; // first is out of range → ignored
    });
    expect(avgUniversal(grades as any)).toBe(4);
  });

  it("returns null when nothing gradeable is present", () => {
    expect(avgUniversal(null)).toBeNull();
    expect(avgUniversal({} as any)).toBeNull();
  });
});

describe("formatRoundName", () => {
  it("prefers the denormalized evaluator name", () => {
    expect(
      formatRoundName({ evaluatorName: "Mike", date: "2026-05-01" } as any),
    ).toBe("Mike · 2026-05-01");
  });
  it("falls back to the legacy label, then a date-only label", () => {
    expect(formatRoundName({ label: "Preseason", date: "x" } as any)).toBe(
      "Preseason",
    );
    expect(formatRoundName({ date: "2026-05-01" } as any)).toBe(
      "Eval (2026-05-01)",
    );
    expect(formatRoundName(null)).toBe("");
  });
});

describe("fmtDelta", () => {
  it("signs and trims a one-decimal delta", () => {
    expect(fmtDelta(1.5)).toBe("+1.5");
    expect(fmtDelta(-0.75)).toBe("-0.8"); // toFixed(1) rounds
    expect(fmtDelta(2)).toBe("+2"); // trailing .0 stripped
    expect(fmtDelta(0)).toBe("+0");
  });
});

describe("pitcherPremium", () => {
  it("is zero for a non-pitcher", () => {
    const nonPitcher = {
      id: "p1",
      name: "Ava",
      comfortablePositions: ["2B"],
    } as unknown as Player;
    expect(pitcherPremium({} as any, nonPitcher)).toBe(0);
  });

  it("never subtracts — a pitcher's premium is >= 0", () => {
    const pitcher = {
      id: "p2",
      name: "Ace",
      comfortablePositions: ["P"],
      stats: {},
    } as unknown as Player;
    expect(pitcherPremium({} as any, pitcher)).toBeGreaterThanOrEqual(0);
  });
});

describe("computeFlags", () => {
  const cats = EVAL_CATEGORIES.filter((c) => !c.addOn);
  const players = [
    { id: "p1", name: "Riser" },
    { id: "p2", name: "Faller" },
  ] as unknown as Player[];
  const roundOf = (date: string, p1: number, p2: number): any => ({
    id: `r-${date}`,
    date,
    grades: {
      p1: Object.fromEntries(cats.map((c) => [c.id, p1])),
      p2: Object.fromEntries(cats.map((c) => [c.id, p2])),
    },
  });

  it("returns empty flags with fewer than two rounds", () => {
    expect(computeFlags([roundOf("2026-05-01", 3, 3)], players, cats)).toEqual({
      standouts: [],
      regressions: [],
      categoryDrops: [],
    });
  });

  it("flags a standout riser and a regressing faller round-over-round", () => {
    // rounds[0] is latest, rounds[1] previous (caller sorts newest-first).
    const flags = computeFlags(
      [roundOf("2026-06-01", 5, 2), roundOf("2026-05-01", 3, 4)],
      players,
      cats,
    );
    expect(flags.standouts.map((s) => s.player.id)).toContain("p1"); // +2
    expect(flags.regressions.map((r) => r.player.id)).toContain("p2"); // -2
    // p2 dropped >=2 in every category → category drops recorded (capped at 5).
    expect(flags.categoryDrops.length).toBeGreaterThan(0);
    expect(flags.categoryDrops.length).toBeLessThanOrEqual(5);
  });
});
