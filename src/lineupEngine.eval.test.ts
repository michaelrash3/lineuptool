import { describe, it, expect } from "vitest";
import {
  calculateTotalScore,
  suggestPrimaryPosition,
  getCombinedGrades,
} from "./lineupEngine";

// A neutral baseline grade object (all 3s) in the new merged v7 model.
const base = {
  contact: 3,
  power: 3,
  approach: 3,
  fielding: 3,
  arm: 3,
  speedBaserunning: 3,
  baseballIQ: 3,
  coachability: 3,
};

describe("calculateTotalScore — v7 eval model", () => {
  it("reads the merged Fielding/Arm grades (not just the old fine-grained ids)", () => {
    const lowFielding = calculateTotalScore({ ...base, fielding: 1, arm: 1 });
    const highFielding = calculateTotalScore({ ...base, fielding: 5, arm: 5 });
    expect(highFielding).toBeGreaterThan(lowFielding);
  });

  it("treats merged Fielding the same as equivalent old Glove+Range", () => {
    const merged = calculateTotalScore({ ...base, fielding: 5 });
    const fineGrained = calculateTotalScore({ ...base, glove: 5, range: 5 });
    expect(merged).toBe(fineGrained);
  });

  it("weights Coachability heavily — it moves the total noticeably", () => {
    const low = calculateTotalScore({ ...base, coachability: 1 });
    const high = calculateTotalScore({ ...base, coachability: 5 });
    // 4-point swing × weight 3.0, normalized — should be a clear gap.
    expect(high - low).toBeGreaterThanOrEqual(10);
  });

  it("still produces a 0–100 score", () => {
    const s = calculateTotalScore(base);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("suggestPrimaryPosition — eval-derived primary", () => {
  it("suggests a premium infield spot for a strong arm + glove + range kid", () => {
    const grades = { ...base, glove: 5, range: 5, armStrength: 5, armAccuracy: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["1B", "SS", "RF"] },
      grades
    );
    expect(s?.position).toBe("SS");
  });

  it("only considers the player's comfortable positions", () => {
    const grades = { ...base, glove: 5, range: 5, armStrength: 5 };
    const s = suggestPrimaryPosition({ comfortablePositions: ["RF"] }, grades);
    expect(s?.position).toBe("RF");
  });

  it("suggests catcher when the catching grades stand out", () => {
    const grades = {
      ...base,
      receiving: 5,
      blocking: 5,
      throwing: 5,
    };
    const s = suggestPrimaryPosition({ comfortablePositions: ["C", "RF"] }, grades);
    expect(s?.position).toBe("C");
  });

  it("never suggests a ceremonial pitcher for non-Kid-Pitch teams", () => {
    const grades = { ...base, velocity: 5, strikes: 5, composure: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["P", "RF"] },
      grades,
      { kidPitch: false }
    );
    expect(s?.position).not.toBe("P");
  });

  it("can suggest pitcher for Kid-Pitch teams with strong pitching grades", () => {
    const grades = { ...base, velocity: 5, strikes: 5, offSpeed: 5, composure: 5 };
    const s = suggestPrimaryPosition(
      { comfortablePositions: ["P", "RF"] },
      grades,
      { kidPitch: true }
    );
    expect(s?.position).toBe("P");
  });

  it("falls back to the field spots when no comfort list is set", () => {
    const grades = { ...base, range: 5, baserunning: 5 };
    const s = suggestPrimaryPosition({}, grades);
    expect(s?.position).toBe("CF");
  });

  it("marks all-neutral field fits for review instead of defaulting to first base", () => {
    const s = suggestPrimaryPosition({}, base);
    expect(s?.position).toBeNull();
    expect(s?.reason).toBe("not-enough-position-signal");
    expect(s?.alternatives.length).toBeGreaterThan(0);
  });

  it("does not blindly pick first base when neutral comfortable positions are tied", () => {
    const s = suggestPrimaryPosition({ comfortablePositions: ["1B", "2B", "3B"] }, base);
    expect(s?.position).toBeNull();
    expect(s?.confidence).toBeLessThan(0.25);
  });

  it("can prefer first base when the profile has a real first-base signal", () => {
    const grades = { ...base, glove: 5, armAccuracy: 5, baseballIQ: 5, range: 2, armStrength: 2 };
    const s = suggestPrimaryPosition({ comfortablePositions: ["1B", "2B", "3B"] }, grades);
    expect(s?.position).toBe("1B");
  });

  it("uses arm strength to separate right field from left field", () => {
    const grades = { ...base, glove: 4, range: 4, armStrength: 5, armAccuracy: 4 };
    const s = suggestPrimaryPosition({ comfortablePositions: ["LF", "RF"] }, grades);
    expect(s?.position).toBe("RF");
  });

  it("returns null for a missing player", () => {
    expect(suggestPrimaryPosition(null, base)).toBeNull();
  });
});

describe("Speed / Base Running split (v8)", () => {
  const round = (grades: any) => [
    { id: "e", date: "2026-01-01", coachRole: "Head", grades },
  ];
  const roster = [{ id: "p1", name: "Runner" }] as any;

  it("seeds BOTH speed and baserunning from a legacy merged grade", () => {
    const merged = getCombinedGrades(
      round({ p1: { speedBaserunning: 5 } }) as any,
      roster
    );
    expect(merged.p1.speed).toBe(5);
    expect(merged.p1.baserunning).toBe(5);
  });

  it("carries separate speed and baserunning grades through unchanged", () => {
    const merged = getCombinedGrades(
      round({ p1: { speed: 5, baserunning: 1 } }) as any,
      roster
    );
    expect(merged.p1.speed).toBe(5);
    expect(merged.p1.baserunning).toBe(1);
  });

  it("total score reflects both speed and base running", () => {
    const low = calculateTotalScore({ ...base, speed: 1, baserunning: 1 });
    const high = calculateTotalScore({ ...base, speed: 5, baserunning: 5 });
    const mixed = calculateTotalScore({ ...base, speed: 5, baserunning: 1 });
    expect(high).toBeGreaterThan(low);
    expect(mixed).toBeGreaterThan(low);
    expect(mixed).toBeLessThan(high);
  });
});

describe("advanced stats carry more weight (D)", () => {
  it("quality-of-contact rates move the offensive score more than the slash line", async () => {
    const { getOffensiveScore } = await import("./lineupEngine");
    const slashOnly = getOffensiveScore({ ops: 0.7, avg: 0.25, obp: 0.35 });
    const withAdvanced = getOffensiveScore({
      ops: 0.7,
      avg: 0.25,
      obp: 0.35,
      qab: 0.6,
      hard: 0.35,
    });
    // Same slash line + strong advanced profile must clearly outscore.
    expect(withAdvanced).toBeGreaterThan(slashOnly + 1);
  });

  it("a full stat sample grades the pitching slots outright (v9)", async () => {
    const { calcPitcherScore } = await import("./lineupEngine");
    // Stats ARE the grade now: elite control + bats-missed rates with a full
    // sample land Strikes/Off-Speed at 5 — well above the scale midpoint.
    const statGraded = calcPitcherScore(
      {},
      { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0, pSwingMiss: 0.25, pBf: 30 }
    );
    expect(statGraded).toBeGreaterThan(16.25);
    // 30 BF is already a full sample (was 40).
    const at40 = calcPitcherScore(
      {},
      { pStrikePct: 0.65, pWhip: 1.0, pKbb: 3.0, pSwingMiss: 0.25, pBf: 40 }
    );
    expect(statGraded).toBeCloseTo(at40);
  });

  it("bat-missing/weak-contact rates outweigh ERA in pitcher stat quality", async () => {
    const { calcPitcherStatsQuality } = await import("./lineupEngine");
    // Elite advanced rates + bad ERA should grade ABOVE the midpoint —
    // the advanced rates describe what the pitcher controls; ERA is noisy.
    const q = calcPitcherStatsQuality({
      pSwingMiss: 0.25,
      pWeak: 0.45,
      pHardPct: 0.15,
      pEra: 8.0,
    });
    expect(q).toBeGreaterThan(0.6);
  });
});

// ---------- v9: stat-derived grades for tangible skills ----------
describe("stat-derived tangible grades (v9)", () => {
  it("statContactGrade ramps with sample size and never penalizes missing data", async () => {
    const { statContactGrade } = await import("./lineupEngine");
    expect(statContactGrade(null)).toBeNull();
    expect(statContactGrade({})).toBeNull();
    // Elite line + full sample -> top grade.
    expect(
      statContactGrade({ avg: 0.45, qab: 0.6, ld: 0.3, ab: 30 })
    ).toBeCloseTo(5);
    // Same line with a tiny sample stays near neutral.
    const tiny = statContactGrade({ avg: 0.45, qab: 0.6, ld: 0.3, ab: 3 });
    expect(tiny).toBeGreaterThan(3);
    expect(tiny).toBeLessThan(4);
    // Rates with no AB count -> no confidence -> null (neutral downstream).
    expect(statContactGrade({ avg: 0.45 })).toBeNull();
  });

  it("statPowerGrade reads SLG (OPS−OBP), XBH rate, and Hard%", async () => {
    const { statPowerGrade } = await import("./lineupEngine");
    const big = statPowerGrade({
      ops: 1.1,
      obp: 0.4,
      doubles: 4,
      triples: 1,
      hr: 1,
      ab: 30,
    });
    expect(big).toBeGreaterThan(4);
    const weak = statPowerGrade({ ops: 0.55, obp: 0.3, ab: 30 });
    expect(weak).toBeLessThan(2);
  });

  it("statFieldingGrade grades FPCT with a chances-based confidence ramp", async () => {
    const { statFieldingGrade } = await import("./lineupEngine");
    expect(statFieldingGrade({})).toBeNull();
    expect(statFieldingGrade({ fFpct: 0.98, fTc: 24 })).toBeCloseTo(5);
    expect(statFieldingGrade({ fFpct: 0.8, fTc: 24 })).toBeCloseTo(1);
    // FPCT with no chance count counts at half confidence.
    expect(statFieldingGrade({ fFpct: 0.98 })).toBeCloseTo(4);
  });

  it("statArmGrade: velocity reading first, catcher CS% next, neutral otherwise", async () => {
    const { statArmGrade } = await import("./lineupEngine");
    expect(statArmGrade({})).toBeNull(); // infield arm isn't in youth stats
    expect(
      statArmGrade({}, { topMph: 58, teamAge: "10U" })
    ).toBeCloseTo(5);
    expect(statArmGrade({ fCsPct: 0.55, fSbAtt: 12 })).toBeCloseTo(5);
  });

  it("statBlockingGrade needs a games-caught denominator", async () => {
    const { statBlockingGrade, countGamesCaught } = await import("./lineupEngine");
    expect(statBlockingGrade({ fPb: 6 })).toBeNull(); // no denominator
    // 6 PB over 6 games caught = 1.0/game — middling.
    const mid = statBlockingGrade({ fPb: 6 }, 6);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(4);
    // 1 PB over 6 games — strong.
    expect(statBlockingGrade({ fPb: 1 }, 6)).toBeGreaterThan(4);
    const games: Array<{ playerStats?: Record<string, any> }> = [
      { playerStats: { c1: { fPb: 1, fSbAtt: 2 } } },
      { playerStats: { c1: { fSbAtt: 1 }, c2: { ab: 3 } } },
      { playerStats: { c2: { fPb: 0 } } },
    ];
    expect(countGamesCaught(games, "c1")).toBe(2);
    expect(countGamesCaught(games, "c2")).toBe(1);
    expect(countGamesCaught(games, "nobody")).toBe(0);
  });

  it("getCombinedGrades overlays stat grades for tangibles and keeps coach intangibles", async () => {
    const { getCombinedGrades } = await import("./lineupEngine");
    const players: any[] = [
      {
        id: "p1",
        name: "Slugger",
        stats: {
          avg: 0.45,
          qab: 0.6,
          ld: 0.3,
          ab: 30,
          fFpct: 0.98,
          fTc: 24,
          pStrikePct: 0.65,
          pWhip: 1.0,
          pBf: 40,
        },
      },
      { id: "p2", name: "NoStats" },
    ];
    const events: any[] = [
      {
        id: "e1",
        date: "2026-04-01",
        coachRole: "Head",
        grades: {
          p1: { approach: 5, coachability: 2, composure: 4 },
          p2: { approach: 1 },
        },
      },
    ];
    const combined = getCombinedGrades(events, players, { teamAge: "10U" });
    // Coach-graded intangibles carry through (incl. the universal Composure).
    expect(combined.p1.approach).toBe(5);
    expect(combined.p1.coachability).toBe(2);
    expect(combined.p1.composure).toBe(4);
    // Tangibles are stat-graded — written to BOTH the merged ids and the
    // fine-grained engine reader ids.
    expect(combined.p1.contact).toBeCloseTo(5);
    expect(combined.p1.fielding).toBeCloseTo(5);
    expect(combined.p1.glove).toBeCloseTo(5);
    expect(combined.p1.range).toBeCloseTo(5);
    expect(combined.p1.strikes).toBeCloseTo(5);
    // No stats -> tangibles stay absent (downstream readers default to 3).
    expect(combined.p2.approach).toBe(1);
    expect(combined.p2.contact).toBeUndefined();
    expect(combined.p2.glove).toBeUndefined();
  });

  it("coach grades for dropped tangible categories no longer flow through", async () => {
    const { getCombinedGrades } = await import("./lineupEngine");
    const players: any[] = [{ id: "p1", name: "Kid" }];
    const events: any[] = [
      {
        id: "e1",
        date: "2026-04-01",
        coachRole: "Head",
        // A pre-v9 round still carrying tangible coach grades.
        grades: { p1: { contact: 5, fielding: 5, strikes: 5, approach: 4 } },
      },
    ];
    const combined = getCombinedGrades(events, players);
    expect(combined.p1.approach).toBe(4); // kept intangible
    expect(combined.p1.contact).toBeUndefined(); // stats-only now
    expect(combined.p1.fielding).toBeUndefined();
    expect(combined.p1.strikes).toBeUndefined();
  });

  it("carries coach-entered Pitch Velocity (mph) and grades it age-relative", async () => {
    const { getCombinedGrades, calcPitcherScore } = await import(
      "./lineupEngine"
    );
    const players: any[] = [{ id: "p1", name: "Ace", comfortablePositions: ["P"] }];
    const events: any[] = [
      {
        id: "e1",
        date: "2026-04-01",
        coachRole: "Head",
        grades: { p1: { strikes: 1, pitchVelo: 58 } },
      },
    ];
    const combined = getCombinedGrades(events, players, { teamAge: "10U" });
    // The raw mph is preserved, and overlaid as an age-relative velocity grade
    // (58 mph at 10U is elite → 5).
    expect(combined.p1.pitchVelo).toBe(58);
    expect(combined.p1.velocity).toBe(5);
    // …and it lifts the pitcher score versus the same pitcher with no reading.
    const withVelo = calcPitcherScore(combined.p1, null, { teamAge: "10U" });
    const noVelo = calcPitcherScore({ strikes: 1 }, null, { teamAge: "10U" });
    expect(withVelo).toBeGreaterThan(noVelo);
  });

  it("uses the chart-based 8U 30-50 mph velocity scoring band", async () => {
    const { getCombinedGrades } = await import("./lineupEngine");
    const players: any[] = [{ id: "p1", name: "Ace", comfortablePositions: ["P"] }];
    const low = getCombinedGrades(
      [{ id: "e1", date: "2026-04-01", coachRole: "Head", grades: { p1: { pitchVelo: 30 } } }],
      players,
      { teamAge: "8U" }
    );
    const high = getCombinedGrades(
      [{ id: "e2", date: "2026-04-02", coachRole: "Head", grades: { p1: { pitchVelo: 40 } } }],
      players,
      { teamAge: "8U" }
    );

    expect(low.p1.velocity).toBe(1);
    expect(high.p1.velocity).toBe(3);
  });

  it("ignores a blank Pitch Velocity (optional — no penalty)", async () => {
    const { getCombinedGrades } = await import("./lineupEngine");
    const players: any[] = [{ id: "p1", name: "Ace", comfortablePositions: ["P"] }];
    const events: any[] = [
      {
        id: "e1",
        date: "2026-04-01",
        coachRole: "Head",
        grades: { p1: { strikes: 1 } }, // no pitchVelo
      },
    ];
    const combined = getCombinedGrades(events, players, { teamAge: "10U" });
    expect(combined.p1.pitchVelo).toBeUndefined();
    expect(combined.p1.velocity).toBeUndefined(); // no reading → no overlay
  });

  it("calculateTotalScore lifts a kid with an elite imported stat line over a statless one", () => {
    const grades = { approach: 3, speed: 3, baserunning: 3, baseballIQ: 3, coachability: 3 };
    const noStats = calculateTotalScore(grades, {});
    const elite = calculateTotalScore(grades, {
      avg: 0.45,
      qab: 0.6,
      ld: 0.3,
      ops: 1.1,
      obp: 0.4,
      ab: 30,
      fFpct: 0.98,
      fTc: 24,
    });
    expect(elite).toBeGreaterThan(noStats);
  });
});
