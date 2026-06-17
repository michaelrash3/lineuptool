import { describe, it, expect } from "vitest";
import { buildOfferLetter, type OfferLetterContext } from "./offerLetters";

const ctx: OfferLetterContext = {
  playerName: "Sam Rivera",
  teamName: "Trash Pandas",
  teamFees: "$1,200",
  deposit: "$300",
  depositDueDate: "March 1, 2026",
  coachName: "Coach Mike",
  coachEmail: "mike@example.com",
  coachPhone: "(555) 123-4567",
};

describe("buildOfferLetter", () => {
  it("returning offer folds in dues, deposit, 48h, and coach contact", () => {
    const { subject, body } = buildOfferLetter("returning", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("invite you back to the Trash Pandas Baseball Club");
    expect(body).toContain("$1,200");
    expect(body).toContain("deposit of $300 is required by March 1, 2026");
    expect(body).toContain("three uniform tops");
    expect(body).toContain("within 48 hours");
    expect(body).toContain("call me at (555) 123-4567");
    expect(body).toContain("Coach Mike");
    expect(body).toContain("mike@example.com");
  });

  it("new player offer congratulates and quotes fees + 48h", () => {
    const { subject, body } = buildOfferLetter("newPlayer", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("pleased to offer you a roster spot");
    expect(body).toContain("$1,200");
    expect(body).toContain("$300 is required by March 1, 2026");
    expect(body).toContain("48 hours");
    expect(body).toContain("Welcome to the Trash Pandas.");
  });

  it("rejection is gracious and omits money / acceptance terms", () => {
    const { subject, body } = buildOfferLetter("rejection", ctx);
    expect(subject).toBe("Trash Pandas Baseball Tryouts Update");
    expect(body).toContain("unable to offer you a position");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("48 hours");
    expect(body).toContain("Coach Mike");
  });

  it("interest invite thanks the lead and omits money", () => {
    const { subject, body } = buildOfferLetter("interest", ctx);
    expect(subject).toContain("Tryout Info for Sam Rivera");
    expect(body).toContain("Thank you for your interest");
    expect(body).toContain("at our tryouts");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("deposit");
    expect(body).toContain("Coach Mike");
  });

  it("drops the phone clause when no coach phone is set", () => {
    const { body } = buildOfferLetter("newPlayer", { ...ctx, coachPhone: "" });
    expect(body).not.toContain("call me at");
    expect(body).toContain("reply to this message confirming your acceptance.");
  });
});
