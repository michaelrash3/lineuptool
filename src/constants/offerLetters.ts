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
  // What the fees cover, from the Budget Planner: the planned line-item labels
  // in planner order (tournament items excluded when their count is planned),
  // plus the total planned Fall+Spring tournament count. Empty list + 0 count
  // = planner not filled in yet; the letter falls back to stock wording.
  coveredItems: string[];
  tournamentCount: number;
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

// "a, b, and c" — Oxford-comma list for the covered-items sentence.
const joinList = (items: string[]): string => {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
};

// Planner labels are sentence-case ("Game jerseys"); mid-sentence they read
// better lowercased. Labels leading with an acronym (USSSA) are left alone.
const midSentence = (label: string): string =>
  /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;

// Pre-planner stock wording, kept as the fallback so a letter drafted before
// the Budget Planner is filled in still reads like a complete offer.
const FALLBACK_COVERED =
  "three uniform tops, two pairs of pants, two hats, a bat bag, access to an indoor facility for practices starting in January, and 3 to 5 tournaments between the Fall and Spring seasons";

// What the fees cover: the Budget Planner's line items as a comma-separated
// list, with the planned tournament total quoted as a ±1 range ("5 to 7
// tournaments") — the letter promises a schedule, not an exact count.
const coveredItems = (ctx: OfferLetterContext): string => {
  const items = (ctx.coveredItems || [])
    .map((label) => midSentence(label.trim()))
    .filter(Boolean);
  const count = Math.round(ctx.tournamentCount || 0);
  if (count > 0) {
    items.push(
      `${Math.max(1, count - 1)} to ${count + 1} tournaments between the Fall and Spring seasons`,
    );
  }
  const covered = items.length > 0 ? joinList(items) : FALLBACK_COVERED;
  return `These fees cover ${covered}. We will provide fundraising opportunities throughout the year to help reduce these costs.`;
};

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

// The pieces a letter is built from. The built-in letters are written once
// against these; filling them with a family's values gives the draft, filling
// them with the bracketed field names gives the editable template a coach
// starts from (defaultLetterTemplate), so the two can never drift apart.
interface LetterParts {
  player: string;
  team: string; // mid-sentence ("the our team" fallback is lowercase)
  teamTitle: string; // subject-line form
  club: string;
  fees: string;
  deposit: string;
  dueDate: string;
  covered: string;
  phoneClause: string; // " or call/text me at …", or "" without a phone
  venmoAccount: string;
  venmoLink: string;
}

const partsFromContext = (ctx: OfferLetterContext): LetterParts => ({
  player: ctx.playerName,
  team: ctx.teamName || "our team",
  teamTitle: ctx.teamName || "Our Team",
  club: clubName(ctx),
  fees: ctx.teamFees,
  deposit: ctx.deposit || "[Deposit Amount]",
  dueDate: ctx.depositDueDate
    ? formatOfferDate(ctx.depositDueDate)
    : "[Deposit Due Date]",
  covered: coveredItems(ctx),
  phoneClause: phoneClause(ctx),
  venmoAccount: venmoAccount(ctx),
  venmoLink: venmoLink(ctx),
});

