// Tryout ranking sheet — the Roster Projection board on paper. The tab can only
// put a tryout on paper one kid at a time (the offer / rejection letters), but
// the conversation right after a tryout is about the whole board: who's above
// the line, who's on the bubble, who still needs a grade. This is that board,
// in the order the screen ranks it (weighted eval score + the explainable
// positional-fit bonus, computed by computeRosterProjection), so the printout
// and the tab can never disagree. Letterhead primitives come from the finance
// pdfStyle and jspdf is loaded lazily, matching every other printable.

import type { Team, Toast } from "../types";
import {
  hexToRgb,
  idealTextOn,
  HAIRLINE,
  SLATE_400,
  SLATE_500,
  SLATE_600,
  SLATE_900,
  ZEBRA,
} from "../finances/pdfStyle";

// The projection as the tab holds it. Typed loosely (the fields this sheet
// reads, nothing more) so the builder unit-tests against hand-rolled rows and
// never imports back out of the screen module.
interface CandidateInput {
  kind?: string;
  id: string;
  name?: string;
  signup?: { tryoutNumber?: string; tryoutDate?: string };
  score?: number | null;
  baseScore?: number | null;
  fitBonus?: number;
  fitReasons?: string[];
}

interface SignupInput {
  id: string;
  firstName?: string;
  lastName?: string;
  tryoutNumber?: string;
}

interface ProjectionInput {
  rosterCap?: number;
  returningYesCount?: number;
  returningNoCount?: number;
  returningUnknownCount?: number;
  acceptedCount?: number;
  lockedCount?: number;
  slotsRemaining?: number;
  recommended?: CandidateInput[];
  nextBest?: CandidateInput[];
  belowLine?: CandidateInput[];
  needsEvaluation?: CandidateInput[];
  tooOld?: SignupInput[];
}

export interface TryoutRankingRow {
  rank: number;
  id: string;
  number: string;
  name: string;
  source: string;
  bucket: string;
  // Pre-formatted for the page: whole-number scores exactly as the board shows
  // them, an em-dash where there's nothing to show.
  evalScore: string;
  fitBonus: string;
  total: string;
  fitReasons: string;
}

export interface TryoutRankingAside {
  id: string;
  number: string;
  name: string;
  source: string;
}

export interface TryoutRankingSheet {
  rows: TryoutRankingRow[];
  // Candidates the board can't rank yet — printed as a to-do list, because
  // "who still needs a grade" is the other half of the post-tryout meeting.
  ungraded: TryoutRankingAside[];
  tooOld: TryoutRankingAside[];
  rosterCap: number;
  lockedCount: number;
  slotsRemaining: number;
  returningYesCount: number;
  returningNoCount: number;
  returningUnknownCount: number;
  acceptedCount: number;
  // Rows above the roster line (the recommended bucket) — where the renderer
  // draws the cut rule.
  aboveLineCount: number;
}

const str = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number =>
  Number.isFinite(Number(v)) ? Number(v) : 0;
const score = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(0) : "—";

const SOURCE_LABELS: Record<string, string> = {
  tryout: "Tryout",
  unknown: "Current roster",
};
const sourceOf = (kind?: string): string =>
  SOURCE_LABELS[str(kind)] || "Candidate";

const asideOf = (c: CandidateInput): TryoutRankingAside => ({
  id: str(c.id),
  number: str(c.signup?.tryoutNumber),
  name: str(c.name) || "Tryout candidate",
  source: sourceOf(c.kind),
});

