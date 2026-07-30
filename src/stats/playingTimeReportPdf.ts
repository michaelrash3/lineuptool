// Playing-time report — the printable page a coach can hand a parent (or read
// off in the parking lot) when the question is "is my kid playing enough?".
//
// Every number on it comes out of utils/playingTime, which in turn reads the
// SAME season ledger the rotation engine used to build those lineups. The
// report can't quietly disagree with the app that made the decisions.
//
// Same shape as the treasurer/stats reports: a pure, tested data-assembly
// function plus a renderer that lazy-loads jspdf (scripts/check-bundle.mjs
// fails the build if jspdf ever lands in the startup graph).

import type { Game, Team, Toast } from "../types";
import {
  buildPlayingTimeReport,
  countedGamesNote,
  notYetPlayedNote,
  playingTimeSentence,
  playingTimeTeamNotes,
  positionBreakdownLabel,
  type PlayingTimeRow,
} from "../utils/playingTime";
import {
  hexToRgb,
  idealTextOn,
  HAIRLINE,
  SLATE_400,
  SLATE_500,
  SLATE_900,
  ZEBRA,
} from "../finances/pdfStyle";

export interface PlayingTimeReportRow {
  id: string;
  /** "#7  Avery" when a number is on file, else just the name. */
  label: string;
  cells: string[];
  positionsLabel: string;
  sentence: string;
}

export interface PlayingTimeReportData {
  gamesCounted: number;
  /** Exactly which games are behind these numbers. */
  countingNote: string;
  /** Plain-English team-level read, most useful first. */
  teamNotes: string[];
  columns: string[];
  rows: PlayingTimeReportRow[];
  /** "Nico hasn't played in a counted game yet." — or empty. */
  notYetPlayedNote: string;
}

export const PLAYING_TIME_COLUMNS = [
  "Games",
  "Defense",
  "Bench",
  "Over share",
  "Bench 1st",
  "Positions",
];

const rowLabel = (r: PlayingTimeRow): string =>
  r.number ? `#${r.number}  ${r.name}` : r.name;

// The six numbers under each name, in the order the table prints them. Shared
// with the Stats-tab card so the screen and the page agree cell for cell.
export const playingTimeCells = (r: PlayingTimeRow): string[] => [
  String(r.gamesPlayed),
  String(r.defensiveInnings),
  String(r.benchInnings),
  r.extraSits > 0 ? `+${r.extraSits}` : "—",
  String(r.firstInningBenches),
  String(r.distinctPositions),
];

// null when no finalized, non-scrimmage game has a lineup yet — there is
// nothing honest to print.
export const buildPlayingTimeReportData = (
  games: Game[] | null | undefined,
  players:
    | Array<{ id?: string; name?: string; number?: string | number }>
    | null
    | undefined,
): PlayingTimeReportData | null => {
  const report = buildPlayingTimeReport(games, players);
  if (report.gamesCounted === 0 || report.rows.length === 0) return null;

  return {
    gamesCounted: report.gamesCounted,
    countingNote: countedGamesNote(report),
    teamNotes: playingTimeTeamNotes(report),
    columns: PLAYING_TIME_COLUMNS,
    rows: report.rows.map((r) => ({
      id: r.id,
      label: rowLabel(r),
      cells: playingTimeCells(r),
      positionsLabel: positionBreakdownLabel(r),
      sentence: playingTimeSentence(r),
    })),
    notYetPlayedNote: notYetPlayedNote(report),
  };
};

interface PlayingTimeReportArgs {
  team?: Team | null;
  games: Game[] | null | undefined;
  players:
    | Array<{ id?: string; name?: string; number?: string | number }>
    | null
    | undefined;
  toast?: Toast;
}

