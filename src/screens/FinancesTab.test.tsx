import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";
import { FinancesTab } from "./FinancesTab";
import { applyFinanceUpdate } from "../utils/financeUpdates";

// Head-coach-only Finances screen. The money math itself is covered in
// helpers.test.js — these tests pin the screen wiring: tiles render the
// summary, the budget planner's quantity mode plans count × unit cost,
// Collections reflects per-player paid/owed state, and every action writes
// through an updateFinances op (see utils/financeUpdates.ts).

const baseTeam: any = {
  players: [
    { id: "kid1", name: "Ava" },
    { id: "kid2", name: "Ben" },
  ],
  games: [],
  finances: {
    clubFee: 100,
    budgetItems: [
      { id: "b1", label: "Tournaments", qty: 4, unitAmount: 100, amount: 400 },
      { id: "b2", label: "Uniform printing", amount: 100 },
    ],
    incomes: [
      {
        id: "i1",
        date: "2026-02-01",
        label: "Hardware sponsorship",
        amount: 60,
      },
    ],
    payments: [{ id: "p1", playerId: "kid1", date: "2026-03-01", amount: 100 }],
    expenses: [
      { id: "e1", date: "2026-03-05", label: "Baseballs", amount: 80 },
    ],
  },
};

// Mutations are captured as narrow updateFinances ops. Applying the captured
// op to the render's fixture finances reconstructs the resulting finances
// object — equivalent to the whole-object patch the old updateTeam call
// carried, so assertions read the same values as before.
const appliedFinances = (teamValue: any, callIdx = 0): any => {
  const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
  return applyFinanceUpdate(teamValue.team?.finances || {}, calls[callIdx][0]);
};

