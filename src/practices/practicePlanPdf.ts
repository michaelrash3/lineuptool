// Practice plan handout — the Smart Planner's agenda on paper. The plan can
// only be "applied to practice" today, which is fine for the coach holding the
// phone and useless for the assistant running the station on the next field
// over. This is the block-by-block sheet they can carry: what runs when, for how
// long, and what gear it needs. The agenda itself is built (and unit-tested) by
// utils/practicePlanner — this only shapes it for the page, so the handout can
// never disagree with the preview. Letterhead primitives come from the finance
// pdfStyle; jspdf is loaded lazily like every other printable.

import type { Team, Toast } from "../types";
import { formatDateDisplay } from "../utils/helpers";
import {
  hexToRgb,
  idealTextOn,
  tint,
  HAIRLINE,
  SLATE_400,
  SLATE_500,
  SLATE_600,
  SLATE_900,
} from "../finances/pdfStyle";

// The plan as the page holds it (DrillLogEntry) and the library it was drawn
// from — typed to just the fields the handout reads so the builder unit-tests
// against hand-rolled blocks.
interface PlanBlockInput {
  name?: string;
  minutes?: number;
  category?: string;
  libraryId?: string;
}

interface DrillLibraryInput {
  id: string;
  description?: string;
  equipment?: string;
}

export interface PracticePlanHandoutBlock {
  index: number;
  name: string;
  category: string;
  minutes: number;
  // Wall-clock when the practice has a start time, elapsed from zero otherwise.
  startLabel: string;
  endLabel: string;
  description: string;
  equipment: string;
}

export interface PracticePlanHandoutData {
  blocks: PracticePlanHandoutBlock[];
  totalMinutes: number;
  // True when the labels are real clock times — the renderer titles the column
  // TIME instead of ELAPSED.
  clocked: boolean;
  dateLabel: string;
  location: string;
  environmentLabel: string;
  emphasis: string;
}

export interface PracticePlanHandoutOptions {
  // 24h "HH:MM" (what <input type="time"> and isoInstantToLocalTimeInput give).
  // Absent/malformed → the sheet runs on elapsed time, which is what a coach
  // does with a practice that has no clock time on it.
  startTime?: string;
  library?: DrillLibraryInput[] | null;
  date?: string;
  location?: string;
  environment?: string;
  emphasis?: string;
}

const str = (v: unknown): string => String(v ?? "").trim();

