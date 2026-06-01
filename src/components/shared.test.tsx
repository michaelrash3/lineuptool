import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, Chip, StatTile } from "./shared";
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
