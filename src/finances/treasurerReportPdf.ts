// Year-end treasurer report — the season-close accountability document the
// audit approved (docs/FINANCES-AUDIT.md §4): where the money came from,
// where it went vs the plan, where every family's dues stand, and how prior
// years closed (including the archived who-still-owed snapshots). The data
// assembly is a pure, tested builder; the PDF mirrors the fee sheet's
// letterhead system and lazy-loads jspdf.

import type { FinancePastSeason, Team, TeamFinances, Toast } from "../types";
import {
  budgetActuals,
  budgetItemAmount,
  financeSummary,
  formatCurrency,
  reimbursementsSummary,
  reconciliationStatus,
  round2,
} from "../utils/helpers";
import {
  hexToRgb,
  idealTextOn,
  tint,
  SLATE_900,
  SLATE_500,
  SLATE_400,
  HAIRLINE,
  ZEBRA,
} from "./pdfStyle";

export interface TreasurerReportData {
  // Headline money (all net of refunds, cent-rounded).
  collected: number;
  otherIncome: number;
  spent: number;
  balanceNow: number;
  stillOwed: number;
  balanceOnceAllPaid: number;
  refundsTotal: number;
  // Non-fee income split by source. A sponsor entry counts as "sponsors"
  // whether or not it also credits dues; fundraising is the non-sponsor
  // fundraising slice; everything else (carryover, misc) is "other".
  incomeBySource: { fundraising: number; sponsors: number; other: number };
  budgetRows: Array<{ label: string; planned: number; spent: number }>;
  unplanned: number;
  collections: Array<{
    playerId: string;
    name: string;
    fee: number;
    paid: number;
    owed: number;
    waived: boolean;
  }>;
  // Unpaid reimbursements owed back to volunteers (a liability).
  reimbursementsOutstanding: number;
  // Reconciled months: real bank figure vs the ledger, with drift flags.
  reconciliations: Array<{
    label: string;
    bankBalance: number;
    variance: number;
    drifted: boolean;
  }>;
  pastSeasons: FinancePastSeason[];
}

// null when Finances was never used — there's nothing to report.
export const buildTreasurerReportData = (
  finances: TeamFinances | null | undefined,
  players: Array<{ id: string; name?: string }> | null | undefined,
): TreasurerReportData | null => {
  const hasActivity =
    (finances?.payments || []).length > 0 ||
    (finances?.incomes || []).length > 0 ||
    (finances?.expenses || []).length > 0 ||
    Number(finances?.clubFee) > 0 ||
    (finances?.pastSeasons || []).length > 0;
  if (!finances || !hasActivity) return null;

  const s = financeSummary(finances, players);

  let fundraising = 0;
  let sponsors = 0;
  let other = 0;
  for (const inc of finances.incomes || []) {
    const amt = Number(inc?.amount) || 0;
    if (inc?.sponsor) sponsors += amt;
    else if (inc?.fundraising) fundraising += amt;
    else other += amt;
  }

  let refundsTotal = 0;
  for (const pay of finances.payments || []) {
    if (pay?.refund) refundsTotal += Number(pay?.amount) || 0;
  }

  const actuals = budgetActuals(finances);
  const budgetRows = (finances.budgetItems || []).map((item) => ({
    label: (item.label || "Budget item").trim() || "Budget item",
    planned: budgetItemAmount(item, finances.salesTaxPct),
    spent: round2(actuals.byItem[item.id] || 0),
  }));

  const exempt = new Set(finances.feeExemptIds || []);
  const collections = (players || [])
    .filter((p) => p?.id)
    .map((p) => {
      const waived = exempt.has(p.id);
      const fee = waived
        ? 0
        : (s.effectiveFeeByPlayer[p.id] ?? s.effectiveFeePerPlayer);
      const paid = round2(s.paidByPlayer[p.id] || 0);
      return {
        playerId: p.id,
        name: p.name || "Player",
        fee,
        paid,
        owed: waived ? 0 : Math.max(0, round2(fee - paid)),
        waived,
      };
    });

  const reimbursementsOutstanding = reimbursementsSummary(finances).outstanding;
  const reconciliations = reconciliationStatus(finances, players)
    .filter((r) => r.reconciled && r.bankBalance != null && r.variance != null)
    .map((r) => ({
      label: `${r.label} ${r.month.slice(0, 4)}`,
      bankBalance: r.bankBalance as number,
      variance: r.variance as number,
      drifted: r.drifted,
    }));

  return {
    collected: s.collected,
    otherIncome: s.otherIncome,
    spent: s.spent,
    balanceNow: s.balanceNow,
    stillOwed: s.stillOwed,
    balanceOnceAllPaid: s.balanceOnceAllPaid,
    refundsTotal: round2(refundsTotal),
    incomeBySource: {
      fundraising: round2(fundraising),
      sponsors: round2(sponsors),
      other: round2(other),
    },
    budgetRows,
    unplanned: round2(actuals.unplanned),
    collections,
    reimbursementsOutstanding,
    reconciliations,
    pastSeasons: finances.pastSeasons || [],
  };
};

