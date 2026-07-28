import { MemoryRouter } from "react-router-dom";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // fees 100 + income 60 − spent 80 = 80; Ben still owes the full 100 fee.
    expect(screen.getByText("Balance now")).toBeInTheDocument();
    expect(screen.getByText("Sponsorships & income")).toBeInTheDocument();
    expect(screen.getAllByText("$60").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Balance once all paid")).toBeInTheDocument();
    expect(screen.getByText("$180")).toBeInTheDocument(); // 80 + 100 owed
  });

  it("shows quantity budget items as count × unit and steps the count through an updateFinances op", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: oneLeft },
      },
    );
    fireEvent.click(screen.getByLabelText("Fewer Tournaments"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems[0]).toMatchObject({
      qty: 1,
      amount: 100,
    });
  });

  it("preset chip prefills a quantity-mode item and Add writes count × unit (taxable default carried)", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByLabelText("Set next season deposit to $100"));
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextDepositAmount: 100 }),
    );
  });

  it("stores the chosen spending category on a new budget item (PR2)", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.change(screen.getByLabelText("Budget item"), {
      target: { value: "Extra nets" },
    });
    fireEvent.change(screen.getByLabelText("Budget amount"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByLabelText("New item category"), {
      target: { value: "gear" },
    });
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const items = appliedFinances(teamValue).budgetItems;
    expect(items[items.length - 1]).toMatchObject({
      label: "Extra nets",
      amount: 60,
      category: "gear",
    });
  });

  it("renders the by-category budget-vs-actual rollup", () => {
    const categorized: any = {
      players: [{ id: "k1", name: "A" }],
      games: [],
      finances: {
        clubFee: 100,
        budgetItems: [
          {
            id: "b1",
            label: "Field time",
            amount: 300,
            category: "facilities",
          },
        ],
        expenses: [
          {
            id: "e1",
            date: "2026-03-01",
            label: "March rental",
            amount: 120,
            budgetItemId: "b1",
          },
        ],
      },
    };
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: categorized } },
    );
    // The rollup panel renders with its caption and the linked spend against
    // the plan ($120 of $300 facilities). Scope the money lookup to the panel —
    // $120 also shows in the ledger row.
    expect(screen.getByText("spent / planned")).toBeInTheDocument();
    const panel = screen
      .getByText("By category")
      .closest("div.rounded-xl") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("$120")).toBeInTheDocument();
    expect(within(panel).getByText("$300")).toBeInTheDocument();
  });

  it("suggests next season's fee from the DRAFT budget minus pledged sponsorships and stores it as nextClubFee", () => {
    const sponsored: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        nextBudgetItems: [
          {
            id: "d1",
            label: "Tournaments",
            qty: 4,
            unitAmount: 100,
            amount: 400,
          },
          { id: "d2", label: "Uniform printing", amount: 100 },
        ],
        sponsorships: [{ id: "s1", sponsor: "Smith Hardware", amount: 200 }],
      },
    };
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: sponsored },
      },
    );
    // (draft 500 − sponsorships 200) / 2 paying players = 150. This year's
    // ledger AND this year's live budget must not change it.
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const second = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: withSponsor },
      },
    );
    fireEvent.click(
      screen.getByLabelText("Remove sponsorship from Smith Hardware"),
    );
    const removePatch = { finances: appliedFinances(second.teamValue) };
    expect(removePatch.finances.sponsorships).toEqual([]);
  });

  it("each sponsor carries its own 'reduces team fees' switch — add off, flip per row", () => {
    // Add a NEXT-season pledge with the switch UNCHECKED: it must be stored
    // as reducesFees: false (planned as club income, no fee offset).
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const second = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: withPledge },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: withSponsor },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const second = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: withSponsor },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: waivedTeam } },
    );
    expect(screen.getByText("Fee waived")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Payment amount for Ben"),
    ).not.toBeInTheDocument();
    // Ben waived → nobody owes anything.
    expect(screen.getByText("Still owed")).toBeInTheDocument();
    expect(screen.queryByText("$100 owed")).not.toBeInTheDocument();
  });

  it("buffer chips write the fee round-up increment", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
        nextBudgetItems: [
          {
            id: "d1",
            label: "Tournaments",
            qty: 4,
            unitAmount: 100,
            amount: 400,
          },
          { id: "d2", label: "Uniform printing", amount: 100 },
        ],
        sponsorships: [{ id: "s1", sponsor: "Smith Hardware", amount: 180 }],
      },
    };
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: buffered },
      },
    );
    // Raw (500 − 180) / 2 = 160 → next $25 = 175.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i }),
    );
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 175 }),
    );
  });

  it("sales tax: percent commits on blur and the +tax toggle flags an item", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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

  it("taxed items raise the DRAFT budget and its suggested fee", () => {
    const taxed: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        salesTaxPct: 10,
        nextBudgetItems: [
          {
            id: "d1",
            label: "Tournaments",
            qty: 4,
            unitAmount: 100,
            amount: 400,
            taxable: true,
          },
          { id: "d2", label: "Uniform printing", amount: 100 },
        ],
      },
    };
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: taxed },
      },
    );
    // Draft 440 + 100 = 540 → 540 / 2 = 270.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i }),
    );
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ nextClubFee: 270 }),
    );
  });

  it("edits an expense ledger entry in place", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByLabelText("Delete entry Team fee — Ava"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments.some((p: any) => p.id === "p1")).toBe(false);
  });

  it("money-out entries can be linked to a budget category", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: linked } },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: withHistory } },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: withHistory } },
    );
    expect(screen.getByText("Past years")).toBeInTheDocument();
    expect(screen.getByText("through Spring 2026")).toBeInTheDocument();
    expect(screen.getByText(/ended/)).toBeInTheDocument();
  });

  it("marks settled players Paid full and records a partial payment", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByLabelText("Mark Ben paid in full"));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.payments[1]).toMatchObject({
      playerId: "kid2",
      amount: 100,
    });
  });

  it("shows one ledger of money in and out with a running balance", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Car wash fundraiser" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "250" },
    });
    // Ledger now precedes the planner — its Add button is first.
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: fundraised } },
    );
    // $60 fundraising / 2 payers = $30 credit → everyone owes $70; Ben has
    // paid nothing, Ava's $100 payment already covers her reduced fee.
    expect(screen.getByText("$70 owed")).toBeInTheDocument();
    expect(screen.getByText(/\$70 each/)).toBeInTheDocument();
    expect(screen.getByText("team-fee credit")).toBeInTheDocument();
  });

  it("flags a money-in entry as fundraising from the ledger form", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes[1]).toMatchObject({
      label: "Raffle night",
      amount: 120,
      fundraising: true,
    });
  });

  it("tags a money-in entry with a revenue source; the picker resets after add", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    fireEvent.change(screen.getByLabelText("Revenue source"), {
      target: { value: "grant" },
    });
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "County rec grant" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "500" },
    });
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.incomes[1]).toMatchObject({
      label: "County rec grant",
      amount: 500,
      category: "grant",
    });
    // The picker snaps back to auto, so the next entry stores no source and
    // falls through to label inference at read time.
    expect(
      (screen.getByLabelText("Revenue source") as HTMLSelectElement).value,
    ).toBe("");
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Mystery money" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "10" },
    });
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
    const second = appliedFinances(teamValue, 1);
    expect(second.incomes[1]).toMatchObject({ label: "Mystery money" });
    expect(second.incomes[1].category).toBeUndefined();
  });

  it("cash flow rolls up money in by source — dues plus inferred income", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // Ava's $100 team fee posts to dues; the untagged "Hardware sponsorship"
    // income infers its source from the label.
    const heading = screen.getByText("Money in by source");
    const panel = heading.parentElement!.parentElement as HTMLElement;
    expect(within(panel).getByText("Registration & dues")).toBeInTheDocument();
    expect(within(panel).getByText("$100")).toBeInTheDocument();
    expect(within(panel).getByText("Sponsorships")).toBeInTheDocument();
    expect(within(panel).getByText("$60")).toBeInTheDocument();
    expect(within(panel).getByText("$160")).toBeInTheDocument(); // total
  });

  it("anticipated player count drives the suggested-fee split", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    const input = screen.getByLabelText("Anticipated players next season");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(appliedFinances(teamValue)).toEqual(
      expect.objectContaining({ plannedPlayerCount: 10 }),
    );
    // With the override stored: draft 500 / 10 anticipated players = 50.
    const planned: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        plannedPlayerCount: 10,
        nextBudgetItems: [
          {
            id: "d1",
            label: "Tournaments",
            qty: 4,
            unitAmount: 100,
            amount: 400,
          },
          { id: "d2", label: "Uniform printing", amount: 100 },
        ],
      },
    };
    const second = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: planned },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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

  it("offers a one-tap DRAFT seeded from this season's actuals when the draft is empty", () => {
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: fresh },
      },
    );
    // $80 unplanned spend rounds up to a clean $100 starting point — written
    // to the DRAFT; the live list is never overwritten by seeding.
    fireEvent.click(
      screen.getByLabelText("Seed draft from this season's actual spending"),
    );
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems).toEqual([]);
    expect(patch.finances.nextBudgetItems).toHaveLength(1);
    expect(patch.finances.nextBudgetItems[0]).toMatchObject({
      label: "Other (unplanned this season)",
      amount: 100,
    });
  });

  it("copies this season's budget into the draft with fresh ids", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(
      screen.getByLabelText("Copy this season's budget into the draft"),
    );
    const patch = { finances: appliedFinances(teamValue) };
    // The live list is untouched; the draft is a fresh-id copy of it.
    expect(patch.finances.budgetItems).toEqual(baseTeam.finances.budgetItems);
    expect(patch.finances.nextBudgetItems).toHaveLength(2);
    expect(patch.finances.nextBudgetItems[0]).toMatchObject({
      label: "Tournaments",
      qty: 4,
      unitAmount: 100,
      amount: 400,
    });
    const liveIds = new Set(
      baseTeam.finances.budgetItems.map((b: any) => b.id),
    );
    for (const item of patch.finances.nextBudgetItems) {
      expect(liveIds.has(item.id)).toBe(false);
    }
  });

  it("the draft add form writes to nextBudgetItems, never the live list", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.change(screen.getByLabelText("Budget item (draft)"), {
      target: { value: "Spring league" },
    });
    fireEvent.change(screen.getByLabelText("Budget amount (draft)"), {
      target: { value: "499" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add (draft)" }));
    const patch = { finances: appliedFinances(teamValue) };
    expect(patch.finances.budgetItems).toEqual(baseTeam.finances.budgetItems);
    expect(patch.finances.nextBudgetItems).toHaveLength(1);
    expect(patch.finances.nextBudgetItems[0]).toMatchObject({
      label: "Spring league",
      amount: 499,
    });
  });

  it("sorts the ledger by a tapped header and back", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: carried },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: carried },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: dismissed } },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: applied } },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: applied },
      },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: withOutstanding } },
    );
    expect(
      screen.getByText(/Closed with \$140 unpaid \(2 families\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Cal: $40")).toBeInTheDocument();
    expect(screen.getByText("Dee: $100")).toBeInTheDocument();
  });

  it("stamps new money records with recordedBy/recordedAt when a user is present", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam, user: { uid: "coach-1" } },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: many } },
    );
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
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    const { teamValue, toastValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
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
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // Ben has paid $0 — no refund control on his row.
    expect(screen.queryByLabelText("Refund Ben")).not.toBeInTheDocument();
  });

  it("renders the empty state without a finances object at all", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: { players: [], games: [] } },
      },
    );
    expect(
      screen.getByText(/Add players on the Roster tab/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing logged yet/i)).toBeInTheDocument();
  });

  it("composes both budget sections from flat sibling sub-cards (Fragment discipline)", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // Each section's card body holds every sub-card's blocks as DIRECT
    // children: the extracted sub-cards (BudgetItemsCard / BudgetPresetsCard /
    // SponsorshipSection / PlannedRosterCard) return Fragments, so a stray
    // wrapper <div> would nest these and change the space-y-3 spacing even
    // though the text-based tests would still pass.
    const liveSection = screen
      .getByText("Budget — this season")
      .closest("section")!;
    const liveKids = Array.from(
      liveSection.querySelector(".space-y-3")!.children,
    );
    // Live BudgetPresetsCard: the add-item <form> is a direct child.
    const addForm = (
      screen.getByLabelText("Budget item") as HTMLElement
    ).closest("form");
    expect(addForm && liveKids.includes(addForm)).toBe(true);
    // Live BudgetItemsCard: the by-category rollup block is a direct child.
    expect(liveKids.some((el) => el.textContent?.includes("By category"))).toBe(
      true,
    );
    const draftSection = screen
      .getByText("Budget draft — next season")
      .closest("section")!;
    const draftKids = Array.from(
      draftSection.querySelector(".space-y-3")!.children,
    );
    // Draft BudgetPresetsCard: its own add form is a direct child.
    const draftForm = (
      screen.getByLabelText("Budget item (draft)") as HTMLElement
    ).closest("form");
    expect(draftForm && draftKids.includes(draftForm)).toBe(true);
    // PlannedRosterCard (draft numbers): the draft-total block is direct.
    expect(
      draftKids.some((el) => el.textContent?.includes("Draft budget total:")),
    ).toBe(true);
  });

  it("marks the sorted ledger column header with aria-sort", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // Columns: Date, Entry, In, Out, Balance, (actions). The ledger defaults to
    // date-ascending, so only the Date header announces a sort direction.
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "ascending");
    expect(headers[2]).toHaveAttribute("aria-sort", "none");
  });

  it("voids a ledger row via a mapEntries op that stamps voidedAt", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    // The Baseballs expense is in the ledger; Void soft-deletes it (keeps the
    // audit row, drops it from every total).
    fireEvent.click(screen.getByLabelText("Void entry Baseballs"));
    const op = (teamValue.updateFinances as jest.Mock).mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "expenses" });
    const next = appliedFinances(teamValue);
    expect(
      (next.expenses || []).find((e: any) => e.id === "e1")?.voidedAt,
    ).toBeTruthy();
  });

  it("shows a reconcile nudge when a transaction references a removed player", () => {
    const orphaned = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        // p1 credits a player who isn't on the roster.
        payments: [
          { id: "p1", playerId: "GONE", date: "2026-03-01", amount: 50 },
        ],
      },
    };
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: orphaned } },
    );
    expect(
      screen.getByText(/removed player or budget item/i),
    ).toBeInTheDocument();
  });

  it("adds a per-player fee adjustment via a feeAdjustments op", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.change(screen.getByLabelText("Player to adjust"), {
      target: { value: "kid1" },
    });
    fireEvent.change(screen.getByLabelText("Adjustment amount"), {
      target: { value: "40" },
    });
    fireEvent.submit(
      screen.getByLabelText("Player to adjust").closest("form")!,
    );
    const op = (teamValue.updateFinances as jest.Mock).mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "feeAdjustments" });
    const next = appliedFinances(teamValue);
    expect(next.feeAdjustments).toHaveLength(1);
    expect(next.feeAdjustments[0]).toMatchObject({
      playerId: "kid1",
      kind: "scholarship",
      amount: 40,
    });
  });

  it("adds a reimbursement as an unpaid liability", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.change(screen.getByLabelText("Reimburse to"), {
      target: { value: "Parent A" },
    });
    fireEvent.change(screen.getByLabelText("Reimbursement amount"), {
      target: { value: "60" },
    });
    fireEvent.submit(screen.getByLabelText("Reimburse to").closest("form")!);
    const op = (teamValue.updateFinances as jest.Mock).mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "reimbursements" });
    expect(op.entry).toMatchObject({
      to: "Parent A",
      amount: 60,
      status: "unpaid",
    });
  });

  it("marks a reimbursement paid by posting one expense and flipping status", () => {
    const withReimb: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        reimbursements: [
          { id: "r1", to: "Coach Bo", amount: 45, status: "unpaid" },
        ],
      },
    };
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: withReimb } },
    );
    fireEvent.click(screen.getByLabelText("Mark Coach Bo reimbursed"));
    const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
    // One expense posted…
    expect(calls[0][0]).toMatchObject({ op: "append", key: "expenses" });
    expect(calls[0][0].entry).toMatchObject({
      label: "Reimbursement — Coach Bo",
      amount: 45,
    });
    // …then the reimbursement flips to paid.
    expect(calls[1][0]).toMatchObject({
      op: "mapEntries",
      key: "reimbursements",
    });
  });

  // ---- Pass-through fee-relief fundraisers ----------------------------------

  // Spirit night raised $300 for families; $90 already paid to Ava, $90 still
  // queued for Ben → allocated 180, remaining 120, undisbursed 210. One $40
  // volunteer IOU sits beside it so the two kinds must not blur.
  const passThroughTeam = (): any => ({
    ...baseTeam,
    finances: {
      ...baseTeam.finances,
      incomes: [
        ...baseTeam.finances.incomes,
        {
          id: "pt1",
          date: "2026-03-02",
          label: "Spirit night",
          amount: 300,
          earmark: "familyPayout",
        },
      ],
      reimbursements: [
        { id: "vol1", to: "Coach Bo", amount: 40, status: "unpaid" },
        {
          id: "fr1",
          to: "Ava",
          amount: 90,
          status: "paid",
          kind: "feeRelief",
          playerId: "kid1",
          sourceIncomeId: "pt1",
        },
        {
          id: "fr2",
          to: "Ben",
          amount: 90,
          status: "unpaid",
          kind: "feeRelief",
          playerId: "kid2",
          sourceIncomeId: "pt1",
        },
      ],
    },
  });

  it("the money-in form's third option writes the earmark — mutually exclusive with fundraising", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      {
        team: { team: baseTeam },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    // Turn fundraising on FIRST, then the earmark: the earmark must win and
    // switch fundraising off (never both on one entry).
    fireEvent.click(
      screen.getByLabelText("Fundraising — reduces player team fees"),
    );
    fireEvent.click(
      screen.getByLabelText(
        "Fundraiser — paid back to families; doesn't change team fees",
      ),
    );
    expect(
      (
        screen.getByLabelText(
          "Fundraising — reduces player team fees",
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Spirit night" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "300" },
    });
    fireEvent.submit(
      screen.getByLabelText("Transaction description").closest("form")!,
    );
    const patch = { finances: appliedFinances(teamValue) };
    const added = patch.finances.incomes[patch.finances.incomes.length - 1];
    expect(added).toMatchObject({
      label: "Spirit night",
      amount: 300,
      earmark: "familyPayout",
    });
    expect(added.fundraising).toBeUndefined();
    expect(added.playerId).toBeUndefined();
  });

  it("checking fundraising unchecks the earmark (the exclusivity runs both ways)", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Money in" }));
    const earmarkBox = () =>
      screen.getByLabelText(
        "Fundraiser — paid back to families; doesn't change team fees",
      ) as HTMLInputElement;
    fireEvent.click(earmarkBox());
    expect(earmarkBox().checked).toBe(true);
    fireEvent.click(
      screen.getByLabelText("Fundraising — reduces player team fees"),
    );
    expect(earmarkBox().checked).toBe(false);
  });

  it("hero shows free cash vs held-for-families only when an earmark exists", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    // balanceNow = 100 + 60 + 300 − 80 = 380; held = 300 − 90 paid = 210;
    // free cash = 380 − 40 volunteer − 210 held = 130.
    const heldTile = screen.getByText("Held for families")
      .parentElement as HTMLElement;
    expect(within(heldTile).getByText("$210")).toBeInTheDocument();
    const freeTile = screen.getByText("Free cash").parentElement as HTMLElement;
    expect(within(freeTile).getByText("$130")).toBeInTheDocument();
    // The earmarked ledger row wears its badge, not the dues-credit one.
    expect(screen.getByText("held for families")).toBeInTheDocument();
    expect(screen.queryByText("team-fee credit")).not.toBeInTheDocument();
  });

  it("the hero split is invisible when no earmark exists", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    expect(screen.queryByText("Held for families")).not.toBeInTheDocument();
    expect(screen.queryByText("Free cash")).not.toBeInTheDocument();
  });

  it("the payout queue splits owed-to-volunteers from owed-to-families", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    const volunteers = screen
      .getByText("Owed to volunteers")
      .closest("div") as HTMLElement;
    expect(within(volunteers).getByText("$40")).toBeInTheDocument();
    const families = screen
      .getByText("Owed to families (fee relief)")
      .closest("div") as HTMLElement;
    expect(within(families).getByText("$90")).toBeInTheDocument();
    // Ben's unpaid payout row is badged by kind.
    expect(screen.getByText("fee relief")).toBeInTheDocument();
  });

  it("distribute splits the remaining balance evenly into editable feeRelief payouts", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    // Card math: raised 300 / disbursed 90 / remaining 120.
    expect(
      screen.getByText(/raised \$300 · disbursed \$90 · remaining \$120/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("Distribute Spirit night to families"),
    );
    // Even split of the $120 remaining across 2 paying families.
    expect(
      (screen.getByLabelText("Payout amount for Ava") as HTMLInputElement)
        .value,
    ).toBe("60");
    expect(
      (screen.getByLabelText("Payout amount for Ben") as HTMLInputElement)
        .value,
    ).toBe("60");
    // Amounts are editable before confirm.
    fireEvent.change(screen.getByLabelText("Payout amount for Ava"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Payout amount for Ben"), {
      target: { value: "50" },
    });
    fireEvent.click(
      screen.getByLabelText("Confirm fee-relief payouts for Spirit night"),
    );
    const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ op: "append", key: "reimbursements" });
    expect(calls[0][0].entry).toMatchObject({
      to: "Ava",
      amount: 70,
      status: "unpaid",
      kind: "feeRelief",
      playerId: "kid1",
      sourceIncomeId: "pt1",
    });
    expect(calls[1][0].entry).toMatchObject({
      to: "Ben",
      amount: 50,
      kind: "feeRelief",
      sourceIncomeId: "pt1",
    });
  });

  it("refuses a distribution that exceeds the fundraiser's remaining balance", () => {
    const { teamValue, toastValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    fireEvent.click(
      screen.getByLabelText("Distribute Spirit night to families"),
    );
    // 100 + 60 = 160 > the 120 remaining → refused at entry, nothing written.
    fireEvent.change(screen.getByLabelText("Payout amount for Ava"), {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByLabelText("Confirm fee-relief payouts for Spirit night"),
    );
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "That's more than the fundraiser has left",
      }),
    );
    // The editor stays open for correction.
    expect(screen.getByLabelText("Payout amount for Ava")).toBeInTheDocument();
  });

  it("marking a feeRelief payout paid posts a 'Fee relief' expense (volunteers unchanged)", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    fireEvent.click(screen.getByLabelText("Mark fee relief to Ben paid"));
    const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
    expect(calls[0][0]).toMatchObject({ op: "append", key: "expenses" });
    expect(calls[0][0].entry).toMatchObject({
      label: "Fee relief — Ben",
      amount: 90,
    });
    expect(calls[1][0]).toMatchObject({
      op: "mapEntries",
      key: "reimbursements",
    });
  });

  it("the ledger editor promotes a plain income to a fee-relief earmark", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.click(screen.getByLabelText("Edit entry Hardware sponsorship"));
    fireEvent.click(
      screen.getByLabelText(
        "Edit held-for-families earmark for Hardware sponsorship",
      ),
    );
    fireEvent.click(screen.getByLabelText("Save entry Hardware sponsorship"));
    const op = (teamValue.updateFinances as jest.Mock).mock.calls[0][0];
    expect(op).toMatchObject({ op: "mapEntries", key: "incomes" });
    const next = appliedFinances(teamValue);
    const inc = next.incomes.find((i: any) => i.id === "i1");
    expect(inc.earmark).toBe("familyPayout");
    // The earmark never rides with the dues credit or a per-child credit.
    expect(inc.fundraising).toBe(false);
    expect(inc.playerId).toBeUndefined();
  });

  it("the ledger editor demotes an earmarked income back to plain club money", () => {
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    fireEvent.click(screen.getByLabelText("Edit entry Spirit night"));
    const earmarkBox = screen.getByLabelText(
      "Edit held-for-families earmark for Spirit night",
    ) as HTMLInputElement;
    // Opens reflecting the stored earmark.
    expect(earmarkBox.checked).toBe(true);
    fireEvent.click(earmarkBox);
    fireEvent.click(screen.getByLabelText("Save entry Spirit night"));
    const next = appliedFinances(teamValue);
    const inc = next.incomes.find((i: any) => i.id === "pt1");
    // undefined is scrubbed from the write — the earmark key is gone.
    expect(inc.earmark).toBeUndefined();
    expect(inc.fundraising).toBe(false);
  });

  it("the edit form keeps the earmark and the fundraising credit mutually exclusive", () => {
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.click(screen.getByLabelText("Edit entry Hardware sponsorship"));
    const fundraisingBox = () =>
      screen.getByLabelText(
        "Edit fundraising flag for Hardware sponsorship",
      ) as HTMLInputElement;
    const earmarkBox = () =>
      screen.getByLabelText(
        "Edit held-for-families earmark for Hardware sponsorship",
      ) as HTMLInputElement;
    fireEvent.click(fundraisingBox());
    expect(fundraisingBox().checked).toBe(true);
    fireEvent.click(earmarkBox());
    expect(earmarkBox().checked).toBe(true);
    expect(fundraisingBox().checked).toBe(false); // earmark wins
    fireEvent.click(fundraisingBox());
    expect(fundraisingBox().checked).toBe(true);
    expect(earmarkBox().checked).toBe(false); // and both ways
  });

  it("voiding a fundraiser with queued payouts confirms, removes the unpaid rows, and keeps paid ones", async () => {
    // No ConfirmProvider in tests — useConfirm falls back to window.confirm.
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const { teamValue, toastValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    fireEvent.click(screen.getByLabelText("Void entry Spirit night"));
    await waitFor(() =>
      expect(teamValue.updateFinances).toHaveBeenCalledTimes(2),
    );
    const calls = (teamValue.updateFinances as jest.Mock).mock.calls;
    expect(calls[0][0]).toMatchObject({ op: "mapEntries", key: "incomes" });
    expect(calls[1][0]).toMatchObject({
      op: "mapEntries",
      key: "reimbursements",
    });
    // Fold both ops over the fixture to read the resulting state.
    const next = calls.reduce(
      (acc: any, c: any) => applyFinanceUpdate(acc, c[0]),
      (teamValue.team as any).finances,
    );
    expect(next.incomes.find((i: any) => i.id === "pt1").voidedAt).toBeTruthy();
    const ids = next.reimbursements.map((r: any) => r.id);
    expect(ids).not.toContain("fr2"); // the unpaid promise is removed
    expect(ids).toContain("fr1"); // the paid payout stays — it's history
    expect(ids).toContain("vol1"); // the volunteer IOU is untouched
    // The toast says what happened to the queued payouts.
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fundraiser voided",
        message: expect.stringMatching(/fee-relief payout.*paid stay/i),
      }),
    );
    confirmSpy.mockRestore();
  });

  it("declining the void confirm leaves the fundraiser and its payouts untouched", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: passThroughTeam() } },
    );
    fireEvent.click(screen.getByLabelText("Void entry Spirit night"));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(teamValue.updateFinances).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("voiding an income with no linked payouts stays a one-tap void (no confirm)", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false); // must never be consulted
    const { teamValue } = renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: baseTeam } },
    );
    fireEvent.click(screen.getByLabelText("Void entry Hardware sponsorship"));
    await waitFor(() =>
      expect(teamValue.updateFinances).toHaveBeenCalledTimes(1),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      (teamValue.updateFinances as jest.Mock).mock.calls[0][0],
    ).toMatchObject({ op: "mapEntries", key: "incomes" });
    confirmSpy.mockRestore();
  });

  it("the reconcile nudge counts fee-relief payouts left behind by a voided fundraiser", () => {
    const residue: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        incomes: [
          ...baseTeam.finances.incomes,
          {
            id: "pt1",
            date: "2026-03-02",
            label: "Struck night",
            amount: 300,
            earmark: "familyPayout",
            voidedAt: "2026-03-03T00:00:00.000Z",
          },
        ],
        // Pre-fix residue: an unpaid payout still pointing at the voided row.
        reimbursements: [
          {
            id: "fr1",
            to: "Ava",
            amount: 90,
            status: "unpaid",
            kind: "feeRelief",
            playerId: "kid1",
            sourceIncomeId: "pt1",
          },
        ],
      },
    };
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: residue } },
    );
    expect(
      screen.getByText(/fee-relief payout whose fundraiser was voided/i),
    ).toBeInTheDocument();
  });

  it("the carryover discount card never offers pass-through money", () => {
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
          // The rolled pass-through entry: still earmarked, still owed to
          // families — even with a carry-shaped label it must never be
          // offered as a dues discount.
          {
            id: "pt1",
            date: "2026-08-01",
            label: "Carried over fee relief",
            amount: 210,
            earmark: "familyPayout",
          },
        ],
      },
    };
    renderWithProviders(
      <MemoryRouter>
        <FinancesTab />
      </MemoryRouter>,
      { team: { team: carried } },
    );
    // Only the $240 club cash is offered: $120 off per family across 2 payers
    // — NOT $225 (which would include the held $210).
    expect(screen.getByText(/\$120 off per/)).toBeInTheDocument();
    expect(screen.queryByText(/\$225 off per/)).not.toBeInTheDocument();
  });

  describe("outside-org fee context (externalOrgFee — display only)", () => {
    const orgTeam: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        externalOrgFee: { label: "Team Elite Premier", amount: 525 },
      },
    };

    it("shows the total family burden in Collections and the fee guidance; totals stay untouched", () => {
      renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: orgTeam } },
      );
      // Collections (fee-setting seam) + this year's fee guidance both carry
      // the context line: $100 club fee + $525 org fee = $625 total burden.
      const lines = screen.getAllByText(/Families also pay/);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText("$625").length).toBeGreaterThanOrEqual(2);
      // Display only: the P&L is EXACTLY what it is without the org fee —
      // fees 100 + income 60 − spent 80 = 80; once-all-paid 180.
      expect(screen.getByText("$180")).toBeInTheDocument();
      expect(screen.queryByText("$705")).not.toBeInTheDocument(); // 180+525 never leaks
    });

    it("stays invisible when unset", () => {
      renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: baseTeam } },
      );
      expect(screen.queryByText(/Families also pay/)).not.toBeInTheDocument();
    });

    it("is set from the Collections inline editor (the this-season fee seam) via a narrow set op", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: baseTeam } },
      );
      // Placement: the CURRENT-year editor lives inside the Collections
      // section — where the coach sets this year's fee — not in the draft.
      const collections = screen
        .getByText(/Collections — this season/)
        .closest("section") as HTMLElement;
      expect(
        within(collections).getByLabelText("Outside org name"),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Outside org name"), {
        target: { value: "  Team Elite Premier " },
      });
      fireEvent.change(screen.getByLabelText("Outside org fee per player"), {
        target: { value: "525" },
      });
      fireEvent.blur(screen.getByLabelText("Outside org fee per player"));
      const patch = { finances: appliedFinances(teamValue) };
      expect(patch.finances.externalOrgFee).toEqual({
        label: "Team Elite Premier",
        amount: 525,
      });
      // Nothing else about finances changed.
      expect(patch.finances.clubFee).toBe(100);
      expect(patch.finances.budgetItems).toEqual(baseTeam.finances.budgetItems);
    });

    it("clearing both fields clears the stored context", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: orgTeam } },
      );
      fireEvent.change(screen.getByLabelText("Outside org name"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByLabelText("Outside org fee per player"), {
        target: { value: "" },
      });
      fireEvent.blur(screen.getByLabelText("Outside org fee per player"));
      const patch = { finances: appliedFinances(teamValue) };
      expect(patch.finances.externalOrgFee).toBeUndefined();
    });

    it("the draft planner stages nextExternalOrgFee via its own editor — the current context is untouched", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: orgTeam } },
      );
      fireEvent.change(screen.getByLabelText("Next season outside org name"), {
        target: { value: "New Umbrella Org" },
      });
      fireEvent.change(
        screen.getByLabelText("Next season outside org fee per player"),
        { target: { value: "600" } },
      );
      fireEvent.blur(
        screen.getByLabelText("Next season outside org fee per player"),
      );
      const patch = { finances: appliedFinances(teamValue) };
      expect(patch.finances.nextExternalOrgFee).toEqual({
        label: "New Umbrella Org",
        amount: 600,
      });
      // Staged only — this year's standing fact is untouched.
      expect(patch.finances.externalOrgFee).toEqual({
        label: "Team Elite Premier",
        amount: 525,
      });
    });

    it("the draft's burden line uses the staged org fee, falling back to the current one", () => {
      // With a set next-season fee ($200) the draft summary renders its
      // burden line. Staged next org fee ($600) → total family cost $800.
      const stagedTeam: any = {
        ...orgTeam,
        finances: {
          ...orgTeam.finances,
          nextClubFee: 200,
          nextExternalOrgFee: { label: "New Umbrella Org", amount: 600 },
        },
      };
      const { unmount } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: stagedTeam } },
      );
      expect(screen.getByText(/to New Umbrella Org directly/)).toBeVisible();
      expect(screen.getByText("$800")).toBeInTheDocument(); // 200 + 600
      unmount();
      // Without a staged value the draft falls back to the CURRENT org fee:
      // total family cost 200 + 525 = $725.
      const fallbackTeam: any = {
        ...orgTeam,
        finances: { ...orgTeam.finances, nextClubFee: 200 },
      };
      renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: fallbackTeam } },
      );
      expect(
        screen.queryByText(/to New Umbrella Org directly/),
      ).not.toBeInTheDocument();
      expect(screen.getByText("$725")).toBeInTheDocument();
    });
  });

  describe("fundedBy — fundraise-funded budget lines", () => {
    const fundedTeam: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        budgetItems: [
          ...baseTeam.finances.budgetItems,
          {
            id: "b3",
            label: "Pitching machine",
            amount: 300,
            fundedBy: "fundraising",
          },
        ],
        nextBudgetItems: [{ id: "nb1", label: "Dugout upgrade", amount: 200 }],
      },
    };

    it("the row toggle marks an item fundraise-funded through a mapEntries op", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: baseTeam } },
      );
      fireEvent.click(
        screen.getByLabelText("Toggle fundraising funding for Tournaments"),
      );
      const items = appliedFinances(teamValue).budgetItems;
      expect(items[0]).toMatchObject({
        label: "Tournaments",
        fundedBy: "fundraising",
      });
    });

    it("toggling back DROPS the key (absent = fees, byte-identical to legacy)", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: fundedTeam } },
      );
      fireEvent.click(
        screen.getByLabelText(
          "Toggle fundraising funding for Pitching machine",
        ),
      );
      const items = appliedFinances(teamValue).budgetItems;
      const machine = items.find((b: any) => b.id === "b3");
      expect("fundedBy" in machine).toBe(false);
    });

    it("the draft list carries its own toggle (suffix-disambiguated)", () => {
      const { teamValue } = renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: fundedTeam } },
      );
      fireEvent.click(
        screen.getByLabelText(
          "Toggle fundraising funding for Dugout upgrade (draft)",
        ),
      );
      const draft = appliedFinances(teamValue).nextBudgetItems;
      expect(draft[0]).toMatchObject({
        label: "Dugout upgrade",
        fundedBy: "fundraising",
      });
      // The live list is untouched.
      expect((teamValue.updateFinances as jest.Mock).mock.calls[0][0].key).toBe(
        "nextBudgetItems",
      );
    });

    it("shows the goal/progress readout in the this-season budget section and the goal-only line in the draft", () => {
      // $300 goal (Pitching machine); $100 plain car-wash income counts,
      // the $60 sponsorship income does not (Sponsorships source).
      const withProgress: any = {
        ...fundedTeam,
        finances: {
          ...fundedTeam.finances,
          incomes: [
            ...fundedTeam.finances.incomes,
            { id: "i2", date: "2026-03-02", label: "Car wash", amount: 100 },
          ],
          nextBudgetItems: [
            {
              id: "nb1",
              label: "Dugout upgrade",
              amount: 200,
              fundedBy: "fundraising",
            },
          ],
        },
      };
      renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: withProgress } },
      );
      expect(screen.getByText("Fundraising goal")).toBeInTheDocument();
      expect(screen.getByText(/raised \$100 of \$300/)).toBeInTheDocument();
      expect(
        screen.getByLabelText("Fundraising goal progress"),
      ).toBeInTheDocument();
      // The card says what it counts.
      expect(
        screen.getByText(/Counts plain Fundraiser income/),
      ).toBeInTheDocument();
      // Draft side: goal total only, no progress meter for next season.
      expect(
        screen.getByText(/Next season's fundraising goal is/),
      ).toBeInTheDocument();
    });

    it("fee guidance splits the budget total into fee-funded + fundraised", () => {
      renderWithProviders(
        <MemoryRouter>
          <FinancesTab />
        </MemoryRouter>,
        { team: { team: fundedTeam } },
      );
      // 800 total = 500 from fees + 300 fundraised; suggested = 500 / 2 = 250.
      expect(
        screen.getByText(/\$500 from fees \+ \$300 fundraised/),
      ).toBeInTheDocument();
    });
  });
});
