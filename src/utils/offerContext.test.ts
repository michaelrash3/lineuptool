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

  it("reads covered items and the tournament total from the Budget Planner", () => {
    const ctx = makeOfferLetterContext(
      {
        name: "Trash Pandas",
        finances: {
          budgetItems: [
            {
              id: "b1",
              label: "Fall tournaments",
              amount: 0,
              qty: 3,
              unitAmount: 450,
            },
            {
              id: "b2",
              label: "Spring tournaments",
              amount: 0,
              qty: 4,
              unitAmount: 450,
            },
            { id: "b3", label: "Game jerseys", amount: 600 },
            { id: "b4", label: "Indoor facility", amount: 900 },
            // Unpriced placeholder rows never show up in a letter.
            { id: "b5", label: "Baseballs", amount: 0 },
          ],
        },
      },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(ctx.coveredItems).toEqual(["Game jerseys", "Indoor facility"]);
    expect(ctx.tournamentCount).toBe(7);
  });

  it("keeps a flat tournament item in the list when no quantity is planned", () => {
    const ctx = makeOfferLetterContext(
      {
        name: "Trash Pandas",
        finances: {
          budgetItems: [
            { id: "b1", label: "Tournament entry", amount: 1800 },
            { id: "b2", label: "Game jerseys", amount: 600 },
          ],
        },
      },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(ctx.coveredItems).toEqual(["Tournament entry", "Game jerseys"]);
    expect(ctx.tournamentCount).toBe(0);
  });

  it("dedupes repeated planner labels and defaults to empty when unplanned", () => {
    const dup = makeOfferLetterContext(
      {
        name: "Trash Pandas",
        finances: {
          budgetItems: [
            { id: "b1", label: "Hotel", amount: 400 },
            { id: "b2", label: "hotel", amount: 250 },
          ],
        },
      },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(dup.coveredItems).toEqual(["Hotel"]);

    const empty = makeOfferLetterContext(
      { name: "Trash Pandas" },
      { displayName: "Coach", email: "coach@example.com" },
      "Ava",
    );
    expect(empty.coveredItems).toEqual([]);
    expect(empty.tournamentCount).toBe(0);
  });
});
