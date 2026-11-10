import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppHeader } from "./Chrome";
import { Icons } from "../icons";
import { TeamContext, UIContext, ToastContext } from "../contexts";

const NAV = [
  { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
  { id: "roster", icon: Icons.Users, label: "Roster" },
  { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
  { id: "finances", icon: Icons.Wallet, label: "Finances" },
];

const team: any = {
  primaryColor: "#2563eb",
  secondaryColor: "#fff",
  tertiaryColor: "#fff",
  logoUrl: "",
  interestSignups: [],
};

const teamCtx: any = {
  team,
  teams: [{ id: "t1", name: "Trash Pandas" }],
  activeTeamId: "t1",
  syncStatus: "synced",
  switchTeam: () => {},
  createTeam: () => {},
  record: { wins: 1, losses: 2, ties: 0 },
  currentRole: "head",
  realRole: "head",
  viewAsRole: null,
  setViewAsRole: () => {},
  joinTeamByCode: async () => ({ ok: true }),
};

const uiCtx: any = {
  isAddingTeam: false,
  setIsAddingTeam: () => {},
  newTeamName: "",
  setNewTeamName: () => {},
  activeTab: "home",
  setActiveTab: () => {},
};

const renderHeader = () =>
  render(
    // The header's Help entry navigates to /help, so it needs a router.
    <MemoryRouter>
      <ToastContext.Provider
        value={{ push: () => {}, dismiss: () => {} } as any}
      >
        <TeamContext.Provider value={teamCtx}>
          <UIContext.Provider value={uiCtx}>
            <AppHeader navButtons={NAV} />
          </UIContext.Provider>
        </TeamContext.Provider>
      </ToastContext.Provider>
    </MemoryRouter>,
  );

describe("AppHeader → NavDrawer integration", () => {
  it("renders the passed navButtons inside the drawer for a head coach", () => {
    renderHeader();
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    NAV.forEach((b) =>
      expect(screen.getByRole("link", { name: b.label })).toBeInTheDocument(),
    );
  });

  it("portals the drawer out of the header", () => {
    // Regression: the drawer should never be constrained by header
    // chrome/layout. It must be portaled to <body> so it stays pinned to the
    // full viewport.
    const { container } = renderHeader();
    fireEvent.click(
      screen.getByRole("button", { name: /open navigation menu/i }),
    );
    const menu = screen.getByRole("navigation", {
      name: /primary navigation/i,
    });
    // Not a descendant of the <header> (it was portaled to document.body).
    expect(menu.closest("header")).toBeNull();
    expect(container.querySelector("header")).not.toBeNull();
  });
});

describe("AppHeader team picker", () => {
  // New Team / Join Team used to be a second always-on bar of buttons under
  // the header. They're entries in the team picker now, and their form bar
  // only renders while one is open — so the header is one row on a phone.
  const renderWithState = (overrides: Partial<typeof teamCtx> = {}) => {
    const switchTeam = jest.fn();
    const createTeam = jest.fn();
    const Harness = () => {
      const [isAddingTeam, setIsAddingTeam] = React.useState(false);
      const [newTeamName, setNewTeamName] = React.useState("");
      return (
        <MemoryRouter>
          <ToastContext.Provider
            value={{ push: () => {}, dismiss: () => {} } as any}
          >
            <TeamContext.Provider
              value={{
                ...teamCtx,
                teams: [
                  { id: "t1", name: "Trash Pandas" },
                  { id: "t2", name: "Comets" },
                ],
                switchTeam,
                createTeam,
                ...overrides,
              }}
            >
              <UIContext.Provider
                value={{
                  ...uiCtx,
                  isAddingTeam,
                  setIsAddingTeam,
                  newTeamName,
                  setNewTeamName,
                }}
              >
                <AppHeader navButtons={NAV} />
              </UIContext.Provider>
            </TeamContext.Provider>
          </ToastContext.Provider>
        </MemoryRouter>
      );
    };
    render(<Harness />);
    return { switchTeam, createTeam };
  };
  const picker = () => screen.getByRole("combobox", { name: /switch team/i });

  it("shows no add/join form bar until one is picked", () => {
    renderWithState();
    expect(
      screen.queryByRole("button", { name: /new team/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/team code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/new team name/i)).not.toBeInTheDocument();
  });

  it("switches teams when a team is picked", () => {
    const { switchTeam } = renderWithState();
    fireEvent.change(picker(), { target: { value: "t2" } });
    expect(switchTeam).toHaveBeenCalledWith("t2");
  });

  it("opens the new-team form from the picker without switching teams", () => {
    const { switchTeam, createTeam } = renderWithState();
    fireEvent.change(picker(), { target: { value: "__bench_new_team__" } });
    expect(switchTeam).not.toHaveBeenCalled();
    // The picker stays on the current team.
    expect((picker() as HTMLSelectElement).value).toBe("t1");
    fireEvent.change(screen.getByLabelText(/new team name/i), {
      target: { value: "Sharks" },
    });
    fireEvent.change(screen.getByLabelText(/team type/i), {
      target: { value: "NKB" },
    });
    // Age group is required too — no silent 8U default.
    fireEvent.submit(screen.getByLabelText(/new team name/i).closest("form")!);
    expect(createTeam).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/age group/i), {
      target: { value: "10U" },
    });
    fireEvent.submit(screen.getByLabelText(/new team name/i).closest("form")!);
    // 10U is always kid pitch, whatever the league.
    expect(createTeam).toHaveBeenCalledWith("Sharks", "NKB", {
      teamAge: "10U",
      pitchingFormat: "Kid Pitch",
    });
  });

  it("opens the join form from the picker and joins with the typed code", async () => {
    const joinTeamByCode = jest.fn(async () => ({ ok: true }));
    const { switchTeam } = renderWithState({ joinTeamByCode });
    fireEvent.change(picker(), { target: { value: "__bench_join_team__" } });
    expect(switchTeam).not.toHaveBeenCalled();
    const code = screen.getByLabelText(/team code/i);
    fireEvent.change(code, { target: { value: "abc123" } });
    fireEvent.submit(code.closest("form")!);
    expect(joinTeamByCode).toHaveBeenCalledWith("ABC123");
    // Closes on success.
    await waitFor(() =>
      expect(screen.queryByLabelText(/team code/i)).not.toBeInTheDocument(),
    );
  });
});
