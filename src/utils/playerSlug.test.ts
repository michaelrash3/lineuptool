import {
  nameSlug,
  playerSlug,
  findPlayerByParam,
  isCanonicalPlayerParam,
  playerPathFromId,
} from "./playerSlug";

const P = (id: string, name?: unknown) => ({ id, name });

describe("nameSlug", () => {
  it("lowercases and dashes a plain name", () => {
    expect(nameSlug("Marcus Elliott")).toBe("marcus-elliott");
  });

  it("folds accents instead of dropping the letters", () => {
    expect(nameSlug("José Núñez")).toBe("jose-nunez");
  });

  it("collapses punctuation and runs of separators", () => {
    expect(nameSlug("D'Angelo  O'Brien-Smith Jr.")).toBe(
      "d-angelo-o-brien-smith-jr",
    );
  });

  it("trims leading and trailing separators", () => {
    expect(nameSlug("  --Ty--  ")).toBe("ty");
  });

  it("yields an empty string for nothing sluggable", () => {
    expect(nameSlug("")).toBe("");
    expect(nameSlug(null)).toBe("");
    expect(nameSlug(undefined)).toBe("");
    expect(nameSlug("!!!")).toBe("");
    expect(nameSlug("大谷")).toBe("");
  });
});

describe("playerSlug", () => {
  it("uses the bare name when it is unique on the roster", () => {
    const roster = [P("p-1", "Marcus Elliott"), P("p-2", "Tara Vance")];
    expect(playerSlug(roster[0], roster)).toBe("marcus-elliott");
  });

  // Two kids with the same name would otherwise fight over one address.
  it("appends the id when two players share a name", () => {
    const roster = [P("p-1", "Jack Ryan"), P("p-2", "Jack Ryan")];
    expect(playerSlug(roster[0], roster)).toBe("jack-ryan-p-1");
    expect(playerSlug(roster[1], roster)).toBe("jack-ryan-p-2");
  });

  it("treats differently-punctuated spellings of a name as the same slug", () => {
    const roster = [P("p-1", "Jo Ann Reed"), P("p-2", "Jo-Ann Reed")];
    expect(playerSlug(roster[0], roster)).toBe("jo-ann-reed-p-1");
    expect(playerSlug(roster[1], roster)).toBe("jo-ann-reed-p-2");
  });

  // /roster/new is the Add Player page and out-ranks /roster/:playerId, so a
  // bare "new" slug would make this player's page unreachable.
  it("disambiguates a name that collides with a real route segment", () => {
    const roster = [P("p-1", "New"), P("p-2", "Import")];
    expect(playerSlug(roster[0], roster)).toBe("new-p-1");
    expect(playerSlug(roster[1], roster)).toBe("import-p-2");
  });

  it("falls back to the id when there is no sluggable name", () => {
    const roster = [P("p-1", ""), P("p-2", "大谷")];
    expect(playerSlug(roster[0], roster)).toBe("p-1");
    expect(playerSlug(roster[1], roster)).toBe("p-2");
  });

  it("does not count the player against themselves", () => {
    const roster = [P("p-1", "Solo Kid")];
    expect(playerSlug(roster[0], roster)).toBe("solo-kid");
  });
});

describe("findPlayerByParam", () => {
  const roster = [
    P("p-1", "Marcus Elliott"),
    P("p-2", "Jack Ryan"),
    P("p-3", "Jack Ryan"),
    P("p-4", ""),
  ];

  it("resolves a bare name slug", () => {
    expect(findPlayerByParam("marcus-elliott", roster)?.id).toBe("p-1");
  });

  // Links a coach texted before slugs existed, and anything still built from
  // a raw id, have to keep working.
  it("still resolves a raw id", () => {
    expect(findPlayerByParam("p-1", roster)?.id).toBe("p-1");
    expect(findPlayerByParam("p-4", roster)?.id).toBe("p-4");
  });

  it("resolves the disambiguated name-plus-id form", () => {
    expect(findPlayerByParam("jack-ryan-p-2", roster)?.id).toBe("p-2");
    expect(findPlayerByParam("jack-ryan-p-3", roster)?.id).toBe("p-3");
  });

  // An old bare link can't say which Jack Ryan it meant, and opening the
  // wrong kid's page silently is worse than showing nothing.
  it("refuses an ambiguous bare name rather than guessing", () => {
    expect(findPlayerByParam("jack-ryan", roster)).toBeNull();
  });

  it("returns null for an unknown or empty segment", () => {
    expect(findPlayerByParam("nobody-here", roster)).toBeNull();
    expect(findPlayerByParam("", roster)).toBeNull();
    expect(findPlayerByParam(undefined, roster)).toBeNull();
    expect(findPlayerByParam("marcus-elliott", [])).toBeNull();
    expect(findPlayerByParam("marcus-elliott", null)).toBeNull();
  });

  it("round-trips every player through its own canonical slug", () => {
    for (const p of roster) {
      expect(findPlayerByParam(playerSlug(p, roster), roster)?.id).toBe(p.id);
    }
  });
});

describe("isCanonicalPlayerParam", () => {
  const roster = [P("p-1", "Marcus Elliott")];

  it("is true for the canonical slug and false for the raw id", () => {
    expect(isCanonicalPlayerParam("marcus-elliott", roster[0], roster)).toBe(
      true,
    );
    expect(isCanonicalPlayerParam("p-1", roster[0], roster)).toBe(false);
  });

  it("is false without a param or player", () => {
    expect(isCanonicalPlayerParam("", roster[0], roster)).toBe(false);
    expect(isCanonicalPlayerParam("marcus-elliott", null, roster)).toBe(false);
  });
});

describe("playerPathFromId", () => {
  const roster = [P("p-1", "Marcus Elliott")];

  it("builds the slug path for a known id", () => {
    expect(playerPathFromId("p-1", roster)).toBe("/roster/marcus-elliott");
  });

  it("appends a sub-page suffix", () => {
    expect(playerPathFromId("p-1", roster, "/report")).toBe(
      "/roster/marcus-elliott/report",
    );
  });

  // Redirecting an unknown id to the roster from here would hide the profile
  // page's own not-found state.
  it("passes an unknown id through untouched", () => {
    expect(playerPathFromId("p-gone", roster)).toBe("/roster/p-gone");
  });
});
