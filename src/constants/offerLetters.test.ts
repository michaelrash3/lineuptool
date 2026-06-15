import { describe, it, expect } from "vitest";
import { buildOfferLetter, type OfferLetterContext } from "./offerLetters";

const ctx: OfferLetterContext = {
  playerName: "Sam Rivera",
  teamName: "Trash Pandas",
  teamFees: "$1,200",
  deposit: "$300",
  coachName: "Coach Mike",
  coachEmail: "mike@example.com",
  coachPhone: "(555) 123-4567",
};

describe("buildOfferLetter", () => {
  it("returning offer folds in dues, deposit, 48h, and coach contact", () => {
    const { subject, body } = buildOfferLetter("returning", ctx);
    expect(subject).toContain("Returning Player Offer");
    expect(subject).toContain("Sam Rivera");
    expect(body).toContain("invite you back to the Trash Pandas");
    expect(body).toContain("$1,200");
    expect(body).toContain("deposit of $300");
    expect(body).toContain("within 48 hours");
    expect(body).toContain("call me at (555) 123-4567");
    expect(body).toContain("Coach Mike");
    expect(body).toContain("mike@example.com");
  });

  it("new player offer congratulates and quotes fees + 48h", () => {
    const { body } = buildOfferLetter("newPlayer", ctx);
    expect(body).toContain("Congratulations!");
    expect(body).toContain("$1,200");
    expect(body).toContain("$300");
    expect(body).toContain("48 hours");
    expect(body).toContain("Welcome to the Trash Pandas!");
  });

  it("rejection is gracious and omits money / acceptance terms", () => {
    const { body } = buildOfferLetter("rejection", ctx);
    expect(body).toContain("unable to offer you a position");
    expect(body).not.toContain("$1,200");
    expect(body).not.toContain("48 hours");
    expect(body).toContain("Coach Mike");
  });

  it("drops the phone clause when no coach phone is set", () => {
    const { body } = buildOfferLetter("newPlayer", { ...ctx, coachPhone: "" });
    expect(body).not.toContain("call me at");
    expect(body).toContain("reply to this message with your acceptance.");
  });
});
