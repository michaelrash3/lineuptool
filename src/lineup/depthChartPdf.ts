// Printable depth-chart board — the Depth Chart tab on paper: every position
// down the page, the ranked players across it. What a coach clips to the dugout
// fence when a kid goes down and the next name up has to be obvious to whoever
// is standing there. Lives beside the lineup card because the board is defense
// planning (it ranks with the lineupEngine scorers), not a roster or stats
// document. The screen already computed the ranking (auto scores with the
// coach's saved manual order applied), so the builder takes that board as-is
// and only shapes it — the sheet can never disagree with the tab. jspdf is
// loaded lazily, matching the lineup card and every other printable.

import type { Team, Toast } from "../types";
import {
  hexToRgb,
  idealTextOn,
  tint,
  HAIRLINE,
  SLATE_400,
  SLATE_500,
  SLATE_900,
  ZEBRA,
} from "../finances/pdfStyle";

// Full position names for the row labels — the same map the tab's cards title
// themselves with.
const POSITION_LABELS: Record<string, string> = {
  P: "Pitcher",
  C: "Catcher",
  "1B": "First Base",
  "2B": "Second Base",
  "3B": "Third Base",
  SS: "Shortstop",
  LF: "Left Field",
  CF: "Center Field",
  RF: "Right Field",
  LCF: "Left-Center Field",
  RCF: "Right-Center Field",
};

// The board as the screen holds it. Typed loosely (id/name/number only) so the
// builder unit-tests against hand-rolled rows without a whole Player fixture.
interface BoardPlayerInput {
  id: string;
  name?: string;
  number?: string | number;
  primaryPosition?: string;
}

interface BoardPositionInput {
  pos: string;
  ranked: BoardPlayerInput[];
  customized?: boolean;
}

export interface DepthChartSlot {
  id: string;
  name: string;
  number: string;
  // The coach's explicit primary here — starred on the sheet so the printed
  // board still shows WHY a kid leads a position he isn't the top scorer at.
  primary: boolean;
}

export interface DepthChartRow {
  pos: string;
  label: string;
  customized: boolean;
  slots: DepthChartSlot[];
}

export interface DepthChartBoardData {
  rows: DepthChartRow[];
  // Widest position, capped at MAX_SLOTS — drives the printed column count.
  depth: number;
  // Distinct players on the board (a kid comfortable at four spots counts once).
  playerCount: number;
  customizedCount: number;
  // Positions with nobody comfortable there — the holes worth seeing.
  emptyCount: number;
}

// Six deep is already more than any youth staff moves through in a game, and
// it's what fits at a readable size across a landscape page. Anyone past it is
// summarized as "+N more" on the row.
const MAX_SLOTS = 6;

const str = (v: unknown): string => String(v ?? "").trim();

// Normalize the tab's board into printable rows. Positions with nobody
// comfortable there are KEPT (an empty row is the point — it's the hole in the
// roster); null only when there is no board at all or not one ranked player
// anywhere, which is the tab's own empty state. Pure + exported so it's
// unit-tested without touching jspdf.
export const buildDepthChartBoard = (
  board: BoardPositionInput[] | null | undefined,
): DepthChartBoardData | null => {
  const positions = (Array.isArray(board) ? board : []).filter(
    (p) => p && str(p.pos),
  );
  if (positions.length === 0) return null;

  const seen = new Set<string>();
  const rows: DepthChartRow[] = positions.map((p) => {
    const pos = str(p.pos);
    const ranked = Array.isArray(p.ranked) ? p.ranked : [];
    ranked.forEach((pl) => pl?.id && seen.add(str(pl.id)));
    return {
      pos,
      label: POSITION_LABELS[pos] || pos,
      customized: !!p.customized,
      slots: ranked.map((pl) => ({
        id: str(pl?.id),
        name: str(pl?.name) || "Unnamed",
        number: str(pl?.number),
        primary: str(pl?.primaryPosition).toUpperCase() === pos.toUpperCase(),
      })),
    };
  });
  if (seen.size === 0) return null;

  return {
    rows,
    depth: Math.min(MAX_SLOTS, Math.max(1, ...rows.map((r) => r.slots.length))),
    playerCount: seen.size,
    customizedCount: rows.filter((r) => r.customized).length,
    emptyCount: rows.filter((r) => r.slots.length === 0).length,
  };
};

