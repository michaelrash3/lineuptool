import { describe, it, expect } from "vitest";
import { buildOfferLetter, type OfferLetterContext } from "./offerLetters";

const ctx: OfferLetterContext = {
  playerName: "Sam Rivera",
  teamName: "Trash Pandas",
  teamFees: "$1,200",
  deposit: "$300",
  depositDueDate: "2026-03-19",
  coachName: "Coach Mike",
  coachEmail: "mike@example.com",
  coachPhone: "(555) 123-4567",
  venmoName: "@Trash-Pandas",
  venmoLink: "https://venmo.com/u/Trash-Pandas",
};

describe("buildOfferLetter", () => {
  it("returning offer folds in dues, deposit, 48h, coach contact, and Venmo", () => {
    const { subject, body } = buildOfferLetter("returning", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("invite you back to the Trash Pandas Baseball Club");
    expect(body).toContain("$1,200");
    expect(body).toContain("deposit of $300 is required by March 19, 2026");
    expect(body).toContain("three uniform tops");
    expect(body).toContain("within 48 hours");
    expect(body).toContain("call/text me at (555) 123-4567");
    expect(body).toContain("sending the deposit to @Trash-Pandas");
    expect(body).toContain("https://venmo.com/u/Trash-Pandas");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
    expect(body).not.toContain("Coach Mike");
    expect(body).not.toContain("mike@example.com");
  });

  it("new player offer congratulates, quotes fees + 48h, and includes Venmo", () => {
    const { subject, body } = buildOfferLetter("newPlayer", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Offer");
    expect(body).toContain("pleased to offer you a roster spot");
    expect(body).toContain("$1,200");
    expect(body).toContain("$300 is required by March 19, 2026");
    expect(body).toContain("48 hours");
    expect(body).toContain("submit this payment via Venmo to @Trash-Pandas");
    expect(body).toContain("https://venmo.com/u/Trash-Pandas");
    expect(body).toContain("Welcome to the Trash Pandas.");
  });

  it("falls back to bracket placeholders when Venmo is unset", () => {
    const { body } = buildOfferLetter("returning", {
      ...ctx,
      venmoName: "",
      venmoLink: "",
    });
    expect(body).toContain("[Venmo Account Name]");
    expect(body).toContain("[Venmo Link]");
  });

  it("tryout rejection is gracious and omits money / acceptance terms", () => {
    const { subject, body } = buildOfferLetter("rejection", ctx);
    expect(subject).toBe("Trash Pandas Baseball Tryouts Update");
    expect(body).toContain("unable to offer you a position");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("48 hours");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
    expect(body).not.toContain("Coach Mike");
  });

  it("not-returning letter thanks the player and omits money / Venmo", () => {
    const { subject, body } = buildOfferLetter("notReturning", ctx);
    expect(subject).toBe("Trash Pandas Baseball Roster Update");
    expect(body).toContain("Thank you for your time and dedication");
    expect(body).toContain("will not be offering you a spot on the roster");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("Venmo");
    expect(body.trimEnd().endsWith("Sincerely,")).toBe(true);
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

  it("shows a phone placeholder when no coach phone is set", () => {
    const { body } = buildOfferLetter("newPlayer", { ...ctx, coachPhone: "" });
    expect(body).toContain("call/text me at [Coach Phone Number]");
  });
});
