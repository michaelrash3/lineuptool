import { describe, it, expect } from "vitest";
import { buildCompetitiveLineup } from "./lineupEngine";

// Eligible at every position (incl. C and P) so the test exercises the bench
// distribution, not eligibility. Grades give a clean strength gradient:
// p0 is weakest, p10 strongest.
const ALL_POS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

function mkPlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    number: String(i),
    comfortablePositions: ALL_POS,
    stats: {},
    pitching: { recentPitches: 0, lastPitchDate: null },
  }));
}

function headEvalGradient(n: number) {
  const grades: Record<string, any> = {};
  for (let i = 0; i < n; i++) {
    const v = 1 + i; // p0 = 1 (weakest) ... rising
    grades[`p${i}`] = {
      fielding: v,
      arm: v,
      baseballIQ: v,
      speedBaserunning: v,
      contact: v,
      power: v,
      approach: v,
      coachability: 3,
    };
  }
  return { id: "e1", coachRole: "Head", date: "2026-05-01", grades };
}

const baseInput = (over: any = {}) => ({
  activePlayers: mkPlayers(11),
  allPlayers: mkPlayers(11),
  evaluationEvents: [headEvalGradient(11)],
  defenseSize: "9",
  totalInnings: 6,
  seed: 1,
  currentGame: { id: "g", date: "2026-05-15", opponent: "X" },
  ...over,
});

const benchCount = (lineup: any[] | undefined, id: string) =>
  (lineup || []).filter((inn) => (inn.BENCH || []).some((b: any) => b?.id === id))
    .length;

describe("buildCompetitiveLineup — minimum-play floor", () => {
  const res = buildCompetitiveLineup(baseInput());

  it("builds without error", () => {
    expect(res.error).toBeUndefined();
    expect(res.lineup).toHaveLength(6);
  });

  it("guarantees a floor — nobody sits more than half the innings", () => {
    // 6 innings -> cap is floor(6/2) = 3 sits, i.e. everyone plays >= 3.
    for (let i = 0; i < 11; i++) {
      expect(benchCount(res.lineup, `p${i}`)).toBeLessThanOrEqual(3);
    }
  });

  it("plays the strongest every inning and benches the weakest the most", () => {
    // 11 present, 9 field -> 2 bench/inning x 6 = 12 slots, cap 3 -> the 4
    // weakest sit 3 each; the rest never sit.
    expect(benchCount(res.lineup, "p10")).toBe(0); // strongest
    expect(benchCount(res.lineup, "p9")).toBe(0);
    expect(benchCount(res.lineup, "p0")).toBe(3); // weakest, at the cap
    expect(benchCount(res.lineup, "p0")).toBeGreaterThan(
      benchCount(res.lineup, "p10")
    );
  });

  it("ignores the seasonal ledger — a kid over-benched in past games gets no makeup", () => {
    // Past games where the weakest kid (p0) was heavily benched. In Rec this
    // would earn them extra play; in Competitive it must NOT.
    const past = ["2026-04-01", "2026-04-08"].map((d, gi) => ({
      id: `past${gi}`,
      date: d,
      status: "final",
      teamScore: 5,
      opponentScore: 2,
      leagueRuleSet: "USSSA",
      lineup: Array.from({ length: 6 }, () => ({ BENCH: [{ id: "p0", name: "P0" }] })),
    }));
    const withHistory = buildCompetitiveLineup(baseInput({ games: past }));
    expect(withHistory.error).toBeUndefined();
    // Still benched at the cap purely on (weak) skill — history was ignored.
    expect(benchCount(withHistory.lineup, "p0")).toBe(3);
  });
});
