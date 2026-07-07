import { describe, it, expect } from "vitest";
import {
  shouldRollFinances,
  rollFinancesForNewSeason,
  financeSummary,
  suggestedFeePerPlayer,
  sponsorshipTotal,
  feeOffsetSponsorshipTotal,
  teamFeesStatus,
  transactionLedger,
  budgetActuals,
  ledgerCsv,
  budgetItemAmount,
  budgetTotal,
  parseMoneyInput,
  MAX_MONEY_INPUT,
  budgetItemCategory,
  expenseCategory,
  budgetByCategory,
  spendingByCategory,
} from "./finances";
import type { TeamFinances } from "../types";

// The money engine had no direct tests. The two things locked here:
// 1. Season-rollover integrity — the season YEAR runs Fall → Spring, so a
//    Fall→Spring advance must leave the ledger/collections COMPLETELY intact,
//    and only a new Fall rolls the money (carry balance, archive year, promote
//    the planned fee).
// 2. The per-sponsor "reduces team fees" switch — each sponsor entry decides
//    for itself whether its money lowers what families pay (default yes):
//    a this-season sponsor via its own fundraising flag, a next-season pledge
//    via reducesFees. Never all-or-nothing across sponsors.

const activeFinances = (): TeamFinances => ({
  clubFee: 100,
  payments: [
    { id: "pay1", playerId: "p1", date: "2026-09-10", amount: 100 },
    { id: "pay2", playerId: "p2", date: "2026-09-12", amount: 60 },
  ],
  incomes: [{ id: "inc1", date: "2026-09-20", label: "Car wash", amount: 200 }],
  expenses: [
    { id: "exp1", date: "2026-10-01", label: "Tournament entry", amount: 250 },
  ],
  nextClubFee: 250,
  nextDepositAmount: 50,
  nextDepositDueDate: "2027-08-01",
  feeExemptIds: ["p9"],
  sponsorships: [
    { id: "sp1", sponsor: "Main Street Pizza", amount: 300 },
    { id: "sp2", sponsor: "", amount: 0 }, // zero pledge — must not convert
  ],
  pastSeasons: [
    {
      season: "through Spring 2026",
      collected: 900,
      otherIncome: 100,
      spent: 800,
      closingBalance: 200,
    },
  ],
});

describe("shouldRollFinances — when the money rolls", () => {
  it("NEVER rolls on the mid-year Fall→Spring advance", () => {
    expect(shouldRollFinances("Spring 2027", activeFinances())).toBe(false);
  });

  it("rolls when a new Fall (new season year) begins", () => {
    expect(shouldRollFinances("Fall 2026", activeFinances())).toBe(true);
  });

  it("no-ops when Finances was never used", () => {
    expect(shouldRollFinances("Fall 2026", undefined)).toBe(false);
    expect(shouldRollFinances("Fall 2026", {})).toBe(false);
  });

  it("rolls into Fall on a planned fee alone (Budget Planner promise)", () => {
    expect(shouldRollFinances("Fall 2026", { nextClubFee: 250 })).toBe(true);
    // …but a planned fee still never rolls mid-year.
    expect(shouldRollFinances("Spring 2027", { nextClubFee: 250 })).toBe(false);
  });
});

describe("Fall→Spring keeps the ledger intact (the provider contract)", () => {
  it("passes finances through untouched when the roll is skipped", () => {
    const finances = activeFinances();
    // Mirrors TeamProvider.advanceSeason:
    //   rollFinances ? rollFinancesForNewSeason(...) : teamData.finances
    const roll = shouldRollFinances("Spring 2027", finances);
    const newSeasonFinances = roll
      ? rollFinancesForNewSeason(finances, "Fall 2026", "2027-02-01")
      : finances;
    // Same object — every payment, income, expense, fee, due date, exemption,
    // sponsorship pledge, and archived season survives verbatim.
    expect(newSeasonFinances).toBe(finances);
  });
});

