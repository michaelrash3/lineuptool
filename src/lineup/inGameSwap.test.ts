import {
  applySwap,
  getPlayerAt,
  isCatcherBlocked,
  fillVacatedSpot,
} from "./inGameSwap";

const P = (id: string, name = id) => ({ id, name });

const inning = () => ({
  P: P("ava"),
  C: P("mia"),
  "1B": P("zoe"),
  BENCH: [P("ben"), P("cor")],
});

describe("getPlayerAt", () => {
  it("resolves a position slot and a bench player", () => {
    const inn = inning();
    expect(getPlayerAt(inn as any, { type: "position", pos: "P" })?.id).toBe(
      "ava",
    );
    expect(
      getPlayerAt(inn as any, { type: "bench", playerId: "cor" })?.id,
    ).toBe("cor");
  });

  it("returns undefined for an empty slot / unknown bench id", () => {
    const inn = { P: P("ava"), BENCH: [] };
    expect(
      getPlayerAt(inn as any, { type: "position", pos: "C" }),
    ).toBeUndefined();
    expect(
      getPlayerAt(inn as any, { type: "bench", playerId: "nope" }),
    ).toBeUndefined();
  });
});

describe("applySwap", () => {
  it("swaps two field positions", () => {
    const next = applySwap(
      inning() as any,
      { type: "position", pos: "P" },
      { type: "position", pos: "1B" },
    );
    expect((next as any).P.id).toBe("zoe");
    expect((next as any)["1B"].id).toBe("ava");
    expect((next as any).C.id).toBe("mia"); // untouched
  });

  it("swaps a field position with a bench player", () => {
    const next = applySwap(
      inning() as any,
      { type: "position", pos: "P" },
      { type: "bench", playerId: "ben" },
    );
    expect((next as any).P.id).toBe("ben");
    expect((next as any).BENCH.map((p: any) => p.id)).toEqual(["ava", "cor"]);
  });

  it("swaps two bench players", () => {
    const next = applySwap(
      inning() as any,
      { type: "bench", playerId: "ben" },
      { type: "bench", playerId: "cor" },
    );
    expect((next as any).BENCH.map((p: any) => p.id)).toEqual(["cor", "ben"]);
  });

  it("returns null when either cell is empty", () => {
    const next = applySwap(
      inning() as any,
      { type: "position", pos: "P" },
      { type: "position", pos: "SS" },
    );
    expect(next).toBeNull();
  });

  it("does not mutate the input inning or its BENCH array", () => {
    const inn = inning();
    const benchRef = inn.BENCH;
    applySwap(
      inn as any,
      { type: "position", pos: "P" },
      { type: "bench", playerId: "ben" },
    );
    expect(inn.P.id).toBe("ava"); // original unchanged
    expect(inn.BENCH).toBe(benchRef); // same array reference
    expect(inn.BENCH.map((p) => p.id)).toEqual(["ben", "cor"]);
  });

  it("is its own inverse for position↔position (applying twice restores it)", () => {
    // Note: this self-inverse property holds only for position↔position. For
    // bench cells the selection's playerId moves off the bench after the swap,
    // which is exactly why InGameView's undo restores a pre-swap snapshot
    // instead of replaying the swap.
    const a = { type: "position", pos: "P" } as const;
    const b = { type: "position", pos: "1B" } as const;
    const once = applySwap(inning() as any, a, b)!;
    const twice = applySwap(once, a, b)!;
    expect((twice as any).P.id).toBe("ava");
    expect((twice as any)["1B"].id).toBe("zoe");
  });
});

describe("fillVacatedSpot (carry a sub forward, just the tapped spot)", () => {
  const always = () => true;
  const never = () => false;

  it("fills the tapped spot when the inning still matches (out at pos, sub on bench)", () => {
    // ben (bench) came in for ava at SS in the current inning; carry that into a
    // later inning where ava is still at SS and ben is still benched.
    const later = {
      P: P("liv"),
      C: P("mia"),
      SS: P("ava"),
      BENCH: [P("ben"), P("cor")],
    };
    const next = fillVacatedSpot(later as any, "SS", "ava", P("ben"), always);
    expect((next as any).SS.id).toBe("ben"); // sub now at SS
    expect((next as any).BENCH.map((p: any) => p.id)).toEqual(["ava", "cor"]); // ava sits
    expect((next as any).P.id).toBe("liv"); // everything else as-is
    expect((next as any).C.id).toBe("mia");
  });

  it("leaves the inning untouched when the rotation already moved the out player", () => {
    // ava isn't at SS here (rotation put zoe there) — don't scramble it.
    const later = { SS: P("zoe"), BENCH: [P("ben"), P("ava")] };
    const next = fillVacatedSpot(later as any, "SS", "ava", P("ben"), always);
    expect(next).toBe(later); // untouched
  });

  it("leaves the inning untouched when the sub isn't free (already on the field)", () => {
    const later = { SS: P("ava"), "1B": P("ben"), BENCH: [P("cor")] };
    const next = fillVacatedSpot(later as any, "SS", "ava", P("ben"), always);
    expect(next).toBe(later); // ben is playing 1B — don't duplicate
  });

  it("does not slide a non-catcher into C", () => {
    const later = { C: P("mia"), BENCH: [P("ben")] };
    const next = fillVacatedSpot(later as any, "C", "mia", P("ben"), never);
    expect(next).toBe(later); // untouched
  });

  it("does not mutate the input inning", () => {
    const later = { SS: P("ava"), BENCH: [P("ben")] };
    const benchRef = later.BENCH;
    fillVacatedSpot(later as any, "SS", "ava", P("ben"), always);
    expect(later.SS.id).toBe("ava");
    expect(later.BENCH).toBe(benchRef);
  });
});

describe("isCatcherBlocked", () => {
  const ava = P("ava");
  const mia = P("mia");
  const clears = (ids: string[]) => (pl: any) => ids.includes(pl?.id);

  it("blocks moving a non-catcher into C", () => {
    // firstSel C receives playerB (mia); mia is not cleared → blocked.
    const blocked = isCatcherBlocked(
      { type: "position", pos: "C" },
      { type: "position", pos: "P" },
      ava,
      mia,
      clears(["ava"]),
    );
    expect(blocked).toBe(true);
  });

  it("allows the swap when the incoming player is cleared to catch", () => {
    const blocked = isCatcherBlocked(
      { type: "position", pos: "C" },
      { type: "position", pos: "P" },
      ava,
      mia,
      clears(["mia"]),
    );
    expect(blocked).toBe(false);
  });

  it("is irrelevant when neither cell is the C slot", () => {
    const blocked = isCatcherBlocked(
      { type: "position", pos: "P" },
      { type: "bench", playerId: "ben" },
      ava,
      mia,
      clears([]),
    );
    expect(blocked).toBe(false);
  });
});
