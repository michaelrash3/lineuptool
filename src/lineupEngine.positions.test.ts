import { describe, it, expect } from "vitest";
import { isPositionBlocked } from "./lineupEngine";
import { canonicalizeOutfield, canonicalizePositionList } from "./utils/helpers";

describe("outfield canonicalization", () => {
  it("collapses center variants to CF, leaves corners distinct", () => {
    expect(canonicalizeOutfield("LCF")).toBe("CF");
    expect(canonicalizeOutfield("RCF")).toBe("CF");
    expect(canonicalizeOutfield("CF")).toBe("CF");
    expect(canonicalizeOutfield("LF")).toBe("LF");
    expect(canonicalizeOutfield("RF")).toBe("RF");
    expect(canonicalizeOutfield("SS")).toBe("SS");
  });

  it("normalizes a position list to the canonical 3-OF model", () => {
    expect(canonicalizePositionList(["LCF", "RCF", "CF"])).toEqual(["CF"]);
    expect(canonicalizePositionList(["LF", "LCF", "RCF", "RF"])).toEqual([
      "LF",
      "CF",
      "RF",
    ]);
  });
});

describe("isPositionBlocked — CF <-> LCF/RCF eligibility", () => {
  it("a 10-fielder roster (accepts LCF/RCF) is NOT blocked from CF in a 9-fielder game", () => {
    const p = { comfortablePositions: ["LCF", "RCF"] };
    expect(isPositionBlocked(p, "CF")).toBe(false);
  });

  it("a CF-eligible player can fill LCF and RCF in a 10-fielder game", () => {
    const p = { comfortablePositions: ["CF"] };
    expect(isPositionBlocked(p, "LCF")).toBe(false);
    expect(isPositionBlocked(p, "RCF")).toBe(false);
  });

  it("center eligibility does NOT leak to the corners", () => {
    const p = { comfortablePositions: ["CF"] };
    expect(isPositionBlocked(p, "LF")).toBe(true);
    expect(isPositionBlocked(p, "RF")).toBe(true);
  });

  it("an empty list stays eligible everywhere", () => {
    expect(isPositionBlocked({ comfortablePositions: [] }, "CF")).toBe(false);
    expect(isPositionBlocked({}, "LCF")).toBe(false);
  });

  it("legacy negative restrictions also canonicalize", () => {
    const p = { restrictions: ["LCF", "RCF"] };
    // Restricted from center: blocked at CF (9-fielder) too.
    expect(isPositionBlocked(p, "CF")).toBe(true);
    // But corners remain allowed.
    expect(isPositionBlocked(p, "LF")).toBe(false);
  });
});