describe("rollFinancesForNewSeason — the Spring→Fall year roll", () => {
  const rolled = rollFinancesForNewSeason(
    activeFinances(),
    "Spring 2027",
    "2027-08-15",
  )!;

  it("resets the row-level ledger for the new year", () => {
    expect(rolled.payments).toEqual([]);
    expect(rolled.expenses).toEqual([]);
  });

  it("carries the closing balance as the opening income line", () => {
    // 160 collected + 200 income − 250 spent = 110.
    const carry = (rolled.incomes || []).find((i) =>
      i.label.startsWith("Carried over"),
    );
    expect(carry?.amount).toBe(110);
    expect(carry?.label).toContain("through Spring 2027");
    // Carry-over is plain income — it must NOT silently discount dues.
    expect(carry?.fundraising).toBeUndefined();
  });

  it("converts sponsor pledges into named income entries (zero pledges dropped)", () => {
    const pledged = (rolled.incomes || []).filter((i) =>
      i.label.startsWith("Sponsorship"),
    );
    expect(pledged).toHaveLength(1);
    expect(pledged[0].label).toContain("Main Street Pizza");
    expect(pledged[0].amount).toBe(300);
    expect(pledged[0].fundraising).toBeUndefined();
    expect(rolled.sponsorships).toBeUndefined();
  });

  it("promotes the planned fee + deposit onto the new collection cycle", () => {
    expect(rolled.clubFee).toBe(250);
    expect(rolled.depositAmount).toBe(50);
    expect(rolled.depositDueDate).toBe("2027-08-01");
    expect(rolled.nextClubFee).toBeUndefined();
    expect(rolled.nextDepositAmount).toBeUndefined();
  });

  it("clears fee exemptions (they were for last year's roster)", () => {
    expect(rolled.feeExemptIds).toBeUndefined();
  });

  it("archives the closed year WITHOUT losing earlier archives", () => {
    expect(rolled.pastSeasons).toHaveLength(2);
    expect(rolled.pastSeasons?.[0].season).toBe("through Spring 2026");
    expect(rolled.pastSeasons?.[1]).toEqual({
      season: "through Spring 2027",
      collected: 160,
      otherIncome: 200,
      spent: 250,
      closingBalance: 110,
    });
  });

  it("carries a NEGATIVE balance as an opening debt expense", () => {
    const inDebt = rollFinancesForNewSeason(
      {
        ...activeFinances(),
        expenses: [
          { id: "exp1", date: "2026-10-01", label: "Uniforms", amount: 500 },
        ],
      },
      "Spring 2027",
      "2027-08-15",
    )!;
    // 160 + 200 − 500 = −140.
    const debt = (inDebt.expenses || []).find((e) =>
      e.label.startsWith("Debt carried over"),
    );
    expect(debt?.amount).toBe(140);
    expect(
      (inDebt.incomes || []).some((i) => i.label.startsWith("Carried over")),
    ).toBe(false);
  });

  it("plan-only roll promotes the fee with a clean ledger and no archive", () => {
    const planned = rollFinancesForNewSeason(
      { nextClubFee: 275, sponsorships: [] },
      "Spring 2027",
      "2027-08-15",
    )!;
    expect(planned.clubFee).toBe(275);
    expect(planned.payments).toEqual([]);
    expect(planned.expenses).toEqual([]);
    expect(planned.pastSeasons).toBeUndefined();
  });
});

