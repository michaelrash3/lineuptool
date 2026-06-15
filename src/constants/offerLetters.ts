// Recruiting / offer-letter drafts. These produce COPYABLE drafts the coach
// hands to a family (the app does not send them — Gmail send is unreliable in
// this environment, and coaches prefer to paste into their own text/email).
//
// Every letter folds in next season's team fees + deposit and asks for an
// acceptance + deposit within 48 hours. Wording is the coach's own copy;
// bracketed fields below are filled from the team/finances/coach context.

export type OfferLetterKind = "returning" | "newPlayer" | "rejection";

export interface OfferLetterContext {
  playerName: string;
  teamName: string;
  // Pre-formatted currency strings (e.g. "$1,200"). Empty string when unset —
  // the caller is responsible for warning the coach before drafting.
  teamFees: string;
  deposit: string;
  coachName: string;
  coachEmail: string;
  coachPhone: string;
}

export interface OfferLetterDraft {
  subject: string;
  body: string;
}

// The signature block: coach name then their contact lines (email / phone),
// matching the "[Coach Name] / [Coach Contact Information]" close in the drafts.
const signature = (ctx: OfferLetterContext): string => {
  const contact = [ctx.coachEmail, ctx.coachPhone].filter(Boolean).join("\n");
  return ["Sincerely,", "", ctx.coachName, contact].filter((l) => l !== undefined).join("\n");
};

const phoneClause = (ctx: OfferLetterContext): string =>
  ctx.coachPhone
    ? ` or call me at ${ctx.coachPhone}`
    : "";

export const OFFER_LETTER_LABELS: Record<OfferLetterKind, string> = {
  returning: "Returning Player Offer",
  newPlayer: "New Player Offer",
  rejection: "Thank You / Not Selected",
};

export const buildOfferLetter = (
  kind: OfferLetterKind,
  ctx: OfferLetterContext
): OfferLetterDraft => {
  const team = ctx.teamName || "our team";
  if (kind === "returning") {
    return {
      subject: `${team} — Returning Player Offer for ${ctx.playerName}`,
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `We are excited to invite you back to the ${team} for the upcoming season. Your hard work and dedication have been a great asset to our team, and we look forward to continuing our success together.`,
        "",
        `The total team fees for the upcoming season are ${ctx.teamFees}. We will provide fundraising opportunities throughout the year to help reduce these fees. To secure your roster spot, a deposit of ${ctx.deposit} is required.`,
        "",
        `Please let us know your decision within 48 hours of receiving this offer. To accept, please reply directly to this message confirming your acceptance${phoneClause(
          ctx
        )}.`,
        "",
        `If you have any questions, please contact me directly.`,
        "",
        signature(ctx),
      ].join("\n"),
    };
  }
  if (kind === "newPlayer") {
    return {
      subject: `${team} — Roster Offer for ${ctx.playerName}`,
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `Congratulations! We are thrilled to offer you a roster spot with the ${team} for the upcoming season. We were very impressed with your performance at tryouts and believe you will be a fantastic addition to our team.`,
        "",
        `The total team fees for the season are ${ctx.teamFees}, and a deposit of ${ctx.deposit} is required. We will also offer fundraising opportunities to help reduce these fees.`,
        "",
        `You have 48 hours to accept this offer. To officially accept and secure your spot on the roster, please reply to this message with your acceptance${phoneClause(
          ctx
        )}.`,
        "",
        `Welcome to the ${team}! If you or your parents have any questions, please reach out to me.`,
        "",
        signature(ctx),
      ].join("\n"),
    };
  }
  // rejection
  return {
    subject: `${team} — Thank You for Trying Out`,
    body: [
      `Dear ${ctx.playerName},`,
      "",
      `Thank you for attending the tryouts for the ${team}. We appreciate the time and effort you put into showcasing your skills on the field.`,
      "",
      `This year, we had a highly competitive group of players, and we have limited roster spots available. Unfortunately, we are unable to offer you a position on the team for the upcoming season.`,
      "",
      `We encourage you to keep practicing and playing hard. We wish you the best of luck in your upcoming baseball season.`,
      "",
      signature(ctx),
    ].join("\n"),
  };
};