interface TreasurerReportArgs {
  team?: Team | null;
  finances: TeamFinances | null | undefined;
  players: Array<{ id: string; name?: string }> | null | undefined;
  toast?: Toast;
}

const renderTreasurerReportPdf = async ({
  team,
  finances,
  players,
}: TreasurerReportArgs): Promise<Blob | null> => {
  const data = buildTreasurerReportData(finances, players);
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
  pdf.text("TREASURER REPORT", margin, 72);
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

  let y = bandH + 34;

  // Page-break helper: continuation pages skip the band and restart high.
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

  // A right-aligned money row with an optional zebra stripe and bold total.
  const ROW_H = 20;
  const moneyRow = (
    label: string,
    values: Array<{ text: string; x: number }>,
    opts?: { zebra?: boolean; bold?: boolean; dim?: boolean },
  ) => {
    ensureRoom(ROW_H);
    if (opts?.zebra) {
      pdf.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
      pdf.rect(margin, y - 13, contentW, ROW_H - 2, "F");
    }
    pdf.setFont("helvetica", opts?.bold ? "bold" : "normal");
    pdf.setFontSize(10.5);
    const ink = opts?.dim ? SLATE_500 : SLATE_900;
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(label, margin + 8, y);
    pdf.setFont("helvetica", "bold");
    for (const v of values) pdf.text(v.text, v.x, y, { align: "right" });
    y += ROW_H;
  };

  // ---- Season summary (tile band) ----
  const tiles: Array<[string, number]> = [
    ["Fees collected", data.collected],
    ["Other income", data.otherIncome],
    ["Spent", data.spent],
    ["Balance now", data.balanceNow],
    ["Still owed", data.stillOwed],
    ["Once all paid", data.balanceOnceAllPaid],
  ];
  const tileW = contentW / 3;
  const tileH = 58;
  const bandBg = tint(accent, 0.92);
  pdf.setFillColor(bandBg[0], bandBg[1], bandBg[2]);
  pdf.rect(margin, y, contentW, tileH * 2, "F");
  pdf.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  pdf.setLineWidth(0.75);
  pdf.rect(margin, y, contentW, tileH * 2);
  tiles.forEach(([label, value], i) => {
    const tx = margin + (i % 3) * tileW + 14;
    const ty = y + Math.floor(i / 3) * tileH;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    pdf.setCharSpace(1);
    pdf.text(label.toUpperCase(), tx, ty + 22);
    pdf.setCharSpace(0);
    pdf.setFontSize(16);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(formatCurrency(value), tx, ty + 44);
  });
  y += tileH * 2 + 30;

  // ---- Income by source ----
  sectionTitle("Income by source");
  const oneCol = [{ x: right - 8 }];
  moneyRow(
    `Club fees${data.refundsTotal > 0 ? ` (net of ${formatCurrency(data.refundsTotal)} refunded)` : ""}`,
    [{ text: formatCurrency(data.collected), ...oneCol[0] }],
    { zebra: true },
  );
  moneyRow("Sponsors", [
    { text: formatCurrency(data.incomeBySource.sponsors), ...oneCol[0] },
  ]);
  moneyRow(
    "Fundraising",
    [{ text: formatCurrency(data.incomeBySource.fundraising), ...oneCol[0] }],
    { zebra: true },
  );
  moneyRow("Other income (carryover, misc.)", [
    { text: formatCurrency(data.incomeBySource.other), ...oneCol[0] },
  ]);
  moneyRow(
    "Total received",
    [
      {
        text: formatCurrency(round2(data.collected + data.otherIncome)),
        ...oneCol[0],
      },
    ],
    { bold: true },
  );
  y += 14;

  // ---- Budget vs actual ----
  if (data.budgetRows.length > 0 || data.unplanned > 0) {
    sectionTitle("Budget vs actual");
    const plannedX = right - 110;
    const spentX = right - 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text("PLANNED", plannedX, y - 4, { align: "right" });
    pdf.text("SPENT", spentX, y - 4, { align: "right" });
    y += 6;
    data.budgetRows.forEach((row, i) => {
      moneyRow(
        row.label,
        [
          { text: formatCurrency(row.planned), x: plannedX },
          { text: formatCurrency(row.spent), x: spentX },
        ],
        { zebra: i % 2 === 0 },
      );
    });
    if (data.unplanned > 0) {
      moneyRow(
        "Unplanned spending",
        [
          { text: "—", x: plannedX },
          { text: formatCurrency(data.unplanned), x: spentX },
        ],
        { zebra: data.budgetRows.length % 2 === 0 },
      );
    }
    moneyRow("Total spent", [{ text: formatCurrency(data.spent), x: spentX }], {
      bold: true,
    });
    y += 14;
  }

  // ---- Collections by family ----
  if (data.collections.length > 0) {
    sectionTitle("Collections by family");
    const feeX = right - 190;
    const paidX = right - 100;
    const owedX = right - 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text("FEE", feeX, y - 4, { align: "right" });
    pdf.text("PAID", paidX, y - 4, { align: "right" });
    pdf.text("OWED", owedX, y - 4, { align: "right" });
    y += 6;
    data.collections.forEach((c, i) => {
      moneyRow(
        c.waived ? `${c.name} (waived)` : c.name,
        c.waived
          ? [{ text: "—", x: owedX }]
          : [
              { text: formatCurrency(c.fee), x: feeX },
              { text: formatCurrency(c.paid), x: paidX },
              { text: c.owed > 0 ? formatCurrency(c.owed) : "✓", x: owedX },
            ],
        { zebra: i % 2 === 0, dim: c.waived },
      );
    });
    moneyRow(
      "Outstanding",
      [{ text: formatCurrency(data.stillOwed), x: owedX }],
      { bold: true },
    );
    y += 14;
  }

  // ---- Reconciliation & liabilities ----
  if (data.reimbursementsOutstanding > 0 || data.reconciliations.length > 0) {
    sectionTitle("Reconciliation & liabilities");
    if (data.reimbursementsOutstanding > 0) {
      moneyRow(
        "Owed to volunteers (unpaid reimbursements)",
        [
          {
            text: formatCurrency(data.reimbursementsOutstanding),
            x: right - 8,
          },
        ],
        { bold: true },
      );
    }
    if (data.reconciliations.length > 0) {
      const bankX = right - 150;
      const varX = right - 8;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
      pdf.text("BANK", bankX, y - 4, { align: "right" });
      pdf.text("VARIANCE", varX, y - 4, { align: "right" });
      y += 6;
      data.reconciliations.forEach((r, i) => {
        moneyRow(
          r.drifted ? `${r.label} (drifted since)` : r.label,
          [
            { text: formatCurrency(r.bankBalance), x: bankX },
            {
              text: r.variance === 0 ? "✓" : formatCurrency(r.variance),
              x: varX,
            },
          ],
          { zebra: i % 2 === 0 },
        );
      });
    }
    y += 14;
  }

  // ---- Prior years ----
  if (data.pastSeasons.length > 0) {
    sectionTitle("Prior years");
    const inX = right - 230;
    const outX = right - 145;
    const closeX = right - 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(SLATE_400[0], SLATE_400[1], SLATE_400[2]);
    pdf.text("IN", inX, y - 4, { align: "right" });
    pdf.text("OUT", outX, y - 4, { align: "right" });
    pdf.text("CLOSED AT", closeX, y - 4, { align: "right" });
    y += 6;
    data.pastSeasons.forEach((ps, i) => {
      const unpaid = (ps.outstanding || []).reduce((sum, o) => sum + o.owed, 0);
      moneyRow(
        unpaid > 0
          ? `${ps.season} — ${formatCurrency(round2(unpaid))} unpaid (${(ps.outstanding || []).length} families)`
          : ps.season,
        [
          {
            text: formatCurrency(round2(ps.collected + ps.otherIncome)),
            x: inX,
          },
          { text: formatCurrency(ps.spent), x: outX },
          { text: formatCurrency(ps.closingBalance), x: closeX },
        ],
        { zebra: i % 2 === 0 },
      );
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
    pdf.setFontSize(9);
    pdf.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    pdf.text(
      `${teamName}${season ? `  ·  ${season}` : ""}`,
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

// Downloads the treasurer report straight to the coach's device — same
// direct-download stance as the fee sheet (a records document, not a share).
export const downloadTreasurerReportPdf = async (
  args: TreasurerReportArgs,
): Promise<void> => {
  const { team, toast } = args;
  try {
    const blob = await renderTreasurerReportPdf(args);
    if (!blob) {
      toast?.push({
        kind: "error",
        title: "Nothing to report yet",
        message: "Record fees, income, or expenses first.",
      });
      return;
    }
    const filename = `treasurer-report-${team?.name || "team"}-${
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
      title: "Treasurer report downloaded",
      message: "Saved to your downloads — print or share from there.",
    });
  } catch (e) {
    console.error("downloadTreasurerReportPdf failed", e);
    toast?.push({
      kind: "error",
      title: "Couldn't generate PDF",
      message: (e instanceof Error ? e.message : null) || "Try again.",
    });
  }
};
