import { describe, it, expect } from "vitest";
import { buildOfferLetter, type OfferLetterContext } from "./offerLetters";

const ctx: OfferLetterContext = {
  playerName: "Sam Rivera",
  teamName: "Trash Pandas",
  teamFees: "$1,200",
  deposit: "$300",
  depositDueDate: "2026-03-19",
  coveredItems: ["Game jerseys", "Hats", "Indoor facility"],
  tournamentCount: 6,
  coachName: "Coach Mike",
  coachEmail: "mike@example.com",
  coachPhone: "(555) 123-4567",
  venmoAccountName: "@CoachMike",
  venmoLink: "https://venmo.com/u/CoachMike",
};

describe("buildOfferLetter", () => {
  it("returning offer folds in dues, deposit, 48h, and coach contact", () => {
    const { subject, body } = buildOfferLetter("returning", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("invite you back to the Trash Pandas Baseball Club");
    expect(body).toContain("$1,200");
    expect(body).toContain("deposit of $300 is required by March 19, 2026");
    expect(body).toContain(
      "These fees cover game jerseys, hats, indoor facility, and 5 to 7 tournaments between the Fall and Spring seasons.",
    );
    expect(body).toContain("within 48 hours");
    expect(body).toContain("call/text me at (555) 123-4567");
    expect(body).toContain("@CoachMike");
    expect(body).toContain("https://venmo.com/u/CoachMike");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
    expect(body).not.toContain("Coach Mike");
    expect(body).not.toContain("mike@example.com");
  });

  it("new player offer congratulates and quotes fees + 48h", () => {
    const { subject, body } = buildOfferLetter("newPlayer", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("pleased to offer you a roster spot");
    expect(body).toContain("$1,200");
    expect(body).toContain("$300 is required by March 19, 2026");
    expect(body).toContain("48 hours");
    expect(body).toContain("Welcome to the Trash Pandas.");
  });

  it("rejection is gracious and omits money / acceptance terms", () => {
    const { subject, body } = buildOfferLetter("rejection", ctx);
    expect(subject).toBe("Trash Pandas Baseball Tryouts Update");
    expect(body).toContain("unable to offer you a position");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("48 hours");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
    expect(body).not.toContain("Coach Mike");
  });

  it("interest invite thanks the lead and omits money", () => {
    const { subject, body } = buildOfferLetter("interest", ctx);
    expect(subject).toContain("Tryout Info for Sam Rivera");
    expect(body).toContain("Thank you for your interest");
    expect(body).toContain("at our tryouts");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("deposit");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
    expect(body).not.toContain("Coach Mike");
  });

  it("drops the phone clause when no coach phone is set", () => {
    const { body } = buildOfferLetter("newPlayer", { ...ctx, coachPhone: "" });
    expect(body).not.toContain("call me at");
    expect(body).toContain("reply to this message confirming your acceptance.");
  });

  it("quotes planned tournaments as a ±1 range in both offers", () => {
    for (const kind of ["returning", "newPlayer"] as const) {
      const { body } = buildOfferLetter(kind, { ...ctx, tournamentCount: 4 });
      expect(body).toContain(
        "3 to 5 tournaments between the Fall and Spring seasons",
      );
    }
  });

  it("floors the tournament range at 1 for a single planned tournament", () => {
    const { body } = buildOfferLetter("returning", {
      ...ctx,
      tournamentCount: 1,
    });
    expect(body).toContain(
      "1 to 2 tournaments between the Fall and Spring seasons",
    );
  });

  it("lists covered items without a tournament clause when none are planned", () => {
    const { body } = buildOfferLetter("returning", {
      ...ctx,
      tournamentCount: 0,
    });
    expect(body).toContain(
      "These fees cover game jerseys, hats, and indoor facility.",
    );
    expect(body).not.toContain("tournaments between");
  });

  it("keeps acronym-leading planner labels as typed", () => {
    const { body } = buildOfferLetter("returning", {
      ...ctx,
      coveredItems: ["USSSA sanctioning", "Game jerseys"],
      tournamentCount: 0,
    });
    expect(body).toContain(
      "These fees cover USSSA sanctioning and game jerseys.",
    );
  });

  it("falls back to the stock covered-items copy when the planner is empty", () => {
    const { body } = buildOfferLetter("returning", {
      ...ctx,
      coveredItems: [],
      tournamentCount: 0,
    });
    expect(body).toContain("three uniform tops");
    expect(body).toContain(
      "3 to 5 tournaments between the Fall and Spring seasons",
    );
  });
});

it("not returning letter is separate from tryout rejection and avoids money", () => {
  const decline = buildOfferLetter("notReturning", ctx);
  const rejection = buildOfferLetter("rejection", ctx);
  expect(decline.subject).toBe("Trash Pandas Baseball Roster Update");
  expect(decline.body).toContain(
    "will not be offering you a spot on the roster",
  );
  expect(rejection.body).toContain("Thank you for attending the tryouts");
  expect(decline.body).not.toContain("deposit");
  expect(decline.body).not.toContain("Venmo");
  expect(decline.body).not.toContain("team fees");
});