const renderPlayingTimeReportPdf = async ({
  team,
  games,
  players,
}: PlayingTimeReportArgs): Promise<Blob | null> => {
  const data = buildPlayingTimeReportData(games, players);
  if (!data) return null;

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
  const footY = pageH - 56;
  const ROW_H = 19;
  const NAME_W = 150;

  // ---- Letterhead band (first page only) ----
  const bandH = 104;
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(0, 0, pageW, bandH, "F");
  pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(21);
  pdf.text(teamName, margin, 50);
  pdf.setFontSize(9.5);
  pdf.setCharSpace(2);
  pdf.text("PLAYING TIME REPORT", margin, 72);
  pdf.setCharSpace(0);
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

  let y = bandH + 30;

  const ensureRoom = (needed: number) => {
    if (y + needed <= footY - 14) return;
    pdf.addPage();
    y = margin;
  };

  const sectionTitle = (title: string) => {
    ensureRoom(60);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(1.5);
    pdf.text(title.toUpperCase(), margin, y);
    pdf.setCharSpace(0);
    y += 8;
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.5);
    pdf.line(margin, y, right, y);
    y += 16;
  };

  // Wrapped body copy.
  const paragraph = (
    text: string,
    opts?: { size?: number; color?: [number, number, number]; bold?: boolean },
  ) => {
    const size = opts?.size ?? 10;
    const color = opts?.color ?? SLATE_900;
    pdf.setFont("helvetica", opts?.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(color[0], color[1], color[2]);
    const lines = pdf.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureRoom(size + 5);
      pdf.text(line, margin, y);
      y += size + 4;
    }
  };

  // ---- What these numbers cover ----
  paragraph(data.countingNote, { size: 9.5, color: SLATE_500 });
  y += 10;

  // ---- How the season has gone ----
  sectionTitle("How the season has gone");
  for (const note of data.teamNotes) {
    paragraph(`•  ${note}`);
    y += 2;
  }
  if (data.notYetPlayedNote) {
    paragraph(`•  ${data.notYetPlayedNote}`, { color: SLATE_500 });
  }
  y += 14;

  // ---- Season totals table ----
  const colW = (contentW - NAME_W) / data.columns.length;
  const drawColumnHeader = () => {
    ensureRoom(24);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.setCharSpace(0.6);
    pdf.text("PLAYER", margin + 2, y);
    data.columns.forEach((c, i) => {
      pdf.text(c.toUpperCase(), margin + NAME_W + colW * (i + 1) - 4, y, {
        align: "right",
      });
    });
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.2);
    pdf.line(margin, y + 5, right, y + 5);
    y += 17;
  };

  sectionTitle("Season totals");
  drawColumnHeader();
  data.rows.forEach((r, i) => {
    if (y + ROW_H > footY - 14) {
      pdf.addPage();
      y = margin;
      drawColumnHeader();
    }
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y - 13, contentW, ROW_H - 2, "F");
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(r.label, margin + 2, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    r.cells.forEach((cell, ci) => {
      pdf.text(cell, margin + NAME_W + colW * (ci + 1) - 4, y, {
        align: "right",
      });
    });
    y += ROW_H;
  });
  y += 18;

  // ---- Player by player (the read-aloud lines) ----
  sectionTitle("Player by player");
  for (const r of data.rows) {
    ensureRoom(34);
    paragraph(r.sentence, { bold: true, size: 10 });
    if (r.positionsLabel) {
      paragraph(`Where those innings went: ${r.positionsLabel}`, {
        size: 8.5,
        color: SLATE_500,
      });
    }
    y += 6;
  }

  // ---- Footer on every page ----
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.75);
    pdf.line(margin, footY, right, footY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      `${teamName}${season ? `  ·  ${season}` : ""}  ·  Playing time`,
      margin,
      footY + 18,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text(`Page ${p} of ${pages}`, right, footY + 18, { align: "right" });
  }

  return pdf.output("blob");
};

// Downloads straight to the coach's device — same stance as the stats and
// treasurer reports: a document they print or forward themselves.
export const downloadPlayingTimeReportPdf = async (
  args: PlayingTimeReportArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderPlayingTimeReportPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to report yet",
        message: "Finalize a game with a saved lineup first.",
      });
      return;
    }
    const filename = `playing-time-${team?.name || "team"}-${
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
      title: "Playing time report downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadPlayingTimeReportPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
