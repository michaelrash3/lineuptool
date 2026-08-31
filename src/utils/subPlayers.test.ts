import { describe, it, expect } from "vitest";
import {
  isSubPlayer,
  isRosterPlayer,
  rosterOnly,
  subTournamentIds,
  subsForTournament,
  subGameIds,
  subGames,
  playsGame,
  playersForGame,
  tournamentForGame,
  subTournamentLabel,
} from "./subPlayers";
import type { Game, Player, Tournament } from "../types";

const p = (over: Partial<Player>): Player =>
  ({ id: "p1", name: "Kid", ...over }) as Player;

const TOURNEYS: Tournament[] = [
  { id: "t1", name: "Labor Day Classic", gameIds: ["g1", "g2"] },
  { id: "t2", name: "Fall Brawl", gameIds: ["g3"] },
];

describe("isSubPlayer / isRosterPlayer", () => {
  it("only flags players explicitly marked isSub", () => {
    expect(isSubPlayer(p({ isSub: true }))).toBe(true);
    expect(isSubPlayer(p({}))).toBe(false);
    // Truthy-but-not-true must not count — the flag is written as a boolean.
    expect(isSubPlayer(p({ isSub: 1 as unknown as boolean }))).toBe(false);
    expect(isSubPlayer(null)).toBe(false);
  });

  it("treats subs and departed players alike as off the roster", () => {
    expect(isRosterPlayer(p({}))).toBe(true);
    expect(isRosterPlayer(p({ isSub: true }))).toBe(false);
    expect(isRosterPlayer(p({ rosterStatus: "departed" }))).toBe(false);
    expect(isRosterPlayer(null)).toBe(false);
  });

  it("rosterOnly drops subs and keeps everyone else in order", () => {
    const list = [
      p({ id: "a" }),
      p({ id: "b", isSub: true }),
      p({ id: "c", rosterStatus: "departed" }),
    ];
    expect(rosterOnly(list).map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("subTournamentIds", () => {
  it("returns the attached ids and ignores malformed entries", () => {
    expect(
      subTournamentIds(
        p({ subTournamentIds: ["t1", "", null, 7, "t2"] as never }),
      ),
    ).toEqual(["t1", "t2"]);
    expect(subTournamentIds(p({}))).toEqual([]);
  });
});

describe("subsForTournament", () => {
  const players = [
    p({ id: "roster" }),
    p({ id: "s1", isSub: true, subTournamentIds: ["t1"] }),
    p({ id: "s2", isSub: true, subTournamentIds: ["t2"] }),
    p({ id: "s3", isSub: true, subTournamentIds: ["t1", "t2"] }),
  ];

  it("returns only the subs attached to that tournament", () => {
    expect(subsForTournament(players, "t1").map((x) => x.id)).toEqual([
      "s1",
      "s3",
    ]);
    expect(subsForTournament(players, "t2").map((x) => x.id)).toEqual([
      "s2",
      "s3",
    ]);
  });

  it("returns nothing without a tournament id", () => {
    expect(subsForTournament(players, null)).toEqual([]);
  });
});

describe("subGameIds / playsGame", () => {
  const sub = p({ id: "s1", isSub: true, subTournamentIds: ["t1"] });

  it("resolves a sub's games through their tournaments", () => {
    expect([...subGameIds(sub, TOURNEYS)].sort()).toEqual(["g1", "g2"]);
  });

  it("unions the games of every attached tournament", () => {
    const both = p({ id: "s3", isSub: true, subTournamentIds: ["t1", "t2"] });
    expect([...subGameIds(both, TOURNEYS)].sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("strands a sub whose tournament no longer exists", () => {
    const orphan = p({ id: "s9", isSub: true, subTournamentIds: ["gone"] });
    expect(subGameIds(orphan, TOURNEYS).size).toBe(0);
    expect(playsGame(orphan, "g1", TOURNEYS)).toBe(false);
  });

  it("lets a sub into their own tournament's games and no others", () => {
    expect(playsGame(sub, "g1", TOURNEYS)).toBe(true);
    expect(playsGame(sub, "g2", TOURNEYS)).toBe(true);
    expect(playsGame(sub, "g3", TOURNEYS)).toBe(false);
    expect(playsGame(sub, "unlinked", TOURNEYS)).toBe(false);
    expect(playsGame(sub, null, TOURNEYS)).toBe(false);
  });

  it("never gates a roster player", () => {
    const kid = p({ id: "r1" });
    expect(playsGame(kid, "g3", TOURNEYS)).toBe(true);
    expect(playsGame(kid, "anything", [])).toBe(true);
    // Even with no game in hand: roster availability is decided by
    // attendance and absences, not by this gate.
    expect(playsGame(kid, null, TOURNEYS)).toBe(true);
  });
});

describe("playersForGame", () => {
  const players = [
    p({ id: "r1" }),
    p({ id: "r2", rosterStatus: "departed" }),
    p({ id: "s1", isSub: true, subTournamentIds: ["t1"] }),
    p({ id: "s2", isSub: true, subTournamentIds: ["t2"] }),
  ];

  it("adds only the subs eligible for that game", () => {
    expect(playersForGame(players, "g1", TOURNEYS).map((x) => x.id)).toEqual([
      "r1",
      "r2",
      "s1",
    ]);
    expect(playersForGame(players, "g3", TOURNEYS).map((x) => x.id)).toEqual([
      "r1",
      "r2",
      "s2",
    ]);
  });

  it("drops every sub for a game in no tournament", () => {
    expect(playersForGame(players, "loose", TOURNEYS).map((x) => x.id)).toEqual(
      ["r1", "r2"],
    );
  });
});

describe("tournamentForGame", () => {
  it("finds the tournament owning a game", () => {
    expect(tournamentForGame(TOURNEYS, "g2")?.id).toBe("t1");
    expect(tournamentForGame(TOURNEYS, "g3")?.id).toBe("t2");
    expect(tournamentForGame(TOURNEYS, "nope")).toBeUndefined();
    expect(tournamentForGame(TOURNEYS, null)).toBeUndefined();
  });
});

describe("subTournamentLabel", () => {
  it("names every tournament the sub is attached to", () => {
    expect(
      subTournamentLabel(
        p({ isSub: true, subTournamentIds: ["t1", "t2"] }),
        TOURNEYS,
      ),
    ).toBe("Labor Day Classic, Fall Brawl");
  });

  it("reads as unattached once the tournaments are gone", () => {
    expect(
      subTournamentLabel(
        p({ isSub: true, subTournamentIds: ["gone"] }),
        TOURNEYS,
      ),
    ).toBe("No tournament");
  });
});

describe("subGames", () => {
  const games = [
    { id: "g2", date: "2026-09-06" },
    { id: "g1", date: "2026-09-05" },
    { id: "g3", date: "2026-10-11" },
  ] as Game[];

  it("returns the sub's games in date order", () => {
    const sub = p({ isSub: true, subTournamentIds: ["t1"] });
    expect(subGames(sub, games, TOURNEYS).map((g) => g.id)).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("returns nothing for a roster player", () => {
    expect(subGames(p({}), games, TOURNEYS)).toEqual([]);
  });
});
