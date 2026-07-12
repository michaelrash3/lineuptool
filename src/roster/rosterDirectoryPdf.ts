// Printable roster & emergency-contact directory. A coach hands this out (or
// keeps it in the scorebook) so every family's contact + emergency number is on
// one sheet — the thing coaches otherwise rebuild by hand each season. Reads the
// contact fields that land on a Player when a Player Info submission is applied
// (parentName/email/phone + parent2*; see applyPlayerInfoToPlayer in
// useTryoutFlows). jspdf is loaded lazily, matching feeSheetPdf / the lineup
// card, so it stays out of the startup bundle.

import type { Player, Team, Toast } from "../types";

export interface DirectoryRow {
  id: string;
  number: string;
  name: string;
  positions: string;
  guardian: string;
  phone: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
}

const str = (v: unknown): string => String(v ?? "").trim();

// Short position summary: primary, then secondary, then any comfortable
// positions, plus C when the kid catches — deduped, first three, "/"-joined.
const positionSummary = (p: Player): string => {
  const out: string[] = [];
  const push = (v?: string) => {
    const s = str(v).toUpperCase();
    if (s && !out.includes(s)) out.push(s);
  };
  push(p.primaryPosition);
  push(p.secondaryPosition);
  (Array.isArray(p.comfortablePositions) ? p.comfortablePositions : []).forEach(
    push,
  );
  if (p.isCatcher) push("C");
  return out.slice(0, 3).join("/");
};