describe("per-sponsor 'reduces team fees' switch", () => {
  const players = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];

  it("a pledge offsets the suggested fee by default (switch unset/on)", () => {
    const finances: TeamFinances = {
      budgetItems: [{ id: "b1", label: "Season costs", amount: 1000 }],
      sponsorships: [{ id: "sp1", sponsor: "Pizza", amount: 600 }],
    };
    // (1000 − 600) / 4 = 100.
    expect(suggestedFeePerPlayer(finances, players)).toBe(100);
  });

  it("a pledge held as club income does NOT offset the fee", () => {
    const finances: TeamFinances = {
      budgetItems: [{ id: "b1", label: "Season costs", amount: 1000 }],
      sponsorships: [
        { id: "sp1", sponsor: "Pizza", amount: 600, reducesFees: false },
      ],
    };
    // Full 1000 / 4 = 250 — this sponsor's money doesn't discount the fee.
    expect(suggestedFeePerPlayer(finances, players)).toBe(250);
  });

  it("mixed pledges: only the fee-reducing ones offset — never all-or-nothing", () => {
    const finances: TeamFinances = {
      budgetItems: [{ id: "b1", label: "Season costs", amount: 1000 }],
      sponsorships: [
        { id: "sp1", sponsor: "Pizza", amount: 400 }, // reduces (default)
        { id: "sp2", sponsor: "Hardware", amount: 600, reducesFees: false },
      ],
    };
    expect(feeOffsetSponsorshipTotal(finances)).toBe(400);
    expect(sponsorshipTotal(finances)).toBe(1000); // gross total for display
    // (1000 − 400) / 4 = 150 — Hardware's pledge stays club income.
    expect(suggestedFeePerPlayer(finances, players)).toBe(150);
  });

  it("a this-season sponsor credits dues only when ITS switch is on", () => {
    const finances: TeamFinances = {
      clubFee: 100,
      incomes: [
        // Switch on → fundraising credit against dues.
        {
          id: "inc1",
          date: "2026-09-01",
          label: "Sponsorship — Pizza",
          amount: 120,
          fundraising: true,
          sponsor: true,
        },
        // Switch off → plain club income, no fundraising flag: fees unchanged.
        {
          id: "inc2",
          date: "2026-09-02",
          label: "Sponsorship — Hardware",
          amount: 80,
          sponsor: true,
        },
        // A car wash is not a sponsor; it credits dues as ever.
        {
          id: "inc3",
          date: "2026-09-08",
          label: "Car wash",
          amount: 40,
          fundraising: true,
        },
      ],
    };
    const s = financeSummary(finances, players);
    // Pizza (120) + car wash (40) credit dues: 160 / 4 = $40 each; Hardware
    // stays out of the credit but is still in the bank.
    expect(s.duesCreditPerPlayer).toBe(40);
    expect(s.effectiveFeePerPlayer).toBe(60);
    expect(s.otherIncome).toBe(240);
    expect(s.balanceNow).toBe(240);
  });
});

// --- Money-math hardening (audit finding 3.3) + input parsing (3.5) ---

