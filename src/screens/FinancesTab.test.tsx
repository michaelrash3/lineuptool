import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";
import { FinancesTab } from "./FinancesTab";

// Head-coach-only Finances screen. The money math itself is covered in
// helpers.test.js — these tests pin the screen wiring: tiles render the
// summary, the budget planner's quantity mode plans count × unit cost,
// Collections reflects per-player paid/owed state, and every action writes
// through updateTeam.

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
      { id: "i1", date: "2026-02-01", label: "Hardware sponsorship", amount: 60 },
    ],
    payments: [{ id: "p1", playerId: "kid1", date: "2026-03-01", amount: 100 }],
    expenses: [{ id: "e1", date: "2026-03-05", label: "Baseballs", amount: 80 }],
  },
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

  it("shows quantity budget items as count × unit and steps the count through updateTeam", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    expect(screen.getByText("× $100")).toBeInTheDocument(); // 4 × $100 row
    fireEvent.click(screen.getByLabelText("More Tournaments"));
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
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
          { id: "b1", label: "Tournaments", qty: 1, unitAmount: 100, amount: 100 },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: oneLeft },
    });
    fireEvent.click(screen.getByLabelText("Fewer Tournaments"));
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.budgetItems[0]).toMatchObject({ qty: 1, amount: 100 });
  });

  it("preset chip prefills a quantity-mode item and Add writes count × unit", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Tournaments" }));
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Cost per unit"), {
      target: { value: "450" },
    });
    // Two Add buttons on the page (budget form + ledger form) — budget first.
    fireEvent.click(screen.getAllByRole("button", { name: /Add$/ })[0]);
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    const items = patch.finances.budgetItems;
    const added = items[items.length - 1];
    expect(added).toMatchObject({
      label: "Tournaments",
      qty: 8,
      unitAmount: 450,
      amount: 3600,
    });
  });

  it("suggests next season's fee from projected year-end money and stores it as nextClubFee", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    // Projected year-end = balanceNow 80 + stillOwed 100 = 180.
    // (budget 500 − 180) / 2 paying players = 160.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i })
    );
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ nextClubFee: 160 }),
    });
    // The CURRENT season's collections fee is untouched by planning.
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.clubFee).toBe(100);
  });

  it("waives a player's fee and shows the waived state", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Waive fee for Ben"));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ feeExemptIds: ["kid2"] }),
    });
  });

  it("renders waived players without payment controls and excludes them from Still owed", () => {
    const waivedTeam: any = {
      ...baseTeam,
      finances: { ...baseTeam.finances, feeExemptIds: ["kid2"] },
    };
    renderWithProviders(<FinancesTab />, { team: { team: waivedTeam } });
    expect(screen.getByText("Fee waived")).toBeInTheDocument();
    expect(screen.queryByLabelText("Payment amount for Ben")).not.toBeInTheDocument();
    // Ben waived → nobody owes anything.
    expect(screen.getByText("Still owed")).toBeInTheDocument();
    expect(screen.queryByText("$100 owed")).not.toBeInTheDocument();
  });

  it("buffer chips write the fee round-up increment", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Fee buffer $25"));
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ feeBufferIncrement: 25 }),
    });
  });

  it("buffered suggestion rounds the next-season fee up to a clean number", () => {
    const buffered: any = {
      ...baseTeam,
      finances: { ...baseTeam.finances, feeBufferIncrement: 25 },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: buffered },
    });
    // Raw (500 − 180) / 2 = 160 → next $25 = 175.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i })
    );
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ nextClubFee: 175 }),
    });
  });

  it("sales tax: percent commits on blur and the +tax toggle flags an item", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    const taxField = screen.getByLabelText("Sales tax percent");
    fireEvent.change(taxField, { target: { value: "8.25" } });
    fireEvent.blur(taxField);
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ salesTaxPct: 8.25 }),
    });
    fireEvent.click(screen.getByLabelText("Toggle sales tax on Tournaments"));
    const calls = (teamValue.updateTeam as jest.Mock).mock.calls;
    const patch = calls[calls.length - 1][0];
    expect(patch.finances.budgetItems[0]).toMatchObject({ taxable: true });
  });

  it("taxed items raise the budget and the suggested fee", () => {
    const taxed: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        salesTaxPct: 10,
        budgetItems: [
          { id: "b1", label: "Tournaments", qty: 4, unitAmount: 100, amount: 400, taxable: true },
          { id: "b2", label: "Uniform printing", amount: 100 },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: taxed },
    });
    // Budget 440 + 100 = 540 → (540 − 180) / 2 = 180.
    fireEvent.click(
      screen.getByRole("button", { name: /Set as next season's fee/i })
    );
    expect(teamValue.updateTeam).toHaveBeenCalledWith({
      finances: expect.objectContaining({ nextClubFee: 180 }),
    });
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
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.expenses[0]).toMatchObject({
      id: "e1",
      label: "Game baseballs",
      amount: 95,
      date: "2026-03-05",
    });
  });

  it("edits ONLY the date on a dues payment row", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.click(screen.getByLabelText("Edit entry Club fee — Ava"));
    // Payments edit their date here; the money is managed in Collections.
    expect(
      screen.queryByLabelText("Edit amount for Club fee — Ava")
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Edit date for Club fee — Ava"), {
      target: { value: "2026-03-10" },
    });
    fireEvent.click(screen.getByLabelText("Save entry Club fee — Ava"));
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.payments[0]).toMatchObject({
      id: "p1",
      date: "2026-03-10",
      amount: 100,
    });
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
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
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
          { id: "e1", date: "2026-03-05", label: "Entry", amount: 450, budgetItemId: "b1" },
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
    fireEvent.click(screen.getByLabelText("Copy dues reminder"));
    await screen.findByLabelText("Copy dues reminder"); // flush the async click
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

  it("records out-of-pocket spending with paidBy and shows the owed-back banner", () => {
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: baseTeam },
    });
    fireEvent.change(screen.getByLabelText("Transaction description"), {
      target: { value: "Snacks" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("Paid out of pocket by"), {
      target: { value: "Coach Mike" },
    });
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    const exp = patch.finances.expenses[patch.finances.expenses.length - 1];
    expect(exp).toMatchObject({ label: "Snacks", amount: 35, paidBy: "Coach Mike" });
  });

  it("shows who fronted an expense and marks it repaid through updateTeam", () => {
    const fronted: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        expenses: [
          { id: "e1", date: "2026-03-05", label: "Baseballs", amount: 80, paidBy: "Mike" },
        ],
      },
    };
    const { teamValue } = renderWithProviders(<FinancesTab />, {
      team: { team: fronted },
    });
    expect(screen.getByText(/Owed back/)).toBeInTheDocument();
    expect(screen.getByText(/fronted by Mike/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mark Baseballs repaid to Mike"));
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.expenses[0]).toMatchObject({ id: "e1", reimbursed: true });
  });

  it("repaid expenses leave the owed-back banner and show the repaid badge", () => {
    const repaid: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        expenses: [
          { id: "e1", date: "2026-03-05", label: "Baseballs", amount: 80, paidBy: "Mike", reimbursed: true },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: repaid } });
    expect(screen.queryByText(/Owed back/)).not.toBeInTheDocument();
    expect(screen.getByText(/repaid Mike/)).toBeInTheDocument();
  });

  it("renders the year-over-year chart when past seasons exist", () => {
    const withHistory: any = {
      ...baseTeam,
      finances: {
        ...baseTeam.finances,
        pastSeasons: [
          { season: "through Spring 2026", collected: 1200, otherIncome: 300, spent: 1100, closingBalance: 400 },
        ],
      },
    };
    renderWithProviders(<FinancesTab />, { team: { team: withHistory } });
    expect(
      screen.getByRole("img", { name: "Year over year money in and out" })
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
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
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
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.payments[1]).toMatchObject({
      playerId: "kid2",
      amount: 100,
    });
  });

  it("shows one ledger of money in and out with a running balance", () => {
    renderWithProviders(<FinancesTab />, { team: { team: baseTeam } });
    // 02-01 +60 sponsorship, 03-01 +100 Ava's fee, 03-05 −80 balls → 80.
    expect(screen.getByText("Hardware sponsorship")).toBeInTheDocument();
    expect(screen.getByText("Club fee — Ava")).toBeInTheDocument();
    expect(screen.getByText("Baseballs")).toBeInTheDocument();
    // $160 also appears as the suggested next-season fee, hence getAllByText.
    expect(screen.getAllByText(/\$160/).length).toBeGreaterThanOrEqual(1);
    // Fee rows are managed from Collections — no delete button on them.
    expect(
      screen.queryByLabelText("Delete entry Club fee — Ava")
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Delete entry Hardware sponsorship")
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
    const addButtons = screen.getAllByRole("button", { name: /Add$/ });
    fireEvent.click(addButtons[addButtons.length - 1]);
    const patch = (teamValue.updateTeam as jest.Mock).mock.calls[0][0];
    expect(patch.finances.incomes).toHaveLength(2);
    expect(patch.finances.incomes[1]).toMatchObject({
      label: "Car wash fundraiser",
      amount: 250,
    });
  });

  it("renders the empty state without a finances object at all", () => {
    renderWithProviders(<FinancesTab />, {
      team: { team: { players: [], games: [] } },
    });
    expect(
      screen.getByText(/Add players on the Roster tab/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing logged yet/i)).toBeInTheDocument();
  });
});
