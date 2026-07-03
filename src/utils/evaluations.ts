// Evaluation cadence, round bookkeeping, preseason seeding, and the eval
// reminder-email gate, extracted from helpers.ts. Pure functions.

import type { PlayerStats } from "../types";
import { genId } from "./id";
import {
  dateToIsoLocal,
  isoToLocalDate,
  sameLocalDay,
  MS_PER_DAY,
} from "./dates";
import {
  combinedTryoutGradeForSignup,
  normalizeTryoutSessions,
} from "./tryouts";

// A compact objective-stat hint for an eval category, so a coach grades with
// real numbers in view (e.g. "AVG .312" under Contact). Returns null when the
// stat isn't present. `pitching` supplies the manual/imported top velocity for
// the velocity category. Pure — safe to call per category per render.
export const evalStatHint = (
  catId: string,
  stats: PlayerStats | null | undefined,
  pitching?: { topMph?: number } | null,
): string | null => {
  const s: any = stats || {};
  const pct = (v: any) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${Math.round(v * 100)}%`
      : null;
  const avg3 = (v: any) =>
    typeof v === "number" && Number.isFinite(v)
      ? v.toFixed(3).replace(/^0(?=\.)/, "")
      : null;
  switch (catId) {
    case "contact":
      return s.avg != null ? `AVG ${avg3(s.avg)}` : null;
    case "power":
      return s.hard != null
        ? `Hard ${pct(s.hard)}`
        : s.hr != null
          ? `${s.hr} HR`
          : null;
    case "approach":
    case "plateDiscipline":
      return s.qab != null ? `QAB ${pct(s.qab)}` : null;
    case "fielding":
    case "glove":
    case "range":
      return s.fFpct != null ? `FPCT ${avg3(s.fFpct)}` : null;
    case "arm":
    case "armStrength":
    case "armAccuracy":
      return s.fAssists != null ? `${s.fAssists} A` : null;
    case "speedBaserunning":
    case "speed":
    case "baserunning":
      return s.sb != null ? `${s.sb} SB` : null;
    case "strikes":
      return s.pStrikePct != null
        ? `S% ${pct(s.pStrikePct)}`
        : s.pBbPerInn != null
          ? `${s.pBbPerInn} BB/inn`
          : null;
    case "velocity":
      return pitching?.topMph
        ? `Top ${pitching.topMph} mph`
        : s.pTopMph != null
          ? `Top ${s.pTopMph} mph`
          : null;
    case "throwing":
      return s.fCsPct != null ? `CS% ${pct(s.fCsPct)}` : null;
    case "blocking":
      return s.fPb != null ? `${s.fPb} PB` : null;
    default:
      return null;
  }
};

// ============================================================================
// Eval prompt cadence — preseason + monthly for both head and assistant.
// Coaches submit a fresh evaluation round once when the season starts (Feb 1),
// then on the first of every month. The submission UI is gated to active
// prompts; outside an active window the assistant's Submit Eval button is
// disabled and the head's "Start New Round" affordance is hidden.
// ============================================================================

// Active window around each due date — three days before through three
// days after. Long enough that coaches catching up over a weekend still
// see the prompt; tight enough that the badge doesn't get stale.
const EVAL_WINDOW_DAYS = 3;

// Build the full ordered list of eval due-dates for a given calendar year:
// the first of every month (monthly cadence). Feb 1 doubles as the spring
// preseason kickoff. Pure; no dependency on current time. Exported for tests.
export const evalDueDatesForYear = (year: number): Date[] => {
  const dates: Date[] = [];
  for (let month = 0; month < 12; month++) {
    dates.push(new Date(year, month, 1));
  }
  return dates;
};

type EvalPromptKind = "preseason" | "monthly";

export interface EvalPromptStatus {
  active: boolean;
  kind: EvalPromptKind | null;
  lastSubmittedDate: string | null;
  // ISO date string of next due window when not currently active.
  nextDueDate: string | null;
  // Days until next eval is due (null when active). Negative when overdue.
  daysUntilDue: number | null;
}

// Pure: decides whether the given coach owes an eval right now.
// Schedule is fixed by calendar date (see evalDueDatesForYear): Spring
// preseason (2/1) + 3/15 + biweekly Sundays through 6/30; Fall weekly
// Sundays 9/1–10/31. Active when the coach hasn't submitted an eval
// within EVAL_WINDOW_DAYS of the nearest due date. Replaces the prior
// "14 days since last save" logic per coach request — the cadence now
// lives on the calendar, not on the last save timestamp.
export const evalPromptStatus = (
  team: { currentSeason?: string; evaluationEvents?: any[] } | null | undefined,
  userUid: string | null | undefined,
  coachRole: "Head" | "Assistant",
  now: Date = new Date(),
): EvalPromptStatus => {
  if (!team || !userUid) {
    return {
      active: false,
      kind: null,
      lastSubmittedDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  // Every eval this coach has ever filed, newest first. The cadence is
  // purely calendar-driven now, so we don't restrict to "this season" —
  // each due date is checked against the latest submission on its own,
  // and old submissions (way before any current due date) naturally
  // fall outside the alreadyHit window.
  const mine = (team.evaluationEvents || [])
    .filter((e) => e.coachRole === coachRole && e.evaluatorId === userUid)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastSubmittedDate = mine[0]?.date || null;

  // Build candidate due dates spanning this calendar year + the next
  // (handles end-of-year edge case where "next due" is in January).
  const candidates = [
    ...evalDueDatesForYear(now.getFullYear()),
    ...evalDueDatesForYear(now.getFullYear() + 1),
  ];

  // Find the due date closest to (and not too far past) "now".
  let activeDue: Date | null = null;
  let upcomingDue: Date | null = null;
  for (const due of candidates) {
    const deltaDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
    // Window is [due - WINDOW, due + WINDOW]. The prompt is fulfilled once the
    // coach files an eval anywhere inside that window — including the days
    // *before* the due date — so the reminder clears as soon as they catch up
    // instead of lingering until the due date physically passes. A later
    // submission (next round already in) counts too, hence the open-ended `>=`.
    const alreadyHit =
      lastSubmittedDate &&
      Math.round(
        (isoToLocalDate(lastSubmittedDate).getTime() - due.getTime()) /
          MS_PER_DAY,
      ) >= -EVAL_WINDOW_DAYS;
    if (
      !alreadyHit &&
      deltaDays >= -EVAL_WINDOW_DAYS &&
      deltaDays <= EVAL_WINDOW_DAYS
    ) {
      activeDue = due;
      break;
    }
    if (!upcomingDue && due.getTime() > now.getTime()) {
      upcomingDue = due;
    }
  }

  if (activeDue) {
    // Preseason vs monthly: Feb 1 is the preseason kickoff; every other
    // first-of-month carries the "monthly" label.
    const isPreseason = activeDue.getMonth() === 1 && activeDue.getDate() === 1;
    return {
      active: true,
      kind: isPreseason ? "preseason" : "monthly",
      lastSubmittedDate,
      nextDueDate: dateToIsoLocal(activeDue),
      daysUntilDue: 0,
    };
  }
  if (!upcomingDue) {
    return {
      active: false,
      kind: null,
      lastSubmittedDate,
      nextDueDate: null,
      daysUntilDue: null,
    };
  }
  // sameLocalDay reads as "no rounding error needed" — Math.ceil handles
  // sub-day timestamps the right way.
  const daysUntilDue = sameLocalDay(now, upcomingDue)
    ? 0
    : Math.ceil((upcomingDue.getTime() - now.getTime()) / MS_PER_DAY);
  return {
    active: false,
    kind: null,
    lastSubmittedDate,
    nextDueDate: dateToIsoLocal(upcomingDue),
    daysUntilDue,
  };
};

// Snap a freshly-filed eval to the calendar round it satisfies. The cadence is
// fixed by date (see evalDueDatesForYear), so a saved round should carry the
// due date it lands nearest to — not the literal day it was keyed in. We scan
// last year's, this year's, and next year's due dates and pick the one closest
// in absolute calendar distance (ties favor the earlier date). The schedule is
// never empty, so the `now` fallback is purely defensive. Pure / injectable.
export const evalRoundDateForSave = (now: Date = new Date()): string => {
  const candidates = [
    ...evalDueDatesForYear(now.getFullYear() - 1),
    ...evalDueDatesForYear(now.getFullYear()),
    ...evalDueDatesForYear(now.getFullYear() + 1),
  ];
  let best: Date | null = null;
  let bestDist = Infinity;
  for (const due of candidates) {
    const dist = Math.abs(due.getTime() - now.getTime());
    if (dist < bestDist) {
      bestDist = dist;
      best = due;
    }
  }
  return best ? dateToIsoLocal(best) : dateToIsoLocal(now);
};

// One-time migration: re-stamp every existing roster eval round onto the
// calendar due date it falls nearest to, matching how new saves are now dated
// (see evalRoundDateForSave). Tryout grades (those carrying `tryoutSignupId`)
// are NOT cadence rounds and pass through untouched. When two of the same
// coach's rounds collapse onto one due date, the round with the most recent
// original date wins (its grades are freshest) and the older is dropped, which
// keeps the per-(role, coach, date) upsert key unique. Idempotent: a round
// already on its due date snaps to itself. Pure.
export const restampEvalDueDates = <
  T extends {
    date?: string;
    coachRole?: string;
    evaluatorId?: string;
    tryoutSignupId?: string;
  },
>(
  events: T[] | null | undefined,
): T[] => {
  if (!Array.isArray(events)) return [];
  // Resolve collisions by original recency: decide winners newest-first,
  // breaking ties by original position for determinism.
  const ranked = events
    .map((e, i) => ({
      e,
      i,
      t: e?.date ? isoToLocalDate(e.date).getTime() : 0,
    }))
    .sort((a, b) => b.t - a.t || a.i - b.i);
  const newDateByIndex = new Map<number, string>();
  const dropped = new Set<number>();
  const seen = new Set<string>();
  for (const { e, i } of ranked) {
    // Leave tryout grades and dateless/blank events exactly as they are.
    if (!e?.date || e.tryoutSignupId) continue;
    const snapped = evalRoundDateForSave(isoToLocalDate(e.date));
    const key = `${e.coachRole ?? ""}|${e.evaluatorId ?? ""}|${snapped}`;
    if (seen.has(key)) {
      dropped.add(i); // older duplicate for this round — drop it
      continue;
    }
    seen.add(key);
    newDateByIndex.set(i, snapped);
  }
  return events
    .map((e, i) => {
      if (dropped.has(i)) return null;
      const nd = newDateByIndex.get(i);
      return nd && nd !== e.date ? { ...e, date: nd } : e;
    })
    .filter((e): e is T => e !== null);
};

// Descending recency comparator for eval rounds: newest date first, with the
// wall-clock createdAt stamp breaking date ties (rounds snapped to the same
// cadence due date, or two literal same-day saves). Before this, tied dates
// fell to stable-sort insertion order, so every "latest round" lookup silently
// resolved to the OLDEST of the tied rounds — the newer evaluation existed but
// never surfaced. Rounds without createdAt (pre-stamp data) sort as 0.
export const evalRoundRecency = (
  a: { date?: string; createdAt?: number } | null | undefined,
  b: { date?: string; createdAt?: number } | null | undefined,
): number => {
  const d = new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime();
  if (d !== 0) return d;
  return (b?.createdAt || 0) - (a?.createdAt || 0);
};

// Advance-Season eval seeding. The new season starts with a single "Preseason"
// eval round so coaches don't begin blind: each returning player carries their
// MOST RECENT eval from the ending season, and each promoted tryout carries
// their tryout evaluation. Grades are keyed by the (new) player id so the round
// drops straight into evaluationEvents.
//
//   endingEvents     — teamData.evaluationEvents from the season being archived
//   returningPlayers — players kept on the new roster (ids unchanged)
//   promotedPlayers  — new players built from tryouts (carry `tryoutSignupId`)
//
// Returns null when nothing could be seeded (no source grades) so the caller
// can fall back to an empty round list.
export const buildPreseasonSeedRound = (
  endingEvents: any[],
  returningPlayers: any[],
  promotedPlayers: any[],
  meta: { date: string; evaluatorId?: string; tryoutSessions?: any[] },
): any | null => {
  const grades: Record<string, any> = {};

  // Returning players → their latest non-tryout round that actually graded them.
  const roundsNewestFirst = (endingEvents || [])
    .filter((e: any) => !e?.tryoutSignupId && e?.grades)
    .slice()
    .sort(evalRoundRecency);
  for (const p of returningPlayers || []) {
    if (!p?.id) continue;
    for (const r of roundsNewestFirst) {
      const g = r.grades?.[p.id];
      if (g && typeof g === "object" && Object.keys(g).length > 0) {
        grades[p.id] = { ...g };
        break;
      }
    }
  }

  const tryoutSessions =
    meta.tryoutSessions ||
    normalizeTryoutSessions({ evaluationEvents: endingEvents });
  for (const p of promotedPlayers || []) {
    const sid = p?.tryoutSignupId;
    if (!sid || !p?.id) continue;
    const g = combinedTryoutGradeForSignup(tryoutSessions, sid);
    if (g && typeof g === "object" && Object.keys(g).length > 0) {
      grades[p.id] = { ...g };
    }
  }

  if (Object.keys(grades).length === 0) return null;

  return {
    id: genId("ev-preseason"),
    date: meta.date,
    createdAt: Date.now(),
    coachRole: "Head",
    evaluatorId: meta.evaluatorId || "",
    // Shown verbatim in the round picker ("Preseason · <date>").
    evaluatorName: "Preseason",
    label: "Preseason",
    grades,
    seededFromAdvance: true,
  };
};

// Cool-off between automated reminder batches. The cadence prompt
// (preseason / biweekly) can stay active for days as coaches catch up;
// without this guard the email fires every time the HC opens the app.
const EMAIL_PROMPT_COOLOFF_DAYS = 7;

export interface EmailPromptStatus {
  active: boolean;
  kind: EvalPromptKind | null;
  // The head's own status (so we know to nudge them too if they haven't
  // submitted this round).
  headDue: boolean;
  // Per-assistant due flags: { [evaluatorId]: boolean }. Only entries
  // where the assistant has NOT submitted this round are emitted.
  assistantsDue: Record<string, boolean>;
  // Reason string when inactive — useful for surfacing a "sent X days
  // ago" hint in Settings.
  reason: string | null;
}

// Whether the team should fire automated reminder emails right now.
// Conditions:
//   1. Eval cadence is active for ANY coach (preseason or biweekly).
//   2. team.emailEvalRemindersDisabled !== true.
//   3. team.lastEvalEmailedAt is missing OR > EMAIL_PROMPT_COOLOFF_DAYS old.
// Recipients = head's email + every coachContacts[].email whose
// assistant hasn't submitted in the current round.
export const emailPromptStatus = (
  team:
    | {
        currentSeason?: string;
        evaluationEvents?: any[];
        ownerId?: string;
        coachContacts?: Array<{ id?: string; name?: string; email?: string }>;
        coachRoles?: Record<string, string>;
        members?: string[];
        lastEvalEmailedAt?: string;
        emailEvalRemindersDisabled?: boolean;
      }
    | null
    | undefined,
  now: Date = new Date(),
): EmailPromptStatus => {
  if (!team) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "no team",
    };
  }
  if (team.emailEvalRemindersDisabled === true) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "reminders disabled",
    };
  }
  // Cool-off guard: skip if we sent recently.
  if (team.lastEvalEmailedAt) {
    const lastMs = new Date(team.lastEvalEmailedAt).getTime();
    if (Number.isFinite(lastMs)) {
      const elapsedDays = Math.floor((now.getTime() - lastMs) / MS_PER_DAY);
      if (elapsedDays < EMAIL_PROMPT_COOLOFF_DAYS) {
        return {
          active: false,
          kind: null,
          headDue: false,
          assistantsDue: {},
          reason: `cool-off (${EMAIL_PROMPT_COOLOFF_DAYS - elapsedDays} day(s) remaining)`,
        };
      }
    }
  }

  // Head status.
  const headStatus = team.ownerId
    ? evalPromptStatus(team, team.ownerId, "Head", now)
    : { active: false, kind: null };

  // Assistant statuses — anyone in coachRoles marked "assistant", or
  // members other than the owner if coachRoles is absent.
  const assistantUids = new Set<string>();
  const coachRoles = team.coachRoles || {};
  for (const [uid, role] of Object.entries(coachRoles)) {
    if (role === "assistant") assistantUids.add(uid);
  }
  if (assistantUids.size === 0 && Array.isArray(team.members)) {
    for (const uid of team.members) {
      if (uid !== team.ownerId) assistantUids.add(uid);
    }
  }
  const assistantsDue: Record<string, boolean> = {};
  let anyAssistantDue = false;
  let firstActiveKind: EvalPromptKind | null = null;
  for (const uid of assistantUids) {
    const s = evalPromptStatus(team, uid, "Assistant", now);
    if (s.active) {
      assistantsDue[uid] = true;
      anyAssistantDue = true;
      if (!firstActiveKind) firstActiveKind = s.kind;
    }
  }

  const anyDue = headStatus.active || anyAssistantDue;
  if (!anyDue) {
    return {
      active: false,
      kind: null,
      headDue: false,
      assistantsDue: {},
      reason: "no cadence active",
    };
  }
  return {
    active: true,
    kind: headStatus.kind || firstActiveKind || "monthly",
    headDue: !!headStatus.active,
    assistantsDue,
    reason: null,
  };
};
