// Tryouts, public-mirror, and player-info-intake helpers, extracted from
// helpers.ts. Pure functions over the tryout/session/signup shapes — no
// React, no Firestore.

import { measurementGrades } from "../constants/showcaseBenchmarks";

// Player Info submissions arrive from the public portal append-only (the
// security rules forbid the anonymous client from replacing array entries), so
// a parent who resubmits — e.g. to correct a shirt size — stacks a second entry
// in the coach's inbox. Coaches want the LATEST submission to REPLACE the prior
// one per person, not accumulate. This collapses the array to one entry per
// person (normalized first + last + dob), keeping the most recently submitted.
//
// Deliberately NOT used for availability submissions: those are add-only by
// design (a family can log unavailable dates across several visits). Order is
// stable (first-appearance of each surviving person) so a no-op produces an
// identical array and never triggers a needless write.
export const dedupePlayerInfoSubmissions = <T extends Record<string, any>>(
  subs: T[] | null | undefined,
): T[] => {
  const list = Array.isArray(subs) ? subs : [];
  const identityOf = (s: any): string =>
    [
      String(s?.firstName || "")
        .trim()
        .toLowerCase(),
      String(s?.lastName || "")
        .trim()
        .toLowerCase(),
      String(s?.dob || "").trim(),
    ].join("|");
  const submittedMs = (s: any): number => {
    const t = new Date(s?.submittedAt || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const order: string[] = [];
  const latest = new Map<string, T>();
  for (const s of list) {
    const key = identityOf(s);
    if (!latest.has(key)) order.push(key);
    const prev = latest.get(key);
    if (!prev || submittedMs(s) >= submittedMs(prev)) latest.set(key, s);
  }
  return order.map((k) => latest.get(k) as T);
};

// ----------------------------------------------------------------------------
// Public team mirror.
//
// The Tryouts Portal is an anonymous-auth surface, but Firestore rules grant
// read access per *document*, not per field — so letting the portal read the
// full team doc would expose evaluations, other families' contact info, member
// UIDs, and the join code. Instead the coach app maintains a sanitized mirror
// doc (artifacts/{appId}/public/data/teamPublic/{teamId}) that the portal reads
// for branding + tryout config. This projection is the allowlist: only fields
// listed here ever reach an anonymous reader. Never add roster, schedule,
// evaluations, signups, members, ownerId, coachRoles, or joinCode.
// ----------------------------------------------------------------------------

export interface TryoutDateLink {
  slug: string;
  date: string;
}

export interface PublicTeamMirror {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  logoUrl: string;
  currentSeason: string;
  teamAge: string;
  tryoutsOpen: boolean;
  tryoutsPhase: string;
  tryoutShareId: string | null;
  tryoutDateSlug: string | null;
  tryoutDates: string[];
  // Explicit slug→date mapping so the public portal can pin a signup to the
  // exact tryout date its link was generated for. `tryoutDateLinks` is the
  // canonical list; `tryoutDateBySlug` is an O(1) lookup of the same data;
  // `tryoutDateSlugs` exists purely so the portal can resolve a link with a
  // single `array-contains` query. These carry only slug + ISO date — no
  // roster, signup, or member data — so they're safe in the public mirror.
  tryoutDateLinks: TryoutDateLink[];
  tryoutDateBySlug: Record<string, string>;
  tryoutDateSlugs: string[];
  // Optional public-facing head-coach contact shown on the portal so families
  // can ask questions. Coach opts in via Settings; empty strings hide the block.
  headCoachName: string;
  headCoachEmail: string;
}

// Normalize a team's per-date tryout links into the canonical slug→date shape.
// New teams persist `tryoutDateLinks` directly (see generateTryoutDateLink).
// Legacy teams only carried a single `tryoutDateSlug` + a `tryoutDates` array,
// with the date embedded inside the slug (`<team>-<YYYY-MM-DD>-<rand>`); we
// recover the intended date by matching a configured date that appears in the
// slug, falling back to the first configured date. Pure.
export const normalizeTryoutDateLinks = (
  team: Record<string, any> | null | undefined,
): TryoutDateLink[] => {
  const seen = new Set<string>();
  const out: TryoutDateLink[] = [];
  const push = (slug: unknown, date: unknown) => {
    const s = String(slug || "").trim();
    const d = String(date || "").trim();
    if (!s || !d || seen.has(s)) return;
    seen.add(s);
    out.push({ slug: s, date: d });
  };

  if (Array.isArray(team?.tryoutDateLinks)) {
    for (const link of team!.tryoutDateLinks) {
      push(link?.slug, link?.date);
    }
  }

  // Legacy single-slug fallback (only if not already represented).
  const legacySlug = String(team?.tryoutDateSlug || "").trim();
  if (legacySlug && !seen.has(legacySlug)) {
    const configured = Array.isArray(team?.tryoutDates)
      ? (team!.tryoutDates as unknown[])
          .map((d) => String(d).trim())
          .filter(Boolean)
      : [];
    const embedded = configured.find((d) => legacySlug.includes(d));
    push(legacySlug, embedded || configured[0] || "");
  }

  return out;
};

// Resolve the tryout date a given portal slug should pin a signup to. Prefers
// the explicit mapping; falls back to deriving from a legacy slug, then to the
// first configured date. Returns "" when nothing resolves. Pure.
export const resolveTryoutDateForSlug = (
  source: Record<string, any> | null | undefined,
  slug: string | null | undefined,
): string => {
  const s = String(slug || "").trim();
  if (!s) return "";
  const map = source?.tryoutDateBySlug;
  if (map && typeof map === "object" && typeof map[s] === "string" && map[s]) {
    return map[s];
  }
  for (const link of normalizeTryoutDateLinks(source)) {
    if (link.slug === s) return link.date;
  }
  const configured = Array.isArray(source?.tryoutDates)
    ? (source!.tryoutDates as unknown[])
        .map((d) => String(d).trim())
        .filter(Boolean)
    : [];
  // Last-ditch legacy: a configured date embedded in the slug, else the first.
  return configured.find((d) => s.includes(d)) || configured[0] || "";
};

export const buildPublicMirror = (
  team: Record<string, any> | null | undefined,
): PublicTeamMirror => {
  const links = normalizeTryoutDateLinks(team);
  const tryoutDateBySlug: Record<string, string> = {};
  for (const link of links) tryoutDateBySlug[link.slug] = link.date;
  return {
    name: team?.name || "",
    primaryColor: team?.primaryColor || "",
    secondaryColor: team?.secondaryColor || "",
    tertiaryColor: team?.tertiaryColor || "",
    logoUrl: team?.logoUrl || "",
    currentSeason: team?.currentSeason || "",
    teamAge: team?.teamAge || "",
    tryoutsOpen: team?.tryoutsOpen === true,
    tryoutsPhase: team?.tryoutsPhase || "",
    // Null (not omitted) so a team that has never shared still produces a stable
    // doc; equality queries on these fields simply won't match a null.
    tryoutShareId: team?.tryoutShareId || null,
    tryoutDateSlug: team?.tryoutDateSlug || null,
    tryoutDates: Array.isArray(team?.tryoutDates)
      ? (team!.tryoutDates as string[]).filter(Boolean)
      : [],
    tryoutDateLinks: links,
    tryoutDateBySlug,
    tryoutDateSlugs: links.map((l) => l.slug),
    headCoachName: (team?.headCoachName as string) || "",
    headCoachEmail: (team?.headCoachPublicEmail as string) || "",
  };
};

const tryoutSessionIdForDate = (date: string) =>
  `tryout-${String(date || "undated").replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const normalizeTryoutSessions = (team: any): any[] => {
  const sessions = Array.isArray(team?.tryoutSessions)
    ? team.tryoutSessions.map((s: any) => ({
        ...s,
        signupIds: Array.isArray(s.signupIds) ? [...s.signupIds] : [],
        gradesByEvaluator: { ...(s.gradesByEvaluator || {}) },
      }))
    : [];
  const byId = new Map(sessions.map((session: any) => [session.id, session]));
  for (const e of team?.evaluationEvents || []) {
    if (!e?.tryoutSignupId || !e?.evaluatorId || !e?.grades?.signup) continue;
    const signup = (team?.tryoutSignups || []).find(
      (s: any) => s.id === e.tryoutSignupId,
    );
    const date = signup?.tryoutDate || e.date || "undated";
    const id = tryoutSessionIdForDate(date);
    const session: any = byId.get(id) || {
      id,
      date,
      label: `Tryout · ${date}`,
      createdAt: e.createdAt || Date.now(),
      updatedAt: e.createdAt || Date.now(),
      signupIds: [],
      gradesByEvaluator: {},
    };
    const evaluatorKey = e.evaluatorId;
    const evaluator = session.gradesByEvaluator[evaluatorKey] || {
      coachRole: e.coachRole || "Assistant",
      evaluatorId: e.evaluatorId,
      evaluatorName: e.evaluatorName,
      grades: {},
    };
    evaluator.grades = {
      ...(evaluator.grades || {}),
      [e.tryoutSignupId]: { ...e.grades.signup },
    };
    evaluator.updatedAt = e.createdAt || Date.now();
    session.gradesByEvaluator[evaluatorKey] = evaluator;
    if (!session.signupIds.includes(e.tryoutSignupId))
      session.signupIds.push(e.tryoutSignupId);
    byId.set(id, session);
  }
  return [...byId.values()];
};

// Round every numeric field once, at the very end of a blend (audit finding
// 3.3 — a single rounding pass). Non-numeric fields (notes, suggestedPositions)
// pass through untouched.
const roundGrade = (grade: Record<string, any> | null) => {
  if (!grade) return grade;
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(grade))
    out[key] = typeof val === "number" ? Math.round(val) : val;
  return out;
};

// ONE session's head/assistant blend for a signup, kept RAW (unrounded) so
// callers can keep averaging without compounding rounding error. Per-group
// mean, then a 50/50 head-vs-assistant split — the head's read counts as much
// as the whole assistant pool (deliberate weighting).
const rawSessionBlend = (session: any, signupId: string): any | null => {
  const headGrades: any[] = [];
  const assistantGrades: any[] = [];
  for (const eg of Object.values(session?.gradesByEvaluator || {}) as any[]) {
    const g = eg?.grades?.[signupId];
    if (!g) continue;
    if (eg.coachRole === "Head") headGrades.push(g);
    else assistantGrades.push(g);
  }
  const rawAvg = (grades: any[]) => {
    if (!grades.length) return null;
    const out: Record<string, any> = {};
    const keys = new Set<string>();
    grades.forEach((g) => Object.keys(g || {}).forEach((k) => keys.add(k)));
    for (const key of keys) {
      if (key === "notes" || key === "suggestedPositions") {
        const latest = [...grades].reverse().find((g) => g?.[key]);
        if (latest) out[key] = latest[key];
        continue;
      }
      const vals = grades
        .map((g) => g?.[key])
        .filter((v) => typeof v === "number");
      if (vals.length) out[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  };
  const head = rawAvg(headGrades);
  const assistants = rawAvg(assistantGrades);
  if (head && assistants) {
    const out: Record<string, any> = {};
    const keys = new Set([...Object.keys(head), ...Object.keys(assistants)]);
    for (const key of keys) {
      if (key === "notes" || key === "suggestedPositions")
        out[key] = head[key] ?? assistants[key];
      else {
        const hv = head[key];
        const av = assistants[key];
        if (typeof hv === "number" && typeof av === "number")
          out[key] = (hv + av) / 2;
        else out[key] = hv ?? av;
      }
    }
    return out;
  }
  return head || assistants;
};

// The sessions (newest first) where this signup was actually graded.
const gradedSessionsFor = (
  sessions: any[] | null | undefined,
  signupId: string,
  date?: string,
): any[] =>
  (sessions || [])
    .filter(
      (s: any) =>
        (!date || s.date === date) &&
        Object.values(s.gradesByEvaluator || {}).some(
          (eg: any) => eg?.grades?.[signupId],
        ),
    )
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));

export const combinedTryoutGradeForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
  date?: string,
): any | null => {
  if (!signupId) return null;
  const session = gradedSessionsFor(sessions, signupId, date)[0];
  if (!session) return null;
  return roundGrade(rawSessionBlend(session, signupId));
};

// The MULTI-TRYOUT fold: a kid graded at several tryout dates gets ONE
// combined grade — each session's head/assistant blend computed raw, then
// averaged per category across sessions (every tryout counts equally), with a
// single final rounding. Notes/positions come from the newest session carrying
// them. With one session this degrades exactly to combinedTryoutGradeForSignup.
export const unifiedTryoutGradeForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
): any | null => {
  if (!signupId) return null;
  const graded = gradedSessionsFor(sessions, signupId);
  if (graded.length === 0) return null;
  const blends = graded
    .map((s) => rawSessionBlend(s, signupId))
    .filter(Boolean) as Record<string, any>[];
  if (blends.length === 0) return null;
  const out: Record<string, any> = {};
  const keys = new Set<string>();
  blends.forEach((b) => Object.keys(b).forEach((k) => keys.add(k)));
  for (const key of keys) {
    if (key === "notes" || key === "suggestedPositions") {
      // blends[] is newest-first — take the freshest note/position set.
      const newest = blends.find((b) => b[key]);
      if (newest) out[key] = newest[key];
      continue;
    }
    const vals = blends.map((b) => b[key]).filter((v) => typeof v === "number");
    if (vals.length) out[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return roundGrade(out);
};

// Every evaluator's saved entry for a signup (optionally scoped to one tryout
// date), newest session first, heads before assistants within a session. The
// cross-coach visibility read: at a real tryout each coach works a station
// and records only what they saw — this shows everyone's numbers to every
// coach (tryoutSessions live on the shared team doc, so all members can read).
export interface TryoutEvaluatorEntry {
  evaluatorId: string;
  coachRole: string;
  evaluatorName?: string;
  date?: string;
  grade: Record<string, any>;
}

export const evaluatorEntriesForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
  date?: string,
): TryoutEvaluatorEntry[] => {
  if (!signupId) return [];
  const out: TryoutEvaluatorEntry[] = [];
  for (const session of gradedSessionsFor(sessions, signupId, date)) {
    const entries: TryoutEvaluatorEntry[] = [];
    for (const eg of Object.values(session.gradesByEvaluator || {}) as any[]) {
      const grade = eg?.grades?.[signupId];
      if (!grade) continue;
      entries.push({
        evaluatorId: String(eg.evaluatorId || ""),
        coachRole: eg.coachRole || "Assistant",
        ...(eg.evaluatorName ? { evaluatorName: eg.evaluatorName } : {}),
        date: session.date,
        grade,
      });
    }
    entries.sort(
      (a, b) =>
        Number(b.coachRole === "Head") - Number(a.coachRole === "Head") ||
        (a.evaluatorName || "").localeCompare(b.evaluatorName || ""),
    );
    out.push(...entries);
  }
  return out;
};

export const evaluatorTryoutGradeForSignup = (
  sessions: any[] | null | undefined,
  signupId: string | null | undefined,
  evaluatorId: string | null | undefined,
  date?: string,
): any | null => {
  if (!signupId || !evaluatorId) return null;
  const session = (sessions || [])
    .filter((s: any) => !date || s.date === date)
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .find((s: any) => s.gradesByEvaluator?.[evaluatorId]?.grades?.[signupId]);
  return session?.gradesByEvaluator?.[evaluatorId]?.grades?.[signupId] || null;
};

// One-time migration (EVAL schema v11) — audit finding 3.2. Legacy tryout
// grades were stored as `evaluationEvents` entries carrying a `tryoutSignupId`
// + `grades.signup`; `normalizeTryoutSessions` folds those into the session map
// on every read but never removed them, so they lived in two places, bloated
// the doc, and were re-normalized on every load. This does that fold ONCE and
// drops the folded entries from `evaluationEvents`, leaving `tryoutSessions` as
// the single home for tryout grades. Pure.
//
// The drop condition is IDENTICAL to what normalizeTryoutSessions folds
// (`tryoutSignupId && evaluatorId && grades.signup`), so nothing that wasn't
// safely captured in a session is ever removed. Idempotent: once no legacy
// entries remain, the inputs are returned unchanged (by reference) so the
// caller writes nothing.
export const migrateLegacyTryoutGrades = (
  team: any,
): { evaluationEvents: any[]; tryoutSessions: any[] } => {
  const events = Array.isArray(team?.evaluationEvents)
    ? team.evaluationEvents
    : [];
  const sessions = Array.isArray(team?.tryoutSessions)
    ? team.tryoutSessions
    : [];
  const isFoldedTryoutGrade = (e: any) =>
    !!(e && e.tryoutSignupId && e.evaluatorId && e.grades?.signup);
  const legacy = events.filter(isFoldedTryoutGrade);
  // No legacy entries → return the inputs untouched (same references) so an
  // equality check upstream sees "nothing changed" and skips the write.
  if (legacy.length === 0) {
    return { evaluationEvents: events, tryoutSessions: sessions };
  }
  return {
    // normalizeTryoutSessions reads team.evaluationEvents/tryoutSessions/
    // tryoutSignups and returns the merged sessions (legacy grades folded in).
    tryoutSessions: normalizeTryoutSessions(team),
    evaluationEvents: events.filter((e: any) => !isFoldedTryoutGrade(e)),
  };
};

// ---- Tryout numbers ---------------------------------------------------------
// Every kid at a tryout wears a number so evaluators know who is who. Numbers
// are scoped PER TRYOUT DATE (two dates can both have a #1); signups without a
// date share the undated pool. Stored as strings on TryoutSignup.tryoutNumber
// (the field the coach can also hand-edit on the card).

// The next free number within a tryout date's pool — for stamping a newly
// added signup.
export const nextTryoutNumber = (
  signups: Array<{ tryoutDate?: string; tryoutNumber?: string }> | undefined,
  tryoutDate?: string,
): string => {
  const scopeDate = String(tryoutDate || "");
  const used = new Set<number>();
  for (const s of signups || []) {
    if (String(s?.tryoutDate || "") !== scopeDate) continue;
    const n = parseInt(String(s?.tryoutNumber || ""), 10);
    if (Number.isFinite(n) && n > 0) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return String(n);
};

// Fill in a number for every signup that lacks one, per date pool, in
// submission order (stable: the earlier a family registered, the lower the
// number). Pure and deterministic — safe inside a mapEntries resolve-once
// callback. Returns the SAME array reference when nothing was missing so the
// caller can skip a no-op write.
export const applyMissingTryoutNumbers = <
  T extends {
    id?: string;
    submittedAt?: string;
    tryoutDate?: string;
    tryoutNumber?: string;
  },
>(
  signups: T[],
): T[] => {
  const list = Array.isArray(signups) ? signups : [];
  const usedByDate = new Map<string, Set<number>>();
  const usedFor = (date: string): Set<number> => {
    let set = usedByDate.get(date);
    if (!set) {
      set = new Set<number>();
      usedByDate.set(date, set);
    }
    return set;
  };
  for (const s of list) {
    const n = parseInt(String(s?.tryoutNumber || ""), 10);
    if (Number.isFinite(n) && n > 0)
      usedFor(String(s?.tryoutDate || "")).add(n);
  }
  const missing = list
    .filter((s) => {
      const n = parseInt(String(s?.tryoutNumber || ""), 10);
      return !(Number.isFinite(n) && n > 0);
    })
    .sort(
      (a, b) =>
        new Date(a?.submittedAt || 0).getTime() -
        new Date(b?.submittedAt || 0).getTime(),
    );
  if (missing.length === 0) return list;
  const assigned = new Map<string, string>();
  for (const s of missing) {
    const pool = usedFor(String(s?.tryoutDate || ""));
    let n = 1;
    while (pool.has(n)) n += 1;
    pool.add(n);
    if (s?.id) assigned.set(s.id, String(n));
  }
  return list.map((s) =>
    s?.id && assigned.has(s.id)
      ? { ...s, tryoutNumber: assigned.get(s.id) }
      : s,
  );
};

// The full tryout grade for a signup: the subjective HC/AC blend PLUS the
// measured showcase overlay. Measured stations are DEFINITIVE — a radar gun
// doesn't care who held it — so measurement-derived grades override the
// subjective blend for their categories (and are exempt from head-vs-assistant
// weighting by construction: they live on the signup, not in any evaluator's
// grade map).
//
// By default the blend UNIFIES every tryout the kid attended (the multi-tryout
// fold) — pass an explicit `date` to scope to a single tryout. Returns null
// only when there is neither a grade nor a measurement.
export const tryoutGradeWithMeasurements = (
  sessions: any[] | null | undefined,
  signup:
    | { id?: string; tryoutDate?: string; measurements?: any }
    | null
    | undefined,
  teamAge?: string,
  date?: string,
): any | null => {
  if (!signup?.id) return null;
  const blend = date
    ? combinedTryoutGradeForSignup(sessions, signup.id, date)
    : unifiedTryoutGradeForSignup(sessions, signup.id);
  const measured = measurementGrades(signup.measurements, teamAge);
  if (Object.keys(measured).length === 0) return blend;
  return { ...(blend || {}), ...measured };
};