// Flatten the three ranked buckets into one numbered sheet, keeping the board's
// own order (each bucket is already sorted by score). null when there is not a
// single candidate anywhere — the tab's own "grade candidates to see the
// projection" state. Pure + exported so it's unit-tested without touching jspdf.
export const buildTryoutRankingSheet = (
  projection: ProjectionInput | null | undefined,
): TryoutRankingSheet | null => {
  if (!projection) return null;
  const buckets: Array<{ label: string; items: CandidateInput[] }> = [
    { label: "Recommended", items: projection.recommended || [] },
    { label: "Next Best", items: projection.nextBest || [] },
    { label: "Below Line", items: projection.belowLine || [] },
  ];
  const rows: TryoutRankingRow[] = [];
  for (const bucket of buckets) {
    for (const c of bucket.items) {
      const fit = num(c.fitBonus);
      rows.push({
        rank: rows.length + 1,
        id: str(c.id),
        number: str(c.signup?.tryoutNumber),
        name: str(c.name) || "Tryout candidate",
        source: sourceOf(c.kind),
        bucket: bucket.label,
        evalScore: score(c.baseScore),
        fitBonus: fit > 0 ? `+${fit.toFixed(0)}` : "—",
        total: score(c.score),
        fitReasons: (c.fitReasons || []).filter(Boolean).join(", "),
      });
    }
  }

  const ungraded = (projection.needsEvaluation || []).map(asideOf);
  const tooOld = (projection.tooOld || []).map((s) => ({
    id: str(s?.id),
    number: str(s?.tryoutNumber),
    name:
      `${str(s?.firstName)} ${str(s?.lastName)}`.trim() || "Tryout candidate",
    source: "Tryout",
  }));
  if (rows.length + ungraded.length + tooOld.length === 0) return null;

  return {
    rows,
    ungraded,
    tooOld,
    rosterCap: num(projection.rosterCap),
    lockedCount: num(projection.lockedCount),
    slotsRemaining: num(projection.slotsRemaining),
    returningYesCount: num(projection.returningYesCount),
    returningNoCount: num(projection.returningNoCount),
    returningUnknownCount: num(projection.returningUnknownCount),
    acceptedCount: num(projection.acceptedCount),
    aboveLineCount: (projection.recommended || []).length,
  };
};

interface TryoutRankingArgs {
  team?: Team | null;
  projection: ProjectionInput | null | undefined;
  toast?: Toast;
}

