import { useCallback } from "react";
import { writeBatch, type Firestore } from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import {
  blankStats,
  normalizeTryoutSessions,
  isDepartedPlayer,
  randomCode,
  genId,
  scrubUndefined,
  coachLastNameOf,
} from "../utils/helpers";
import { applyMissingTryoutNumbers } from "../utils/tryouts";
import {
  deleteSignupDoc,
  findLegacySignupEntries,
  newSignupId,
  removeLegacySignupEntries,
  signupDocRef,
  upsertSignupDoc,
} from "../utils/tryoutSignupDocs";

// Lowercase base36 — matches the look of the previous Math.random().toString(36)
// share tokens, but every character is now uniformly drawn from a CSPRNG and the
// length is exact (the old slice(2, N) could occasionally come up short).
const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
import type {
  AvailabilitySubmission,
  InterestSignup,
  Player,
  PlayerInfoSubmission,
  ToastContextValue,
  TryoutSession,
  TryoutSignup,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Tryout + interest-signup flows extracted from App.tsx's TeamProvider.
// Share-link generation, open/close state, signup/lead CRUD, tryout
// evaluations, and accept-to-roster.
//
// SIGNUPS live per-entry in the tryoutSignups/interestSignups subcollections
// (Phase 1 of docs/firestore-data-migration.md, mirroring evalRounds), and —
// as of Phase 1b — so do the playerInfoSubmissions/availabilitySubmissions
// portal lanes: teamDataRef.current.<key> is the assembled UNION of
// subcollection docs and any not-yet-migrated legacy team-doc array entries,
// and every signup/submission mutation here writes per-doc via
// utils/tryoutSignupDocs. Deletes must ALSO clear a legacy-resident copy —
// the union re-admits any legacy entry whose id has no subcollection doc, so
// removing only the subdoc would resurrect the entry from its stale array
// twin.
//
// That legacy cleanup deliberately does NOT go through updateTeamArrays. Both
// of its shapes are wrong for a union-backed key: `removeById` resolves the
// arrayRemove value from teamData (the union, where a coach-edited SUBDOC wins
// the id) so it matches nothing once the two copies diverge, and `mapEntries`
// writes the whole resolved array — i.e. the union — back into the team doc,
// re-inflating it with subcollection-only entries. Every cleanup here reads
// the RAW array refs and calls removeLegacySignupEntries, which arrayRemoves
// the exact stored elements (tryoutSignupDocs.ts has the full reasoning).
//
// The remaining array mutations (players, tryoutSessions) go through the
// injected updateTeamArrays. Scalar/config writes (share links, open/close,
// roster cap) stay on updateTeam. No engine or UI-bridge coupling.
interface UseTryoutFlowsArgs {
  // Ref to the live team doc — callbacks read teamDataRef.current at call time
  // so they keep a stable identity across Firestore snapshots (same pattern as
  // updateTeam in TeamProvider).
  teamDataRef: React.MutableRefObject<any>;
  // The RAW legacy signup arrays straight off the team doc (NOT the assembled
  // union above) — deletes consult these to decide whether a legacy-array
  // cleanup write is needed at all (see the resurrect hazard note above).
  rawTryoutSignupsRef: React.MutableRefObject<
    TryoutSignup[] | null | undefined
  >;
  rawInterestSignupsRef: React.MutableRefObject<
    InterestSignup[] | null | undefined
  >;
  rawPlayerInfoSubmissionsRef: React.MutableRefObject<
    PlayerInfoSubmission[] | null | undefined
  >;
  rawAvailabilitySubmissionsRef: React.MutableRefObject<
    AvailabilitySubmission[] | null | undefined
  >;
  updateTeam: (patch: Record<string, unknown>) => void;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  user:
    | { uid: string; displayName?: string | null; email?: string | null }
    | null
    | undefined;
  activeTeamId: string | null;
  // Subcollection write handles — mirrors useEvaluationCrud. teamId is the
  // provider's activeTeamId; nullable because no team may be selected yet.
  db: Firestore;
  appId: string;
  teamId: string | null;
}

// Union a submission's absence dates + time/reason blocks into a player,
// deduped (blocks by date+start+end, preferring an entry that carries a
// reason). Pure add over whatever the player already has, so it can run
// against the LATEST roster item inside a mapEntries map — a parent
// re-submitting, or another coach's concurrent edit, only ever accumulates.
const mergeAvailabilityIntoPlayer = (
  player: Player,
  dates: string[],
  blocks: any[],
  submittedAt: string,
): Player => {
  const mergedAbsences = [
    ...new Set([...(player.absences || []), ...dates]),
  ].sort();
  const blockKey = (b: any) =>
    `${String(b?.date).slice(0, 10)}|${b?.startTime || ""}|${b?.endTime || ""}`;
  const blockMap = new Map<string, any>();
  for (const b of [...(player.availabilityBlocks || []), ...blocks]) {
    if (!b?.date) continue;
    const key = blockKey(b);
    if (!blockMap.has(key) || (b.reason && !blockMap.get(key)?.reason)) {
      blockMap.set(key, { ...b, date: String(b.date).slice(0, 10) });
    }
  }
  const mergedBlocks = [...blockMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return {
    ...player,
    absences: mergedAbsences,
    availabilityBlocks: mergedBlocks,
    availabilitySubmittedAt: submittedAt,
  };
};

const submissionDates = (sub: any): string[] =>
  Array.isArray(sub?.dates) ? sub.dates : [];
const submissionBlocks = (sub: any): any[] =>
  Array.isArray(sub?.blocks)
    ? sub.blocks
    : submissionDates(sub).map((date: string) => ({ date }));

export const useTryoutFlows = ({
  teamDataRef,
  rawTryoutSignupsRef,
  rawInterestSignupsRef,
  rawPlayerInfoSubmissionsRef,
  rawAvailabilitySubmissionsRef,
  updateTeam,
  updateTeamArrays,
  toast,
  user,
  activeTeamId,
  db,
  appId,
  teamId,
}: UseTryoutFlowsArgs) => {
  // One error surface for every per-doc signup write (the useEvaluationCrud
  // pattern): the utils REJECT on failure so we can tell the coach instead of
  // silently dropping the edit. Offline writes don't reject — they queue in
  // the SDK's offline buffer — so this fires only on genuine rejections.
  const signupWriteFailed = useCallback(() => {
    toast.push({
      kind: "error",
      title: "Couldn't save that change",
      message: "Check your connection and try again.",
    });
  }, [toast]);

  const generateTryoutShareId = useCallback(() => {
    const id = randomCode(12, SLUG_ALPHABET);
    updateTeam({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" });
    return id;
  }, [updateTeam]);

  const generateTryoutDateLink = useCallback(
    (rawDate: any) => {
      const teamData = teamDataRef.current;
      const date = String(rawDate || "").trim();
      if (!date) return null;
      const base = String(activeTeamId || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const rand = randomCode(6, SLUG_ALPHABET);
      const slug = `${base || "team"}-${date}-${rand}`;
      const dates = Array.isArray(teamData.tryoutDates)
        ? teamData.tryoutDates
        : [];
      const nextDates = dates.includes(date) ? dates : [...dates, date];
      // Persist an explicit slug→date mapping so the portal pins the exact date
      // this link was generated for. We append (never replace): a date can be
      // regenerated to mint a fresh slug while previously printed QR codes keep
      // resolving to their original date. `tryoutDateSlug` is still written for
      // backward compatibility with the legacy single-slug portal/mirror path.
      const existingLinks = Array.isArray(teamData.tryoutDateLinks)
        ? teamData.tryoutDateLinks.filter(
            (l: any) => l && l.slug && l.date && l.slug !== slug,
          )
        : [];
      const nextLinks = [...existingLinks, { slug, date }];
      updateTeam({
        tryoutDateSlug: slug,
        tryoutDates: nextDates,
        tryoutDateLinks: nextLinks,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      });
      return slug;
    },
    [activeTeamId, teamDataRef, updateTeam],
  );

  const setTryoutsOpen = useCallback(
    (open: any) => {
      updateTeam({
        tryoutsOpen: !!open,
        tryoutsPhase: open ? "open" : "intake_closed",
      });
    },
    [updateTeam],
  );

  const completeTryouts = useCallback(() => {
    updateTeam({ tryoutsOpen: false, tryoutsPhase: "completed" });
  }, [updateTeam]);

  const setRosterCap = useCallback(
    (cap: any) => {
      const n = parseInt(cap, 10);
      if (!Number.isFinite(n) || n <= 0) return;
      updateTeam({ rosterCap: n });
    },
    [updateTeam],
  );

  const appendTryoutSignup = useCallback(
    (signup: any) => {
      if (!teamId) return;
      // Firestore auto-id (collision-SAFE) instead of genId: the signup id is
      // now a doc id shared with anonymous portal devices the coach never
      // sees, so "collision-unlikely" isn't good enough.
      const id = signup.id || newSignupId(db, appId, teamId, "tryoutSignups");
      const entry = {
        id,
        submittedAt: signup.submittedAt || new Date().toISOString(),
        status: signup.status || "tryout",
        ...signup,
      };
      upsertSignupDoc(db, appId, teamId, "tryoutSignups", entry).catch(
        signupWriteFailed,
      );
      return entry;
    },
    [db, appId, teamId, signupWriteFailed],
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      if (!teamId) return;
      // Patch over the union entry, then write the FULL entry as its own doc.
      // A legacy-only signup gets its subdoc created here — the union dedups
      // by id with the subcollection winning, so this doubles as a lazy
      // per-entry migration. Unknown id → silent no-op, matching the old
      // mapEntries behavior.
      const current = (teamDataRef.current.tryoutSignups || []).find(
        (s: TryoutSignup) => s.id === id,
      );
      if (!current) return;
      upsertSignupDoc(db, appId, teamId, "tryoutSignups", {
        ...current,
        ...patch,
      }).catch(signupWriteFailed);
    },
    [db, appId, teamId, teamDataRef, signupWriteFailed],
  );

  // One-tap "everyone gets a number": fill a tryout number for every signup
  // that lacks one, per tryout-date pool, in submission order. Runs over the
  // call-time union — a portal registration that lands mid-tap simply stays
  // unnumbered until the next tap (numbers are only ever ADDED, never
  // reissued, so re-running is always safe). One batch of full-entry set()s
  // for just the signups whose number changed. writeBatch, not runTransaction:
  // transactions fail offline while batches queue in the SDK's offline buffer
  // (teamArrayUpdates.ts:14-17 has the same reasoning) — and field-side number
  // assignment is exactly when the coach's connection is flakiest.
  const assignTryoutNumbers = useCallback(() => {
    if (!teamId) return;
    const current: TryoutSignup[] = teamDataRef.current.tryoutSignups || [];
    const next = applyMissingTryoutNumbers(current);
    if (next === current) return; // same reference ⇒ nothing was missing
    const batch = writeBatch(db);
    next.forEach((s, i) => {
      // applyMissingTryoutNumbers preserves order and reuses the object
      // reference for untouched entries, so !== means "number assigned".
      if (s !== current[i]) {
        batch.set(
          signupDocRef(db, appId, teamId, "tryoutSignups", s.id),
          scrubUndefined(s) as DocumentData,
        );
      }
    });
    batch.commit().catch(signupWriteFailed);
  }, [db, appId, teamId, teamDataRef, signupWriteFailed]);

  // Record showcase-station measurements on a signup. The measurements live on
  // the SIGNUP (one shared record) — not in any evaluator's grade map — so
  // whichever coach runs the radar gun, every evaluator sees the same numbers
  // and they stay exempt from head-vs-assistant grade weighting. Merges the
  // patch over what's already recorded; pass undefined for a field to leave it
  // untouched (the payload sanitizer scrubs undefined before Firestore).
  const saveTryoutMeasurements = useCallback(
    (signupId: any, patch: Record<string, number | undefined>) => {
      if (!teamId) return;
      const current = (teamDataRef.current.tryoutSignups || []).find(
        (s: TryoutSignup) => s.id === signupId,
      );
      if (!current) return;
      upsertSignupDoc(db, appId, teamId, "tryoutSignups", {
        ...current,
        measurements: { ...(current.measurements || {}), ...patch },
      }).catch(signupWriteFailed);
    },
    [db, appId, teamId, teamDataRef, signupWriteFailed],
  );

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id || !teamId) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      deleteSignupDoc(db, appId, teamId, "tryoutSignups", id).catch(
        signupWriteFailed,
      );
      // RESURRECT HAZARD: the union re-admits any legacy-array entry whose id
      // has no subcollection doc — so once the subdoc above is gone, a stale
      // legacy copy would bring the signup straight back on the next
      // assembly, carrying whatever data it held BEFORE the coach's edits.
      // arrayRemove of the exact stored element, so a portal signup that
      // landed after this coach's snapshot survives the delete; a
      // subcollection-only signup finds no legacy twin and writes nothing.
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "tryoutSignups",
        findLegacySignupEntries(rawTryoutSignupsRef.current, [id]),
      ).catch(signupWriteFailed);
    },
    [db, appId, teamId, rawTryoutSignupsRef, signupWriteFailed],
  );

  // Bulk-remove signups: ONE batch of per-doc deletes (deleting a doc that
  // never existed is a Firestore no-op, so legacy-only ids are safe to
  // include) plus ONE exact-entry arrayRemove clearing every legacy-resident
  // target at once (arrayRemove is variadic) — the bulk form of
  // deleteTryoutSignup's resurrect guard. Returns the number removed
  // (estimated from the call-time union via teamDataRef).
  //
  // The legacy side must NOT be a mapEntries filter: that writes the whole
  // resolved array back, and the array it resolves is teamData's UNION — which
  // would push subcollection-only signups INTO the legacy team-doc array,
  // re-inflating the doc this migration exists to shrink and resurrecting them
  // as legacy entries the moment their subdoc goes away.
  const deleteTryoutSignups = useCallback(
    (ids: any[]) => {
      if (!teamId) return 0;
      const toRemove = new Set<string>((ids || []).filter(Boolean));
      if (toRemove.size === 0) return 0;
      const current = teamDataRef.current.tryoutSignups || [];
      const targets = current.filter((s: any) => toRemove.has(s.id));
      if (targets.length === 0) return 0;
      const batch = writeBatch(db);
      for (const s of targets) {
        batch.delete(signupDocRef(db, appId, teamId, "tryoutSignups", s.id));
      }
      batch.commit().catch(signupWriteFailed);
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "tryoutSignups",
        findLegacySignupEntries(rawTryoutSignupsRef.current, toRemove),
      ).catch(signupWriteFailed);
      return targets.length;
    },
    [db, appId, teamId, teamDataRef, rawTryoutSignupsRef, signupWriteFailed],
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here. Same
  // resurrect guard as deleteTryoutSignup, on the interest lane.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id || !teamId) return;
      deleteSignupDoc(db, appId, teamId, "interestSignups", id).catch(
        signupWriteFailed,
      );
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "interestSignups",
        findLegacySignupEntries(rawInterestSignupsRef.current, [id]),
      ).catch(signupWriteFailed);
    },
    [db, appId, teamId, rawInterestSignupsRef, signupWriteFailed],
  );

  // Promote an interest-survey lead into a real tryout signup. Useful
  // when tryouts open and the HC wants to seed the signup list from
  // standing interest. Copies fields, marks status:"tryout", and removes the
  // source lead — create + delete ride ONE writeBatch, so the promotion is
  // atomic (a kid can't end up in both lists or neither) yet still queues in
  // the SDK's offline buffer, unlike a transaction (teamArrayUpdates.ts:14-17).
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id || !teamId) return;
      const lead = (teamDataRef.current.interestSignups || []).find(
        (s: any) => s.id === id,
      );
      if (!lead) return;
      const signup = {
        id: newSignupId(db, appId, teamId, "tryoutSignups"),
        submittedAt: new Date().toISOString(),
        firstName: lead.firstName,
        lastName: lead.lastName,
        dob: lead.dob || "",
        parentName: lead.parentName || "",
        email: lead.email || "",
        phone: lead.phone || "",
        currentTeam: lead.currentTeam || "",
        tryoutDate: lead.tryoutDate || "",
        primaryPosition: lead.primaryPosition || "",
        secondaryPosition: lead.secondaryPosition || "",
        canPitch: lead.canPitch === true,
        canCatch: lead.canCatch === true || lead.isCatcher === true,
        isCatcher: lead.canCatch === true || lead.isCatcher === true,
        comfortablePositions: [
          ...(Array.isArray(lead.comfortablePositions)
            ? lead.comfortablePositions
            : []
          ).filter((p: any) => p !== "C"),
          ...(lead.canCatch === true || lead.isCatcher === true ? ["C"] : []),
        ],
        notes: lead.notes || "",
        status: "tryout" as const,
      };
      const batch = writeBatch(db);
      batch.set(
        signupDocRef(db, appId, teamId, "tryoutSignups", signup.id),
        scrubUndefined(signup) as DocumentData,
      );
      batch.delete(signupDocRef(db, appId, teamId, "interestSignups", id));
      batch.commit().catch(signupWriteFailed);
      // A legacy-resident lead needs its array copy cleared too, or the union
      // resurrects the consumed lead once its subdoc is gone (same hazard as
      // deleteInterestSignup) — and it comes back as an un-converted lead
      // alongside the tryout signup this just created.
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "interestSignups",
        findLegacySignupEntries(rawInterestSignupsRef.current, [id]),
      ).catch(signupWriteFailed);
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [
      db,
      appId,
      teamId,
      teamDataRef,
      rawInterestSignupsRef,
      toast,
      signupWriteFailed,
    ],
  );

  // Drop a parent-submitted player-info entry. Coach-only; the two-tap
  // confirm lives in the PlayerInfoTab UI so there's no native prompt here.
  // Same two-home delete as deleteTryoutSignup: the subcollection doc plus,
  // when a legacy team-doc twin exists, an exact-entry arrayRemove — or the
  // union resurrects the entry from its stale array copy.
  const deletePlayerInfoSubmission = useCallback(
    (id: any) => {
      if (!id || !teamId) return;
      deleteSignupDoc(db, appId, teamId, "playerInfoSubmissions", id).catch(
        signupWriteFailed,
      );
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "playerInfoSubmissions",
        findLegacySignupEntries(rawPlayerInfoSubmissionsRef.current, [id]),
      ).catch(signupWriteFailed);
    },
    [db, appId, teamId, rawPlayerInfoSubmissionsRef, signupWriteFailed],
  );

  // Apply a parent-submitted player-info entry onto a matching roster player.
  // Writes the sizing + school + emergency-contact fields onto the chosen
  // Player (only fields the parent actually filled in — never blanking
  // existing roster data) and stamps the submission as handled so the inbox
  // can show it as applied. The player patch and the submission stamp used to
  // ride ONE team-doc write; the submission now lives in its own subcollection
  // doc, so they are separate writes only a server-side batch could make
  // atomic. The player patch is issued FIRST, so the bad interleaving is a
  // stamped-but-unapplied inbox row the coach can re-apply — never sizing
  // silently lost (the acceptTryout trade, same reasoning).
  const applyPlayerInfoToPlayer = useCallback(
    (submissionId: any, playerId: any) => {
      if (!submissionId || !playerId || !teamId) return;
      const teamData = teamDataRef.current;
      const sub = (teamData.playerInfoSubmissions || []).find(
        (s: any) => s.id === submissionId,
      );
      const player = (teamData.players || []).find(
        (p: any) => p.id === playerId,
      );
      if (!sub || !player) return;

      // Map submission fields → player fields, skipping blanks so applying a
      // sparse submission never wipes data already on the roster record.
      const patch: Record<string, unknown> = {};
      const put = (key: string, value: unknown) => {
        const v = String(value ?? "").trim();
        if (v) patch[key] = v;
      };
      put("number", sub.number);
      put("hatSize", sub.hatSize);
      put("shirtSize", sub.shirtSize);
      put("pantsSize", sub.pantsSize);
      put("height", sub.height);
      put("weight", sub.weight);
      put("school", sub.school);
      put("grade", sub.grade);
      // Parent / guardian 2 (legacy emergency fields are read as a fallback so
      // older submissions still populate Parent 2).
      put("parent2Name", sub.parent2Name || sub.emergencyName);
      put("parent2Phone", sub.parent2Phone || sub.emergencyPhone);
      put("parent2Email", sub.parent2Email);

      const now = new Date().toISOString();
      updateTeamArrays({
        op: "mapEntries",
        key: "players",
        map: (items: Player[]) =>
          items.map((p) => {
            if (p.id !== playerId) return p;
            // DOB + parent/guardian 1 contact only fill gaps — evaluated
            // against the LATEST roster record so this never clobbers what
            // a coach curated after this screen rendered.
            const gaps: Record<string, unknown> = {};
            const fill = (key: string, value: unknown) => {
              const v = String(value ?? "").trim();
              if (v && !(p as any)[key]) gaps[key] = v;
            };
            fill("dob", sub.dob);
            fill("parentName", sub.parentName);
            fill("email", sub.email);
            fill("phone", sub.phone);
            return {
              ...p,
              ...patch,
              ...gaps,
              playerInfoSubmittedAt: sub.submittedAt || now,
            };
          }),
      });
      // Full-entry upsert of the submission's own doc. `sub` comes from the
      // assembled union, so a legacy-only entry gets its subdoc created here —
      // the union dedups by id with the subcollection winning, making this a
      // lazy per-entry migration too (the updateTryoutSignup pattern).
      upsertSignupDoc(db, appId, teamId, "playerInfoSubmissions", {
        ...sub,
        appliedToPlayerId: playerId,
        appliedAt: now,
      }).catch(signupWriteFailed);
      toast.push({
        kind: "success",
        title: "Player info applied",
        message:
          `${sub.firstName || ""} ${sub.lastName || ""}`.trim() || player.name,
      });
    },
    [db, appId, teamId, teamDataRef, updateTeamArrays, toast, signupWriteFailed],
  );

  // Drop a parent-submitted availability entry. Coach-only; the two-tap confirm
  // lives in the AvailabilityTab UI so there's no native prompt here. Same
  // two-home delete as deletePlayerInfoSubmission.
  const deleteAvailabilitySubmission = useCallback(
    (id: any) => {
      if (!id || !teamId) return;
      deleteSignupDoc(db, appId, teamId, "availabilitySubmissions", id).catch(
        signupWriteFailed,
      );
      removeLegacySignupEntries(
        db,
        appId,
        teamId,
        "availabilitySubmissions",
        findLegacySignupEntries(rawAvailabilitySubmissionsRef.current, [id]),
      ).catch(signupWriteFailed);
    },
    [db, appId, teamId, rawAvailabilitySubmissionsRef, signupWriteFailed],
  );

  // Merge a parent-submitted availability entry onto a roster player: union the
  // submitted dates into player.absences (deduped + sorted), stamp the player's
  // availabilitySubmittedAt (drives the completion tracker), and mark the
  // submission handled. Pure union over the LATEST roster record, so
  // re-applying, a parent re-submitting more dates, or a concurrent absence
  // edit is always additive. Player merge first, submission stamp second —
  // the same shrunken-not-closed atomicity window as applyPlayerInfoToPlayer,
  // with the same benign bad interleaving (an unstamped row re-applies as a
  // pure re-union).
  const applyAvailabilityToPlayer = useCallback(
    (submissionId: any, playerId: any, opts?: { silent?: boolean }) => {
      if (!submissionId || !playerId || !teamId) return;
      const teamData = teamDataRef.current;
      const sub = (teamData.availabilitySubmissions || []).find(
        (s: any) => s.id === submissionId,
      );
      const player = (teamData.players || []).find(
        (p: any) => p.id === playerId,
      );
      if (!sub || !player) return;

      const dates = submissionDates(sub);
      const blocks = submissionBlocks(sub);
      const now = new Date().toISOString();
      updateTeamArrays({
        op: "mapEntries",
        key: "players",
        map: (items: Player[]) =>
          items.map((p) =>
            p.id === playerId
              ? mergeAvailabilityIntoPlayer(
                  p,
                  dates,
                  blocks,
                  sub.submittedAt || now,
                )
              : p,
          ),
      });
      // Full-entry upsert doubling as lazy migration — see
      // applyPlayerInfoToPlayer.
      upsertSignupDoc(db, appId, teamId, "availabilitySubmissions", {
        ...sub,
        appliedToPlayerId: playerId,
        appliedAt: now,
      }).catch(signupWriteFailed);
      if (!opts?.silent) {
        toast.push({
          kind: "success",
          title: "Availability applied",
          message:
            `${sub.firstName || ""} ${sub.lastName || ""}`.trim() ||
            player.name,
        });
      }
    },
    [db, appId, teamId, teamDataRef, updateTeamArrays, toast, signupWriteFailed],
  );

  // Auto-apply every un-applied availability submission whose name + DOB
  // uniquely identify one non-departed roster player. Ambiguous or unmatched
  // submissions are left for the coach to match by hand. Runs on the coach
  // client (only members can write players) — typically when the Availability
  // tab mounts. Matching runs on the call-time team snapshot (teamDataRef);
  // the player merges run over the LATEST roster array in one write, and the
  // submission stamps ride one batch of per-doc set()s (the
  // applyAvailabilityToPlayer atomicity trade, in bulk). Returns the number
  // applied.
  const autoApplyAvailability = useCallback(() => {
    if (!teamId) return 0;
    const teamData = teamDataRef.current;
    const subs = teamData.availabilitySubmissions || [];
    const players = teamData.players || [];
    const pending = subs.filter((s: any) => !s.appliedToPlayerId);
    if (pending.length === 0) return 0;

    const norm = (v: any) =>
      String(v ?? "")
        .trim()
        .toLowerCase();
    const matchPlayer = (sub: any): any | null => {
      const dob = String(sub.dob || "").trim();
      const full = `${sub.firstName || ""} ${sub.lastName || ""}`
        .trim()
        .toLowerCase();
      const active = players.filter((p: any) => !isDepartedPlayer(p));
      if (dob) {
        const byDob = active.filter(
          (p: any) => String(p.dob || "").trim() === dob,
        );
        if (byDob.length === 1) return byDob[0];
        if (byDob.length > 1 && full) {
          const hit = byDob.find((p: any) => norm(p.name) === full);
          if (hit) return hit;
        }
        return null; // DOB present but ambiguous/unmatched → manual
      }
      // No DOB: only auto-apply on a unique name match.
      const byName = active.filter((p: any) => norm(p.name) === full);
      return byName.length === 1 ? byName[0] : null;
    };

    const now = new Date().toISOString();
    // playerId → the submissions that matched it (usually one).
    const appliesByPlayer = new Map<string, any[]>();
    const appliedSubIds = new Map<string, string>(); // subId → playerId
    for (const sub of pending) {
      const player = matchPlayer(sub);
      if (!player) continue;
      appliesByPlayer.set(player.id, [
        ...(appliesByPlayer.get(player.id) || []),
        sub,
      ]);
      appliedSubIds.set(sub.id, player.id);
    }
    if (appliedSubIds.size === 0) return 0;

    updateTeamArrays({
      op: "mapEntries",
      key: "players",
      map: (items: Player[]) =>
        items.map((p) => {
          const mySubs = appliesByPlayer.get(p.id);
          if (!mySubs) return p;
          let next = p;
          for (const sub of mySubs) {
            next = mergeAvailabilityIntoPlayer(
              next,
              submissionDates(sub),
              submissionBlocks(sub),
              sub.submittedAt || now,
            );
          }
          return next;
        }),
    });
    // Stamp every applied submission in ONE batch of full-entry set()s (the
    // assignTryoutNumbers pattern — batches queue offline, transactions
    // don't). Each set doubles as that entry's lazy migration.
    const batch = writeBatch(db);
    for (const sub of pending) {
      const playerId = appliedSubIds.get(sub.id);
      if (!playerId) continue;
      batch.set(
        signupDocRef(db, appId, teamId, "availabilitySubmissions", sub.id),
        scrubUndefined({
          ...sub,
          appliedToPlayerId: playerId,
          appliedAt: now,
        }) as DocumentData,
      );
    }
    batch.commit().catch(signupWriteFailed);
    return appliedSubIds.size;
  }, [db, appId, teamId, teamDataRef, updateTeamArrays, signupWriteFailed]);

  // Tryout grades live in date-grouped tryoutSessions, separate from the
  // roster evaluationEvents collection. Each date has one session; each
  // evaluator owns a grades map keyed by signup id inside that session.
  // The upsert runs inside a mapEntries map against the LATEST sessions —
  // two evaluators grading simultaneously each rewrite only this one array,
  // resolved from fresh state. normalizeTryoutSessions still folds in legacy
  // grades stored on evaluationEvents; those come from the call-time team
  // snapshot (legacy data is static, so a snapshot read is safe).
  const saveTryoutEvaluation = useCallback(
    (signupId: any, grades: any, coachRole: any, rawDate?: any) => {
      if (!user || !signupId) return;
      const teamData = teamDataRef.current;
      const uid = user.uid;
      const signup = (teamData.tryoutSignups || []).find(
        (s: any) => s.id === signupId,
      );
      const date = String(
        rawDate || signup?.tryoutDate || new Date().toISOString().slice(0, 10),
      );
      const sessionId = `tryout-${date.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const legacyAux = {
        evaluationEvents: teamData.evaluationEvents,
        tryoutSignups: teamData.tryoutSignups,
      };
      const now = Date.now();
      updateTeamArrays({
        op: "mapEntries",
        key: "tryoutSessions",
        map: (items: TryoutSession[]) => {
          const sessions = normalizeTryoutSessions({
            ...legacyAux,
            tryoutSessions: items,
          });
          const existing = sessions.find((s: any) => s.id === sessionId);
          const session = existing || {
            id: sessionId,
            date,
            label: `Tryout · ${date}`,
            createdAt: now,
            signupIds: [],
            gradesByEvaluator: {},
          };
          const evaluator = session.gradesByEvaluator?.[uid] || {
            coachRole: coachRole || "Assistant",
            evaluatorId: uid,
            grades: {},
          };
          const nextSession = {
            ...session,
            updatedAt: now,
            signupIds: Array.from(
              new Set([...(session.signupIds || []), signupId]),
            ),
            gradesByEvaluator: {
              ...(session.gradesByEvaluator || {}),
              [uid]: {
                ...evaluator,
                coachRole: coachRole || evaluator.coachRole || "Assistant",
                evaluatorId: uid,
                // Denormalized so the shared coach-evals panel can show WHO
                // recorded each read without an auth roundtrip.
                evaluatorName: coachLastNameOf(user),
                updatedAt: now,
                grades: {
                  ...(evaluator.grades || {}),
                  [signupId]: { ...grades },
                },
              },
            },
          };
          return existing
            ? sessions.map((s: any) => (s.id === sessionId ? nextSession : s))
            : [...sessions, nextSession];
        },
      });
    },
    [user, teamDataRef, updateTeamArrays],
  );

  const saveTryoutEvaluations = useCallback(
    (entries: any[], coachRole: any) => {
      if (!user) return;
      const teamData = teamDataRef.current;
      const uid = user.uid;
      const legacyAux = {
        evaluationEvents: teamData.evaluationEvents,
        tryoutSignups: teamData.tryoutSignups,
      };
      // Resolve each entry's session date from the snapshot signup list —
      // input mapping, not state derivation.
      const resolved = (entries || [])
        .filter((entry: any) => entry?.signupId)
        .map((entry: any) => {
          const signup = (teamData.tryoutSignups || []).find(
            (s: any) => s.id === entry.signupId,
          );
          const date = String(
            entry.date ||
              signup?.tryoutDate ||
              new Date().toISOString().slice(0, 10),
          );
          return { ...entry, date };
        });
      if (resolved.length === 0) return;
      const now = Date.now();
      updateTeamArrays({
        op: "mapEntries",
        key: "tryoutSessions",
        map: (items: TryoutSession[]) => {
          const sessions = normalizeTryoutSessions({
            ...legacyAux,
            tryoutSessions: items,
          });
          const byId = new Map(
            sessions.map((session: any) => [session.id, session]),
          );
          for (const entry of resolved) {
            const sessionId = `tryout-${entry.date.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const session: any = byId.get(sessionId) || {
              id: sessionId,
              date: entry.date,
              label: `Tryout · ${entry.date}`,
              createdAt: now,
              signupIds: [],
              gradesByEvaluator: {},
            };
            const evaluator = session.gradesByEvaluator?.[uid] || {
              coachRole: coachRole || "Assistant",
              evaluatorId: uid,
              grades: {},
            };
            byId.set(sessionId, {
              ...session,
              updatedAt: now,
              signupIds: Array.from(
                new Set([...(session.signupIds || []), entry.signupId]),
              ),
              gradesByEvaluator: {
                ...(session.gradesByEvaluator || {}),
                [uid]: {
                  ...evaluator,
                  coachRole: coachRole || evaluator.coachRole || "Assistant",
                  evaluatorId: uid,
                  evaluatorName: coachLastNameOf(user),
                  updatedAt: now,
                  grades: {
                    ...(evaluator.grades || {}),
                    [entry.signupId]: { ...(entry.grades || {}) },
                  },
                },
              },
            });
          }
          return [...byId.values()];
        },
      });
    },
    [user, teamDataRef, updateTeamArrays],
  );

  // Accept-offer flow. Tryout accepts are oriented to the NEXT season by
  // default: the signup is flagged "accepted" and stays in the Tryouts tab,
  // then advanceSeason promotes it onto the new roster automatically (it's
  // pre-checked in the Advance Season modal). The coach can override with
  // target="current" to pull a kid straight onto the CURRENT roster now.
  const acceptTryout = useCallback(
    (id: any, target: "next" | "current" = "next") => {
      if (!teamId) return;
      const signup = (teamDataRef.current.tryoutSignups || []).find(
        (s: any) => s.id === id,
      );
      if (!signup) return;
      const name = `${signup.firstName || ""} ${signup.lastName || ""}`.trim();

      if (target === "current") {
        // Override: this kid plays THIS season. They become a normal active
        // player (and ride into next season as a returner), so their tryout
        // signup is consumed — they're a roster player, not a tryout anymore.
        const player = {
          id: genId("p"),
          name,
          number: signup.tryoutNumber || signup.number || "",
          dob: signup.dob || "",
          bats: signup.bats || "R",
          throws: signup.throws || "R",
          comfortablePositions: [
            ...(Array.isArray(signup.comfortablePositions)
              ? signup.comfortablePositions
              : []
            ).filter((p: any) => p !== "C"),
            ...(signup.isCatcher === true ? ["C"] : []),
          ],
          parentName: signup.parentName || "",
          email: signup.email || "",
          phone: signup.phone || "",
          present: true,
          playerStatus: "returning" as const,
          stats: blankStats(),
          pitching: { recentPitches: 0, lastPitchDate: null },
          tryoutSignupId: signup.id,
        };
        // The players append stays on the team-doc array lane (players haven't
        // migrated); consuming the signup is a subcollection delete plus, when
        // a legacy twin exists, an exact-entry arrayRemove on the team doc.
        // Separate writes that only a server-side batch could make atomic —
        // the append is issued FIRST so the bad interleaving is a duplicate
        // (signup lingers next to the new player; coach deletes it by hand)
        // rather than a vanished kid. The window shrinks; it does not close
        // (same caveat as the advanceSeason eval reset in useTeamLifecycle).
        //
        // The legacy remove no longer rides the append's team-doc write. It
        // can't: updateTeamArrays would resolve the arrayRemove value from the
        // assembled union, and this signup has almost certainly been edited in
        // its subdoc (that's what "accepted" means here), so the remove would
        // match nothing — leaving the kid on the roster AND still in Tryouts,
        // the exact outcome this cleanup exists to prevent.
        updateTeamArrays({ op: "append", key: "players", entries: [player] });
        deleteSignupDoc(db, appId, teamId, "tryoutSignups", id).catch(
          signupWriteFailed,
        );
        removeLegacySignupEntries(
          db,
          appId,
          teamId,
          "tryoutSignups",
          findLegacySignupEntries(rawTryoutSignupsRef.current, [id]),
        ).catch(signupWriteFailed);
        toast.push({
          kind: "success",
          title: `${name} added to current roster`,
        });
        return;
      }

      // Default: accept for NEXT season. Keep them in the Tryouts tab marked
      // "accepted" (full-entry upsert of their own doc); advanceSeason brings
      // them onto the roster.
      upsertSignupDoc(db, appId, teamId, "tryoutSignups", {
        ...signup,
        status: "accepted" as const,
      }).catch(signupWriteFailed);
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Joins the roster automatically when you Advance Season.",
      });
    },
    [
      db,
      appId,
      teamId,
      teamDataRef,
      rawTryoutSignupsRef,
      updateTeamArrays,
      toast,
      signupWriteFailed,
    ],
  );

  return {
    generateTryoutShareId,
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    appendTryoutSignup,
    updateTryoutSignup,
    assignTryoutNumbers,
    saveTryoutMeasurements,
    deleteTryoutSignup,
    deleteTryoutSignups,
    deleteInterestSignup,
    convertInterestToTryout,
    deletePlayerInfoSubmission,
    applyPlayerInfoToPlayer,
    deleteAvailabilitySubmission,
    applyAvailabilityToPlayer,
    autoApplyAvailability,
    saveTryoutEvaluation,
    saveTryoutEvaluations,
    acceptTryout,
  };
};