interface DepthChartPdfArgs {
  team?: Team | null;
  board: BoardPositionInput[] | null | undefined;
  toast?: Toast;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

const renderDepthChartPdf = async ({
  team,
  board,
}: DepthChartPdfArgs): Promise<Blob | null> => {
  const data = buildDepthChartBoard(board);
  if (!data) return null;

  const { jsPDF } = await import("jspdf");
  // Landscape: six depth columns wide enough to hold a full name only fit
  // across the long edge.
  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "landscape",
    compress: true,
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const right = pageW - margin;
  const contentW = pageW - margin * 2;
  const accent = hexToRgb(team?.primaryColor);
  const onAccent = idealTextOn(accent);
  const chipBg = tint(accent, 0.86);
  const teamName = (team?.name || "Team").trim();
  const season = (team?.currentSeason || "").trim();
  const footY = pageH - 38;

  const POS_W = 116;
  const slotW = (contentW - POS_W) / data.depth;
  const rowH = 34;

  const truncate = (text: string, width: number, size: number): string => {
    if (!text) return "";
    pdf.setFontSize(size);
    if (pdf.getTextWidth(text) <= width) return text;
    let out = text;
    while (out.length > 1 && pdf.getTextWidth(out + "…") > width)
      out = out.slice(0, -1);
    return out + "…";
  };

  const drawHeaderBand = () => {
    const bandH = 76;
    pdf.setFillColor(accent[0], accent[1], accent[2]);
    pdf.rect(0, 0, pageW, bandH, "F");
    pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(19);
    pdf.text(teamName, margin, 36);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setCharSpace(2);
    pdf.text("DEPTH CHART", margin, 55);
    pdf.setCharSpace(0);
    const issued = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    if (season) pdf.text(season.toUpperCase(), right, 34, { align: "right" });
    pdf.text(
      `${data.playerCount} player${data.playerCount === 1 ? "" : "s"}  ·  Issued ${issued}`,
      right,
      season ? 52 : 36,
      { align: "right" },
    );
    return bandH;
  };

  const drawColumnHeader = (y: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.8);
    pdf.text("POSITION", margin, y);
    for (let i = 0; i < data.depth; i += 1) {
      pdf.text(
        (ORDINALS[i] || `${i + 1}th`).toUpperCase(),
        margin + POS_W + slotW * i + 8,
        y,
      );
    }
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.4);
    pdf.line(margin, y + 6, right, y + 6);
    return y + 6;
  };

  let y = drawHeaderBand() + 30;
  y = drawColumnHeader(y) + 6;

  data.rows.forEach((row, i) => {
    if (y + rowH > footY - 8) {
      pdf.addPage();
      y = drawHeaderBand() + 30;
      y = drawColumnHeader(y) + 6;
    }
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y, contentW, rowH, "F");
    }
    const line1 = y + 15;
    const line2 = y + 27;

    // Position chip + full name, so the row reads at a glance from the fence.
    pdf.setFillColor(chipBg[0], chipBg[1], chipBg[2]);
    pdf.rect(margin, y + 6, 34, 16, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(row.pos, margin + 17, y + 17, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.text(truncate(row.label, POS_W - 48, 8.5), margin + 40, y + 17);
    if (row.customized) {
      pdf.setFontSize(6.5);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.setCharSpace(0.6);
      pdf.text("COACH ORDER", margin, y + 29);
      pdf.setCharSpace(0);
    }

    if (row.slots.length === 0) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.text("Nobody comfortable here yet", margin + POS_W + 8, line1);
    }

    row.slots.slice(0, data.depth).forEach((slot, si) => {
      const x = margin + POS_W + slotW * si + 8;
      const w = slotW - 16;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
      pdf.text(truncate(slot.name, w, 10), x, line1);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
      const meta = [
        slot.number ? `#${slot.number}` : "",
        slot.primary ? "★ primary" : "",
      ]
        .filter(Boolean)
        .join("   ");
      if (meta) pdf.text(meta, x, line2);
    });

    // Depth past the printed columns still matters when a coach is counting
    // bodies, so say how many are behind the last one shown.
    const overflow = row.slots.length - data.depth;
    if (overflow > 0) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.text(`+${overflow} more`, right, line2, { align: "right" });
    }

    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y + rowH, right, y + rowH);
    y += rowH;
  });

  // ---- Footer on every page ----
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.75);
    pdf.line(margin, footY, right, footY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      `${teamName}${season ? `  ·  ${season}` : ""}  ·  ${data.rows.length} positions`,
      margin,
      footY + 14,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text(
      "★ = coach's primary  ·  order follows the Depth Chart tab",
      margin,
      footY + 25,
    );
    pdf.text(`Page ${p} of ${pages}`, right, footY + 14, { align: "right" });
  }

  return pdf.output("blob");
};

// Build + download the board straight to the coach's device — same
// direct-download stance as the roster directory and stats report.
export const downloadDepthChartPdf = async (
  args: DepthChartPdfArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderDepthChartPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to export yet",
        message: "Set players comfortable at a position first.",
      });
      return;
    }
    const filename = `depth-chart-${team?.name || "team"}-${
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
      title: "Depth chart downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadDepthChartPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