describe("FinancesTab", () => {
  it("renders the P&L tiles from the finance summary, sponsorships included", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    // fees 100 + income 60 − spent 80 = 80; Ben still owes the full 100 fee.
    expect(screen.getByText("Balance now")).toBeInTheDocument();
    expect(screen.getByText("Sponsorships & income")).toBeInTheDocument();
    expect(screen.getAllByText("$60").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Balance once all paid")).toBeInTheDocument();
    expect(screen.getByText("$180")).toBeInTheDocument(); // 80 + 100 owed
  });

  it("shows quantity budget items as count × unit and steps the count through an updateFinances op", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    expect(screen.getByText("× $100")).toBeInTheDocument(); // 4 × $100 row
    fireEvent.click(screen.getByLabelText("More Tournaments"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems[0]).toMatchObject({
      qty: 5,
      unitAmount: 100,
      amount: 500,
    });
  });

  it("never steps a quantity below one", () => {
    const oneLeft: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        budgetItems: [
          {
            id: "b1",
            label: "Tournaments",
            qty: 1,
            unitAmount: 100,
            amount: 100,
          },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: oneLeft },
    });
    fireEvent.click(screen.getByLabelText("Fewer Tournaments"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems[0]).toMatchObject({
      qty: 1,
      amount: 100,
    });
  });

  it("preset chip prefills a quantity-mode item and Add writes count × unit (taxable default carried)", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    // "Tournament entry" is a per-tournament, taxable catalog preset — clicking
    // it opens quantity mode AND seeds the +tax default.
    fireEvent.click(screen.getByRole("button", { name: "+ Tournament entry" }));
    fireEvent.change(screen.getByLabelText("Count"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Cost per unit"), {
      target: { value: "450" },
    });
    // Two Add buttons on the page (ledger form + budget form) — the planner
    // now sits at the bottom of the tab, so its Add is last.
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const patch = { finances: appliedFinances(teamValue) };
    const items = patch.finances.budgetItems;
    const added = items[items.length - 1];
    expect(added).toMatchObject({
      label: "Tournament entry",
      qty: 8,
      unitAmount: 450,
      amount: 3600,
      taxable: true,
    });
  });

  it("a flat (non-unit) catalog preset adds without quantity mode", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    // "Team insurance" has no unitNoun → flat amount, no Count field.
    fireEvent.click(screen.getByRole("button", { name: "+ Team insurance" }));
    expect(screen.queryByLabelText("Count")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Budget amount"), {
      target: { value: "225" },
    });
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const items = appliedFinances(teamValue).budgetItems;
    const added = items[items.length - 1];
    expect(added).toMatchObject({ label: "Team insurance", amount: 225 });
    expect(added.qty).toBeUndefined();
    expect(added.taxable).toBeUndefined();
  });

  it("offers ledger autocomplete and one-tap deposit amounts from the catalog", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    // Expense datalist (money-out is the default ledger direction) carries the
    // spend catalog; a deposit quick-pick sets the next-season deposit.
    const expenseOpts = document
      .getElementById("ledger-expense-suggestions")
      ?.querySelectorAll("option");
    expect(expenseOpts && expenseOpts.length).toBeGreaterThan(0);
    const incomeOpts = document
      .getElementById("ledger-income-suggestions")
      ?.querySelectorAll("option");
    expect(incomeOpts && incomeOpts.length).toBeGreaterThan(0);
  });

  it("a deposit quick-pick chip stores the next-season deposit", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Set next season deposit to $100"));
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextDepositAmount: 100 }),
    );
  });

  it("suggests next season's fee from the budget minus pledged sponsorships and stores it as nextClubFee", () => {
    const sponsored: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        sponsorships: [{ id: "s1", sponsor: "Smith Hardware", amount: 200 }],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: sponsored },
    });
    // (budget 500 − sponsorships 200) / 2 paying players = 150. This year's
    // ledger (payments/income/expenses in the fixture) must not change it.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i }),
    );
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 150 }),
    );
    // The CURRENT season's collections fee is untouched by planning.
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.clubFee).toBe(100);
  });

  it("adds a named sponsorship to the budget planner and removes it", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.change(screen.getByLabelText("Sponsor name"), {
      target: { value: "Smith Hardware" },
    });
    fireEvent.change(screen.getByLabelText("Sponsorship amount"), {
      target: { value: "250" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Sponsor/ }));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.sponsorships[0]).toMatchObject({
      sponsor: "Smith Hardware",
      amount: 250,
    });

    const withSponsor: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        sponsorships: patch.finances.sponsorships,
      },
    };
    const second = renderWithProviders(<FinancesTab />, {
      team: { team: withSponsor },
    });
    fireEvent.click(
      screen.getByLabelText("Remove sponsorship from Smith Hardware"),
    );
    const removePatch = { finances: appliedFinances(second.teamValue) };
    expect(removePatch.finances.sponsorships).toEqual([]);
  });

  it("each sponsor carries its own 'reduces team fees' switch — add off, flip per row", () => {
    // Add a NEXT-season pledge with the switch UNCHECKED: it must be stored
    // as reducesFees: false (planned as club income, no fee offset).
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.change(screen.getByLabelText("Sponsor name"), {
      target: { value: "Iron Rig Fitness" },
    });
    fireEvent.change(screen.getByLabelText("Sponsorship amount"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByLabelText("This sponsor reduces team fees"));
    fireEvent.click(screen.getByRole("button", { name: /Add Sponsor/ }));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.sponsorships[0]).toMatchObject({
      sponsor: "Iron Rig Fitness",
      amount: 500,
      reducesFees: false,
    });

    // Its row chip reads "club income"; tapping it flips the pledge back to
    // fee-reducing — per entry, not all-or-nothing.
    const withPledge: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        sponsorships: patch.finances.sponsorships,
      },
    };
    const second = renderWithProviders(<FinancesTab />, {
      team: { team: withPledge },
    });
    fireEvent.click(
      second.getByRole("button", {
        name: /Iron Rig Fitness: held as club income/,
      }),
    );
    const flip = { finances: appliedFinances(second.teamValue) };
    expect(flip.finances.sponsorships[0].reducesFees).toBe(true);
  });

  it("a this-season sponsor row flips between fee credit and club income", () => {
    // Seeded sponsor income WITH the fundraising credit on.
    const withSponsor: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          ...baseTeam.finances.incomes,
          {
            id: "i2",
            date: "2026-03-10",
            label: "Kasselmann McDonald's",
            amount: 250,
            fundraising: true,
            sponsor: true,
          },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: withSponsor },
    });
    // Tapping its chip drops the fundraising flag: the money stays in the
    // ledger as plain club income and no longer credits team fees.
    fireEvent.click(
      screen.getByRole("button", {
        name: /Kasselmann McDonald's: reduces team fees/,
      }),
    );
    const patch = { finances: appliedFinances(teamValue) };
    const flipped = patch.finances.incomes.find((i: any) => i.id === "i2");
    expect(flipped.sponsor).toBe(true);
    expect(flipped.fundraising).toBeUndefined();
    expect(flipped.amount).toBe(250); // the money itself is untouched
  });

  it("adds a current-season sponsor as fundraising income reducing this year's fees", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    // Switch the sponsor toggle to the current season.
    fireEvent.click(screen.getByLabelText("Sponsor applies to this season"));
    fireEvent.change(screen.getByLabelText("Sponsor name"), {
      target: { value: "Smith Hardware" },
    });
    fireEvent.change(screen.getByLabelText("Sponsorship amount"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Sponsor/ }));
    const patch = { finances: appliedFinances(teamValue) };
    // Posts to the income ledger as fundraising (lowers current dues), not to
    // next season's sponsorships.
    expect(patch.finances.sponsorships).toBeUndefined();
    const added = patch.finances.incomes[patch.finances.incomes.length - 1];
    expect(added).toMatchObject({
      label: "Smith Hardware",
      amount: 300,
      fundraising: true,
      sponsor: true,
    });

    // It surfaces under "This season" with its own remove control.
    const withSponsor: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: patch.finances.incomes,
      },
    };
    const second = renderWithProviders(<FinancesTab />, {
      team: { team: withSponsor },
    });
    fireEvent.click(
      screen.getByLabelText("Remove this-season sponsor Smith Hardware"),
    );
    const removePatch = { finances: appliedFinances(second.teamValue) };
    // The sponsor income is gone; unrelated seed income is untouched.
    expect(removePatch.finances.incomes.some((i: any) => i.sponsor)).toBe(
      false,
    );
    expect(removePatch.finances.incomes.some((i: any) => i.id === "i1")).toBe(
      true,
    );
  });

  it("waives a player's fee and shows the waived state", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Waive fee for Ben"));
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ feeExemptIds: ["kid2"] }),
    );
  });

  it("renders waived players without payment controls and excludes them from Still owed", () => {
    const waivedTeam: any = {
      ...baseTeam,
      finances: { ...baseTeam.finances, feeExemptIds: ["kid2"] },
    };
    renderWithProviders(<FinancesTab />, { team: { team: waivedTeam } });
    expect(screen.getByText("Fee waived")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Payment amount for Ben"),
    ).not.toBeInTheDocument();
    // Ben waived → nobody owes anything.
    expect(screen.getByText("Still owed")).toBeInTheDocument();
    expect(screen.queryByText("$100 owed")).not.toBeInTheDocument();
  });

  it("buffer chips write the fee round-up increment", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Fee buffer $25"));
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ feeBufferIncrement: 25 }),
    );
  });

  it("buffered suggestion rounds the next-season fee up to a clean number", () => {
    const buffered: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        feeBufferIncrement: 25,
        sponsorships: [{ id: "s1", sponsor: "Smith Hardware", amount: 180 }],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: buffered },
    });
    // Raw (500 − 180) / 2 = 160 → next $25 = 175.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i }),
    );
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 175 }),
    );
  });

  it("sales tax: percent commits on blur and the +tax toggle flags an item", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    const taxField = screen.getByLabelText("Sales tax percent");
    fireEvent.change(taxField, { target: { value: "8.25" } });
    fireEvent.blur(taxField);
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ salesTaxPct: 8.25 }),
    );
    fireEvent.click(screen.getByLabelText("Toggle sales tax on Tournaments"));
    const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
    expect(
      appliedFinances(teamValue, calls.length - 1).budgetItems[0],
    ).toMatchObject({ taxable: true });
  });

  it("taxed items raise the budget and the suggested fee", () => {
    const taxed: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        salesTaxPct: 10,
        budgetItems: [
          {
            id: "b1",
            label: "Tournaments",
            qty: 4,
            unitAmount: 100,
            amount: 400,
            taxable: true,
          },
          { id: "b2", label: "Uniform printing", amount: 100 },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: taxed },
    });
    // Budget 440 + 100 = 540 → 540 / 2 = 270.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i }),
    );
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 270 }),
    );
  });

  it("edits an expense ledger entry in place", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Edit entry Baseballs"));
    fireEvent.change(screen.getByLabelText("Edit amount for Baseballs"), {
      target: { value: "95" },
    });
    fireEvent.change(screen.getByLabelText("Edit description for Baseballs"), {
      target: { value: "Game baseballs" },
    });
    fireEvent.click(screen.getByLabelText("Save entry Baseballs"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.expenses[0]).toMatchObject({
      id: "e1",
      label: "Game baseballs",
      amount: 95,
      date: "2026-03-05",
    });
  });

  it("edits the date AND amount on a team-fee payment row (typo fix)", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Edit entry Team fee — Ava"));
    // A typo'd payment can be corrected in place — amount is now editable.
    fireEvent.change(screen.getByLabelText("Edit date for Team fee — Ava"), {
      target: { value: "2026-03-10" },
    });
    fireEvent.change(screen.getByLabelText("Edit amount for Team fee — Ava"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByLabelText("Save entry Team fee — Ava"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments[0]).toMatchObject({
      id: "p1",
      date: "2026-03-10",
      amount: 120,
    });
  });

  it("deletes a team-fee payment row", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Delete entry Team fee — Ava"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments.some((p: any) => p.id === "p1")).toBe(false);
  });

  it("money-out entries can be linked to a budget category", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.change(screen.getByLabelText("Budget category"), {
      target: { value: "b1" },
    });
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Memorial Day entry" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "450" },
    });
    // Ledger now precedes the planner — its Add button is first.
    fireEvent.click(screen.getAllByRole("button", { name: /Add$/ })[0]);
    const patch = { finances: appliedFinances(teamValue) };
    const exp = patch.finances.expenses[patch.finances.expenses.length - 1];
    expect(exp).toMatchObject({
      label: "Memorial Day entry",
      amount: 450,
      budgetItemId: "b1",
    });
  });

  it("budget rows show spent-of-planned when expenses are linked", () => {
    const linked: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        expenses: [
          {
            id: "e1",
            date: "2026-03-05",
            label: "Entry",
            amount: 450,
            budgetItemId: "b1",
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: linked } });
    // 450 spent of the 400 planned → over budget flag.
    expect(screen.getByText(/spent \$450 of \$400/)).toBeInTheDocument();
    expect(screen.getByText(/over budget/)).toBeInTheDocument();
  });

  it("copies a dues reminder listing only owing families", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    fireEvent.click(screen.getByLabelText("Copy team-fees reminder"));
    await screen.findByLabelText("Copy team-fees reminder"); // flush the async click
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("Ben: $100");
    expect(text).not.toContain("Ava:"); // settled
    expect(text).toContain("Total outstanding: $100");
  });

  it("exports the ledger as a CSV download", () => {
    const createObjectURL = jest.fn(() => "blob:x");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    fireEvent.click(screen.getByLabelText("Export ledger CSV"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("renders the year-over-year chart when past seasons exist", () => {
    const withHistory: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        pastSeasons: [
          {
            season: "through Spring 2026",
            collected: 1200,
            otherIncome: 300,
            spent: 1100,
            closingBalance: 400,
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: withHistory } });
    expect(
      screen.getByRole("img", { name: "Year over year money in and out" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Year over year/)).toBeInTheDocument();
  });

  it("shows archived past years in the ledger footer", () => {
    const withHistory: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        pastSeasons: [
          {
            season: "through Spring 2026",
            collected: 1200,
            otherIncome: 300,
            spent: 1100,
            closingBalance: 400,
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: withHistory } });
    expect(screen.getByText("Past years")).toBeInTheDocument();
    expect(screen.getByText("through Spring 2026")).toBeInTheDocument();
    expect(screen.getByText(/ended/)).toBeInTheDocument();
  });

  it("marks settled players Paid full and records a partial payment", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    expect(screen.getByText(/Paid full ✓/)).toBeInTheDocument(); // Ava
    expect(screen.getByText("$100 owed")).toBeInTheDocument(); // Ben
    fireEvent.change(screen.getByLabelText("Payment amount for Ben"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByLabelText("Record payment for Ben"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments).toHaveLength(2);
    expect(patch.finances.payments[1]).toMatchObject({
      playerId: "kid2",
      amount: 40,
    });
  });

  it("'Paid full' records the exact remaining balance", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Mark Ben paid in full"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments[1]).toMatchObject({
      playerId: "kid2",
      amount: 100,
    });
  });

  it("shows one ledger of money in and out with a running balance", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    // 02-01 +60 sponsorship, 03-01 +100 Ava's fee, 03-05 −80 balls → 80.
    expect(screen.getByText("Hardware sponsorship")).toBeInTheDocument();
    expect(screen.getByText("Team fee — Ava")).toBeInTheDocument();
    expect(screen.getByText("Baseballs")).toBeInTheDocument();
    // $160 also appears as the suggested next-season fee, hence getAllByText.
    expect(screen.getAllByText(/\$160/).length).toBeGreaterThanOrEqual(1);
    // Every ledger row — including team-fee payments — can be deleted so a
    // mistaken entry can be cleaned up.
    expect(
      screen.getByLabelText("Delete entry Team fee — Ava"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Delete entry Hardware sponsorship"),
    ).toBeInTheDocument();
  });

  it("records money in as an income entry", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Car wash fundraiser" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "250" },
    });
    // Ledger now precedes the planner — its Add button is first.
    fireEvent.click(screen.getAllByRole("button", { name: /Add$/ })[0]);
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes).toHaveLength(2);
    expect(patch.finances.incomes[1]).toMatchObject({
      label: "Car wash fundraiser",
      amount: 250,
    });
  });

  it("fundraising income reduces each paying family's dues", () => {
    const fundraised: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          ...baseTeam.finances.incomes,
          {
            id: "i2",
            date: "2026-03-02",
            label: "Car wash",
            amount: 60,
            fundraising: true,
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: fundraised } });
    // $60 fundraising / 2 payers = $30 credit → everyone owes $70; Ben has
    // paid nothing, Ava's $100 payment already covers her reduced fee.
    expect(screen.getByText("$70 owed")).toBeInTheDocument();
    expect(screen.getByText(/\$70 each/)).toBeInTheDocument();
    expect(screen.getByText("team-fee credit")).toBeInTheDocument();
  });

  it("flags a money-in entry as fundraising from the ledger form", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.click(
      screen.getByLabelText("Fundraising — reduces player team fees"),
    );
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Raffle night" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Add$/ })[0]);
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes[1]).toMatchObject({
      label: "Raffle night",
      amount: 120,
      fundraising: true,
    });
  });

  it("anticipated player count drives the suggested-fee split", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    const input = screen.getByLabelText("Anticipated players next season");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ plannedPlayerCount: 10 }),
    );
    // With the override stored: budget 500 / 10 anticipated players = 50.
    const planned: any = {
      ...baseTeam,
      finances: { ...baseTeam.finances, plannedPlayerCount: 10 },
    };
    const second = renderWithProviders(<FinancesTab />, {
      team: { team: planned },
    });
    // Both renders stay mounted — the second tree's button is last.
    const setFeeButtons = screen.getAllByRole("button", {
      name: /Set as next season's fee/i,
    });
    fireEvent.click(setFeeButtons[setFeeButtons.length - 1]);
    expect(appliedFinances(second.teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 50 }),
    );
    expect(screen.getByText(/× 10 anticipated players/)).toBeInTheDocument();
  });

  it("edits a budget item in place, keeping quantity mode in sync", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Edit Tournaments"));
    fireEvent.change(screen.getByLabelText("Edit count for Tournaments"), {
      target: { value: "6" },
    });
    fireEvent.change(
      screen.getByLabelText("Edit cost per unit for Tournaments"),
      { target: { value: "500" } },
    );
    fireEvent.change(screen.getByLabelText("Edit label for Tournaments"), {
      target: { value: "Spring tournaments" },
    });
    fireEvent.click(screen.getByLabelText("Save Tournaments"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems[0]).toMatchObject({
      id: "b1",
      label: "Spring tournaments",
      qty: 6,
      unitAmount: 500,
      amount: 3000,
    });
  });

  it("offers a one-tap budget seeded from this season when the planner is empty", () => {
    const fresh: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        budgetItems: [],
        expenses: [
          { id: "e1", date: "2026-03-05", label: "Baseballs", amount: 80 },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: fresh },
    });
    // $80 unplanned spend rounds up to a clean $100 starting point.
    fireEvent.click(screen.getByLabelText("Seed budget from this season"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems).toHaveLength(1);
    expect(patch.finances.budgetItems[0]).toMatchObject({
      label: "Other (unplanned this season)",
      amount: 100,
    });
  });

  it("sorts the ledger by a tapped header and back", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    const rowsByLabel = () =>
      screen
        .getAllByRole("row")
        .map((r) => r.textContent || "")
        .filter((t) => /Hardware sponsorship|Team fee — Ava|Baseballs/.test(t));
    // Default date order: sponsorship (02-01), fee (03-01), baseballs (03-05).
    expect(rowsByLabel()[0]).toContain("Hardware sponsorship");
    // Sort by Entry: alphabetical → Baseballs first.
    fireEvent.click(screen.getAllByLabelText("Sort by Entry")[0]);
    expect(rowsByLabel()[0]).toContain("Baseballs");
  });

  it("offers to apply a carried-over surplus as a dues discount", () => {
    const carried: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          {
            id: "carry-2026-08-01-abc123",
            date: "2026-08-01",
            label: "Carried over (through Spring 2026)",
            amount: 240,
          },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: carried },
    });
    // $240 across 2 paying families ≈ $120 off each.
    expect(screen.getByText(/\$120 off per/)).toBeInTheDocument();
    // Two-tap confirm: Yes swaps to a confirm message, no write yet.
    fireEvent.click(
      screen.getByLabelText("Apply carryover as team-fee discount"),
    );
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm apply carryover discount"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes[0]).toMatchObject({
      id: "carry-2026-08-01-abc123",
      fundraising: true,
    });
  });

  it("dismisses the carryover prompt permanently on a confirmed No", () => {
    const carried: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          {
            id: "carry-2026-08-01-abc123",
            date: "2026-08-01",
            label: "Carried over (through Spring 2026)",
            amount: 240,
          },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: carried },
    });
    // First No swaps to the confirm message without writing.
    fireEvent.click(screen.getByLabelText("Skip carryover discount"));
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    // Confirming No flags the entry dismissed (stays in the bank, not applied).
    fireEvent.click(screen.getByLabelText("Confirm skip carryover discount"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes[0]).toMatchObject({
      id: "carry-2026-08-01-abc123",
      dismissed: true,
    });
    expect(patch.finances.incomes[0].fundraising).toBeFalsy();
  });

  it("hides the carryover prompt once it has been dismissed", () => {
    const dismissed: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          {
            id: "carry-2026-08-01-abc123",
            date: "2026-08-01",
            label: "Carried over (through Spring 2026)",
            amount: 240,
            dismissed: true,
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: dismissed } });
    expect(
      screen.queryByLabelText("Apply carryover as team-fee discount"),
    ).not.toBeInTheDocument();
  });

  it("hides the carryover prompt once the discount is applied; debt never prompts", () => {
    const applied: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          {
            id: "carry-2026-08-01-abc123",
            date: "2026-08-01",
            label: "Carried over (through Spring 2026)",
            amount: 240,
            fundraising: true,
          },
        ],
        // A debt carryover lives in expenses — it stays on the books but
        // must never raise what parents owe.
        expenses: [
          {
            id: "carry-2026-08-01-def456",
            date: "2026-08-01",
            label: "Debt carried over (through Spring 2026)",
            amount: 150,
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: applied } });
    expect(
      screen.queryByLabelText("Apply carryover as team-fee discount"),
    ).not.toBeInTheDocument();
    // Applied surplus shows as the fundraising credit: 240/2 = 120 off the
    // $100 fee → everyone fully covered ($0 each).
    expect(screen.getByText(/\$0 each/)).toBeInTheDocument();
    // The debt row stays visible in the ledger.
    expect(
      screen.getByText("Debt carried over (through Spring 2026)"),
    ).toBeInTheDocument();
  });

  it("reverses an applied carryover discount back to the bank", () => {
    const applied: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          {
            id: "carry-2026-08-01-abc123",
            date: "2026-08-01",
            label: "Carried over (through Spring 2026)",
            amount: 240,
            fundraising: true,
          },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: applied },
    });
    fireEvent.click(
      screen.getByLabelText("Reverse carryover team-fee discount"),
    );
    const patch = { finances: appliedFinances(teamValue) };
    // The carryover entry flips back to a plain (non-fundraising) income, so
    // the surplus no longer discounts dues.
    expect(patch.finances.incomes[0]).toMatchObject({
      id: "carry-2026-08-01-abc123",
      fundraising: false,
    });
  });

  it("refuses to save a ledger edit with a cleared date (keep editing until valid)", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Edit entry Baseballs"));
    fireEvent.change(screen.getByLabelText("Edit date for Baseballs"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByLabelText("Save entry Baseballs"));
    // No write happened and the row is still in edit mode.
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Edit date for Baseballs"),
    ).toBeInTheDocument();
  });

  it("shows archived unpaid dues under Past years (finding 3.6 snapshot)", () => {
    const withOutstanding: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        pastSeasons: [
          {
            season: "through Spring 2026",
            collected: 1200,
            otherIncome: 300,
            spent: 1100,
            closingBalance: 400,
            outstanding: [
              { playerId: "gone1", name: "Cal", owed: 40 },
              { playerId: "gone2", name: "Dee", owed: 100 },
            ],
          },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: withOutstanding } });
    expect(
      screen.getByText(/Closed with \$140 unpaid \(2 families\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Cal: $40")).toBeInTheDocument();
    expect(screen.getByText("Dee: $100")).toBeInTheDocument();
  });

  it("stamps new money records with recordedBy/recordedAt when a user is present", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam, user: { uid: "coach-1" } },
    });
    fireEvent.change(screen.getByLabelText("Payment amount for Ben"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByLabelText("Record payment for Ben"));
    const patch = { finances: appliedFinances(teamValue) };
    const added = patch.finances.payments[patch.finances.payments.length - 1];
    expect(added.recordedBy).toBe("coach-1");
    expect(typeof added.recordedAt).toBe("string");
    expect(added.recordedAt.length).toBeGreaterThan(0);
  });

  it("caps the rendered ledger at 100 rows and expands on Show all", () => {
    const many: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [],
        payments: [],
        expenses: Array.from({ length: 120 }, (_, i) => ({
          id: `bulk-${i}`,
          date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
          label: `Bulk expense ${i}`,
          amount: 5,
        })),
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: many } });
    expect(screen.getAllByText(/Bulk expense/)).toHaveLength(100);
    fireEvent.click(
      screen.getByRole("button", { name: /Show all 120 entries/ }),
    );
    expect(screen.getAllByText(/Bulk expense/)).toHaveLength(120);
    expect(
      screen.queryByRole("button", { name: /Show all/ }),
    ).not.toBeInTheDocument();
  });

  it("records a refund for a settled family via the prompt (capped at paid)", async () => {
    // No ConfirmProvider in tests — useConfirm falls back to window.prompt.
    const prompt = jest.spyOn(window, "prompt").mockReturnValue("40");
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    // Ava is settled (paid 100) — her row offers Refund.
    fireEvent.click(screen.getByLabelText("Refund Ava"));
    await waitFor(() => expect(teamValue.updateFinances).toHaveBeenCalled());
    const patch = { finances: appliedFinances(teamValue) };
    const added = patch.finances.payments[patch.finances.payments.length - 1];
    expect(added).toMatchObject({ playerId: "kid1", amount: 40, refund: true });
    prompt.mockRestore();
  });

  it("rejects a refund larger than what the family has paid", async () => {
    const prompt = jest.spyOn(window, "prompt").mockReturnValue("150");
    const { teamValue, toastValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Refund Ava"));
    await waitFor(() =>
      expect(toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Refund exceeds what they've paid" }),
      ),
    );
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("does not offer Refund to a family that has paid nothing", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    // Ben has paid $0 — no refund control on his row.
    expect(screen.queryByLabelText("Refund Ben")).not.toBeInTheDocument();
  });

  it("renders the empty state without a finances object at all", () => {
    renderWithProviders(<FinancesTab />, {
      team: { team: { players: [], games: [] } },
    });
    expect(
      screen.getByText(/Add players on the Roster tab/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing logged yet/i)).toBeInTheDocument();
  });
});