const renderTryoutRankingPdf = async ({
  team,
  projection,
}: TryoutRankingArgs): Promise<Blob | null> => {
  const data = buildTryoutRankingSheet(projection);
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
  const margin = 40;
  const right = pageW - margin;
  const contentW = pageW - margin * 2;
  const accent = hexToRgb(team?.primaryColor);
  const onAccent = idealTextOn(accent);
  const teamName = (team?.name || "Team").trim();
  const season = (team?.currentSeason || "").trim();
  const footY = pageH - 44;
  const ROW_H = 22;

  // Column x-offsets from the left margin; NOTES flexes into whatever the
  // fixed columns leave.
  const col = {
    rank: 0,
    number: 26,
    name: 54,
    source: 190,
    notes: 268,
    evalScore: contentW - 132,
    fit: contentW - 78,
    total: contentW,
  };
  const notesW = col.evalScore - col.notes - 12;

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
    const bandH = 80;
    pdf.setFillColor(accent[0], accent[1], accent[2]);
    pdf.rect(0, 0, pageW, bandH, "F");
    pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(19);
    pdf.text(teamName, margin, 36);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setCharSpace(2);
    pdf.text("TRYOUT RANKING SHEET", margin, 55);
    pdf.setCharSpace(0);
    const issued = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    if (season) pdf.text(season.toUpperCase(), right, 34, { align: "right" });
    pdf.text(`Issued ${issued}`, right, season ? 52 : 36, { align: "right" });
    pdf.setFontSize(8);
    pdf.text(
      `${data.slotsRemaining} open of ${data.rosterCap}  ·  ${data.lockedCount} locked`,
      right,
      season ? 66 : 52,
      { align: "right" },
    );
    return bandH;
  };

  const drawColumnHeader = (y: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.7);
    pdf.text("#", margin + col.rank, y);
    pdf.text("TAG", margin + col.number, y);
    pdf.text("CANDIDATE", margin + col.name, y);
    pdf.text("SOURCE", margin + col.source, y);
    pdf.text("FIT NOTES", margin + col.notes, y);
    pdf.text("EVAL", margin + col.evalScore, y, { align: "right" });
    pdf.text("FIT", margin + col.fit, y, { align: "right" });
    pdf.text("TOTAL", margin + col.total, y, { align: "right" });
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.4);
    pdf.line(margin, y + 6, right, y + 6);
    return y + 6;
  };

  let y = drawHeaderBand() + 28;

  // Roster math first: the sheet is read as "how many spots are left, and who
  // fills them", so the counts lead.
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
  pdf.text(
    `${data.returningYesCount} returning yes  ·  ${data.returningNoCount} no  ·  ${data.returningUnknownCount} unknown  ·  ${data.acceptedCount} accepted tryout${
      data.acceptedCount === 1 ? "" : "s"
    }`,
    margin,
    y,
  );
  y += 22;
  y = drawColumnHeader(y) + 6;

  const sectionTitle = (text: string) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.setCharSpace(1);
    pdf.text(text.toUpperCase(), margin, y);
    pdf.setCharSpace(0);
    y += 16;
  };

  data.rows.forEach((r, i) => {
    if (y + ROW_H > footY - 8) {
      pdf.addPage();
      y = drawHeaderBand() + 28;
      y = drawColumnHeader(y) + 6;
    }
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y - 12, contentW, ROW_H - 2, "F");
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text(String(r.rank), margin + col.rank, y);
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    if (r.number) pdf.text(r.number, margin + col.number, y);
    pdf.setFontSize(10);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      truncate(r.name, col.source - col.name - 10, 10),
      margin + col.name,
      y,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.text(r.source, margin + col.source, y);
    if (r.fitReasons)
      pdf.text(truncate(r.fitReasons, notesW, 8), margin + col.notes, y);
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    pdf.text(r.evalScore, margin + col.evalScore, y, { align: "right" });
    pdf.text(r.fitBonus, margin + col.fit, y, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(r.total, margin + col.total, y, { align: "right" });
    y += ROW_H;

    // The cut rule: everything above it fills an open spot at today's counts.
    if (
      r.rank === data.aboveLineCount &&
      data.aboveLineCount < data.rows.length
    ) {
      pdf.setDrawColor(accent[0], accent[1], accent[2]);
      pdf.setLineWidth(1.2);
      pdf.setLineDashPattern([4, 3], 0);
      pdf.line(margin, y - 8, right, y - 8);
      pdf.setLineDashPattern([], 0);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
      pdf.setCharSpace(0.8);
      pdf.text(
        `ROSTER LINE — ${data.slotsRemaining} OPEN SPOT${data.slotsRemaining === 1 ? "" : "S"}`,
        right,
        y + 3,
        { align: "right" },
      );
      pdf.setCharSpace(0);
      y += 12;
    }
  });

  const aside = (title: string, items: TryoutRankingAside[]) => {
    if (items.length === 0) return;
    y += 14;
    if (y + 16 + ROW_H > footY - 8) {
      pdf.addPage();
      y = drawHeaderBand() + 28;
    }
    sectionTitle(`${title} — ${items.length}`);
    items.forEach((item, i) => {
      if (y + ROW_H > footY - 8) {
        pdf.addPage();
        y = drawHeaderBand() + 28;
      }
      if (i % 2 === 0) {
        pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
        pdf.rect(margin, y - 12, contentW, ROW_H - 2, "F");
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9.5);
      pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
      const label = item.number ? `${item.number}  ${item.name}` : item.name;
      pdf.text(truncate(label, contentW - 120, 9.5), margin + col.rank, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
      pdf.text(item.source, right, y, { align: "right" });
      y += ROW_H;
    });
  };

  aside("Still needs a grade", data.ungraded);
  aside("Outside the age group", data.tooOld);

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
      `${teamName}${season ? `  ·  ${season}` : ""}  ·  ${data.rows.length} ranked`,
      margin,
      footY + 14,
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text(
      "Planning projection — confidential, for coaching staff use only.",
      margin,
      footY + 25,
    );
    pdf.text(`Page ${p} of ${pages}`, right, footY + 14, { align: "right" });
  }

  return pdf.output("blob");
};

// Build + download the ranking sheet straight to the coach's device — same
// direct-download stance as the stats report and roster directory.
export const downloadTryoutRankingPdf = async (
  args: TryoutRankingArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderTryoutRankingPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to export yet",
        message: "Grade a few candidates first.",
      });
      return;
    }
    const filename = `tryout-ranking-${team?.name || "team"}-${
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
      title: "Ranking sheet downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadTryoutRankingPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
