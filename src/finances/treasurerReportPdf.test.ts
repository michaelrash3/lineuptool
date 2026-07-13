import { describe, it, expect } from "vitest";
import { buildTreasurerReportData } from "./treasurerReportPdf";
import type { TeamFinances } from "../types";

const finances: TeamFinances = {
  clubFee: 100,
  feeExemptIds: ["p3"],
  budgetItems: [
    { id: "b1", label: "Tournaments", amount: 400 },
    { id: "b2", label: "Uniforms", amount: 100 },
  ],
  payments: [
    { id: "pay1", playerId: "p1", date: "2026-03-01", amount: 100 },
    { id: "pay2", playerId: "p2", date: "2026-03-02", amount: 60 },
    {
      id: "ref1",
      playerId: "p1",
      date: "2026-04-01",
      amount: 25,
      refund: true,
    },
  ],
  incomes: [
    {
      id: "i1",
      date: "2026-02-01",
      label: "Pizza Co",
      amount: 200,
      sponsor: true,
    },
    {
      id: "i2",
      date: "2026-02-10",
      label: "Car wash",
      amount: 80,
      fundraising: true,
    },
    { id: "i3", date: "2026-02-15", label: "Carried over", amount: 50 },
  ],
  expenses: [
    {
      id: "e1",
      date: "2026-03-05",
      label: "Entry",
      amount: 300,
      budgetItemId: "b1",
    },
    { id: "e2", date: "2026-03-06", label: "Snacks", amount: 40 },
  ],
  pastSeasons: [
    {
      season: "through Spring 2026",
      collected: 900,
      otherIncome: 100,
      spent: 800,
      closingBalance: 200,
      outstanding: [{ playerId: "gone", name: "Cal", owed: 60 }],
    },
  ],
};

const players = [
  { id: "p1", name: "Ava" },
  { id: "p2", name: "Ben" },
  { id: "p3", name: "Waived Wes" },
];

describe("buildTreasurerReportData", () => {
  it("returns null when Finances was never used", () => {
    expect(buildTreasurerReportData({}, players)).toBeNull();
    expect(buildTreasurerReportData(undefined, players)).toBeNull();
  });

  it("assembles the season summary net of refunds", () => {
    const d = buildTreasurerReportData(finances, players)!;
    // 100 + 60 − 25 refund = 135 collected; income 330; spent 340.
    expect(d.collected).toBe(135);
    expect(d.otherIncome).toBe(330);
    expect(d.spent).toBe(340);
    expect(d.balanceNow).toBe(125);
    expect(d.refundsTotal).toBe(25);
  });

  it("splits non-fee income by source (sponsor beats fundraising)", () => {
    const d = buildTreasurerReportData(finances, players)!;
    expect(d.incomeBySource).toEqual({
      sponsors: 200,
      fundraising: 80,
      other: 50,
    });
  });

  it("pairs budget rows with their actual spend and the unplanned bucket", () => {
    const d = buildTreasurerReportData(finances, players)!;
    expect(d.budgetRows).toEqual([
      { label: "Tournaments", planned: 400, spent: 300 },
      { label: "Uniforms", planned: 100, spent: 0 },
    ]);
    expect(d.unplanned).toBe(40);
  });

  it("lists every family's fee/paid/owed, with waived families flagged", () => {
    const d = buildTreasurerReportData(finances, players)!;
    const byName = Object.fromEntries(d.collections.map((c) => [c.name, c]));
    // $80 fundraising splits across 2 payers → $40 credit → effective fee $60.
    expect(byName["Ava"]).toMatchObject({ fee: 60, paid: 75, owed: 0 });
    expect(byName["Ben"]).toMatchObject({ fee: 60, paid: 60, owed: 0 });
    expect(byName["Waived Wes"]).toMatchObject({
      waived: true,
      fee: 0,
      owed: 0,
    });
  });

  it("passes prior seasons through, outstanding snapshots included", () => {
    const d = buildTreasurerReportData(finances, players)!;
    expect(d.pastSeasons).toHaveLength(1);
    expect(d.pastSeasons[0].outstanding?.[0]).toEqual({
      playerId: "gone",
      name: "Cal",
      owed: 60,
    });
  });

  it("includes the reimbursement liability and reconciled months", () => {
    const withExtras: TeamFinances = {
      ...finances,
      reimbursements: [
        { id: "r1", to: "Coach", amount: 45, status: "unpaid" },
        { id: "r2", to: "Parent", amount: 20, status: "paid" },
      ],
      reconciliations: [
        {
          id: "rec1",
          month: "2026-03",
          bankBalance: 150,
          ledgerBalanceAtReconcile: 135,
        },
      ],
    };
    const d = buildTreasurerReportData(withExtras, players)!;
    expect(d.reimbursementsOutstanding).toBe(45); // only the unpaid one
    expect(d.reconciliations).toHaveLength(1);
    expect(d.reconciliations[0].label).toContain("2026");
    expect(d.reconciliations[0].bankBalance).toBe(150);
    expect(typeof d.reconciliations[0].variance).toBe("number");
  });
});
