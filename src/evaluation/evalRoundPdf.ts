// Eval round PDF — a clean, printable grade grid for one saved evaluation round
// (docs/EVALUATIONS-AUDIT.md §4, approved feature). The CSV export
// (src/utils/evalExport.ts) is for spreadsheets; this is the formatted handout a
// head coach shares with staff or a club board. jspdf is loaded lazily so it
// only enters the bundle when a coach actually exports — mirroring feeSheetPdf
// and rosterDirectoryPdf. Landscape so the category columns fit on one page.

import type { Team, Toast } from "../types";
import {
  hexToRgb,
  idealTextOn,
  SLATE_900,
  SLATE_600,
  SLATE_500,
  SLATE_400,
  HAIRLINE,
  ZEBRA,
} from "../finances/pdfStyle";

interface GridPlayer {
  id: string;
  name?: string;
  number?: string | number;
}

interface GridCategory {
  id: string;
  label: string;
}

interface GridRound {
  date?: string;
  grades?: Record<string, Record<string, unknown> | undefined>;
}

export interface EvalGridColumn {
  id: string;
  label: string;
}

export interface EvalGridRow {
  id: string;
  name: string;
  number: string;
  // One entry per category column, in column order: the numeric grade, or null
  // when that category was left ungraded (rendered blank, never a spurious 0).
  grades: (number | null)[];
  notes: string;
  graded: boolean;
}

export interface EvalGrid {
  columns: EvalGridColumn[];
  rows: EvalGridRow[];
  gradedCount: number;
}

// Pure, unit-tested core: shape a round + roster + category set into a grid.
// Row order follows the roster as given (same as the CSV export); the renderer
// only draws. Returns null when there's no one to render.
export const buildEvalGradeGrid = (
  round: GridRound | null | undefined,
  players: GridPlayer[] | null | undefined,
  categories: GridCategory[] | null | undefined,
): EvalGrid | null => {
  const cats = Array.isArray(categories) ? categories : [];
  const roster = Array.isArray(players) ? players : [];
  if (roster.length === 0) return null;
  const columns: EvalGridColumn[] = cats.map((c) => ({
    id: c.id,
    label: c.label,
  }));
  let gradedCount = 0;
  const rows: EvalGridRow[] = roster.map((p) => {
    const g = round?.grades?.[p.id] || {};
    const grades = columns.map((c) =>
      typeof g[c.id] === "number" ? (g[c.id] as number) : null,
    );
    const notes = typeof g.notes === "string" ? g.notes : "";
    const graded = grades.some((v) => v !== null) || notes.length > 0;
    if (graded) gradedCount += 1;
    return {
      id: p.id,
      name: p.name || "",
      number:
        p.number === undefined || p.number === null ? "" : String(p.number),
      grades,
      notes,
      graded,
    };
  });
  return { columns, rows, gradedCount };
};

interface EvalPdfArgs {
  team?: Team | null;
  round: GridRound | null | undefined;
  roundName?: string;
  players: GridPlayer[] | null | undefined;
  categories: GridCategory[] | null | undefined;
  toast?: Toast;
}

