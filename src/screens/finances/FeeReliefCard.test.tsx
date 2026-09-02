import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { FeeReliefCard } from "./FeeReliefCard";
import type { PassThroughSummary } from "../../utils/helpers";

// One fundraiser with $100 left, split across three families.
const passThrough = (remaining = 100): PassThroughSummary => ({
  fundraisers: [
    {
      id: "inc1",
      label: "Donation",
      amount: 100,
      allocated: 0,
      disbursed: 0,
      remaining,
      undisbursed: remaining,
    },
  ],
  raised: 100,
  disbursed: 0,
  remaining,
  undisbursed: remaining,
});

const payers = [
  { id: "p1", name: "Ava Rivera" },
  { id: "p2", name: "Bo Chen" },
  { id: "p3", name: "Cy Diaz" },
];

const openEditor = (distribute = vi.fn(() => true)) => {
  render(
    <FeeReliefCard
      passThrough={passThrough()}
      payers={payers}
      distribute={distribute}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Distribute Donation to families/i }),
  );
  return distribute;
};

const amountFor = (name: string) =>
  screen.getByRole("textbox", { name: `Payout amount for ${name}` });

const setAmount = (name: string, value: string) =>
  fireEvent.change(amountFor(name), { target: { value } });

const confirm = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /Confirm fee-relief payouts/i }),
  );

describe("FeeReliefCard payout editor", () => {
  // A family's name is the only way to tell the rows apart. The shared input
  // class leads with w-full, which Tailwind emits after w-28 — so an
  // un-forced w-28 let the input fill the row and squeeze every name out.
  it("labels each row with the family's name", () => {
    openEditor();
    for (const p of payers) {
      expect(screen.getByText(p.name)).toBeInTheDocument();
    }
  });

  it("keeps the amount input from swallowing the name column", () => {
    openEditor();
    expect(amountFor("Ava Rivera").className).toContain("!w-28");
  });

  // The bug: parseAmount returns null for a typed 0 exactly as it does for
  // junk, and the confirm handler bailed on null — so one zeroed-out family
  // silently killed the whole submit and the button looked dead.
  it("treats a typed 0 as leaving that family out, not as an error", () => {
    const distribute = openEditor();
    setAmount("Ava Rivera", "60");
    setAmount("Bo Chen", "0");
    setAmount("Cy Diaz", "40");
    confirm();

    expect(distribute).toHaveBeenCalledTimes(1);
    expect(distribute).toHaveBeenCalledWith("inc1", [
      { playerId: "p1", name: "Ava Rivera", amount: 60 },
      { playerId: "p3", name: "Cy Diaz", amount: 40 },
    ]);
  });

  it("still pays out when every other family is zeroed", () => {
    const distribute = openEditor();
    setAmount("Ava Rivera", "0");
    setAmount("Bo Chen", "100");
    setAmount("Cy Diaz", "0");
    confirm();

    expect(distribute).toHaveBeenCalledWith("inc1", [
      { playerId: "p2", name: "Bo Chen", amount: 100 },
    ]);
  });

  it("carries the player id on every row so payouts tie back to a kid", () => {
    const distribute = openEditor();
    setAmount("Ava Rivera", "50");
    setAmount("Bo Chen", "50");
    setAmount("Cy Diaz", "0");
    confirm();

    const rows = (distribute as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Array<{ playerId: string }>;
    expect(rows.map((r) => r.playerId)).toEqual(["p1", "p2"]);
  });

  // Refusing has to say why — a quiet return is indistinguishable from a
  // dead button, which is how this was reported.
  it("names the family whose amount cannot be read", () => {
    const distribute = openEditor();
    setAmount("Ava Rivera", "60");
    setAmount("Bo Chen", "abc");
    confirm();

    expect(distribute).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Bo Chen/);
  });

  it("says so when every family is zero or blank", () => {
    const distribute = openEditor();
    for (const p of payers) setAmount(p.name, "0");
    confirm();

    expect(distribute).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one family/i);
  });

  it("clears the complaint once the amounts are fixed", () => {
    const distribute = openEditor();
    setAmount("Bo Chen", "abc");
    confirm();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    setAmount("Bo Chen", "0");
    setAmount("Ava Rivera", "25");
    confirm();
    expect(distribute).toHaveBeenCalledTimes(1);
  });

  it("leaves the editor open when the distribute call refuses", () => {
    const distribute = vi.fn(() => false);
    openEditor(distribute);
    setAmount("Ava Rivera", "60");
    confirm();

    expect(distribute).toHaveBeenCalled();
    // Still editable, so the coach can correct the amounts.
    expect(amountFor("Ava Rivera")).toBeInTheDocument();
  });
});
