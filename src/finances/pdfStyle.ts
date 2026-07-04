// Shared styling primitives for the finance PDFs (fee sheet, treasurer
// report) so both documents read as the same letterhead system.

export type RGB = [number, number, number];

// "#1b4f9c" → [27, 79, 156]; falls back to slate-900 for missing/odd values.
export const hexToRgb = (hex?: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [17, 24, 39];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

// Black or white text, whichever reads on the given background. Keeps the
// header legible whatever team color a coach picked (navy vs. a bright yellow).
export const idealTextOn = (c: RGB): RGB => {
  const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return luminance > 0.62 ? [17, 24, 39] : [255, 255, 255];
};

// Mix a color toward white by t (0..1) — used for faint accent tints.
export const tint = (c: RGB, t: number): RGB => [
  Math.round(c[0] + (255 - c[0]) * t),
  Math.round(c[1] + (255 - c[1]) * t),
  Math.round(c[2] + (255 - c[2]) * t),
];

export const SLATE_900: RGB = [17, 24, 39];
export const SLATE_600: RGB = [71, 85, 105];
export const SLATE_500: RGB = [100, 116, 139];
export const SLATE_400: RGB = [148, 163, 184];
export const HAIRLINE: RGB = [226, 232, 240];
export const ZEBRA: RGB = [247, 249, 252];
