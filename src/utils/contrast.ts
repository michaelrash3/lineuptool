// Legible team-color TEXT — pick, never modify. The team triplet
// (primary/secondary/tertiary) is user-chosen and sacred: no darkening,
// lightening, or nudging. But a navy primary used as FONT color on a dark
// surface (or a white tertiary on a white surface) is unreadable. These
// helpers AUTOMATE WHICH existing color gets used as the font for a given
// background — walking a candidate list in preference order and returning the
// first one that actually reads, falling back to the app's neutral ink only
// when none of the team's own colors are legible there.
//
// Consumed via four CSS custom properties (declared with back-compat defaults
// in styles.css, computed per-team in App.tsx and the public portals):
//   --team-ink          team-colored text ON the app surface (theme-aware)
//   --team-on-primary   text ON a team-primary fill (btn-premium, badges)
//   --team-on-secondary text ON a team-secondary fill (active nav row)

// WCAG relative luminance. Accepts #rgb / #rrggbb; returns null for anything
// unparseable (color-mix() strings, named colors) so callers skip it.
export const relativeLuminance = (hex: string): number | null => {
  const s = String(hex || "").trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const chan = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
};

// WCAG contrast ratio (1–21). 0 when either color is unparseable.
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return 0;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

// WCAG AA for normal text. Team-colored text is mostly bold/large, but the
// stricter bar keeps small labels (nav rows, eyebrows) safe too.
const MIN_RATIO = 4.5;

// The automation: the FIRST candidate that clears AA against the surface wins;
// if none do, the highest-contrast candidate wins. Candidates are returned
// EXACTLY as given — colors are chosen, never altered. Unparseable entries
// (unset team colors, css functions) are skipped.
export const pickLegibleColor = (
  candidates: Array<string | null | undefined>,
  surface: string,
  minRatio: number = MIN_RATIO,
): string => {
  let best = "";
  let bestRatio = -1;
  for (const c of candidates) {
    if (!c) continue;
    const ratio = contrastRatio(c, surface);
    if (ratio <= 0) continue; // unparseable candidate
    if (ratio >= minRatio) return c;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  return best || "#ffffff";
};

// The app's neutral inks (styles.css :root / [data-theme=dark]) — the final
// fallbacks when no team color is legible on a surface.
const INK_LIGHT_THEME = "#0b1220"; // --ink (light)
const INK_DARK_THEME = "#eef2f9"; // --ink (dark)
const SURFACE_LIGHT_THEME = "#ffffff"; // --surface (light)
const SURFACE_DARK_THEME = "#0e1421"; // --surface (dark)

export interface TeamInkVars {
  teamInkLight: string;
  teamInkDark: string;
  onPrimary: string;
  onSecondary: string;
  onTertiary: string;
}

// Compute all four picks for a team triplet. Pure — DOM application below.
export const computeTeamInkVars = (team: {
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
}): TeamInkVars => {
  const { primaryColor: p, secondaryColor: s, tertiaryColor: t } = team;
  return {
    // Team text on the app surface: prefer primary, then the other brand
    // colors, then the theme's neutral ink.
    teamInkLight: pickLegibleColor(
      [p, s, t, INK_LIGHT_THEME],
      SURFACE_LIGHT_THEME,
    ),
    teamInkDark: pickLegibleColor(
      [p, s, t, INK_DARK_THEME],
      SURFACE_DARK_THEME,
    ),
    // Text on a team-primary fill: prefer the team's own accent pair, then
    // plain white/near-black (a choice between existing neutrals).
    onPrimary: pickLegibleColor(
      [t, s, "#ffffff", INK_LIGHT_THEME],
      p || "#2563eb",
    ),
    // Text on a team-secondary fill (active nav row): prefer primary (the
    // classic pairing), then tertiary, then neutrals.
    onSecondary: pickLegibleColor(
      [p, t, INK_LIGHT_THEME, "#ffffff"],
      s || "#f8fafc",
    ),
    // Text on a team-tertiary fill (position badges): prefer primary, then
    // secondary, then neutrals.
    onTertiary: pickLegibleColor(
      [p, s, INK_LIGHT_THEME, "#ffffff"],
      t || "#ffffff",
    ),
  };
};

// Write the picks onto a root element as CSS custom properties. styles.css
// declares back-compat defaults (--team-ink: primary, --team-on-primary:
// tertiary…), so until/unless this runs the app renders exactly as before.
export const applyTeamInkVars = (
  root: HTMLElement,
  team: {
    primaryColor?: string;
    secondaryColor?: string;
    tertiaryColor?: string;
  },
): void => {
  const v = computeTeamInkVars(team);
  root.style.setProperty("--team-ink-light", v.teamInkLight);
  root.style.setProperty("--team-ink-dark", v.teamInkDark);
  root.style.setProperty("--team-on-primary", v.onPrimary);
  root.style.setProperty("--team-on-secondary", v.onSecondary);
  root.style.setProperty("--team-on-tertiary", v.onTertiary);
};