// Numbers sort numerically when both are numeric, else fall back to name.
const compareRows = (a: DirectoryRow, b: DirectoryRow): number => {
  const na = Number(a.number);
  const nb = Number(b.number);
  const aNum = a.number !== "" && !Number.isNaN(na);
  const bNum = b.number !== "" && !Number.isNaN(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1; // numbered players first
  return a.name.localeCompare(b.name);
};

// Normalize roster players into directory rows. Released players are dropped
// (a directory is for the active roster); everyone else is included even with
// missing contact info so gaps are visible to chase down. Pure + exported so
// it's unit-tested without touching jspdf.
export const buildRosterDirectoryRows = (
  players: Player[] | null | undefined,
): DirectoryRow[] =>
  (players || [])
    .filter((p) => p && p.playerStatus !== "released")
    .map((p) => ({
      id: str(p.id),
      number: str(p.number),
      name: str(p.name) || "Unnamed",
      positions: positionSummary(p),
      guardian: str(p.parentName),
      phone: str(p.phone),
      email: str(p.email),
      emergencyName: str(p.parent2Name),
      emergencyPhone: str(p.parent2Phone),
    }))
    .sort(compareRows);

type RGB = [number, number, number];
const hexToRgb = (hex?: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [17, 24, 39];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};
const idealTextOn = (c: RGB): RGB => {
  const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return luminance > 0.62 ? [17, 24, 39] : [255, 255, 255];
};

const SLATE_900: RGB = [17, 24, 39];
const SLATE_600: RGB = [71, 85, 105];
const SLATE_500: RGB = [100, 116, 139];
const SLATE_400: RGB = [148, 163, 184];
const HAIRLINE: RGB = [226, 232, 240];
const ZEBRA: RGB = [247, 249, 252];

interface DirectoryArgs {
  team?: Team | null;
  players: Player[] | null | undefined;
  toast?: Toast;
}

const renderRosterDirectoryPdf = async ({
  team,
  players,
}: DirectoryArgs): Promise<Blob | null> => {
  const rows = buildRosterDirectoryRows(players);
  if (rows.length === 0) return null;

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

  // Column layout (x offset from margin, width). PLAYER carries #+name;
  // CONTACT/EMERGENCY stack a name over a phone/email so the grid stays wide
  // enough to read on a printed page.
  const col = {
    player: { x: 0, w: 150 },
    pos: { x: 152, w: 44 },
    contact: { x: 200, w: 150 },
    email: { x: 352, w: 0 }, // width filled in below
    emergency: { x: 0, w: 132 },
  };
  col.emergency.x = contentW - col.emergency.w;
  col.email.w = col.emergency.x - col.email.x - 10;

  const truncate = (text: string, width: number, size: number): string => {
    if (!text) return "";
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, width) as string[];
    if (lines.length <= 1) return lines[0] ?? text;
    let first = lines[0];
    while (first.length > 1 && pdf.getTextWidth(first + "…") > width)
      first = first.slice(0, -1);
    return first + "…";
  };

  const drawHeaderBand = () => {
    const bandH = 84;
    pdf.setFillColor(accent[0], accent[1], accent[2]);
    pdf.rect(0, 0, pageW, bandH, "F");
    let textX = margin;
    const logo = (team?.logoUrl || "").trim();
    if (logo.startsWith("data:image")) {
      try {
        const props = pdf.getImageProperties(logo);
        if (props?.width && props?.height) {
          const chip = 52;
          const cy = (bandH - chip) / 2;
          pdf.setFillColor(255, 255, 255);
          pdf.roundedRect(margin, cy, chip, chip, 7, 7, "F");
          const box = chip - 14;
          const r = Math.min(box / props.width, box / props.height);
          const lw = props.width * r;
          const lh = props.height * r;
          pdf.addImage(
            logo,
            props.fileType || "PNG",
            margin + (chip - lw) / 2,
            cy + (chip - lh) / 2,
            lw,
            lh,
            undefined,
            "FAST",
          );
          textX = margin + chip + 16;
        }
      } catch {
        // Unsupported logo data — omit the chip.
      }
    }
    pdf.setTextColor(onAccent[0], onAccent[1], onAccent[2]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(19);
    pdf.text(teamName, textX, 40);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setCharSpace(2);
    pdf.text("ROSTER & EMERGENCY CONTACTS", textX, 58);
    pdf.setCharSpace(0);
    const issued = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    pdf.setFontSize(9);
    if (season) pdf.text(season.toUpperCase(), right, 38, { align: "right" });
    pdf.text(`Issued ${issued}`, right, season ? 54 : 40, { align: "right" });
    return bandH;
  };

  const drawColumnHeader = (y: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(0.8);
    pdf.text("PLAYER", margin + col.player.x, y);
    pdf.text("POS", margin + col.pos.x, y);
    pdf.text("PARENT / GUARDIAN", margin + col.contact.x, y);
    pdf.text("EMAIL", margin + col.email.x, y);
    pdf.text("EMERGENCY", margin + col.emergency.x, y);
    pdf.setCharSpace(0);
    pdf.setDrawColor(accent[0], accent[1], accent[2]);
    pdf.setLineWidth(1.4);
    pdf.line(margin, y + 7, right, y + 7);
    return y + 7;
  };

  let bandH = drawHeaderBand();
  let y = bandH + 28;
  y = drawColumnHeader(y) + 6;

  const rowH = 34;
  const footReserve = 54;
  rows.forEach((r, i) => {
    if (y + rowH > pageH - footReserve) {
      pdf.addPage();
      bandH = drawHeaderBand();
      y = bandH + 28;
      y = drawColumnHeader(y) + 6;
    }
    if (i % 2 === 0) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y, contentW, rowH, "F");
    }
    const line1 = y + 14;
    const line2 = y + 27;

    // Player (# + name) and position.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    const label = r.number ? `#${r.number}  ${r.name}` : r.name;
    pdf.text(truncate(label, col.player.w, 11), margin + col.player.x, line1);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.text(r.positions || "—", margin + col.pos.x, line1);

    // Primary contact (name over phone).
    pdf.setFontSize(9.5);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      truncate(r.guardian || "—", col.contact.w, 9.5),
      margin + col.contact.x,
      line1,
    );
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    pdf.text(
      truncate(r.phone, col.contact.w, 9.5),
      margin + col.contact.x,
      line2,
    );

    // Email.
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    pdf.text(truncate(r.email, col.email.w, 9.5), margin + col.email.x, line1);

    // Emergency / 2nd contact (name over phone).
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      truncate(r.emergencyName || "—", col.emergency.w, 9.5),
      margin + col.emergency.x,
      line1,
    );
    pdf.setTextColor(SLATE_600[0], SLATE_600[1], SLATE_600[2]);
    pdf.text(
      truncate(r.emergencyPhone, col.emergency.w, 9.5),
      margin + col.emergency.x,
      line2,
    );

    pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y + rowH, right, y + rowH);
    y += rowH;
  });

  // Footer on the final page.
  const footY = pageH - footReserve + 16;
  pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  pdf.setLineWidth(0.75);
  pdf.line(margin, footY, right, footY);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
  pdf.text(
    `${teamName}${season ? `  ·  ${season}` : ""}  ·  ${rows.length} players`,
    margin,
    footY + 16,
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
  pdf.text("Confidential — for coaching staff use only.", right, footY + 16, {
    align: "right",
  });

  return pdf.output("blob");
};

// Build + download the directory straight to the coach's device.
export const downloadRosterDirectoryPdf = async (
  args: DirectoryArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderRosterDirectoryPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "No players yet",
        message: "Add players to the roster first.",
      });
      return;
    }
    const filename = `roster-directory-${team?.name || "team"}-${
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
      title: "Directory downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
