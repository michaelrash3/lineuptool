import { describe, it, expect } from "vitest";
import {
  shouldRollFinances,
  rollFinancesForNewSeason,
  financeSummary,
  suggestedFeePerPlayer,
  sponsorshipTotal,
  feeOffsetSponsorshipTotal,
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
