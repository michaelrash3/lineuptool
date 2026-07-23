import React from "react";
import { render, screen } from "@testing-library/react";
import {
  TeamContext,
  TeamActionsContext,
  useTeam,
  useTeamActions,
} from "./contexts";
import type { TeamContextValue } from "./types";

// Contract of the data/actions context split: a changed data value pierces
// React.memo for useTeam() consumers (context invalidation), while
// command-only consumers on useTeamActions() stay untouched as long as the
// actions value keeps its identity — which is the whole point of the split.

const counts = { data: 0, actions: 0 };

const DataConsumer = React.memo(() => {
  counts.data += 1;
  const { team } = useTeam();
  return <div data-testid="team-name">{(team as { name?: string })?.name}</div>;
});

const ActionsConsumer = React.memo(() => {
  counts.actions += 1;
  const { updateTeam } = useTeamActions();
  return (
    <button type="button" onClick={() => updateTeam?.({})}>
      go
    </button>
  );
});

const Harness = ({
  dataValue,
  actionsValue,
}: {
  dataValue: unknown;
  actionsValue: unknown;
}) => (
  <TeamContext.Provider value={dataValue as TeamContextValue}>
    <TeamActionsContext.Provider value={actionsValue as TeamContextValue}>
      <DataConsumer />
      <ActionsConsumer />
    </TeamActionsContext.Provider>
  </TeamContext.Provider>
);

describe("team context split", () => {
  beforeEach(() => {
    counts.data = 0;
    counts.actions = 0;
  });

  it("re-renders data consumers but not action-only consumers on a snapshot", () => {
    const actionsValue = { updateTeam: jest.fn() };
    const { rerender } = render(
      <Harness
        dataValue={{ team: { name: "A" } }}
        actionsValue={actionsValue}
      />,
    );
    const before = { ...counts };
    // New data value = a Firestore snapshot landing; actions identity stable.
    rerender(
      <Harness
        dataValue={{ team: { name: "B" } }}
        actionsValue={actionsValue}
      />,
    );
    expect(screen.getByTestId("team-name").textContent).toBe("B");
    expect(counts.data).toBeGreaterThan(before.data);
    expect(counts.actions).toBe(before.actions);
  });

  it("serves useTeam from a lone TeamContext for legacy single-provider trees", () => {
    // Older tests mount only TeamContext with one mock carrying everything —
    // useTeam() must serve it unchanged (useTeamActions instead requires the
    // actions provider; renderWithProviders mounts both).
    const everything = { team: { name: "Solo" }, updateTeam: jest.fn() };
    const Probe = () => {
      const { team, updateTeam } = useTeam();
      return (
        <button
          type="button"
          onClick={() => updateTeam?.({})}
          data-testid="probe"
        >
          {(team as { name?: string })?.name}
        </button>
      );
    };
    render(
      <TeamContext.Provider value={everything as unknown as TeamContextValue}>
        <Probe />
      </TeamContext.Provider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("Solo");
    screen.getByTestId("probe").click();
    expect(everything.updateTeam).toHaveBeenCalled();
  });
});