describe("cent rounding at aggregation boundaries", () => {
  it("sums drift-prone payment amounts to exact cents", () => {
    // 0.1 + 0.2 !== 0.3 in raw floats; the summary must not leak that.
    const finances: TeamFinances = {
      clubFee: 0.3,
      payments: [
        { id: "a", playerId: "p1", date: "2026-03-01", amount: 0.1 },
        { id: "b", playerId: "p1", date: "2026-03-02", amount: 0.2 },
      ],
    };
    const s = financeSummary(finances, [{ id: "p1" }]);
    expect(s.collected).toBe(0.3);
    expect(s.paidByPlayer.p1).toBe(0.3);
    // The family is settled EXACTLY — no fraction-of-a-cent residue.
    expect(s.stillOwed).toBe(0);
    expect(s.balanceNow).toBe(0.3);
  });

  it("teamFeesStatus does not call a settled family unpaid over sub-cent drift", () => {
    const finances: TeamFinances = {
      clubFee: 0.3,
      payments: [
        { id: "a", playerId: "p1", date: "2026-03-01", amount: 0.1 },
        { id: "b", playerId: "p1", date: "2026-03-02", amount: 0.2 },
      ],
    };
    const st = teamFeesStatus(finances, [{ id: "p1" }]);
    expect(st.fullOwedCount).toBe(0);
    expect(st.stillOwed).toBe(0);
  });

  it("keeps the ledger running balance in exact agreement with the CSV", () => {
    const finances: TeamFinances = {
      payments: [{ id: "a", playerId: "p1", date: "2026-03-01", amount: 10.1 }],
      expenses: [{ id: "e", date: "2026-03-02", label: "x", amount: 10.2 }],
      incomes: [{ id: "i", date: "2026-03-03", label: "y", amount: 0.35 }],
    };
    const rows = transactionLedger(finances);
    expect(rows.map((r) => r.balanceAfter)).toEqual([10.1, -0.1, 0.25]);
    const csv = ledgerCsv(finances);
    expect(csv).toContain("-0.10");
    expect(csv).toContain("0.25");
  });

  it("rounds the taxed budget projection to cents", () => {
    const finances: TeamFinances = {
      salesTaxPct: 8.25,
      budgetItems: [
        { id: "b1", label: "Entry", amount: 449.99, taxable: true },
      ],
    };
    // 449.99 × 1.0825 = 487.114175 → 487.11, and the total matches exactly.
    expect(budgetItemAmount(finances.budgetItems![0], 8.25)).toBe(487.11);
    expect(budgetTotal(finances)).toBe(487.11);
  });
});

describe("parseMoneyInput", () => {
  it("parses plain, $-prefixed, and thousands-grouped amounts", () => {
    expect(parseMoneyInput("1500")).toBe(1500);
    expect(parseMoneyInput("$ 12.50")).toBe(12.5);
    expect(parseMoneyInput("1,500")).toBe(1500);
    expect(parseMoneyInput("12,345.67")).toBe(12345.67);
  });

  it("treats a short trailing comma group as a decimal separator", () => {
    // Previously "1,50" silently became 150 — a 100× error.
    expect(parseMoneyInput("1,50")).toBe(1.5);
    expect(parseMoneyInput("12,5")).toBe(12.5);
  });

  it("rejects malformed grouping instead of silently stripping commas", () => {
    expect(parseMoneyInput("1,0000")).toBeNull();
    expect(parseMoneyInput("12,34")).toBe(12.34); // comma-decimal, valid
    expect(parseMoneyInput("1,23,456")).toBeNull();
  });

  it("rejects NaN, negatives, and amounts over the sanity cap", () => {
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-50")).toBeNull();
    expect(parseMoneyInput(String(MAX_MONEY_INPUT + 1))).toBeNull();
    expect(parseMoneyInput(String(MAX_MONEY_INPUT))).toBe(MAX_MONEY_INPUT);
  });

  it("treats zero/blank as null unless allowZero (clear-the-fee commits)", () => {
    expect(parseMoneyInput("0")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("0", { allowZero: true })).toBe(0);
    expect(parseMoneyInput("", { allowZero: true })).toBeNull();
  });

  it("rounds to whole cents", () => {
    expect(parseMoneyInput("10.999")).toBe(11);
    expect(parseMoneyInput("10.994")).toBe(10.99);
  });
});

// --- Date integrity (audit finding 3.4) + unpaid-dues archive (3.6) ---

describe("ledger date integrity", () => {
  it("sinks undated/malformed rows to the bottom so the running balance stays sane", () => {
    const finances: TeamFinances = {
      incomes: [
        { id: "bad", date: "", label: "Mystery money", amount: 500 },
        { id: "i1", date: "2026-03-01", label: "Sponsor", amount: 100 },
      ],
      expenses: [{ id: "e1", date: "2026-03-05", label: "Balls", amount: 40 }],
    };
    const rows = transactionLedger(finances);
    expect(rows.map((r) => r.id)).toEqual(["i1", "e1", "bad"]);
    // Dated rows carry a clean running balance; the undated row lands last.
    expect(rows[0].balanceAfter).toBe(100);
    expect(rows[1].balanceAfter).toBe(60);
    expect(rows[2].balanceAfter).toBe(560);
  });
});