const renderEvalRoundPdf = async ({
  team,
  round,
  roundName,
  players,
  categories,
}: EvalPdfArgs): Promise<Blob | null> => {
  const grid = buildEvalGradeGrid(round, players, categories);
  if (!grid) return null;

  const { jsPDF } = await import("jspdf");
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
  const teamName = (team?.name || "Team").trim();
  const title = (roundName || "Evaluation Round").trim();

  // One-line truncation with an ellipsis so a cell never overflows its column.
  const truncate = (text: string, width: number, size: number): string => {
    if (!text) return "";
    pdf.setFontSize(size);
    if (pdf.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && pdf.getTextWidth(`${t}…`) > width)
      t = t.slice(0, -1);
    return `${t}…`;
  };

  // ---- Letterhead band (team color) ----
  const bandH = 84;
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(0, 0, pageW, bandH, "F");

  // Logo in a white chip on the left so it reads on any band color.
  let textX = margin;
  const logo = (team?.logoUrl || "").trim();
  if (logo.startsWith("data:image")) {
    try {
      const props = pdf.getImageProperties(logo);
      if (props?.width && props?.height) {
        const chip = 54;
        const cx = margin;
        const cy = (bandH - chip) / 2;
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(cx, cy, chip, chip, 8, 8, "F");
        const box = chip - 14;
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
        textX = cx + chip + 16;
      }
    } catch {
      // Unsupported logo data — just omit the chip.
    }
  }

  // Team name + document title.
  pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.text(teamName, textX, 40);
  pdf.setFontSize(9);
  pdf.setCharSpace(2);
  pdf.text("EVALUATION REPORT", textX, 60);
  pdf.setCharSpace(0);

  // Right-aligned meta: round name + issued date + graded count.
  const issued = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text(truncate(title, 320, 12), right, 38, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(
    `Issued ${issued}  ·  ${grid.gradedCount}/${grid.rows.length} graded`,
    right,
    56,
    { align: "right" },
  );

  // ---- Column layout ----
  // Player + # are fixed; category columns and Notes flex to fill the width.
  const playerW = 150;
  const numW = 30;
  const minNotesW = 120;
  const nCats = grid.columns.length;
  const forCats = contentW - playerW - numW - minNotesW;
  const catW = nCats > 0 ? Math.max(30, Math.min(64, forCats / nCats)) : 0;
  const notesW = contentW - playerW - numW - catW * nCats;
  const xPlayer = margin;
  const xNum = xPlayer + playerW;
  const xCat = (i: number) => xNum + numW + i * catW;
  const xNotes = xNum + numW + nCats * catW;

  const rowH = 22;
  const headerH = 24;

  const drawHeader = (y: number): number => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.5);
    pdf.text("PLAYER", xPlayer + 4, y + headerH - 8);
    pdf.text("#", xNum + numW / 2, y + headerH - 8, { align: "center" });
    grid.columns.forEach((c, i) => {
      pdf.text(
        truncate(c.label.toUpperCase(), catW - 4, 8.5),
        xCat(i) + catW / 2,
        y + headerH - 8,
        { align: "center" },
      );
    });
    if (notesW > 20) pdf.text("NOTES", xNotes + 4, y + headerH - 8);
    pdf.setCharSpace(0);
    const lineY = y + headerH;
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.5);
    pdf.line(margin, lineY, right, lineY);
    return lineY;
  };

  let y = bandH + 28;
  y = drawHeader(y);

  grid.rows.forEach((row, i) => {
    // Page break: start a fresh page (with a re-drawn header) before a row that
    // would cross the bottom margin.
    if (y + rowH > pageH - 44) {
      pdf.addPage();
      y = margin + 8;
      y = drawHeader(y);
    }
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y, contentW, rowH, "F");
    }
    const baseline = y + rowH / 2 + 3.5;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(truncate(row.name || "—", playerW - 8, 10), xPlayer + 4, baseline);
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    if (row.number)
      pdf.text(row.number, xNum + numW / 2, baseline, { align: "center" });
    row.grades.forEach((g, ci) => {
      if (g === null) {
        pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
        pdf.text("–", xCat(ci) + catW / 2, baseline, { align: "center" });
      } else {
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
        pdf.text(String(g), xCat(ci) + catW / 2, baseline, { align: "center" });
        pdf.setFont("helvetica", "normal");
      }
    });
    if (notesW > 20 && row.notes) {
      pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
      pdf.setFontSize(9);
      pdf.text(truncate(row.notes, notesW - 8, 9), xNotes + 4, baseline);
    }
    y += rowH;
  });

  // ---- Footer on every page ----
  const season = (team?.currentSeason || "").trim();
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    pdf.setPage(p);
    const footY = pageH - 32;
    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.75);
    pdf.line(margin, footY, right, footY);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      `${teamName}${season ? `  ·  ${season}` : ""}`,
      margin,
      footY + 16,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text("Coach evaluations — confidential", margin, footY + 27);
    pdf.text(`Page ${p} of ${pageCount}`, right, footY + 16, {
      align: "right",
    });
  }

  return pdf.output("blob");
};

// Download the round's grade grid straight to the coach's device as a PDF.
export const downloadEvalRoundPdf = async (
  args: EvalPdfArgs,
): Promise<void> => {
  const { team, round, roundName, toast } = args;
  try {
    const blob = await renderEvalRoundPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to export yet",
        message: "Add players to the roster first.",
      });
      return;
    }
    const slug = (s: string) =>
      s
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    const teamPart = team?.name ? `${slug(team.name)}-` : "";
    const namePart = roundName
      ? slug(roundName)
      : round?.date
        ? slug(String(round.date))
        : "round";
    const filename = `${teamPart}evaluations-${namePart}.pdf`;

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
      title: "Evaluation PDF downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadEvalRoundPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
