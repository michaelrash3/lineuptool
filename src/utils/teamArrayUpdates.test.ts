import {
  applyTeamArrayUpdate,
  buildTeamArrayPayload,
  resolveTeamArrayUpdate,
  type ArrayFieldOps,
} from "./teamArrayUpdates";
import { scrubUndefined } from "./helpers";
import type { Game, Player } from "../types";

const basePlayers = (): Player[] => [
  { id: "p1", name: "Ava", number: "3" },
  { id: "p2", name: "Ben", number: "7" },
];

const baseTeam = () => ({
  name: "Hawks",
  players: basePlayers(),
  games: [{ id: "g1", date: "2026-04-01", opponent: "Cubs" }] as Game[],
});

// Tagged stub sentinels so payload assertions can check both which op was
// used and what it wrapped (same style as financeUpdates.test.ts).
const ops: ArrayFieldOps = {
  arrayUnion: (...v) => ({ __op: "arrayUnion", v }),
  arrayRemove: (v) => ({ __op: "arrayRemove", v }),
  scrub: (v) => v,
};

describe("applyTeamArrayUpdate", () => {
  it("appends to an existing array and leaves other keys untouched", () => {
    const team = baseTeam();
    const next = applyTeamArrayUpdate(team, {
      op: "append",
      key: "players",
      entries: [{ id: "p3", name: "Cai" }],
    });
    expect(next.players.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(next.games).toBe(team.games);
  });

  it("appends to an absent array", () => {
    const next = applyTeamArrayUpdate(
      { name: "Hawks" } as Record<string, unknown>,
      {
        op: "append",
        key: "practices",
        entries: [{ id: "pr1", date: "2026-04-02" }],
      },
    );
    expect(next.practices).toHaveLength(1);
  });

  it("removes by id", () => {
    const next = applyTeamArrayUpdate(baseTeam(), {
      op: "removeById",
      key: "players",
      id: "p1",
    });
    expect(next.players.map((p) => p.id)).toEqual(["p2"]);
  });

  it("mapEntries rewrites one array from the given items", () => {
    const next = applyTeamArrayUpdate(baseTeam(), {
      op: "mapEntries",
      key: "players",
      map: (items) => items.map((p) => ({ ...p, number: "0" })),
    });
    expect(next.players.every((p) => p.number === "0")).toBe(true);
  });

  it("optimistic state mirrors stored bytes: photoUrl stripped, undefined dropped", () => {
    const next = applyTeamArrayUpdate(baseTeam(), {
      op: "append",
      key: "players",
      entries: [
        { id: "p3", name: "Cai", photoUrl: "data:...", dob: undefined },
      ],
    });
    const added = next.players[2];
    expect("photoUrl" in added).toBe(false);
    expect("dob" in added).toBe(false);
  });
});

describe("buildTeamArrayPayload", () => {
  it("append → bare-key arrayUnion of the sanitized entries (single)", () => {
    const entry = { id: "p3", name: "Cai" };
    expect(
      buildTeamArrayPayload(
        baseTeam(),
        { op: "append", key: "players", entries: [entry] },
        ops,
      ),
    ).toEqual({ players: { __op: "arrayUnion", v: [entry] } });
  });

  it("append is variadic — a bulk import is ONE arrayUnion", () => {
    const entries = [
      { id: "g2", date: "2026-04-08", opponent: "Reds" },
      { id: "g3", date: "2026-04-15", opponent: "Mets" },
    ] as Game[];
    expect(
      buildTeamArrayPayload(
        baseTeam(),
        { op: "append", key: "games", entries },
        ops,
      ),
    ).toEqual({ games: { __op: "arrayUnion", v: entries } });
  });

  it("players append strips photoUrl before the sentinel", () => {
    const payload = buildTeamArrayPayload(
      baseTeam(),
      {
        op: "append",
        key: "players",
        entries: [{ id: "p3", name: "Cai", photoUrl: "data:..." }],
      },
      ops,
    );
    const sent = (payload?.players as { v: Player[] }).v[0];
    expect(sent).toEqual({ id: "p3", name: "Cai" });
  });

  it("games append/mapEntries output is slimmed (lineup players → id/name/number)", () => {
    const fatPlayer = {
      id: "p1",
      name: "Ava",
      number: "3",
      stats: { ab: 12 },
      comfortablePositions: ["P", "SS"],
    };
    const game = {
      id: "g2",
      date: "2026-04-08",
      battingLineup: [fatPlayer],
      lineup: [{ P: fatPlayer, BENCH: [fatPlayer] }],
    } as unknown as Game;
    const payload = buildTeamArrayPayload(
      baseTeam(),
      { op: "append", key: "games", entries: [game] },
      ops,
    );
    const sent = (payload?.games as { v: Game[] }).v[0];
    const slim = { id: "p1", name: "Ava", number: "3" };
    expect(sent.battingLineup?.[0]).toEqual(slim);
    expect(sent.lineup?.[0].P).toEqual(slim);
    expect(sent.lineup?.[0].BENCH?.[0]).toEqual(slim);
  });

  it("append entries are scrubbed of undefined values", () => {
    const payload = buildTeamArrayPayload(
      baseTeam(),
      {
        op: "append",
        key: "players",
        entries: [{ id: "p3", name: "Cai", dob: undefined }],
      },
      // Real scrub here to prove the payload Firestore sees is clean even
      // when the provider-injected scrub is the identity of this stub.
      { ...ops, scrub: scrubUndefined },
    );
    const sent = (payload?.players as { v: Player[] }).v[0];
    expect("dob" in sent).toBe(false);
  });

  it("removeById → arrayRemove of the EXACT stored entry, NOT re-sanitized", () => {
    // A legacy stored player still carrying photoUrl must round-trip
    // byte-for-byte through arrayRemove or the remove matches nothing.
    const legacy = { id: "p1", name: "Ava", photoUrl: "data:legacy" };
    const team = { players: [legacy] };
    const payload = buildTeamArrayPayload(
      team,
      { op: "removeById", key: "players", id: "p1" },
      ops,
    );
    expect((payload?.players as { v: unknown }).v).toBe(legacy);
  });

  it("removeById of a missing id resolves to null (successful no-op)", () => {
    expect(
      buildTeamArrayPayload(
        baseTeam(),
        { op: "removeById", key: "players", id: "ghost" },
        ops,
      ),
    ).toBeNull();
  });

  it("mapEntries → single bare key replacing that ONE array, resolved from prev", () => {
    const payload = buildTeamArrayPayload(
      baseTeam(),
      {
        op: "mapEntries",
        key: "games",
        map: (items) => items.map((g) => ({ ...g, status: "final" })),
      },
      ops,
    );
    expect(Object.keys(payload || {})).toEqual(["games"]);
    expect((payload?.games as Game[])[0].status).toBe("final");
  });

  it("resolveTeamArrayUpdate runs a mapEntries map exactly once", () => {
    // The provider consumes each op twice (optimistic apply + payload); a
    // non-deterministic map (fresh genId per call) must still yield ONE array.
    let calls = 0;
    const team = baseTeam();
    const resolved = resolveTeamArrayUpdate(team, {
      op: "mapEntries",
      key: "players",
      map: (items) => {
        calls += 1;
        return items.map((p) => ({ ...p, tag: Math.random() }));
      },
    });
    const optimistic = applyTeamArrayUpdate(team, resolved);
    const payload = buildTeamArrayPayload(team, resolved, ops);
    expect(calls).toBe(1);
    expect(payload?.players).toEqual(optimistic.players);
  });

  it("apply/payload parity: the entry stored equals the optimistic entry", () => {
    const entry = {
      id: "p3",
      name: "Cai",
      photoUrl: "data:...",
      dob: undefined,
    };
    const team = baseTeam();
    const optimistic = applyTeamArrayUpdate(team, {
      op: "append",
      key: "players",
      entries: [entry],
    }).players[2];
    const payload = buildTeamArrayPayload(
      team,
      { op: "append", key: "players", entries: [entry] },
      { ...ops, scrub: scrubUndefined },
    );
    expect((payload?.players as { v: Player[] }).v[0]).toEqual(optimistic);
  });
});
