import { describe, expect, it } from "vitest";
import { makeOfferLetterContext } from "./offerContext";

describe("makeOfferLetterContext", () => {
  it("uses Budget Planner next-season fee and deposit before current collections", () => {
    const ctx = makeOfferLetterContext(
      {
        name: "Trash Pandas",
        finances: {
          clubFee: 500,
          depositAmount: 100,
          depositDueDate: "2026-03-01",
          nextClubFee: 900,
          nextDepositAmount: 250,
          nextDepositDueDate: "2026-07-15",
        },
      },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );

    expect(ctx.teamFees).toBe("$900");
    expect(ctx.deposit).toBe("$250");
    expect(ctx.depositDueDate).toBe("2026-07-15");
  });

  it("passes the coach Venmo account name + link through", () => {
    const ctx = makeOfferLetterContext(
      {
        name: "Trash Pandas",
        coachVenmoAccountName: "@Trash-Pandas",
        coachVenmoLink: "https://venmo.com/u/Trash-Pandas",
      },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(ctx.venmoAccountName).toBe("@Trash-Pandas");
    expect(ctx.venmoLink).toBe("https://venmo.com/u/Trash-Pandas");
  });

  it("leaves Venmo blank when nothing is set", () => {
    const ctx = makeOfferLetterContext(
      { name: "Trash Pandas" },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(ctx.venmoAccountName).toBe("");
    expect(ctx.venmoLink).toBe("");
  });
});
