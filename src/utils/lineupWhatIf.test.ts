import { describe, it, expect } from "vitest";
import {
  computeFairness,
  summarizeScenario,
  buildRationale,
  diffScenarios,
  buildGameAttendance,
  type EngineLike,
} from "./lineupWhatIf";

const players = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
  { id: "d", name: "Di" },
];

// 2-inning lineup: Ann P→1B (variety 2), Bo catches both, Cy sits inning 2,
// Di sits inning 1.
const lineup = [
  {
    P: { id: "a", name: "Ann" },
    C: { id: "b", name: "Bo" },
    "1B": { id: "c", name: "Cy" },
    BENCH: [{ id: "d", name: "Di" }],
  },
  {
    P: { id: "d", name: "Di" },
    C: { id: "b", name: "Bo" },
    "1B": { id: "a", name: "Ann" },
    BENCH: [{ id: "c", name: "Cy" }],
  },
];

describe("computeFairness", () => {
  it("counts bench innings and distinct positions per player", () => {
    const f = computeFairness(lineup as any, players);
    const byId = Object.fromEntries(f.map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ benchInnings: 0, distinctPositions: 2 });
    expect(byId.a.positions).toEqual(["P", "1B"]);
    expect(byId.b).toMatchObject({ benchInnings: 0, distinctPositions: 1 });
    expect(byId.c.benchInnings).toBe(1);
    expect(byId.d.benchInnings).toBe(1);
    expect(byId.d.positions).toEqual(["P"]);
  });
});

describe("summarizeScenario", () => {
  it("summarizes a successful engine result", () => {
    const result: EngineLike = {
      lineup: lineup as any,
      qualityPenalty: 0,
      lockRelaxedInnings: [],
    };
    const s = summarizeScenario(result, players);
    expect(s.ok).toBe(true);
    expect(s.penalty).toBe(0);
    expect(s.totalInnings).toBe(2);
    expect(s.perPlayer).toHaveLength(4);
  });

  it("marks a failed result and carries the blocker", () => {
    const s = summarizeScenario({ error: "No catcher available." }, players);
    expect(s.ok).toBe(false);
    expect(s.error).toBe("No catcher available.");
    expect(s.perPlayer).toEqual([]);
  });
});

describe("buildRationale", () => {
  it("returns the blocker when the lineup failed", () => {
    const s = summarizeScenario({ error: "Need 1 more catcher." }, players);
    expect(buildRationale(s)).toEqual(["Need 1 more catcher."]);
  });

  it("explains fairness relaxation, lock relaxation, penalty, and bench spread", () => {
    const s = summarizeScenario(
      {
        lineup: lineup as any,
        qualityPenalty: 4,
        fairnessRelaxed: true,
        fairnessRelaxedReason: "not enough infielders to rotate",
        lockRelaxedInnings: [3, 4],
      },
      players,
    );
    const lines = buildRationale(s);
    expect(lines.some((l) => /Season fairness was relaxed/.test(l))).toBe(true);
    expect(lines.some((l) => /inning 3, 4/.test(l))).toBe(true);
    expect(lines.some((l) => /Fairness\/constraint cost: 4/.test(l))).toBe(
      true,
    );
    expect(lines.some((l) => /Most bench time/.test(l))).toBe(true);
  });

  it("celebrates a perfect (penalty 0) fit", () => {
    const s = summarizeScenario(
      { lineup: lineup as any, qualityPenalty: 0 },
      players,
    );
    expect(buildRationale(s).some((l) => /penalty 0/.test(l))).toBe(true);
  });
});

describe("buildGameAttendance", () => {
  it("marks toggled-out players absent and everyone else present", () => {
    const att = buildGameAttendance(players, new Set(["b", "d"]));
    expect(att).toEqual({ a: true, b: false, c: true, d: false });
  });

  it("marks all present when nobody is out", () => {
    const att = buildGameAttendance(players, new Set());
    expect(Object.values(att).every((v) => v === true)).toBe(true);
  });
});

describe("diffScenarios", () => {
  it("computes the fairness-cost delta and bench changes", () => {
    const a = summarizeScenario(
      { lineup: lineup as any, qualityPenalty: 2 },
      players,
    );
    // Scenario B: Di sits both innings instead of Cy inning 2.
    const lineupB = [
      lineup[0],
      {
        P: { id: "a", name: "Ann" },
        C: { id: "b", name: "Bo" },
        "1B": { id: "c", name: "Cy" },
        BENCH: [{ id: "d", name: "Di" }],
      },
    ];
    const b = summarizeScenario(
      { lineup: lineupB as any, qualityPenalty: 5 },
      players,
    );
    const diff = diffScenarios(a, b);
    expect(diff.penaltyDelta).toBe(3); // B is costlier (less fair)
    const di = diff.benchChanges.find((c) => c.id === "d");
    expect(di).toMatchObject({ from: 1, to: 2 });
    const cy = diff.benchChanges.find((c) => c.id === "c");
    expect(cy).toMatchObject({ from: 1, to: 0 });
  });
});
