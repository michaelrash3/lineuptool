import {
  normalizeOpponentName,
  seasonOpponentRecord,
  buildOpponentSeasonAggregates,
  appendOpponentArchive,
  combinedOpponentRecord,
  formatRecord,
  OPPONENT_ARCHIVE_MAX,
} from "./opponentHistory";
import type { OpponentSeasonRecord } from "../types";

const finalGame = (over: any = {}) => ({
  id: over.id || "g",
  date: "2026-06-05",
  opponent: "Cubs",
  status: "final",
  teamScore: 5,
  opponentScore: 3,
  ...over,
});

describe("normalizeOpponentName", () => {
  it("trims, collapses whitespace, and lowercases — but never fuzzy-matches", () => {
    expect(normalizeOpponentName("  Chicago   Cubs ")).toBe("chicago cubs");
    expect(normalizeOpponentName("CUBS")).toBe("cubs");
    expect(normalizeOpponentName(null)).toBe("");
    // Different words stay different teams.
    expect(normalizeOpponentName("Cubs")).not.toBe(
      normalizeOpponentName("Chicago Cubs"),
    );
  });
});

describe("seasonOpponentRecord", () => {
  it("tallies wins/losses/ties and runs across name-matched finalized games", () => {
    const games = [
      finalGame({ id: "g1", teamScore: 5, opponentScore: 3 }),
      finalGame({
        id: "g2",
        opponent: " cubs ",
        teamScore: 2,
        opponentScore: 7,
      }),
      finalGame({ id: "g3", opponent: "CUBS", teamScore: 4, opponentScore: 4 }),
      finalGame({
        id: "g4",
        opponent: "Rays",
        teamScore: 10,
        opponentScore: 0,
      }),
    ];
    const rec = seasonOpponentRecord(games, "Cubs");
    expect(rec).toEqual({
      games: 3,
      wins: 1,
      losses: 1,
      ties: 1,
      runsFor: 11,
      runsAgainst: 14,
    });
  });

  it("skips scrimmages and unfinalized games", () => {
    const games = [
      finalGame({ id: "g1" }),
      finalGame({ id: "g2", isScrimmage: true }),
      { id: "g3", date: "2026-06-07", opponent: "Cubs" }, // not finalized
    ];
    expect(seasonOpponentRecord(games, "Cubs").games).toBe(1);
  });

  it("returns an empty record for a blank name or no games", () => {
    expect(seasonOpponentRecord([finalGame()], "").games).toBe(0);
    expect(seasonOpponentRecord(null, "Cubs").games).toBe(0);
  });
});

describe("buildOpponentSeasonAggregates", () => {
  it("groups per opponent under the first-seen display name, sorted by name", () => {
    const games = [
      finalGame({ id: "g1", opponent: "Rays", teamScore: 3, opponentScore: 1 }),
      finalGame({
        id: "g2",
        opponent: "  Cubs ",
        teamScore: 5,
        opponentScore: 3,
      }),
      finalGame({ id: "g3", opponent: "cubs", teamScore: 1, opponentScore: 9 }),
    ];
    const out = buildOpponentSeasonAggregates(games, "Spring 2026");
    expect(out).toHaveLength(2);
    // Sorted alphabetically; display name is trimmed first-seen spelling.
    expect(out[0]).toEqual({
      season: "Spring 2026",
      opponent: "Cubs",
      wins: 1,
      losses: 1,
      ties: 0,
      runsFor: 6,
      runsAgainst: 12,
    });
    expect(out[1].opponent).toBe("Rays");
    expect(out[1].wins).toBe(1);
  });

  it("skips scrimmages, unfinalized games, and blank opponent names", () => {
    const games = [
      finalGame({ id: "g1", isScrimmage: true }),
      finalGame({ id: "g2", opponent: "   " }),
      { id: "g3", opponent: "Cubs" },
    ];
    expect(buildOpponentSeasonAggregates(games, "Spring 2026")).toEqual([]);
  });
});

describe("appendOpponentArchive", () => {
  const entry = (season: string, opponent = "Cubs"): OpponentSeasonRecord => ({
    season,
    opponent,
    wins: 1,
    losses: 0,
    ties: 0,
    runsFor: 5,
    runsAgainst: 3,
  });

  it("appends newest-last and tolerates a missing archive", () => {
    const out = appendOpponentArchive(undefined, [entry("Spring 2026")]);
    expect(out).toHaveLength(1);
    const out2 = appendOpponentArchive(out, [entry("Fall 2026")]);
    expect(out2.map((e) => e.season)).toEqual(["Spring 2026", "Fall 2026"]);
  });

  it("drops the OLDEST entries past the bound", () => {
    const old = Array.from({ length: OPPONENT_ARCHIVE_MAX }, (_, i) =>
      entry("Old", `Team ${i}`),
    );
    const out = appendOpponentArchive(old, [entry("New")]);
    expect(out).toHaveLength(OPPONENT_ARCHIVE_MAX);
    expect(out[out.length - 1].season).toBe("New");
    expect(out[0].opponent).toBe("Team 1"); // Team 0 fell off
  });
});

describe("combinedOpponentRecord", () => {
  const archive: OpponentSeasonRecord[] = [
    {
      season: "Spring 2025",
      opponent: "Cubs",
      wins: 2,
      losses: 1,
      ties: 0,
      runsFor: 18,
      runsAgainst: 12,
    },
    {
      season: "Fall 2025",
      opponent: "cubs", // spelling drifted between seasons — still them
      wins: 0,
      losses: 2,
      ties: 1,
      runsFor: 7,
      runsAgainst: 15,
    },
    {
      season: "Spring 2025",
      opponent: "Rays",
      wins: 1,
      losses: 0,
      ties: 0,
      runsFor: 9,
      runsAgainst: 2,
    },
  ];

  it("merges name-matched archive seasons with the current season's games", () => {
    const games = [finalGame({ teamScore: 6, opponentScore: 2 })];
    const rec = combinedOpponentRecord(games, archive, "CUBS");
    expect(rec.current.wins).toBe(1);
    expect(rec.past).toEqual({
      games: 6,
      wins: 2,
      losses: 3,
      ties: 1,
      runsFor: 25,
      runsAgainst: 27,
    });
    expect(rec.pastSeasons).toEqual(["Spring 2025", "Fall 2025"]);
  });

  it("returns zeroed history for a first-ever meeting", () => {
    const rec = combinedOpponentRecord([], archive, "Sharks");
    expect(rec.current.games).toBe(0);
    expect(rec.past.games).toBe(0);
    expect(rec.pastSeasons).toEqual([]);
  });
});

describe("formatRecord", () => {
  it("shows ties only when present", () => {
    expect(
      formatRecord({
        games: 3,
        wins: 2,
        losses: 1,
        ties: 0,
        runsFor: 0,
        runsAgainst: 0,
      }),
    ).toBe("2-1");
    expect(
      formatRecord({
        games: 4,
        wins: 2,
        losses: 1,
        ties: 1,
        runsFor: 0,
        runsAgainst: 0,
      }),
    ).toBe("2-1-1");
  });
});