describe("rollover archives who still owed (finding 3.6)", () => {
  const players = [
    { id: "p1", name: "Ava" },
    { id: "p2", name: "Ben" },
    { id: "p9", name: "Waived Wes" },
  ];

  it("snapshots partial payers onto the archived season, excluding exempt and settled", () => {
    const rolled = rollFinancesForNewSeason(
      activeFinances(),
      "Spring 2027",
      "2027-08-01",
      players,
    );
    const archived =
      rolled?.pastSeasons?.[(rolled?.pastSeasons?.length || 1) - 1];
    // Fee 100: Ava paid 100 (settled), Ben paid 60 (owes 40), Wes is exempt.
    expect(archived?.outstanding).toEqual([
      { playerId: "p2", name: "Ben", owed: 40 },
    ]);
    // The carry itself is unchanged — unpaid dues still don't carry over.
    expect(archived?.closingBalance).toBe(110);
  });

  it("omits the outstanding key entirely when everyone settled", () => {
    const settled: TeamFinances = {
      ...activeFinances(),
      payments: [
        { id: "pay1", playerId: "p1", date: "2026-09-10", amount: 100 },
        { id: "pay2", playerId: "p2", date: "2026-09-12", amount: 100 },
      ],
    };
    const rolled = rollFinancesForNewSeason(
      settled,
      "Spring 2027",
      "2027-08-01",
      players,
    );
    expect(
      "outstanding" in
        (rolled?.pastSeasons?.[(rolled?.pastSeasons?.length || 1) - 1] || {}),
    ).toBe(false);
  });

  it("keeps the legacy call shape working (no players → no snapshot)", () => {
    const rolled = rollFinancesForNewSeason(
      activeFinances(),
      "Spring 2027",
      "2027-08-01",
    );
    expect(
      "outstanding" in
        (rolled?.pastSeasons?.[(rolled?.pastSeasons?.length || 1) - 1] || {}),
    ).toBe(false);
  });
});

// --- Attribution passthrough (audit finding 3.7) ---

describe("ledger attribution passthrough", () => {
  it("carries recordedBy/recordedAt onto ledger rows when present", () => {
    const finances: TeamFinances = {
      payments: [
        {
          id: "p1",
          playerId: "k1",
          date: "2026-03-01",
          amount: 100,
          recordedBy: "coach-1",
          recordedAt: "2026-03-01T12:00:00.000Z",
        },
      ],
      expenses: [
        { id: "e1", date: "2026-03-02", label: "Legacy row", amount: 10 },
      ],
    };
    const rows = transactionLedger(finances, [{ id: "k1", name: "Ava" }]);
    expect(rows[0].recordedBy).toBe("coach-1");
    expect(rows[0].recordedAt).toBe("2026-03-01T12:00:00.000Z");
    // Rows predating the stamps simply lack the fields.
    expect("recordedBy" in rows[1]).toBe(false);
  });
});

// --- Refunds (approved feature, docs/FINANCES-AUDIT.md §4) ---

