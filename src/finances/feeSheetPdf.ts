// Parent-facing "Player Fee Breakdown" sheet. Renders a clean one-page PDF a
// coach can hand to a family showing where one player's annual fee goes — the
// fee spread across the budget's expected expenses. The split is proportional
// so the lines total exactly the fee (see buildPlayerFeeBreakdown); the sheet
// deliberately shows no rounding buffer or sponsorship line. jspdf is loaded
// lazily so it only enters the bundle when a coach actually exports a sheet —
// matching the lineup card, browser print is avoided for a fixed-format
// document that emails/texts/prints consistently across devices.

import type { Team, TeamFinances, Toast } from "../types";
import { buildPlayerFeeBreakdown, formatCurrency } from "../utils/helpers";

interface FeeSheetArgs {
  team?: Team | null;
  finances: TeamFinances | null | undefined;
  players: Array<{ id: string }> | null | undefined;
  toast?: Toast;
}

// "#1b4f9c" → [27, 79, 156]; falls back to slate-900 for missing/odd values.
type RGB = [number, number, number];
const hexToRgb = (hex?: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [17, 24, 39];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

// Black or white text, whichever reads on the given background. Keeps the
// header legible whatever team color a coach picked (navy vs. a bright yellow).
const idealTextOn = (c: RGB): RGB => {
  const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return luminance > 0.62 ? [17, 24, 39] : [255, 255, 255];
};

// Mix a color toward white by t (0..1) — used for the faint accent tint behind
// the total row.
const tint = (c: RGB, t: number): RGB => [
  Math.round(c[0] + (255 - c[0]) * t),
  Math.round(c[1] + (255 - c[1]) * t),
  Math.round(c[2] + (255 - c[2]) * t),
];

const SLATE_900: RGB = [17, 24, 39];
const SLATE_600: RGB = [71, 85, 105];
const SLATE_500: RGB = [100, 116, 139];
const SLATE_400: RGB = [148, 163, 184];
const HAIRLINE: RGB = [226, 232, 240];
const ZEBRA: RGB = [247, 249, 252];

const renderFeeSheetPdf = async ({
  team,
  finances,
  players,
}: FeeSheetArgs): Promise<Blob | null> => {
  const breakdown = buildPlayerFeeBreakdown(finances, players);
  if (!breakdown) return null;

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "portrait",
    compress: true,
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const right = pageW - margin;
  const contentW = pageW - margin * 2;
  const accent = hexToRgb(team?.primaryColor);
  const onAccent = idealTextOn(accent);
  const teamName = (team?.name || "Team").trim();
  const season = (team?.currentSeason || "").trim();

  // ---- Letterhead band (team color) ----
  const bandH = 104;
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(0, 0, pageW, bandH, "F");

  // Logo in a white chip on the left so it reads on any band color. The chip
  // also keeps the logo's own background from clashing with the team color.
  let textX = margin;
  const logo = (team?.logoUrl || "").trim();
  if (logo.startsWith("data:image")) {
    try {
      const props = pdf.getImageProperties(logo);
      if (props?.width && props?.height) {
        const chip = 64;
        const cx = margin;
        const cy = (bandH - chip) / 2;
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(cx, cy, chip, chip, 8, 8, "F");
        const box = chip - 16;
        const r = Math.min(box / props.width, box / props.height);
        const lw = props.width * r;
        const lh = props.height * r;
        pdf.addImage(
          logo,
          props.fileType || "PNG",
          cx + (chip - lw) / 2,
          cy + (chip - lh) / 2,
          lw,
          lh,
          undefined,
          "FAST",
        );
        textX = cx + chip + 18;
      }
    } catch {
      // Unsupported logo data — just omit the chip.
    }
  }

  // Team name + document title.
  pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(21);
  pdf.text(teamName, textX, 50);
  pdf.setFontSize(9.5);
  pdf.setCharSpace(2);
  pdf.text("PLAYER FEE SCHEDULE", textX, 72);
  pdf.setCharSpace(0);

  // Right-aligned document meta (season + issue date).
  const issued = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  if (season) {
    pdf.setFontSize(12);
    pdf.text(season.toUpperCase(), right, 48, { align: "right" });
  }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`Issued ${issued}`, right, season ? 66 : 50, { align: "right" });

  let y = bandH + 38;

  // ---- Fee callout (left accent stripe) ----
  const calloutH = 74;
  pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
  pdf.rect(margin, y, contentW, calloutH, "F");
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(margin, y, 6, calloutH, "F");
  pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  pdf.setLineWidth(0.75);
  pdf.rect(margin, y, contentW, calloutH);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
  pdf.setCharSpace(1.5);
  pdf.text("ANNUAL FEE PER PLAYER", margin + 22, y + 28);
  pdf.setCharSpace(0);
  pdf.setFontSize(30);
  pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
  pdf.text(formatCurrency(breakdown.fee), margin + 22, y + 60);
  y += calloutH + 34;

  // ---- Intro line ----
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
  pdf.text("Each player's fee supports the team as follows:", margin, y);
  y += 28;

  // ---- Table header ----
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
  pdf.setCharSpace(1);
  pdf.text("EXPENSE", margin + 8, y);
  pdf.text("PER PLAYER", right - 8, y, { align: "right" });
  pdf.setCharSpace(0);
  y += 9;
  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(1.5);
  pdf.line(margin, y, right, y);

  // ---- Expense rows (zebra striped) ----
  // Pre-measure every row, then shrink row spacing/font uniformly if the table
  // plus the total would otherwise spill past the footer (many budget lines).
  const labelMaxW = contentW - 130;
  const wrappedLines = breakdown.lines.map(
    (line) => pdf.splitTextToSize(line.label, labelMaxW) as string[],
  );
  const BASE_STEP = 15;
  const BASE_PAD = 15;
  const BASE_FONT = 11.5;
  const totalH = 42;
  const naturalH = wrappedLines.reduce(
    (sum, w) => sum + BASE_STEP * w.length + BASE_PAD,
    0,
  );
  const available = pageH - 64 - 16 - totalH - y; // keep clear of the footer
  const scale =
    naturalH > available && available > 0
      ? Math.max(0.55, available / naturalH)
      : 1;
  const step = BASE_STEP * scale;
  const pad = BASE_PAD * scale;
  const rowFont = Math.max(7.5, BASE_FONT * scale);

  breakdown.lines.forEach((line, i) => {
    const wrapped = wrappedLines[i];
    const rowH = step * wrapped.length + pad;
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y, contentW, rowH, "F");
    }
    const baseline =
      y + (rowH - (wrapped.length - 1) * step) / 2 + rowFont * 0.34;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(rowFont);
    pdf.setTextColor(30, 41, 59);
    pdf.text(wrapped, margin + 8, baseline);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(formatCurrency(line.amount), right - 8, baseline, {
      align: "right",
    });
    y += rowH;
  });

  // ---- Total row (accent tint band) ----
  const band = tint(accent, 0.86);
  pdf.setFillColor(band[0], band[1], band[2]);
  pdf.rect(margin, y, contentW, totalH, "F");
  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(1.5);
  pdf.line(margin, y, right, y);
  const totalBaseline = y + totalH / 2 + 5;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
  pdf.setCharSpace(0.5);
  pdf.text("TOTAL", margin + 8, totalBaseline);
  pdf.setCharSpace(0);
  pdf.setFontSize(15);
  pdf.text(formatCurrency(breakdown.fee), right - 8, totalBaseline, {
    align: "right",
  });

  // ---- Footer ----
  const footY = pageH - 64;
  pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  pdf.setLineWidth(0.75);
  pdf.line(margin, footY, right, footY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
  pdf.text(`${teamName}${season ? `  ·  ${season}` : ""}`, margin, footY + 18);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
  pdf.text(
    "This schedule reflects the team's estimated operating costs for the season. Questions? Please contact your coach.",
    margin,
    footY + 32,
    { maxWidth: contentW },
  );

  return pdf.output("blob");
};

// Downloads the fee sheet straight to the coach's device as a PDF file — no
// share sheet. The handout is meant to be saved and printed, so it goes
// directly to downloads where it can be reopened, printed, or attached.
export const downloadPlayerFeeSheetPdf = async (
  args: FeeSheetArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderFeeSheetPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to show yet",
        message: "Add budget items and set next season's fee first.",
      });
      return;
    }
    const filename = `player-fees-${team?.name || "team"}-${
      team?.currentSeason || "season"
    }.pdf`
      .replace(/\s+/g, "-")
      .toLowerCase();

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast?.push({
      kind: "success",
      title: "Fee sheet downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadPlayerFeeSheetPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
