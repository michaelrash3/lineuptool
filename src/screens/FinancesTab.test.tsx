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