const composeLetter = (
  kind: OfferLetterKind,
  p: LetterParts,
): OfferLetterDraft => {
  if (kind === "returning") {
    return {
      subject: `${p.teamTitle} Baseball Roster Offer`,
      body: [
        `Dear ${p.player},`,
        "",
        `We are pleased to invite you back to the ${p.club} for the upcoming season. Your hard work and dedication continue to be a great asset to our team.`,
        "",
        `The team fees for the upcoming season are ${p.fees}. ${p.covered}`,
        "",
        `Please let us know your decision within 48 hours of receiving this offer. To accept, please reply directly to this message confirming your acceptance${p.phoneClause}.`,
        "",
        `To secure your roster spot, a deposit of ${p.deposit} is required by ${p.dueDate}. You can complete this payment via Venmo by sending the deposit to ${p.venmoAccount} or by clicking directly on this link: ${p.venmoLink}.`,
        "",
        `If you have any questions, please contact me directly.`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "newPlayer") {
    return {
      subject: `${p.teamTitle} Baseball Roster Offer`,
      body: [
        `Dear ${p.player},`,
        "",
        `We are pleased to offer you a roster spot with the ${p.club} for the upcoming season. We were impressed with your performance at tryouts and believe you will be a great addition to our team.`,
        "",
        `The team fees for the season are ${p.fees}. ${p.covered}`,
        "",
        `You have 48 hours to accept this offer. To accept, please reply to this message confirming your acceptance${p.phoneClause}.`,
        "",
        `To officially secure your spot, a deposit of ${p.deposit} is required by ${p.dueDate}. You can submit this payment via Venmo to ${p.venmoAccount} or by clicking here: ${p.venmoLink}.`,
        "",
        `Welcome to the ${p.team}. If you or your parents have any questions, please reach out to me.`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "interest") {
    return {
      subject: `${p.team} — Tryout Info for ${p.player}`,
      body: [
        `Dear ${p.player},`,
        "",
        `Thank you for your interest in the ${p.team}! We're glad ${p.player} is considering playing with us for the upcoming season.`,
        "",
        `We'd love to see ${p.player} at our tryouts. Reply to this message and we'll get you the date, time, and location — and feel free to reach out${p.phoneClause} with any questions in the meantime.`,
        "",
        `Looking forward to meeting you on the field!`,
        "",
        signature,
      ].join("\n"),
    };
  }

  if (kind === "notReturning") {
    return {
      subject: `${p.team} Baseball Roster Update`,
      body: [
        `Dear ${p.player},`,
        "",
        `Thank you for your time and dedication to the ${p.club} over the past season. We appreciate the hard work you put into the team.`,
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
    subject: `${p.team} Baseball Tryouts Update`,
    body: [
      `Dear ${p.player},`,
      "",
      `Thank you for attending the tryouts for the ${p.club}. We appreciate the time and effort you put into showcasing your skills on the field.`,
      "",
      `We had a highly competitive group of players this year, and we have a very limited number of roster spots available. We are unable to offer you a position on the team for the upcoming season.`,
      "",
      `We encourage you to keep practicing and playing hard. We wish you the best of luck in your upcoming baseball season.`,
      "",
      signature,
    ].join("\n"),
  };
};

// ---- Coach-edited letters -------------------------------------------------
// A head coach can reword any letter (Settings › Letters). The saved wording
// lives on the team as team.letterTemplates[kind] = { subject, body } and
// uses bracketed fill-in fields — the blanks on a paper form — that are
// filled for each family when a letter is drafted. A kind with no saved
// wording uses the built-in letter above, unchanged.

export interface LetterTemplate {
  subject: string;
  body: string;
}

export type LetterTemplates = Partial<Record<OfferLetterKind, LetterTemplate>>;

// Longest a saved subject / message may be (the editor clamps to these).
export const LETTER_LIMITS = { subject: 200, body: 6000 } as const;

// Every fill-in field, in the order the editor offers them.
export const LETTER_FIELDS: ReadonlyArray<{ token: string; hint: string }> = [
  { token: "[Player Name]", hint: "The player or family you're writing to" },
  { token: "[Team Name]", hint: "Your team's name" },
  { token: "[Club Name]", hint: "“<Team> Baseball Club”" },
  { token: "[Team Fees]", hint: "Next season's team fee (Budget Planner)" },
  { token: "[Deposit Amount]", hint: "The deposit that holds a spot" },
  { token: "[Deposit Due Date]", hint: "When the deposit is due" },
  {
    token: "[What the Fees Cover]",
    hint: "The “These fees cover …” sentence, from the Budget Planner",
  },
  { token: "[Coach Name]", hint: "Your name" },
  { token: "[Coach Email]", hint: "Your email" },
  { token: "[Coach Phone]", hint: "The phone number in Settings" },
  { token: "[Venmo Account Name]", hint: "Your Venmo account name" },
  { token: "[Venmo Link]", hint: "Your Venmo link" },
];

// The built-in letter with its blanks showing — what the editor starts from.
export const defaultLetterTemplate = (kind: OfferLetterKind): LetterTemplate =>
  composeLetter(kind, {
    player: "[Player Name]",
    team: "[Team Name]",
    teamTitle: "[Team Name]",
    club: "[Club Name]",
    fees: "[Team Fees]",
    deposit: "[Deposit Amount]",
    dueDate: "[Deposit Due Date]",
    covered: "[What the Fees Cover]",
    phoneClause: " or call/text me at [Coach Phone]",
    venmoAccount: "[Venmo Account Name]",
    venmoLink: "[Venmo Link]",
  });

// Field name → this family's value. A field with no value yet keeps its
// brackets, so the coach sees exactly what still needs filling in.
const fieldValues = (ctx: OfferLetterContext): Record<string, string> => {
  const due = ctx.depositDueDate ? formatOfferDate(ctx.depositDueDate) : "";
  return {
    "player name": ctx.playerName,
    "team name": ctx.teamName,
    "club name": ctx.teamName ? clubName(ctx) : "",
    "team fees": ctx.teamFees,
    "deposit amount": ctx.deposit,
    "deposit due date": due,
    "what the fees cover": coveredItems(ctx),
    "coach name": ctx.coachName,
    "coach email": ctx.coachEmail,
    "coach phone": ctx.coachPhone,
    "venmo account name": ctx.venmoAccountName,
    "venmo link": ctx.venmoLink,
  };
};

const fieldKey = (inner: string) =>
  inner.trim().toLowerCase().replace(/\s+/g, " ");

// Fill a saved letter for one family. Field names match case- and
// spacing-insensitively ("[player name]" works); unknown brackets are left as
// typed.
export const fillLetterTemplate = (
  template: LetterTemplate,
  ctx: OfferLetterContext,
): OfferLetterDraft => {
  const values = fieldValues(ctx);
  const fill = (text: string) =>
    String(text || "").replace(/\[([^\[\]\n]{1,40})\]/g, (whole, inner) => {
      const v = values[fieldKey(inner)];
      return v ? v : whole;
    });
  return { subject: fill(template.subject), body: fill(template.body) };
};

// Bracketed words in a saved letter that aren't fill-in fields — the editor
// flags them (most likely a typo like "[Player]") so they aren't sent as-is.
export const unknownLetterFields = (text: string): string[] => {
  const known = new Set(
    LETTER_FIELDS.map((f) => fieldKey(f.token.slice(1, -1))),
  );
  const out = new Set<string>();
  for (const m of String(text || "").matchAll(/\[([^\[\]\n]{1,40})\]/g)) {
    if (!known.has(fieldKey(m[1]))) out.add(m[0]);
  }
  return [...out];
};

// True when a saved letter is just the built-in one (so saving it unchanged
// stores nothing and "Customized" never shows for an untouched letter).
export const isDefaultLetterTemplate = (
  kind: OfferLetterKind,
  template: LetterTemplate | null | undefined,
): boolean => {
  if (!template) return true;
  const d = defaultLetterTemplate(kind);
  return (
    template.subject.trim() === d.subject.trim() &&
    template.body.trim() === d.body.trim()
  );
};

export const buildOfferLetter = (
  kind: OfferLetterKind,
  ctx: OfferLetterContext,
  // The head coach's saved wording for this kind, when there is one.
  custom?: LetterTemplate | null,
): OfferLetterDraft =>
  custom && !isDefaultLetterTemplate(kind, custom)
    ? fillLetterTemplate(custom, ctx)
    : composeLetter(kind, partsFromContext(ctx));