describe("refunds", () => {
  const finances: TeamFinances = {
    clubFee: 100,
    payments: [
      { id: "pay1", playerId: "p1", date: "2026-03-01", amount: 100 },
      {
        id: "ref1",
        playerId: "p1",
        date: "2026-04-01",
        amount: 40,
        refund: true,
      },
    ],
  };

  it("nets refunds out of collected and the family's paid total", () => {
    const s = financeSummary(finances, [{ id: "p1" }]);
    expect(s.collected).toBe(60);
    expect(s.paidByPlayer.p1).toBe(60);
    // The refunded slice is owed again.
    expect(s.stillOwed).toBe(40);
    expect(s.balanceNow).toBe(60);
  });

  it("shows a refund as money OUT in the ledger with its own label", () => {
    const rows = transactionLedger(finances, [{ id: "p1", name: "Ava" }]);
    expect(rows[0]).toMatchObject({
      label: "Team fee — Ava",
      direction: "in",
      balanceAfter: 100,
    });
    expect(rows[1]).toMatchObject({
      label: "Refund — Ava",
      direction: "out",
      amount: 40,
      balanceAfter: 60,
    });
  });

  it("keeps refunds out of expense/category math", () => {
    // budgetActuals reads expenses only — a refund never pollutes a budget
    // category or the unplanned bucket.
    const actuals = budgetActuals(finances);
    expect(actuals.unplanned).toBe(0);
    expect(Object.keys(actuals.byItem)).toHaveLength(0);
  });

  it("teamFeesStatus counts the refunded family as owing again", () => {
    const st = teamFeesStatus(finances, [{ id: "p1" }]);
    expect(st.fullOwedCount).toBe(1);
    expect(st.stillOwed).toBe(40);
  });
});

describe("by-category reporting (PR2)", () => {
  it("budgetItemCategory prefers the stored category, else infers from label", () => {
    expect(
      budgetItemCategory({
        id: "b1",
        label: "Anything",
        amount: 1,
        category: "travel",
      }),
    ).toBe("travel");
    // No stored category → inferred from the label keyword.
    expect(
      budgetItemCategory({ id: "b2", label: "New helmets", amount: 1 }),
    ).toBe("gear");
  });

  it("expenseCategory follows the linked budget item, else infers from its own label", () => {
    const items = [
      {
        id: "b1",
        label: "Field rental",
        amount: 100,
        category: "facilities" as const,
      },
    ];
    // Linked → inherits the item's category, even if the expense label differs.
    expect(
      expenseCategory({ budgetItemId: "b1", label: "March invoice" }, items),
    ).toBe("facilities");
    // Unlinked → inferred from the expense label.
    expect(expenseCategory({ label: "Hotel deposit" }, items)).toBe("travel");
    // Dangling link (item deleted) falls back to inference too.
    expect(
      expenseCategory({ budgetItemId: "gone", label: "Umpires" }, items),
    ).toBe("tournaments");
  });

  it("budgetByCategory rolls planned + actual up by area, in canonical order", () => {
    const finances: TeamFinances = {
      budgetItems: [
        {
          id: "b1",
          label: "Tournament entry",
          amount: 400,
          category: "tournaments",
        },
        { id: "b2", label: "Game jerseys", amount: 300, category: "uniforms" },
      ],
      expenses: [
        // Linked spend against the tournament plan.
        {
          id: "e1",
          date: "2026-03-01",
          label: "Spring Classic",
          amount: 450,
          budgetItemId: "b1",
        },
        // Unlinked spend inferred to travel — a category with no plan.
        { id: "e2", date: "2026-03-05", label: "Hotel block", amount: 200 },
      ],
    };
    const rows = budgetByCategory(finances);
    expect(rows.map((r) => r.category)).toEqual([
      "tournaments",
      "uniforms",
      "travel",
    ]);
    expect(rows[0]).toMatchObject({ planned: 400, spent: 450 }); // over plan
    expect(rows[1]).toMatchObject({ planned: 300, spent: 0 }); // planned, unspent
    expect(rows[2]).toMatchObject({ planned: 0, spent: 200 }); // spent, unplanned
  });

  it("spendingByCategory is donut-ready actual spend, categories with spend only", () => {
    const finances: TeamFinances = {
      budgetItems: [{ id: "b1", label: "Bats", amount: 100, category: "gear" }],
      expenses: [
        {
          id: "e1",
          date: "2026-03-01",
          label: "Bats",
          amount: 120,
          budgetItemId: "b1",
        },
      ],
    };
    expect(spendingByCategory(finances)).toEqual([
      { label: "Gear & equipment", value: 120 },
    ]);
  });
});
