// Season stats report — the printable version of the Stats tab: one table per
// category (Batting / Pitching / Fielding) plus season leaders, respecting the
// tab's machine/kid format scope. The data assembly is a pure, tested builder;
// the PDF mirrors the treasurer report's letterhead system (pdfStyle) and the
// roster directory's per-page column redraw, and lazy-loads jspdf so it stays
// out of the startup bundle.

import type { Team, Toast } from "../types";
import { CATEGORIES, fmt, type Col, type StatRow } from "./statColumns";
import {
  hexToRgb,
  idealTextOn,
  HAIRLINE,
  SLATE_400,
  SLATE_500,
  SLATE_900,
  ZEBRA,
} from "../finances/pdfStyle";

export interface StatsReportSection {
  id: string;
  label: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ id: string; name: string; number: string; cells: string[] }>;
}

export interface StatsReportLeader {
  category: string;
  stat: string;
  entries: Array<{ name: string; value: string }>;
}

export interface StatsReportData {
  scopeLabel: string;
  playerCount: number;
  sections: StatsReportSection[];
  leaders: StatsReportLeader[];
}

// Marquee stats worth a leaders line, per category. Rank direction comes from
// the column definition (hi), so ERA/WHIP rank ascending automatically.
const LEADER_SPECS: Array<{ catId: string; keys: string[] }> = [
  { catId: "batting", keys: ["ops", "avg", "hr"] },
  { catId: "pitching", keys: ["era", "whip", "ip"] },
  { catId: "fielding", keys: ["fpct"] },
];
const LEADER_MAX = 3;

// Same ordering as the on-screen table's initial sort: the category's marquee
// stat in its higher/lower-is-better direction, missing values sunk to the
// bottom, names as the tiebreak.
const compareBy =
  (col: Col) =>
  (a: StatRow, b: StatRow): number => {
    const av = col.get(a);
    const bv = col.get(b);
    if (av === undefined && bv === undefined)
      return String(a.name).localeCompare(String(b.name));
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (av === bv) return String(a.name).localeCompare(String(b.name));
    return (av - bv) * (col.hi ? -1 : 1);
  };

// null when no player has a single stat — there's nothing to report. A player
// appears in each section they have data for; the eval Total Score rides along
// as the Overall column but never earns a section row by itself.
export const buildStatsReportData = (
  rows: StatRow[] | null | undefined,
  opts?: { scopeLabel?: string },
): StatsReportData | null => {
  const all = Array.isArray(rows) ? rows : [];
  const sections: StatsReportSection[] = [];
  const seen = new Set<string>();
  for (const cat of CATEGORIES) {
    const kept = all
      .filter((r) => cat.cols.some((c) => c.get(r) !== undefined))
      .sort(
        compareBy(
          cat.cols.find((c) => c.key === cat.defaultKey) || cat.cols[0],
        ),
      );
    if (kept.length === 0) continue;
    kept.forEach((r) => seen.add(r.id));
    sections.push({
      id: cat.id,
      label: cat.label,
      columns: [
        { key: "total", label: "Overall" },
        ...cat.cols.map((c) => ({ key: c.key, label: c.label })),
      ],
      rows: kept.map((r) => ({
        id: r.id,
        name: r.name || "Player",
        number: r.number == null ? "" : String(r.number),
        cells: [
          r.total > 0 ? String(r.total) : "—",
          ...cat.cols.map((c) => {
            const v = c.get(r);
            return v === undefined ? "—" : fmt(v, c.kind);
          }),
        ],
      })),
    });
  }
  if (sections.length === 0) return null;

  const leaders: StatsReportLeader[] = [];
  for (const spec of LEADER_SPECS) {
    const cat = CATEGORIES.find((c) => c.id === spec.catId);
    if (!cat) continue;
    for (const key of spec.keys) {
      const col = cat.cols.find((c) => c.key === key);
      if (!col) continue;
      const ranked = all
        .map((r) => ({ r, v: col.get(r) }))
        .filter((x): x is { r: StatRow; v: number } => x.v !== undefined)
        .sort((a, b) => (col.hi ? b.v - a.v : a.v - b.v))
        .slice(0, LEADER_MAX);
      if (ranked.length === 0) continue;
      leaders.push({
        category: cat.label,
        stat: col.label,
        entries: ranked.map(({ r, v }) => ({
          name: r.name || "Player",
          value: fmt(v, col.kind),
        })),
      });
    }
  }

  return {
    scopeLabel: (opts?.scopeLabel || "").trim() || "All Formats",
    playerCount: seen.size,
    sections,
    leaders,
  };
};

