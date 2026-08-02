import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RosterRecoveryCard } from "./RosterRecoveryCard";
import { renderWithProviders } from "../test-utils";

// A wiped team whose season still references two players: one named via an
// applied availability submission, one id-only via practice attendance.
const wipedTeam = {
  players: [],
  games: [],
  practices: [{ id: "pr-1", attendance: { "p-idonly": "present" } }],
  availabilitySubmissions: [
    {
      id: "av-1",
      submittedAt: "2026-03-01T00:00:00.000Z",
      firstName: "Sam",
      lastName: "Reyes",
      dates: ["2026-04-10"],
      appliedToPlayerId: "p-named",
    },
  ],
};

describe("RosterRecoveryCard", () => {
  it("renders nothing when the season references no players", () => {
    const { container } = renderWithProviders(<RosterRecoveryCard />, {
      team: { team: { players: [], games: [] } as any },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the rebuild with counts and recovered names", () => {
    renderWithProviders(<RosterRecoveryCard />, {
      team: { team: wipedTeam as any },
    });
    expect(
      screen.getByText(/recover roster from season data/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Sam Reyes")).toBeInTheDocument();
    expect(screen.getByText(/recovered player 1/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /rebuild roster/i }),
    ).toBeInTheDocument();
  });

  it("restores via an APPEND op (never a whole-array write) after a two-tap confirm", async () => {
    const user = userEvent.setup();
    const { teamValue, toastValue } = renderWithProviders(
      <RosterRecoveryCard />,
      { team: { team: wipedTeam as any } },
    );
    await user.click(screen.getByRole("button", { name: /rebuild roster/i }));
    // First tap only arms.
    expect(teamValue.updateTeamArrays).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /tap again/i }));
    expect(teamValue.updateTeamArrays).toHaveBeenCalledTimes(1);
    const op = (teamValue.updateTeamArrays as jest.Mock).mock.calls[0][0];
    expect(op.op).toBe("append");
    expect(op.key).toBe("players");
    // Original ids preserved so history reattaches.
    expect(op.entries.map((p: any) => p.id).sort()).toEqual([
      "p-idonly",
      "p-named",
    ]);
    const named = op.entries.find((p: any) => p.id === "p-named");
    expect(named.name).toBe("Sam Reyes");
    expect(named.absences).toEqual(["2026-04-10"]);
    expect(toastValue.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Roster restored" }),
    );
  });
});
