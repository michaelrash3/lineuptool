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
const hexToRgb = (hex?: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [17, 24, 39];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

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
  const contentW = pageW - margin * 2;
  const accent = hexToRgb(team?.primaryColor);

  // Accent bar across the top.
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(0, 0, pageW, 8, "F");

  let y = margin + 14;

  // Team name.
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.setFontSize(22);
  pdf.text(team?.name || "Team", margin, y);

  // Eyebrow.
  y += 22;
  const season = (team?.currentSeason || "").trim();
  pdf.setFontSize(11);
  pdf.setTextColor(accent[0], accent[1], accent[2]);
  pdf.text(
    `PLAYER FEE BREAKDOWN${season ? ` — ${season.toUpperCase()}` : ""}`,
    margin,
    y,
  );

  // Fee callout box.
  y += 26;
  const boxH = 66;
  pdf.setFillColor(245, 247, 250);
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(1);
  pdf.roundedRect(margin, y, contentW, boxH, 8, 8, "FD");
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text("ANNUAL FEE PER PLAYER", margin + 18, y + 24);
  pdf.setFontSize(30);
  pdf.setTextColor(17, 24, 39);
  pdf.text(formatCurrency(breakdown.fee), margin + 18, y + 54);
  y += boxH + 32;

  // Intro line.
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    "Here's how each player's fee supports the team this season:",
    margin,
    y,
  );
  y += 26;

  // Table header.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text("EXPENSE", margin, y);
  pdf.text("PER PLAYER", pageW - margin, y, { align: "right" });
  y += 8;
  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(1.5);
  pdf.line(margin, y, pageW - margin, y);
  y += 20;

  // Expense rows. Long labels wrap; the amount aligns to the first line.
  const labelMaxW = contentW - 120;
  for (const line of breakdown.lines) {
    const wrapped = pdf.splitTextToSize(line.label, labelMaxW) as string[];
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(12);
    pdf.setTextColor(30, 41, 59);
    pdf.text(wrapped, margin, y);
    pdf.setFont("helvetica", "bold");
    pdf.text(formatCurrency(line.amount), pageW - margin, y, {
      align: "right",
    });
    y += 16 * wrapped.length + 6;
    pdf.setDrawColor(241, 245, 249);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageW - margin, y);
    y += 12;
  }

  // Total — equals the fee exactly because the lines are spread from it.
  y += 4;
  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(1.5);
  pdf.line(margin, y, pageW - margin, y);
  y += 24;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(17, 24, 39);
  pdf.text("TOTAL", margin, y);
  pdf.text(formatCurrency(breakdown.fee), pageW - margin, y, {
    align: "right",
  });

  // Footer note.
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(148, 163, 184);
  pdf.text(
    "Fees cover the team's operating costs for the season. Questions? Please reach out to your coach.",
    margin,
    pageH - 48,
    { maxWidth: contentW },
  );

  return pdf.output("blob");
};

// Tries the Web Share API first (so the coach's iOS/Android share sheet
// appears), falling back to a download link. Mirrors downloadLineupPdf.
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
    const file = new File([blob], filename, { type: "application/pdf" });

    const nav = navigator as unknown as {
      share?: (data: {
        files: File[];
        title?: string;
        text?: string;
      }) => Promise<void>;
      canShare?: (data: { files: File[] }) => boolean;
    };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share!({
          files: [file],
          title: "Player Fee Breakdown",
          text: "Player Fee Breakdown",
        });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }

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