interface StatsReportArgs {
  team?: Team | null;
  rows: StatRow[] | null | undefined;
  scopeLabel?: string;
  toast?: Toast;
}

const renderStatsReportPdf = async ({
  team,
  rows,
  scopeLabel,
}: StatsReportArgs): Promise<Blob | null> => {
  const data = buildStatsReportData(rows, { scopeLabel });
  if (!data) return null;

  const { jsPDF } = await import("jspdf");
  // Landscape: the batting table alone is 13 numeric columns; portrait can't
  // fit them at a readable size.
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
  const season = (team?.currentSeason || "").trim();
  const footY = pageH - 38;
  const ROW_H = 19;
  const PLAYER_W = 170;

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
    pdf.text("SEASON STATS REPORT", margin, 55);
    pdf.setCharSpace(0);
    const issued = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    if (season) pdf.text(season.toUpperCase(), right, 34, { align: "right" });
    pdf.text(
      `${data.scopeLabel}  ·  Issued ${issued}`,
      right,
      season ? 52 : 36,
      { align: "right" },
    );
    return bandH;
  };

  let y = drawHeaderBand() + 32;

  const newPage = () => {
    pdf.addPage();
    y = drawHeaderBand() + 32;
  };

  const sectionTitle = (text: string) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.setCharSpace(1);
    pdf.text(text.toUpperCase(), margin, y);
    pdf.setCharSpace(0);
    y += 14;
  };

  const drawColumnHeader = (section: StatsReportSection) => {
    const colW = (contentW - PLAYER_W) / section.columns.length;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.6);
    pdf.text("PLAYER", margin, y);
    section.columns.forEach((c, i) => {
      pdf.text(
        c.label.toUpperCase(),
        margin + PLAYER_W + colW * (i + 1) - 4,
        y,
        {
          align: "right",
        },
      );
    });
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.2);
    pdf.line(margin, y + 5, right, y + 5);
    y += 17;
  };

  const zebraRow = (i: number) => {
    if (i % 2 !== 0) return;
    pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
    pdf.rect(margin, y - 13, contentW, ROW_H - 2, "F");
  };

  data.sections.forEach((section, si) => {
    if (si > 0) y += 16;
    // Keep the title, column header, and first row together on one page.
    if (y + 14 + 17 + ROW_H > footY - 8) newPage();
    sectionTitle(
      `${section.label} — ${section.rows.length} player${
        section.rows.length === 1 ? "" : "s"
      }`,
    );
    drawColumnHeader(section);
    const colW = (contentW - PLAYER_W) / section.columns.length;
    section.rows.forEach((r, i) => {
      if (y + ROW_H > footY - 8) {
        newPage();
        drawColumnHeader(section);
      }
      zebraRow(i);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
      const label = r.number ? `#${r.number}  ${r.name}` : r.name;
      pdf.text(truncate(label, PLAYER_W - 8, 9.5), margin + 2, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      r.cells.forEach((cell, ci) => {
        pdf.text(cell, margin + PLAYER_W + colW * (ci + 1) - 4, y, {
          align: "right",
        });
      });
      y += ROW_H;
    });
  });

  if (data.leaders.length > 0) {
    y += 16;
    if (y + 14 + ROW_H > footY - 8) newPage();
    sectionTitle("Season leaders");
    data.leaders.forEach((l, i) => {
      if (y + ROW_H > footY - 8) newPage();
      zebraRow(i);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
      pdf.text(l.stat, margin + 2, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
      pdf.text(l.category.toUpperCase(), margin + 76, y);
      pdf.setFontSize(9);
      pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
      pdf.text(
        l.entries.map((e, j) => `${j + 1}. ${e.name} ${e.value}`).join("    "),
        right - 4,
        y,
        { align: "right" },
      );
      y += ROW_H;
    });
  }

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
      `${teamName}${season ? `  ·  ${season}` : ""}  ·  ${data.scopeLabel}`,
      margin,
      footY + 14,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text(`Page ${p} of ${pages}`, right, footY + 14, { align: "right" });
  }

  return pdf.output("blob");
};

// Downloads the stats report straight to the coach's device — same
// direct-download stance as the roster directory and treasurer report.
export const downloadStatsReportPdf = async (
  args: StatsReportArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderStatsReportPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to export yet",
        message: "Import a GameChanger stats CSV first.",
      });
      return;
    }
    const filename = `stats-report-${team?.name || "team"}-${
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
      title: "Stats report downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadStatsReportPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