// "16:45" → 1005. null for anything that isn't a real time of day.
const parseStartMinutes = (value?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(value));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const clockLabel = (minuteOfDay: number): string => {
  const wrapped = ((minuteOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(wrapped % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
};

const elapsedLabel = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// Shape the generated agenda into a printable handout, running the clock across
// the blocks. null when the plan is empty — the planner's own "your library has
// nothing tagged for this practice" state. Pure + exported so it's unit-tested
// without touching jspdf.
export const buildPracticePlanHandout = (
  blocks: PlanBlockInput[] | null | undefined,
  opts?: PracticePlanHandoutOptions,
): PracticePlanHandoutData | null => {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
  if (list.length === 0) return null;

  const byId = new Map(
    (opts?.library || []).filter((d) => d?.id).map((d) => [d.id, d]),
  );
  const start = parseStartMinutes(opts?.startTime);
  const label = (offset: number): string =>
    start === null ? elapsedLabel(offset) : clockLabel(start + offset);

  let cursor = 0;
  const built: PracticePlanHandoutBlock[] = list.map((b, i) => {
    const minutes = Math.max(0, Math.round(Number(b?.minutes) || 0));
    const drill = byId.get(str(b?.libraryId));
    const block: PracticePlanHandoutBlock = {
      index: i + 1,
      name: str(b?.name) || "Drill",
      category: str(b?.category),
      minutes,
      startLabel: label(cursor),
      endLabel: label(cursor + minutes),
      description: str(drill?.description),
      equipment: str(drill?.equipment),
    };
    cursor += minutes;
    return block;
  });

  const env = str(opts?.environment).toLowerCase();
  return {
    blocks: built,
    totalMinutes: cursor,
    clocked: start !== null,
    dateLabel: formatDateDisplay(str(opts?.date)),
    location: str(opts?.location),
    environmentLabel: env ? env.charAt(0).toUpperCase() + env.slice(1) : "",
    emphasis: str(opts?.emphasis),
  };
};

interface PracticePlanPdfArgs extends PracticePlanHandoutOptions {
  team?: Team | null;
  blocks: PlanBlockInput[] | null | undefined;
  toast?: Toast;
}

const renderPracticePlanPdf = async (
  args: PracticePlanPdfArgs,
): Promise<Blob | null> => {
  const data = buildPracticePlanHandout(args.blocks, args);
  if (!data) return null;

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "portrait",
    compress: true,
  });

  const { team } = args;
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
  const footY = pageH - 44;

  // Wide enough for the longest window a wall clock produces
  // ("11:30 PM – 12:15 AM") at the chip's type size.
  const TIME_W = 112;
  const CHIP_W = TIME_W - 14;
  const bodyX = margin + TIME_W;
  const bodyW = contentW - TIME_W - 52;

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
    pdf.text("PRACTICE PLAN", margin, 55);
    pdf.setCharSpace(0);
    if (data.dateLabel) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.text(data.dateLabel, right, 36, { align: "right" });
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    const meta = [
      data.blocks.length === 1 ? "1 block" : `${data.blocks.length} blocks`,
      `${data.totalMinutes} min`,
      data.environmentLabel,
      data.location,
    ].filter(Boolean);
    pdf.text(meta.join("  ·  "), right, data.dateLabel ? 54 : 38, {
      align: "right",
    });
    if (season)
      pdf.text(season.toUpperCase(), right, data.dateLabel ? 68 : 52, {
        align: "right",
      });
    return bandH;
  };

  const drawColumnHeader = (y: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.8);
    pdf.text(data.clocked ? "TIME" : "ELAPSED", margin, y);
    pdf.text("BLOCK", bodyX, y);
    pdf.text("MIN", right, y, { align: "right" });
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.4);
    pdf.line(margin, y + 6, right, y + 6);
    return y + 6;
  };

  let y = drawHeaderBand() + 28;

  // The planner's one-line rationale — why this agenda and not a generic one.
  if (data.emphasis) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    const lines = pdf.splitTextToSize(data.emphasis, contentW) as string[];
    lines.slice(0, 2).forEach((line) => {
      pdf.text(line, margin, y);
      y += 12;
    });
    y += 10;
  }
  y = drawColumnHeader(y) + 16;

  data.blocks.forEach((b) => {
    pdf.setFontSize(8.5);
    const descLines = b.description
      ? (pdf.splitTextToSize(b.description, bodyW) as string[]).slice(0, 2)
      : [];
    const rowH = 32 + descLines.length * 11 + (b.equipment ? 11 : 0);
    if (y + rowH > footY - 8) {
      pdf.addPage();
      y = drawHeaderBand() + 28;
      y = drawColumnHeader(y) + 16;
    }

    // Time window in a tinted chip: the one thing an assistant reads mid-drill.
    pdf.setFillColor(chipBg[0], chipBg[1], chipBg[2]);
    pdf.rect(margin, y - 12, CHIP_W, 22, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(`${b.startLabel} – ${b.endLabel}`, margin + CHIP_W / 2, y + 3, {
      align: "center",
    });

    pdf.setFontSize(11);
    pdf.text(truncate(`${b.index}. ${b.name}`, bodyW, 11), bodyX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    pdf.text(`${b.minutes}m`, right, y, { align: "right" });

    let ty = y + 12;
    if (b.category) {
      pdf.setFontSize(7);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.setCharSpace(0.8);
      pdf.text(b.category.toUpperCase(), bodyX, ty);
      pdf.setCharSpace(0);
      ty += 11;
    }
    if (descLines.length > 0) {
      pdf.setFontSize(8.5);
      pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
      descLines.forEach((line) => {
        pdf.text(line, bodyX, ty);
        ty += 11;
      });
    }
    if (b.equipment) {
      pdf.setFontSize(8);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.text(truncate(`Gear: ${b.equipment}`, bodyW, 8), bodyX, ty);
    }

    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y + rowH - 14, right, y + rowH - 14);
    y += rowH;
  });

  // Ruled space for what actually happened — the reason a paper plan beats a
  // screen at the field.
  const notesH = 92;
  if (y + notesH < footY - 8) {
    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(1);
    pdf.text("NOTES", margin, y);
    pdf.setCharSpace(0);
    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.5);
    for (let i = 1; i <= 4; i += 1)
      pdf.line(margin, y + i * 18, right, y + i * 18);
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
      `${teamName}  ·  Practice plan${data.dateLabel ? `  ·  ${data.dateLabel}` : ""}`,
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

// Build + download the handout straight to the coach's device — same
// direct-download stance as the roster directory and stats report.
export const downloadPracticePlanPdf = async (
  args: PracticePlanPdfArgs,
): Promise<void> => {
  const { team, date, toast } = args;
  try {
    const blob = await renderPracticePlanPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to export yet",
        message: "Build a plan first.",
      });
      return;
    }
    const filename = `practice-plan-${team?.name || "team"}-${
      date || "agenda"
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
      title: "Practice plan downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadPracticePlanPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
