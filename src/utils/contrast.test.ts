import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  pickLegibleColor,
  computeTeamInkVars,
} from "./contrast";

describe("relativeLuminance / contrastRatio", () => {
  it("computes the WCAG anchors", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("accepts #rgb shorthand and rejects garbage", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("")).toBeNull();
    expect(relativeLuminance("var(--team-primary)")).toBeNull();
    expect(relativeLuminance("navy")).toBeNull();
    expect(contrastRatio("navy", "#fff")).toBe(0);
  });
});

describe("pickLegibleColor — chooses, never modifies", () => {
  it("returns the FIRST candidate that clears the bar, verbatim", () => {
    // Navy on white clears AA easily → primary wins even though later
    // candidates contrast more.
    expect(pickLegibleColor(["#1e3a5f", "#000000"], "#ffffff")).toBe("#1e3a5f");
  });

  it("falls through an illegible primary to the next team color on a dark surface", () => {
    // Dark navy on near-black fails; a light secondary passes → secondary is
    // picked UNCHANGED (the user's own color, not a lightened primary).
    const picked = pickLegibleColor(
      ["#12203a", "#f8fafc", "#ffffff"],
      "#0e1421",
    );
    expect(picked).toBe("#f8fafc");
  });

  it("lands on the neutral only when NO team color is legible", () => {
    // All-dark triplet on a dark surface → the appended neutral ink wins.
    const picked = pickLegibleColor(
      ["#12203a", "#0a1a2f", "#111827", "#eef2f9"],
      "#0e1421",
    );
    expect(picked).toBe("#eef2f9");
  });

  it("skips unparseable candidates and falls back to highest contrast when none clear", () => {
    // Nothing reaches 4.5 → highest-contrast candidate returned as-is.
    const picked = pickLegibleColor(
      ["var(--nope)", "#666666", "#555555"],
      "#444444",
    );
    expect(picked).toBe("#666666");
  });
});

describe("computeTeamInkVars", () => {
  it("dark-navy primary: kept on light surfaces, replaced by a legible sibling on dark", () => {
    const v = computeTeamInkVars({
      primaryColor: "#12203a",
      secondaryColor: "#f8fafc",
      tertiaryColor: "#ffffff",
    });
    expect(v.teamInkLight).toBe("#12203a"); // primary reads on white
    expect(v.teamInkDark).toBe("#f8fafc"); // secondary picked on dark
    // Text ON the navy fill: white-ish tertiary reads.
    expect(v.onPrimary).toBe("#ffffff");
    // Text ON the near-white secondary fill: navy primary reads.
    expect(v.onSecondary).toBe("#12203a");
  });

  it("light primary: flipped — legible on dark, replaced on light", () => {
    const v = computeTeamInkVars({
      primaryColor: "#fde047",
      secondaryColor: "#facc15",
      tertiaryColor: "#0a0a0a",
    });
    expect(v.teamInkDark).toBe("#fde047"); // yellow reads on dark
    // On white, yellows fail → the dark tertiary is the team's own legible pick.
    expect(v.teamInkLight).toBe("#0a0a0a");
    // On the yellow fill, the dark tertiary reads.
    expect(v.onPrimary).toBe("#0a0a0a");
  });

  it("tolerates missing team colors (defaults still yield picks)", () => {
    const v = computeTeamInkVars({});
    expect(v.teamInkLight).toBeTruthy();
    expect(v.teamInkDark).toBeTruthy();
    expect(v.onPrimary).toBeTruthy();
    expect(v.onSecondary).toBeTruthy();
  });
});

// Finance UI theme tokens (src/styles.css) must clear WCAG AA (4.5:1) for the
// small meta/eyebrow (--ink-3) and win-colored (--win-ink) TEXT they drive, on
// both surface tokens in each theme. Pins the a11y contrast fix so a future
// token nudge can't silently regress below AA.
describe("finance text tokens clear WCAG AA on their surfaces", () => {
  const AA = 4.5;
  const light = { surface: "#ffffff", surface2: "#f3f6fb" };
  const dark = { surface: "#0e1421", surface2: "#151d2c" };

  it("light --ink-3 (#5b6577) reads on both light surfaces", () => {
    expect(contrastRatio("#5b6577", light.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#5b6577", light.surface2)).toBeGreaterThanOrEqual(AA);
  });
  it("light --win-ink (#157a3a) reads on both light surfaces", () => {
    expect(contrastRatio("#157a3a", light.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#157a3a", light.surface2)).toBeGreaterThanOrEqual(AA);
  });
  it("dark --ink-3 (#7c889b) reads on both dark surfaces", () => {
    expect(contrastRatio("#7c889b", dark.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#7c889b", dark.surface2)).toBeGreaterThanOrEqual(AA);
  });
  it("dark --win-ink (#34d399) reads on both dark surfaces", () => {
    expect(contrastRatio("#34d399", dark.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio("#34d399", dark.surface2)).toBeGreaterThanOrEqual(AA);
  });
});
