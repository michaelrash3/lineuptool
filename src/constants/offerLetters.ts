// Recruiting / offer-letter drafts. These produce COPYABLE drafts the coach
// hands to a family (the app does not send them — Gmail send is unreliable in
// this environment, and coaches prefer to paste into their own text/email).
//
// Every letter folds in next season's team fees + deposit and asks for an
// acceptance + deposit within 48 hours. Wording is the coach's own copy;
// bracketed fields below are filled from the team/finances/coach context.

export type OfferLetterKind =
  | "returning"
  | "newPlayer"
  | "rejection"
  | "notReturning"
  | "interest";

export interface OfferLetterContext {
  playerName: string;
  teamName: string;
  // Pre-formatted currency strings (e.g. "$1,200"). Empty string when unset —
  // the caller is responsible for warning the coach before drafting.
  teamFees: string;
  deposit: string;
  depositDueDate: string;
  coachName: string;
  coachEmail: string;
  coachPhone: string;
  venmoAccountName: string;
  venmoLink: string;
}

export interface OfferLetterDraft {
  subject: string;
  body: string;
}

// The close. We stop at "Sincerely," on purpose — the coach pastes these
// drafts into their own email, whose signature already supplies the name and
// contact lines, so adding them here would just duplicate that block.
const signature = "Sincerely,";

const phoneClause = (ctx: OfferLetterContext): string =>
  ctx.coachPhone ? ` or call/text me at ${ctx.coachPhone}` : "";

const venmoAccount = (ctx: OfferLetterContext): string =>
  ctx.venmoAccountName || "[Venmo Account Name]";
const venmoLink = (ctx: OfferLetterContext): string =>
  ctx.venmoLink || "[Venmo Link]";

const clubName = (ctx: OfferLetterContext): string =>
  `${ctx.teamName || "our team"} Baseball Club`;

const rosterOfferSubject = (ctx: OfferLetterContext): string =>
  `${ctx.teamName || "Our Team"} Baseball Roster Offer`;

const coveredItems =
  "These fees cover three uniform tops, two pairs of pants, two hats, a bat bag, access to an indoor facility for practices starting in January, and 3 to 5 tournaments between the Fall and Spring seasons. We will provide fundraising opportunities throughout the year to help reduce these costs.";

const formatOfferDate = (date: string): string => {
  const trimmed = date.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return trimmed;

  const [, year, month, day] = isoMatch;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== m - 1 ||
    utc.getUTCDate() !== d
  ) {
    return trimmed;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc);
};

export const OFFER_LETTER_LABELS: Record<OfferLetterKind, string> = {
  returning: "Returning Player Offer",
  newPlayer: "New Player Offer",
  rejection: "Tryout Rejection Letter",
  notReturning: "Not Returning Player Letter",
  interest: "Interest / Tryout Invite",
};

export const buildOfferLetter = (
  kind: OfferLetterKind,
  ctx: OfferLetterContext,
): OfferLetterDraft => {
  const team = ctx.teamName || "our team";
  const club = clubName(ctx);
  const dueDate = ctx.depositDueDate
    ? formatOfferDate(ctx.depositDueDate)
    : "[Deposit Due Date]";

  if (kind === "returning") {
    return {
      subject: rosterOfferSubject(ctx),
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `We are pleased to invite you back to the ${club} for the upcoming season. Your hard work and dedication continue to be a great asset to our team.`,
        "",
        `The team fees for the upcoming season are ${ctx.teamFees}. ${coveredItems}`,
        "",
        `Please let us know your decision within 48 hours of receiving this offer. To accept, please reply directly to this message confirming your acceptance${phoneClause(
          ctx,
        )}.`,
        "",
        `To secure your roster spot, a deposit of ${ctx.deposit || "[Deposit Amount]"} is required by ${dueDate}. You can complete this payment via Venmo by sending the deposit to ${venmoAccount(ctx)} or by clicking directly on this link: ${venmoLink(ctx)}.`,
        "",
        `If you have any questions, please contact me directly.`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "newPlayer") {
    return {
      subject: rosterOfferSubject(ctx),
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `We are pleased to offer you a roster spot with the ${club} for the upcoming season. We were impressed with your performance at tryouts and believe you will be a great addition to our team.`,
        "",
        `The team fees for the season are ${ctx.teamFees}. ${coveredItems}`,
        "",
        `You have 48 hours to accept this offer. To accept, please reply to this message confirming your acceptance${phoneClause(
          ctx,
        )}.`,
        "",
        `To officially secure your spot, a deposit of ${ctx.deposit || "[Deposit Amount]"} is required by ${dueDate}. You can submit this payment via Venmo to ${venmoAccount(ctx)} or by clicking here: ${venmoLink(ctx)}.`,
        "",
        `Welcome to the ${team}. If you or your parents have any questions, please reach out to me.`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "interest") {
    return {
      subject: `${team} — Tryout Info for ${ctx.playerName}`,
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `Thank you for your interest in the ${team}! We're glad ${ctx.playerName} is considering playing with us for the upcoming season.`,
        "",
        `We'd love to see ${ctx.playerName} at our tryouts. Reply to this message and we'll get you the date, time, and location — and feel free to reach out${phoneClause(
          ctx,
        )} with any questions in the meantime.`,
        "",
        `Looking forward to meeting you on the field!`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "notReturning") {
    return {
      subject: `${team} Baseball Roster Update`,
      body: [
        `Dear ${ctx.playerName},`,
        "",
        `Thank you for your time and dedication to the ${club} over the past season. We appreciate the hard work you put into the team.`,
        "",
        "As we prepare for the upcoming season, we have had to make difficult roster decisions. At this time, we will not be offering you a spot on the roster for the next season.",
        "",
        "We wish you the best of luck in your future baseball endeavors and hope you have a great season wherever you play next.",
        "",
        signature,
      ].join("\n"),
    };
  }

  return {
    subject: `${team} Baseball Tryouts Update`,
    body: [
      `Dear ${ctx.playerName},`,
      "",
      `Thank you for attending the tryouts for the ${club}. We appreciate the time and effort you put into showcasing your skills on the field.`,
      "",
      `We had a highly competitive group of players this year, and we have a very limited number of roster spots available. We are unable to offer you a position on the team for the upcoming season.`,
      "",
      `We encourage you to keep practicing and playing hard. We wish you the best of luck in your upcoming baseball season.`,
      "",
      signature,
    ].join("\n"),
  };
};
