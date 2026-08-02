import { describe, expect, it } from "vitest";
import {
  collectRosterEvidence,
  planRosterRebuild,
  rebuildPlayersFromEvidence,
} from "./rosterRebuild";
import type { Team } from "../types";

// A team shaped like the incident this module was written for: players wiped
// to [], every other trace of the season intact.
const wipedTeam = (): Partial<Team> =>
  ({
    players: [],
    games: [
      {
        id: "g-1",
        date: "2026-04-01",
        attendance: { "p-att1": true, "p-lineup1": true },
        playerStats: { "p-stats1": { ab: 3 } },
        lineup: [
          {
            P: { id: "p-lineup1", name: "Casey Alvarez", number: "12" },
            BENCH: [{ id: "p-bench1", name: "Riley Ng", number: "7" }],
          },
        ],
        battingLineup: [{ id: "p-bat1", name: "Jo Woods", number: "3" }],
      },
      { id: "g-2", lineup: null, battingLineup: null },
    ],
    practices: [
      { id: "pr-1", attendance: { "p-att1": "present", "p-prac1": "absent" } },
    ],
    depthChart: {
      SS: ["p-ss1", "p-lineup1"],
      P: ["p-lineup1"],
    },
    evaluationEvents: [{ grades: { "p-eval1": { hitting: 4 } } }],
    availabilitySubmissions: [
      {
        id: "av-1",
        submittedAt: "2026-03-01T00:00:00.000Z",
        firstName: "Sam",
        lastName: "Reyes",
        dob: "2016-05-04",
        dates: ["2026-04-10"],
        blocks: [{ date: "2026-04-11" }],
        appliedToPlayerId: "p-att1",
      },
      // Older submission for the same player — the newer one above must win
      // name/DOB, but dates union across both.
      {
        id: "av-0",
        submittedAt: "2026-02-01T00:00:00.000Z",
        firstName: "Sammy",
        lastName: "Reyes",
        dob: "2016-05-04",
        dates: ["2026-04-01"],
        appliedToPlayerId: "p-att1",
      },
      // Unapplied submission: no player id, contributes nothing.
      {
        id: "av-2",
        submittedAt: "2026-03-02T00:00:00.000Z",
        firstName: "Nobody",
        lastName: "Matched",
        dates: ["2026-04-12"],
      },
    ],
    playerInfoSubmissions: [
      {
        id: "pi-1",
        submittedAt: "2026-03-05T00:00:00.000Z",
        firstName: "Sam",
        lastName: "Reyes",
        number: "21",
        shirtSize: "YL",
        school: "Elm Street",
        parentName: "Dana Reyes",
        email: "dana@example.com",
        phone: "555-1234",
        emergencyName: "Lee Reyes",
        emergencyPhone: "555-9876",
        appliedToPlayerId: "p-att1",
      },
    ],
  }) as unknown as Partial<Team>;

describe("collectRosterEvidence", () => {
  it("collects every id the season references, across all sources", () => {
    const evidence = collectRosterEvidence(wipedTeam() as never);
    expect([...evidence.keys()].sort()).toEqual(
      [
        "p-att1",
        "p-bat1",
        "p-bench1",
        "p-eval1",
        "p-lineup1",
        "p-prac1",
        "p-ss1",
        "p-stats1",
      ].sort(),
    );
  });

  it("mines names + numbers from lineup slots, bench lists, and batting orders", () => {
    const evidence = collectRosterEvidence(wipedTeam() as never);
    expect(evidence.get("p-lineup1")).toMatchObject({
      name: "Casey Alvarez",
      number: "12",
    });
    expect(evidence.get("p-bench1")).toMatchObject({ name: "Riley Ng" });
    expect(evidence.get("p-bat1")).toMatchObject({ name: "Jo Woods" });
  });

  it("links applied availability submissions: latest name/DOB, dates unioned across all", () => {
    const e = collectRosterEvidence(wipedTeam() as never).get("p-att1")!;
    expect(e.name).toBe("Sam Reyes");
    expect(e.dob).toBe("2016-05-04");
    expect(e.availabilitySubmittedAt).toBe("2026-03-01T00:00:00.000Z");
    expect([...e.absenceDates].sort()).toEqual([
      "2026-04-01",
      "2026-04-10",
      "2026-04-11",
    ]);
  });

  it("records depth-chart positions per player in board order", () => {
    const evidence = collectRosterEvidence(wipedTeam() as never);
    expect(evidence.get("p-lineup1")!.depthPositions).toEqual(["SS", "P"]);
    expect(evidence.get("p-ss1")!.depthPositions).toEqual(["SS"]);
  });

  it("ignores unapplied submissions and null games/lineups", () => {
    const evidence = collectRosterEvidence(wipedTeam() as never);
    for (const e of evidence.values()) {
      expect(e.name).not.toBe("Nobody Matched");
    }
  });
});

