import { useCallback } from "react";
import {
  blankStats,
  normalizeTryoutSessions,
  isDepartedPlayer,
  randomCode,
  genId,
} from "../utils/helpers";
import { applyMissingTryoutNumbers } from "../utils/tryouts";

// Lowercase base36 — matches the look of the previous Math.random().toString(36)
// share tokens, but every character is now uniformly drawn from a CSPRNG and the
// length is exact (the old slice(2, N) could occasionally come up short).
const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
import type {
  Player,
  PlayerInfoSubmission,
  ToastContextValue,
  TryoutSession,
  TryoutSignup,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Tryout + interest-signup flows extracted from App.tsx's TeamProvider.
// Share-link generation, open/close state, signup/lead CRUD, tryout
// evaluations, and accept-to-roster. Array mutations go through the injected
// updateTeamArrays — the anonymous portals append signups/submissions
// concurrently via their own rules lanes, so a coach-side whole-array write
// here would erase any parent submission that landed after the coach's
// snapshot. Scalar/config writes (share links, open/close, roster cap) stay
// on updateTeam. No engine or UI-bridge coupling.
interface UseTryoutFlowsArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  user: { uid: string } | null | undefined;
  activeTeamId: string | null;
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
  teamData,
  updateTeam,
  updateTeamArrays,
  toast,
  user,
  activeTeamId,
}: UseTryoutFlowsArgs) => {
  const generateTryoutShareId = useCallback(() => {
    const id = randomCode(12, SLUG_ALPHABET);
    updateTeam({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" });
    return id;
  }, [updateTeam]);

  const generateTryoutDateLink = useCallback(
    (rawDate: any) => {
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
    [activeTeamId, teamData.tryoutDates, teamData.tryoutDateLinks, updateTeam],
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
      const id = signup.id || genId("ts");
      const entry = {
        id,
        submittedAt: signup.submittedAt || new Date().toISOString(),
        status: signup.status || "tryout",
        ...signup,
      };
      updateTeamArrays({
        op: "append",
        key: "tryoutSignups",
        entries: [entry],
      });
      return entry;
    },
    [updateTeamArrays],
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "tryoutSignups",
        map: (items: TryoutSignup[]) =>
          items.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [updateTeamArrays],
  );

  // One-tap "everyone gets a number": fill a tryout number for every signup
  // that lacks one, per tryout-date pool, in submission order. The assignment
  // runs INSIDE the map over the LATEST signups (resolve-once contract), so a
  // parent registration that landed after the coach's snapshot still gets a
  // number and existing numbers are never reissued.
  const assignTryoutNumbers = useCallback(() => {
    updateTeamArrays({
      op: "mapEntries",
      key: "tryoutSignups",
      map: (items: TryoutSignup[]) => applyMissingTryoutNumbers(items),
    });
  }, [updateTeamArrays]);

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      // removeById → arrayRemove of the exact entry, so a parent signup that
      // landed after this coach's snapshot survives the delete.
      updateTeamArrays({ op: "removeById", key: "tryoutSignups", id });
    },
    [updateTeamArrays],
  );

  // Bulk-remove signups in a SINGLE write. Calling deleteTryoutSignup() in a
  // loop is buggy: each call filters the same closure-captured array and the
  // optimistic merge keeps only the last write — so all-but-one survive. This
  // filters every id out at once. Returns the number actually removed
  // (estimated from the rendered snapshot; the write itself resolves against
  // the latest state).
  const deleteTryoutSignups = useCallback(
    (ids: any[]) => {
      const toRemove = new Set((ids || []).filter(Boolean));
      if (toRemove.size === 0) return 0;
      const current = teamData.tryoutSignups || [];
      const removed = current.filter((s: any) => toRemove.has(s.id)).length;
      if (removed > 0) {
        updateTeamArrays({
          op: "mapEntries",
          key: "tryoutSignups",
          map: (items: TryoutSignup[]) =>
            items.filter((s) => !toRemove.has(s.id)),
        });
      }
      return removed;
    },
    [teamData.tryoutSignups, updateTeamArrays],
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id) return;
      updateTeamArrays({ op: "removeById", key: "interestSignups", id });
    },
    [updateTeamArrays],
  );

  // Promote an interest-survey lead into a real tryout signup. Useful
  // when tryouts open and the HC wants to seed the signup list from
  // standing interest. Copies fields, marks status:"tryout", removes
  // the source lead from interestSignups in the same (atomic) write.
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id) return;
      const lead = (teamData.interestSignups || []).find(
        (s: any) => s.id === id,
      );
      if (!lead) return;
      const signup = {
        id: genId("ts"),
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
      updateTeamArrays([
        { op: "append", key: "tryoutSignups", entries: [signup] },
        { op: "removeById", key: "interestSignups", id },
      ]);
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [teamData.interestSignups, updateTeamArrays, toast],
  );

  // Drop a parent-submitted player-info entry. Coach-only; the two-tap
  // confirm lives in the PlayerInfoTab UI so there's no native prompt here.
  const deletePlayerInfoSubmission = useCallback(
    (id: any) => {
      if (!id) return;
      updateTeamArrays({ op: "removeById", key: "playerInfoSubmissions", id });
    },
    [updateTeamArrays],
  );

  // Apply a parent-submitted player-info entry onto a matching roster player.
  // Writes the sizing + school + emergency-contact fields onto the chosen
  // Player (only fields the parent actually filled in — never blanking
  // existing roster data) and stamps the submission as handled in the same
  // atomic write so the inbox can show it as applied.
  const applyPlayerInfoToPlayer = useCallback(
    (submissionId: any, playerId: any) => {
      if (!submissionId || !playerId) return;
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
      updateTeamArrays([
        {
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
        },
        {
          op: "mapEntries",
          key: "playerInfoSubmissions",
          map: (items: PlayerInfoSubmission[]) =>
            items.map((s) =>
              s.id === submissionId
                ? { ...s, appliedToPlayerId: playerId, appliedAt: now }
                : s,
            ),
        },
      ]);
      toast.push({
        kind: "success",
        title: "Player info applied",
        message:
          `${sub.firstName || ""} ${sub.lastName || ""}`.trim() || player.name,
      });
    },
    [teamData.playerInfoSubmissions, teamData.players, updateTeamArrays, toast],
  );

  // Drop a parent-submitted availability entry. Coach-only; the two-tap confirm
  // lives in the AvailabilityTab UI so there's no native prompt here.
  const deleteAvailabilitySubmission = useCallback(
    (id: any) => {
      if (!id) return;
      updateTeamArrays({
        op: "removeById",
        key: "availabilitySubmissions",
        id,
      });
    },
    [updateTeamArrays],
  );

  // Merge a parent-submitted availability entry onto a roster player: union the
  // submitted dates into player.absences (deduped + sorted), stamp the player's
  // availabilitySubmittedAt (drives the completion tracker), and mark the
  // submission handled — all in one atomic write. Pure union over the LATEST
  // roster record, so re-applying, a parent re-submitting more dates, or a
  // concurrent absence edit is always additive.
  const applyAvailabilityToPlayer = useCallback(
    (submissionId: any, playerId: any, opts?: { silent?: boolean }) => {
      if (!submissionId || !playerId) return;
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
      updateTeamArrays([
        {
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
        },
        {
          op: "mapEntries",
          key: "availabilitySubmissions",
          map: (items) =>
            items.map((s) =>
              s.id === submissionId
                ? { ...s, appliedToPlayerId: playerId, appliedAt: now }
                : s,
            ),
        },
      ]);
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
    [
      teamData.availabilitySubmissions,
      teamData.players,
      updateTeamArrays,
      toast,
    ],
  );

  // Auto-apply every un-applied availability submission whose name + DOB
  // uniquely identify one non-departed roster player. Ambiguous or unmatched
  // submissions are left for the coach to match by hand. Runs on the coach
  // client (only members can write players) — typically when the Availability
  // tab mounts. Matching runs on the rendered snapshot; the merges run over
  // the LATEST arrays in one atomic write. Returns the number applied.
  const autoApplyAvailability = useCallback(() => {
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

    updateTeamArrays([
      {
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
      },
      {
        op: "mapEntries",
        key: "availabilitySubmissions",
        map: (items) =>
          items.map((s) =>
            appliedSubIds.has(s.id)
              ? {
                  ...s,
                  appliedToPlayerId: appliedSubIds.get(s.id),
                  appliedAt: now,
                }
              : s,
          ),
      },
    ]);
    return appliedSubIds.size;
  }, [teamData.availabilitySubmissions, teamData.players, updateTeamArrays]);

  // Tryout grades live in date-grouped tryoutSessions, separate from the
  // roster evaluationEvents collection. Each date has one session; each
  // evaluator owns a grades map keyed by signup id inside that session.
  // The upsert runs inside a mapEntries map against the LATEST sessions —
  // two evaluators grading simultaneously each rewrite only this one array,
  // resolved from fresh state. normalizeTryoutSessions still folds in legacy
  // grades stored on evaluationEvents; those come from the rendered snapshot
  // (legacy data is static, so a snapshot read is safe).
  const saveTryoutEvaluation = useCallback(
    (signupId: any, grades: any, coachRole: any, rawDate?: any) => {
      if (!user || !signupId) return;
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
    [user, teamData, updateTeamArrays],
  );

  const saveTryoutEvaluations = useCallback(
    (entries: any[], coachRole: any) => {
      if (!user) return;
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
    [user, teamData, updateTeamArrays],
  );

  // Accept-offer flow. Tryout accepts are oriented to the NEXT season by
  // default: the signup is flagged "accepted" and stays in the Tryouts tab,
  // then advanceSeason promotes it onto the new roster automatically (it's
  // pre-checked in the Advance Season modal). The coach can override with
  // target="current" to pull a kid straight onto the CURRENT roster now.
  const acceptTryout = useCallback(
    (id: any, target: "next" | "current" = "next") => {
      const signup = (teamData.tryoutSignups || []).find(
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
        updateTeamArrays([
          { op: "removeById", key: "tryoutSignups", id },
          { op: "append", key: "players", entries: [player] },
        ]);
        toast.push({
          kind: "success",
          title: `${name} added to current roster`,
        });
        return;
      }

      // Default: accept for NEXT season. Keep them in the Tryouts tab marked
      // "accepted"; advanceSeason brings them onto the roster.
      updateTeamArrays({
        op: "mapEntries",
        key: "tryoutSignups",
        map: (items: TryoutSignup[]) =>
          items.map((s) =>
            s.id === id ? { ...s, status: "accepted" as const } : s,
          ),
      });
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Joins the roster automatically when you Advance Season.",
      });
    },
    [teamData.tryoutSignups, updateTeamArrays, toast],
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
