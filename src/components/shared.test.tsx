import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, Chip, StatTile, PlayerAvatar } from "./shared";
import { renderWithProviders } from "../test-utils";
import { useTeam, useToast } from "../contexts";

describe("Button", () => {
  it("renders its children and defaults to type=button", () => {
    render(<Button>Save lineup</Button>);
    const btn = screen.getByRole("button", { name: "Save lineup" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("type", "button");
  });

  it("fires onClick when pressed", async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("forwards the disabled attribute", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button", { name: "Nope" })).toBeDisabled();
  });
});

describe("Chip", () => {
  it("renders its label", () => {
    render(<Chip variant="success">Active</Chip>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

describe("StatTile", () => {
  it("renders the label and value", () => {
    render(<StatTile label="AVG" value=".321" />);
    expect(screen.getByText("AVG")).toBeInTheDocument();
    expect(screen.getByText(".321")).toBeInTheDocument();
  });
});

describe("PlayerAvatar", () => {
  const player = { id: "p1", name: "Sammy Sosa", number: "21", primaryPosition: "SS" };

  it("shows the team logo (not a player photo) when a logo is set", () => {
    renderWithProviders(<PlayerAvatar player={player} />, {
      team: { team: { logoUrl: "data:image/png;base64,LOGO" } },
    });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/png;base64,LOGO");
  });

  it("falls back to initials over the gradient when no logo is set", () => {
    renderWithProviders(<PlayerAvatar player={player} />, {
      team: { team: { logoUrl: "" } },
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("SS")).toBeInTheDocument(); // Sammy Sosa initials
  });

  it("overlays the number and primary position when asked", () => {
    renderWithProviders(<PlayerAvatar player={player} showNumber showPosition />, {
      team: { team: { logoUrl: "data:image/png;base64,LOGO" } },
    });
    expect(screen.getByText("21")).toBeInTheDocument();
    // "SS" here is the primary-position badge, not initials (logo is shown).
    expect(screen.getByText("SS")).toBeInTheDocument();
  });

  it("ignores any legacy photoUrl still on the player record", () => {
    renderWithProviders(
      <PlayerAvatar player={{ ...player, photoUrl: "data:image/jpeg;base64,OLD" }} />,
      { team: { team: { logoUrl: "data:image/png;base64,LOGO" } } }
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,LOGO"
    );
  });
});

// Sanity check that the shared test harness actually supplies context values
// to consumers — guards against future provider regressions.
describe("renderWithProviders", () => {
  const TeamProbe = () => {
    const { team, currentRole } = useTeam();
    return (
      <div>
        <span>role:{currentRole}</span>
        <span>name:{team?.name ?? "none"}</span>
      </div>
    );
  };

  it("provides team context with overrides applied", () => {
    renderWithProviders(<TeamProbe />, {
      team: { currentRole: "assistant", team: { name: "Hawks" } },
    });
    expect(screen.getByText("role:assistant")).toBeInTheDocument();
    expect(screen.getByText("name:Hawks")).toBeInTheDocument();
  });

  it("exposes the mocked toast so actions can be asserted", async () => {
    const ToastProbe = () => {
      const toast = useToast();
      return <Button onClick={() => toast.push({ title: "hi" })}>Toast</Button>;
    };
    const { toastValue } = renderWithProviders(<ToastProbe />);
    await userEvent.click(screen.getByRole("button", { name: "Toast" }));
    expect(toastValue.push).toHaveBeenCalledWith({ title: "hi" });
  });
});