describe("rebuildPlayersFromEvidence / planRosterRebuild", () => {
  it("rebuilds players under their ORIGINAL ids so season history reattaches", () => {
    const plan = planRosterRebuild(wipedTeam());
    const ids = plan.players.map((p) => p.id);
    expect(ids).toContain("p-att1");
    expect(ids).toContain("p-eval1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applies player-info fields with the applyPlayerInfoToPlayer mapping, including legacy emergency fallbacks", () => {
    const plan = planRosterRebuild(wipedTeam());
    const sam = plan.players.find((p) => p.id === "p-att1")!;
    expect(sam).toMatchObject({
      name: "Sam Reyes",
      number: "21",
      shirtSize: "YL",
      school: "Elm Street",
      parentName: "Dana Reyes",
      email: "dana@example.com",
      phone: "555-1234",
      parent2Name: "Lee Reyes",
      parent2Phone: "555-9876",
      dob: "2016-05-04",
      playerInfoSubmittedAt: "2026-03-05T00:00:00.000Z",
      availabilitySubmittedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(sam.absences).toEqual(["2026-04-01", "2026-04-10", "2026-04-11"]);
  });

  // P and C gate eval specialties (Pitching/Catching tabs), arm care, and
  // catcher policies app-wide — a rebuild that granted them to everyone would
  // put the whole roster on those surfaces. Field positions stay permissive.
  it("defaults field positions to permissive but P/C only on depth-chart evidence", () => {
    const plan = planRosterRebuild(wipedTeam());
    const fieldOnly = ["1B", "2B", "3B", "SS", "LF", "LCF", "CF", "RCF", "RF"];
    // p-lineup1 is listed under P on the depth chart → keeps pitcher.
    const pitcher = plan.players.find((p) => p.id === "p-lineup1")!;
    expect(pitcher.comfortablePositions).toEqual(["P", ...fieldOnly]);
    // Nobody has C depth-chart evidence; everyone else has neither specialty.
    for (const p of plan.players) {
      expect(p.comfortablePositions).not.toContain("C");
      if (p.id !== "p-lineup1") {
        expect(p.comfortablePositions).toEqual(fieldOnly);
      }
    }
  });

  it("names unidentifiable players 'Recovered player N' in display order, named players sorted first", () => {
    const plan = planRosterRebuild(wipedTeam());
    const names = plan.players.map((p) => p.name);
    const firstUnnamed = names.findIndex((n) =>
      n.startsWith("Recovered player "),
    );
    // Every name before the first placeholder is a real name in alpha order.
    const named = names.slice(0, firstUnnamed);
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b)));
    // Placeholders count up 1..N with no gaps.
    const placeholders = names.slice(firstUnnamed);
    expect(placeholders).toEqual(
      placeholders.map((_, i) => `Recovered player ${i + 1}`),
    );
    expect(plan.namedCount).toBe(named.length);
  });

  it("returns an empty plan when nothing references any player", () => {
    expect(planRosterRebuild({}).players).toEqual([]);
    expect(planRosterRebuild(null).players).toEqual([]);
    expect(rebuildPlayersFromEvidence(collectRosterEvidence({}))).toEqual([]);
  });
});
