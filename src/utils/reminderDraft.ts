// Reminder drafts + email helpers. The app deliberately does NOT send mail
// itself: the Gmail API path was removed because gmail.send is a Google
// restricted scope that an unverified Spark-plan app can't use (it failed
// silently). Instead we assemble the subject/body/recipients and hand them to
// the coach's own mail client via a mailto: compose ("Open in Email") or the
// clipboard ("Copy draft"). See components/ReminderActions.

import type { Team } from "../types";

export interface ReminderDraft {
  subject: string;
  body: string;
}

// mailto: builder. URLSearchParams encodes spaces as "+", which mail clients
// render literally; encodeURIComponent emits %20, which they decode correctly.
export const buildMailtoUrl = (
  to: string,
  subject: string,
  body: string,
): string =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

// Plain-text rendering of a draft for the clipboard, with an optional recipient
// header so a pasted draft still says who it's for.
export const draftToText = (
  draft: ReminderDraft,
  recipients?: string[],
): string => {
  const lines: string[] = [];
  if (recipients && recipients.length)
    lines.push(`To: ${recipients.join(", ")}`);
  lines.push(`Subject: ${draft.subject}`, "", draft.body);
  return lines.join("\n");
};

const isEmail = (v: unknown): boolean =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v ?? "").trim());

// Every parent/guardian email on file (roster Parent 1 + Parent 2, plus
// un-applied Player Info submissions), deduped and validated. Shared by the
// Roster "Email all parents" controls and the Home game-reminder button.
export const collectParentEmails = (
  team: Team | null | undefined,
): string[] => {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (isEmail(v)) out.add(String(v).trim());
  };
  for (const p of team?.players || []) {
    add((p as { email?: unknown }).email);
    add((p as { parent2Email?: unknown }).parent2Email);
  }
  for (const s of team?.playerInfoSubmissions || []) {
    add(s.email);
    add((s as { parent2Email?: unknown }).parent2Email);
  }
  return [...out];
};

// A game reminder a coach sends to families.
export const buildGameReminderDraft = (args: {
  teamName?: string;
  opponent?: string;
  dateLabel?: string;
  timeLabel?: string | null;
  location?: string;
  isHome?: boolean | null;
}): ReminderDraft => {
  const teamName = (args.teamName || "the team").trim();
  const opponent = (args.opponent || "TBD").trim();
  const vs = args.isHome === false ? `at ${opponent}` : `vs ${opponent}`;
  const subject = `[${teamName}] Game ${vs}${
    args.dateLabel ? ` — ${args.dateLabel}` : ""
  }`;
  const body = [
    `Reminder: ${teamName} plays ${vs}.`,
    "",
    args.dateLabel
      ? `When: ${args.dateLabel}${args.timeLabel ? ` at ${args.timeLabel}` : ""}`
      : null,
    args.location ? `Where: ${String(args.location).split("\n")[0]}` : null,
    "",
    "Please arrive early, ready to play. Reply with any conflicts.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return { subject, body };
};

// An evaluation-round reminder the head coach sends to the coaching staff.
export const buildEvalReminderDraft = (args: {
  teamName?: string;
  fromName?: string;
  url: string;
}): ReminderDraft => {
  const teamName = (args.teamName || "the team").trim();
  const fromName = (args.fromName || "Your head coach").trim();
  const subject = `[${teamName}] Eval round due`;
  const body = [
    "Hi coach,",
    "",
    `${fromName} is asking for a fresh evaluation round for ${teamName}.`,
    "",
    "Open the eval form and submit your grades:",
    args.url,
    "",
    "You can mute these in Settings -> Coaches.",
  ].join("\n");
  return { subject, body };
};
