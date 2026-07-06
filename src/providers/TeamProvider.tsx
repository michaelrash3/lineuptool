import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  signInWithCustomToken,
  type User,
  onAuthStateChanged,
  getRedirectResult,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField,
  DocumentSnapshot,
  FirestoreError,
} from "firebase/firestore";
import { auth, db, appId } from "../firebase";
import { TeamContext, useToast, useConfirm } from "../contexts";
import { errCode, errMessage, authDiag } from "../utils/diagnostics";
import {
  clearRedirectPending,
  isRedirectLikelyStuck,
} from "../auth/googleRedirect";
import { downscaleImageToDataURL } from "../components/shared";
import { buildEvalReminderDraft, buildMailtoUrl } from "../utils/reminderDraft";
import {
  EVAL_ROUNDS_SUBCOLLECTION,
  EVAL_ROUNDS_DUAL_WRITE,
} from "../constants/flags";
import {
  buildEvalRoundsQuery,
  assembleEvalRounds,
  backfillOwnEvalRounds,
} from "../utils/evalRounds";
import {
  slimGame,
  scrubUndefined,
  blankStats,
  emailPromptStatus,
  restampEvalDueDates,
  migrateLegacyTryoutGrades,
  buildPreseasonSeedRound,
  dateToIsoLocal,
  isReturning,
  countsTowardStats,
  buildPublicMirror,
  revertOptimisticUpdate,
  estimateDocSizeBytes,
  mergeTeamEntries,
  blockedRosterWipeReason,
  financeSummary,
  formatCurrency,
  rollFinancesForNewSeason,
  shouldRollFinances,
  dedupePlayerInfoSubmissions,
  genId,
  FIRESTORE_DOC_LIMIT_BYTES,
  DOC_SIZE_WARN_RATIO,
} from "../utils/helpers";
import {
  DEFAULT_TEAM_DATA,
  EVAL_SCHEMA_VERSION,
  isKidPitchFormat,
  bumpAgeTier,
  computeNextSeason,
} from "../constants/ui";
import {
  applyFinanceUpdate,
  buildFinancePayload,
  withFinanceKeyDeletes,
  type FinanceUpdate,
} from "../utils/financeUpdates";
import {
  applyTeamArrayUpdate,
  buildTeamArrayPayload,
  resolveTeamArrayUpdate,
  type TeamArrayUpdate,
} from "../utils/teamArrayUpdates";
import { useTeamMembership } from "../hooks/useTeamMembership";
import { useInviteFlows } from "../hooks/useInviteFlows";
import { useImportExportFlows } from "../hooks/useImportExportFlows";
import { useGameCrud } from "../hooks/useGameCrud";
import { usePracticeCrud } from "../hooks/usePracticeCrud";
import { usePlayerCrud } from "../hooks/usePlayerCrud";
import { usePastSeasonCrud } from "../hooks/usePastSeasonCrud";
import { useTryoutFlows } from "../hooks/useTryoutFlows";
import { useEvaluationCrud } from "../hooks/useEvaluationCrud";
import { useLineupActions } from "../hooks/useLineupActions";
import type {
  Team,
  Game,
  Inning,
  SlimPlayer,
  EvaluationEvent,
  Player,
  TryoutSignup,
  TryoutSession,
} from "../types";

// TeamProvider extracted from App.tsx: owns team state, Firebase auth +
// Firestore subscriptions, and the CRUD/action surface exposed via
// TeamContext. Behavior is unchanged from its in-App.tsx definition.

export const TeamProvider = ({ children }: { children: React.ReactNode }) => {
  const toast = useToast();
  const { confirm, promptText } = useConfirm();

  // Auth + team-list state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [teamData, setTeamData] = useState<any>(DEFAULT_TEAM_DATA);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingActive, setLoadingActive] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [genError, setGenError] = useState(""); // login screen only

  const previousLineupRef = useRef<{
    lineup: Inning[] | null;
    battingLineup: SlimPlayer[] | null;
  } | null>(null);
  // Bridge to UIProvider: lineup/eval screens publish their in-progress inputs
  // and receive generated results through this ref. Owned here (TeamProvider)
  // and passed to the lineup/eval action hooks + exposed on the context value.
  const uiBridge = useRef<any>({
    getInputs: () => null,
    applyResult: () => {},
  });
  const persistTeamRef = useRef<
    | ((
        updates: Partial<Team>,
        opts?: { silent?: boolean; allowEmptyPlayers?: boolean },
      ) => Promise<boolean>)
    | null
  >(null);
  // Latest team data, readable from persistTeam without widening its deps —
  // used only to estimate the doc size for the storage-headroom guard.
  const teamDataRef = useRef<any>(teamData);
  teamDataRef.current = teamData;
  // One-shot guard so the "approaching storage limit" warning fires once per
  // session instead of on every save once the doc is large.
  const docSizeWarnedRef = useRef(false);
  // Last Firestore write error from persistTeam, stashed so the optimistic
  // updateTeam path can surface the real code/message in its toast instead of
  // a generic "check your connection" line that hides whether the write was
  // rejected by rules (permission-denied), the size cap (resource-exhausted /
  // invalid-argument), or a real network drop (unavailable).
  const lastPersistErrorRef = useRef<{ code: string; message: string } | null>(
    null,
  );
  // The team id whose data is actually loaded into teamData. Stays null while
  // the app shows the DEFAULT_TEAM_DATA placeholder (before any team loads) and
  // during the brief window where activeTeamId is set but the team doc snapshot
  // hasn't arrived yet. Effects that WRITE derived corrections (defenseSize
  // auto-correct) gate on this so they never fire against placeholder data —
  // which previously produced phantom "save failed" toasts (no activeTeamId yet)
  // and risked writing default values onto a real team mid-load.
  const loadedTeamIdRef = useRef<string | null>(null);
  // JSON of the last public-mirror projection we wrote, so we only re-upsert
  // the sanitized teamPublic doc when a mirrored field actually changes.
  const lastMirrorRef = useRef<string>("");
  // One-shot guard so the "public page may be stale" warning fires once per
  // failure streak rather than on every team change while the mirror is down.
  const mirrorWarnedRef = useRef(false);
  // True when the most recent mirror write failed (public tryout page stale).
  const [mirrorStale, setMirrorStale] = useState(false);
  // Per-session set of team ids we've already attempted to auto-claim.
  // Prevents the legacy-owner migration effect from re-firing every time
  // Firestore emits a fresh snapshot before ownerId is reflected back.
  const migrationAttemptedRef = useRef(new Set());
  const bootstrapAttemptedRef = useRef(false);
  // Per-session set of uids we've already run the orphaned-team recovery
  // query for, so an empty team list doesn't re-fire it on every snapshot.
  const teamsRecoveryAttemptedRef = useRef<Set<string>>(new Set());
  // True when the team-list subscription errored out (not "user has no
  // teams"). Gates the WelcomeChooser: forcing a coach with a real team
  // through the create/join "orientation" because a READ failed is exactly
  // the path that used to orphan their data.
  const [teamsLoadFailed, setTeamsLoadFailed] = useState(false);

  const bootstrapDefaultTeam = useCallback(async () => {
    if (!user) return null;
    if (bootstrapAttemptedRef.current) return null;
    bootstrapAttemptedRef.current = true;
    const settingsRef = doc(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "settings",
      "teams",
    );
    try {
      // Never trust the local `teams` state here: if the settings doc already
      // lists teams (stale/raced snapshot), adopt them instead of creating a
      // parallel default team — and never overwrite that list.
      const existingSnap = await getDoc(settingsRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;
      const existingTeams = Array.isArray(existingData?.teams)
        ? existingData.teams
        : [];
      if (existingTeams.length > 0) {
        setTeams(existingTeams);
        setActiveTeamId(existingData?.activeTeamId || existingTeams[0].id);
        return existingTeams[0].id;
      }
      const id = genId("team");
      const teamRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        id,
      );
      await setDoc(teamRef, {
        ...DEFAULT_TEAM_DATA,
        name: "My Team",
        ownerId: user.uid,
        members: [user.uid],
      });
      const merged = mergeTeamEntries(existingTeams, teams, [
        { id, name: "My Team" },
      ]);
      await setDoc(
        settingsRef,
        { teams: merged, activeTeamId: id },
        { merge: true },
      );
      setTeams(merged);
      setActiveTeamId(id);
      return id;
    } catch {
      bootstrapAttemptedRef.current = false;
      toast.push({
        kind: "error",
        title: "Setup failed",
        message: "We couldn't create your default team yet. Please try again.",
      });
      return null;
    }
  }, [user, teams, toast]);

  // Auth subscription
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenFromHost =
          (typeof window !== "undefined" &&
            (window as Window & { __initial_auth_token?: string })
              .__initial_auth_token) ||
          null;
        if (tokenFromHost) {
          await signInWithCustomToken(auth, tokenFromHost);
        }
      } catch (e) {
        console.warn("Custom token sign-in failed", e);
      }
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (cancelled) return;
        if (u) {
          setUser(u);
          setAuthReady(true);
        } else {
          setUser(null);
          setAuthReady(true);
        }
      });
      return () => unsub();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load user's team list
  useEffect(() => {
    if (!authReady || !user) {
      // No user yet: nothing to load. Mark teams loading as done so the
      // spinner resolves and the login screen can render.
      setLoadingTeams(false);
      return;
    }
    const ref = doc(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "settings",
      "teams",
    );
    let unsub = () => {};
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let permissionRetried = false;

    const handleSnap = async (snap: DocumentSnapshot) => {
      if (cancelled) return;
      setTeamsLoadFailed(false);
      let data = snap.exists() ? snap.data() : null;
      if (!data || !data.teams || data.teams.length === 0) {
        // No teams yet for this user. The MainShell renders <WelcomeChooser>
        // off the empty `teams` list so the coach explicitly picks Join vs
        // Create. We no longer force-create "My Team" here — that produced a
        // throwaway team for anyone whose actual intent was to join via the
        // 6-char code. The ?join= redemption flow still goes through
        // bootstrapDefaultTeam() as a fallback when its lookup fails (see the
        // join effect below).
        //
        // SAFETY NET: an empty list can also mean the settings doc was
        // clobbered (the "all my players were deleted" report) or a fresh
        // device raced the doc. Before funneling the coach into the
        // WelcomeChooser, look for team docs that already list this user as
        // a member and restore the pointers — the team doc itself survives a
        // settings clobber, so this recovers the roster in place.
        if (!teamsRecoveryAttemptedRef.current.has(user.uid)) {
          teamsRecoveryAttemptedRef.current.add(user.uid);
          try {
            const teamsQuery = query(
              collection(db, "artifacts", appId, "public", "data", "teams"),
              where("members", "array-contains", user.uid),
            );
            const found = await getDocs(teamsQuery);
            const recovered = found.docs.map((d) => ({
              id: d.id,
              name: String(d.data()?.name || "") || "My Team",
            }));
            if (cancelled) return;
            if (recovered.length > 0) {
              await setDoc(
                ref,
                { teams: recovered, activeTeamId: recovered[0].id },
                { merge: true },
              );
              setTeams(recovered);
              setActiveTeamId(recovered[0].id);
              setLoadingTeams(false);
              toast.push({
                kind: "success",
                title: "Team restored",
                message:
                  "We re-linked a team you belong to that had dropped off this account's list.",
              });
              return;
            }
          } catch {
            // Query denied or offline — fall through to the chooser. Its
            // create/join flows merge with the server list instead of
            // overwriting it, so an existing team can no longer be orphaned.
          }
        }
        if (cancelled) return;
        setTeams([]);
        setActiveTeamId(null);
        setLoadingTeams(false);
        return;
      }
      bootstrapAttemptedRef.current = false;
      setTeams(data.teams);
      if (data.activeTeamId) setActiveTeamId(data.activeTeamId);
      else if (data.teams[0]) setActiveTeamId(data.teams[0].id);
      setLoadingTeams(false);
    };

    // A fresh sign-in can race rules propagation and get a transient
    // permission-denied. Retry once before surfacing — and either way mark
    // the load as FAILED rather than "no teams", so the WelcomeChooser never
    // walks a coach with a real team through team creation off a read error.
    const handleErr = (err: FirestoreError) => {
      if (cancelled) return;
      if (err?.code === "permission-denied" && !permissionRetried) {
        permissionRetried = true;
        unsub();
        retryTimeout = setTimeout(() => {
          if (!cancelled) subscribe();
        }, 1500);
        return;
      }
      setTeamsLoadFailed(true);
      toast.push({
        kind: "error",
        title: "Connection error",
        message: err.message,
      });
      setLoadingTeams(false);
    };

    const subscribe = () => {
      unsub = onSnapshot(ref, handleSnap, handleErr);
    };
    subscribe();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      unsub();
    };
  }, [authReady, user, toast]);

  // Subscribe to active team document
  useEffect(() => {
    if (!activeTeamId) {
      // When auth changes (or a user has no teams yet), there is no active
      // team doc to subscribe to. Ensure the global loading gate is cleared
      // so the login screen/app shell can render instead of spinning forever.
      setLoadingActive(false);
      return;
    }
    setLoadingActive(true);
    const ref = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "teams",
      activeTeamId,
    );
    let unsub = () => {};
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let permissionRetried = false;

    const handleSnap = (snap: DocumentSnapshot) => {
      if (cancelled) return;
      if (snap.exists()) {
        const raw = snap.data();
        // Eval schema migration:
        //   v1 (6-category) rounds get wiped — no straightforward mapping.
        //   v2 (1–10 11-category) rounds convert to v3 (1–5) by halving
        //   every numeric grade so prior trend history survives the scale
        //   change.
        const stored = raw.evalSchemaVersion ?? 1;
        if (stored < EVAL_SCHEMA_VERSION) {
          let migratedEvents = raw.evaluationEvents || [];
          if (stored >= 2 && stored < 3) {
            migratedEvents = migratedEvents.map((ev: EvaluationEvent) => {
              if (!ev?.grades) return ev;
              const nextGrades: Record<string, unknown> = {};
              for (const [pid, grade] of Object.entries(ev.grades)) {
                if (!grade || typeof grade !== "object") {
                  nextGrades[pid] = grade;
                  continue;
                }
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(grade)) {
                  if (typeof v === "number" && Number.isFinite(v)) {
                    out[k] = Math.max(1, Math.min(5, Math.round(v / 2)));
                  } else {
                    out[k] = v; // notes + any non-numeric fields untouched
                  }
                }
                nextGrades[pid] = out;
              }
              return { ...ev, grades: nextGrades };
            });
          }
          // v3 → v4: flip the position model from negative (restrictions)
          // to positive (comfortablePositions) + dedicated isCatcher flag.
          // The engine still consults `restrictions` as a fallback for
          // one release so this is safe to run incrementally.
          let migratedPlayers = raw.players || [];
          if (stored < 4) {
            const ALL_POS = [
              "P",
              "C",
              "1B",
              "2B",
              "3B",
              "SS",
              "LF",
              "LCF",
              "CF",
              "RCF",
              "RF",
            ];
            migratedPlayers = migratedPlayers.map((p: Player) => {
              if (!p) return p;
              if (
                Array.isArray(p.comfortablePositions) &&
                typeof p.isCatcher === "boolean"
              ) {
                return p; // already migrated (likely a fresh team)
              }
              const restrictions = Array.isArray(p.restrictions)
                ? p.restrictions
                : [];
              const comfortable = ALL_POS.filter(
                (pos) => !restrictions.includes(pos),
              );
              return {
                ...p,
                comfortablePositions: Array.isArray(p.comfortablePositions)
                  ? p.comfortablePositions
                  : comfortable,
                isCatcher:
                  typeof p.isCatcher === "boolean"
                    ? p.isCatcher
                    : !restrictions.includes("C"),
              };
            });
          }
          // v5 — catcher unification. Catcher is now just "C" in
          // comfortablePositions; the separate isCatcher flag is gone. The
          // v4 auto-fill had set comfortablePositions to every position a
          // kid wasn't *restricted* from — which, for the common case of no
          // restrictions, marked the ENTIRE roster as catcher-eligible. Undo
          // that: a "C" already in the list came from that auto-fill (the UI
          // never let a coach add C), so re-derive real catcher status from
          // the legacy primaryPosition; otherwise honor the explicit
          // isCatcher checkbox. Then encode the result as "C" in the list.
          if (stored < 5) {
            migratedPlayers = migratedPlayers.map((p: Player) => {
              if (!p) return p;
              const comfort = Array.isArray(p.comfortablePositions)
                ? p.comfortablePositions
                : [];
              const isCatcher = comfort.includes("C")
                ? p.primaryPosition === "C"
                : p.isCatcher === true;
              const next = comfort.filter((pos: string) => pos !== "C");
              if (isCatcher) next.push("C");
              const { isCatcher: _dropped, ...rest } = p;
              return { ...rest, comfortablePositions: next };
            });
          }
          // v6 — re-stamp existing roster eval rounds onto the calendar due
          // date they satisfy, matching how new saves are now dated. Tryout
          // grades are left alone; same-round duplicates collapse to the
          // freshest. Idempotent, so it's safe even if a doc lands here twice.
          if (stored < 6) {
            migratedEvents = restampEvalDueDates(migratedEvents);
          }
          // v7 — leaner eval categories. Remap each player's grades from the
          // old fine-grained ids to the merged set: Plate Discipline folds
          // into Approach, Glove+Range → Fielding, Arm Str+Acc → Arm,
          // Baserunning → Speed & Baserunning, Control+Command → Strikes,
          // Pop Time → Throwing. Merged pairs average their two old scores so
          // prior history carries over; notes/non-numeric fields are kept.
          if (stored < 7) {
            const avgGrade = (a: unknown, b: unknown): number | undefined => {
              const nums = [a, b].filter(
                (x): x is number => typeof x === "number" && Number.isFinite(x),
              );
              if (nums.length === 0) return undefined;
              return Math.max(
                1,
                Math.min(
                  5,
                  Math.round(nums.reduce((s, x) => s + x, 0) / nums.length),
                ),
              );
            };
            const carry = [
              "contact",
              "power",
              "baseballIQ",
              "coachability",
              "velocity",
              "offSpeed",
              "composure",
              "receiving",
              "blocking",
              "gameCalling",
              // already-merged ids (idempotent if a round was partly migrated)
              "approach",
              "fielding",
              "arm",
              "strikes",
              "speedBaserunning",
              "throwing",
            ];
            migratedEvents = migratedEvents.map((ev: EvaluationEvent) => {
              if (!ev?.grades) return ev;
              const nextGrades: Record<string, unknown> = {};
              for (const [pid, grade] of Object.entries(ev.grades)) {
                if (!grade || typeof grade !== "object") {
                  nextGrades[pid] = grade;
                  continue;
                }
                const g = grade as Record<string, unknown>;
                const out: Record<string, unknown> = {};
                for (const k of carry) {
                  if (typeof g[k] === "number") out[k] = g[k];
                }
                const approach = avgGrade(g.approach, g.plateDiscipline);
                if (approach !== undefined) out.approach = approach;
                const fielding = avgGrade(g.glove, g.range);
                if (fielding !== undefined) out.fielding = fielding;
                const arm = avgGrade(g.armStrength, g.armAccuracy);
                if (arm !== undefined) out.arm = arm;
                const strikes = avgGrade(g.control, g.command);
                if (strikes !== undefined) out.strikes = strikes;
                if (typeof g.baserunning === "number")
                  out.speedBaserunning = g.baserunning;
                if (typeof g.popTime === "number") out.throwing = g.popTime;
                // Preserve notes and any non-numeric fields.
                for (const [k, v] of Object.entries(g)) {
                  if (typeof v !== "number") out[k] = v;
                }
                nextGrades[pid] = out;
              }
              return { ...ev, grades: nextGrades };
            });
          }
          // v8 — split the merged "Speed & Baserunning" grade back into
          // separate Speed + Base Running. The old value seeds BOTH so prior
          // history carries over; the merged key is dropped. Idempotent.
          if (stored < 8) {
            migratedEvents = migratedEvents.map((ev: EvaluationEvent) => {
              if (!ev?.grades) return ev;
              const nextGrades: Record<string, unknown> = {};
              for (const [pid, grade] of Object.entries(ev.grades)) {
                if (!grade || typeof grade !== "object") {
                  nextGrades[pid] = grade;
                  continue;
                }
                const { speedBaserunning, ...rest } = grade as Record<
                  string,
                  unknown
                >;
                const out: Record<string, unknown> = { ...rest };
                if (typeof speedBaserunning === "number") {
                  if (typeof out.speed !== "number")
                    out.speed = speedBaserunning;
                  if (typeof out.baserunning !== "number")
                    out.baserunning = speedBaserunning;
                }
                nextGrades[pid] = out;
              }
              return { ...ev, grades: nextGrades };
            });
          }
          // v9 — stats-graded tangibles. Coaches now grade only the
          // intangibles; every tangible skill is derived from imported
          // stats (see the stat-grade helpers in lineupEngine). Strip the
          // dropped grade keys from saved rounds so they stop feeding
          // combined grades; notes and any non-numeric fields are kept.
          if (stored < 9) {
            const KEPT_V9 = new Set([
              "approach",
              "speed",
              "baserunning",
              "baseballIQ",
              "coachability",
              "composure",
              // Coach-graded catching skills (Game Calling was dropped in
              // favor of these tangible, young-age-appropriate skills).
              "blocking",
              "receiving",
              // Optional coach-entered radar reading (mph), not a 1–5 grade.
              "pitchVelo",
            ]);
            migratedEvents = migratedEvents.map((ev: EvaluationEvent) => {
              if (!ev?.grades) return ev;
              const nextGrades: Record<string, unknown> = {};
              for (const [pid, grade] of Object.entries(ev.grades)) {
                if (!grade || typeof grade !== "object") {
                  nextGrades[pid] = grade;
                  continue;
                }
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(grade)) {
                  if (typeof v !== "number" || KEPT_V9.has(k)) out[k] = v;
                }
                nextGrades[pid] = out;
              }
              return { ...ev, grades: nextGrades };
            });
          }
          // v10 — retire the "Inactive" roster status. Anyone not Departed
          // becomes active again: clear a stale rosterStatus and flip present
          // back to true so legacy-inactive kids return to lineups, stats, and
          // attendance. Departed players are untouched.
          if (stored < 10) {
            migratedPlayers = migratedPlayers.map((p: Player) => {
              if (!p || p.rosterStatus === "departed") return p;
              const { rosterStatus: _dropped, ...rest } = p;
              return { ...rest, present: true };
            });
          }
          // v11 — legacy tryout-grade cleanup (EVALUATIONS-AUDIT.md finding
          // 3.2). Fold tryout grades stored on evaluationEvents into
          // tryoutSessions once, and drop them from evaluationEvents. Only
          // include tryoutSessions in the write when it actually changed.
          let migratedTryoutSessions: TryoutSession[] | undefined;
          if (stored < 11) {
            const beforeSessions = raw.tryoutSessions;
            const folded = migrateLegacyTryoutGrades({
              ...raw,
              evaluationEvents: migratedEvents,
            });
            migratedEvents = folded.evaluationEvents;
            if (folded.tryoutSessions !== beforeSessions) {
              migratedTryoutSessions = folded.tryoutSessions;
            }
          }
          persistTeamRef.current?.({
            evaluationEvents: migratedEvents,
            players: migratedPlayers,
            ...(migratedTryoutSessions !== undefined
              ? { tryoutSessions: migratedTryoutSessions }
              : {}),
            evalSchemaVersion: EVAL_SCHEMA_VERSION,
          });
          setTeamData({
            ...DEFAULT_TEAM_DATA,
            ...raw,
            // Coerce core collections to arrays: a malformed doc with
            // players/games set to null would otherwise override the
            // DEFAULT_TEAM_DATA [] and crash the many .map/.find call
            // sites downstream.
            games: Array.isArray(raw.games) ? raw.games : [],
            evaluationEvents: migratedEvents,
            players: migratedPlayers,
            evalSchemaVersion: EVAL_SCHEMA_VERSION,
          });
        } else {
          setTeamData({
            ...DEFAULT_TEAM_DATA,
            ...raw,
            players: Array.isArray(raw.players) ? raw.players : [],
            games: Array.isArray(raw.games) ? raw.games : [],
          });
        }
        // Mark which team's data is now loaded so write-effects
        // (auto-correct, photo-strip) and the roster-wipe guard can safely
        // run against real data. Deliberately INSIDE the exists() branch: a
        // missing doc means teamData is still the placeholder, and treating
        // that as "loaded" would let derived writes target a team whose
        // real data never arrived.
        loadedTeamIdRef.current = activeTeamId;
      }
      setLoadingActive(false);
    };

    // Immediately after a join/invite write, the server may still reject
    // our read because the membership change hasn't propagated to the
    // rules engine yet. Swallow the first permission-denied error and
    // re-subscribe after a short delay; only surface a toast if the
    // retry also fails.
    const handleErr = (err: FirestoreError) => {
      if (cancelled) return;
      if (err?.code === "permission-denied" && !permissionRetried) {
        permissionRetried = true;
        unsub();
        retryTimeout = setTimeout(() => {
          if (!cancelled) subscribe();
        }, 1500);
        return;
      }
      toast.push({
        kind: "error",
        title: "Failed to load team",
        message: err.message,
      });
      setLoadingActive(false);
    };

    const subscribe = () => {
      unsub = onSnapshot(ref, handleSnap, handleErr);
    };
    subscribe();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      unsub();
    };
  }, [activeTeamId, toast]);

  // Helper: write a partial update to the active team document. Resolves to
  // `true` on success and `false` on failure so optimistic callers (updateTeam)
  // can roll back. Pass `{ silent: true }` to suppress the built-in failure
  // toast when the caller surfaces its own (e.g. a rollback + retry message).
  const persistTeam = useCallback(
    async (
      updates: Partial<Team>,
      opts?: { silent?: boolean; allowEmptyPlayers?: boolean },
    ): Promise<boolean> => {
      if (!activeTeamId) return false;
      // HARD GUARD against roster wipes: refuse to save an empty players
      // array unless the team's doc has loaded on this device AND its roster
      // is already empty. Placeholder/default state leaking into a write is
      // the "all my players were deleted" class of bug; deliberately
      // destructive flows (Advance Season, backup restore) pass
      // allowEmptyPlayers to opt out.
      if (!opts?.allowEmptyPlayers) {
        const wipeReason = blockedRosterWipeReason(
          updates,
          teamDataRef.current?.players,
          loadedTeamIdRef.current === activeTeamId,
        );
        if (wipeReason) {
          const message = `Refused to save an empty roster because ${wipeReason}.`;
          lastPersistErrorRef.current = {
            code: "roster-wipe-blocked",
            message,
          };
          console.error("[persistTeam] roster wipe blocked:", message);
          if (!opts?.silent) {
            toast.push({ kind: "error", title: "Save blocked", message });
          }
          return false;
        }
      }
      // Slim any games being persisted — strip embedded player objects down
      // to {id, name, number} to stay under the Firestore 1MB document limit.
      let toPersist = updates;
      if (Array.isArray(updates.games)) {
        toPersist = {
          ...updates,
          games: updates.games
            .map(slimGame)
            .filter((g): g is Game => g != null),
        };
      }
      // Player photos were removed from the app — they lived as inline base64 on
      // each player and pushed this single team doc toward the 1 MB cap. Never
      // write photoUrl back, so any leftover bytes are dropped on the next save.
      if (Array.isArray(toPersist.players)) {
        toPersist = {
          ...toPersist,
          players: toPersist.players.map((p) => {
            if (!p || !("photoUrl" in p)) return p;
            const { photoUrl: _dropped, ...rest } = p;
            return rest;
          }),
        };
      }
      // setDoc(..., {merge:true}) DEEP-MERGES nested maps, so finance keys a
      // caller drops by omission (the season roll destructures away
      // nextClubFee / feeExemptIds / sponsorships / ...) would survive
      // server-side and resurrect on the next snapshot. Convert vanished
      // top-level finance keys into explicit deletes; teamDataRef still holds
      // the pre-write committed doc at this point.
      if (toPersist.finances && teamDataRef.current?.finances) {
        const adjusted = withFinanceKeyDeletes(
          teamDataRef.current.finances,
          toPersist.finances,
          deleteField,
        );
        if (adjusted !== toPersist.finances) {
          toPersist = { ...toPersist, finances: adjusted as Team["finances"] };
        }
      }
      // Scrub any undefined values from the tree — Firestore rejects them.
      toPersist = scrubUndefined(toPersist) as Partial<Team>;

      // Storage-headroom guard: the whole team is one Firestore doc (1 MiB cap).
      // Estimate the post-merge size (games slimmed as they will be stored) and
      // warn once when nearing the limit so a coach can archive old seasons
      // before a write silently fails.
      if (!docSizeWarnedRef.current) {
        const prev = teamDataRef.current || {};
        const mergedGames = Array.isArray(toPersist.games)
          ? toPersist.games
          : Array.isArray(prev.games)
            ? prev.games.map(slimGame)
            : [];
        const estimated = estimateDocSizeBytes({
          ...prev,
          ...toPersist,
          games: mergedGames,
        });
        if (estimated > FIRESTORE_DOC_LIMIT_BYTES * DOC_SIZE_WARN_RATIO) {
          docSizeWarnedRef.current = true;
          toast.push({
            kind: "warn",
            title: "Team data is getting large",
            message: `Using ${Math.round(
              estimated / 1024,
            )} KB of the ~1 MB limit. Consider archiving old seasons (Advance Season) to free space.`,
            duration: 0,
          });
        }
      }

      setSyncStatus("Saving");
      try {
        const ref = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          activeTeamId,
        );
        await setDoc(ref, toPersist, { merge: true });
        setSyncStatus("Synced");
        setTimeout(() => setSyncStatus(""), 1500);
        lastPersistErrorRef.current = null;
        return true;
      } catch (e) {
        setSyncStatus("");
        const code = errCode(e);
        const message = errMessage(e);
        lastPersistErrorRef.current = { code, message };
        // Always log the real Firestore error, even on the silent path — the
        // optimistic updateTeam caller replaces it with a generic revert toast.
        console.error("[persistTeam] write failed", code, message);
        if (!opts?.silent) {
          toast.push({
            kind: "error",
            title: "Save failed",
            message: code ? `${code}: ${message}` : message,
          });
        }
        return false;
      }
    },
    [activeTeamId, toast],
  );

  // Expose persistTeam to the onSnapshot above so the eval schema migration
  // can write the cleared evaluationEvents back to Firestore.
  useEffect(() => {
    persistTeamRef.current = persistTeam;
  }, [persistTeam]);

  // Write the sanitized public mirror for the active team. Only a member ever
  // runs this (it's their active team), which satisfies the teamPublic write
  // rule. Reads the freshest team via teamDataRef so the callback stays stable.
  // Returns whether the write succeeded (or was a no-op). `force` bypasses the
  // unchanged-projection guard for a manual resync.
  const writePublicMirror = useCallback(
    async (opts?: { force?: boolean }): Promise<boolean> => {
      const team = teamDataRef.current;
      if (!activeTeamId || !team) return false;
      const mirror = buildPublicMirror(team);
      const key = activeTeamId + ":" + JSON.stringify(mirror);
      if (!opts?.force && key === lastMirrorRef.current) return true;
      const ref = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teamPublic",
        activeTeamId,
      );
      try {
        await setDoc(
          ref,
          { ...mirror, updatedAt: Date.now() },
          { merge: true },
        );
        lastMirrorRef.current = key;
        setMirrorStale(false);
        return true;
      } catch (err) {
        // A failed mirror write shouldn't disrupt the app, but the coach's
        // public tryout page is now stale — surface it (below) and retry on the
        // next change by clearing the dedupe key.
        lastMirrorRef.current = "";
        setMirrorStale(true);
        return false;
      }
    },
    [activeTeamId],
  );

  // Manual repair path for a stale public mirror (wired into Settings →
  // Tryouts). Forces a fresh write even if the projection looks unchanged.
  const resyncPublicMirror = useCallback(async (): Promise<boolean> => {
    mirrorWarnedRef.current = false;
    const ok = await writePublicMirror({ force: true });
    toast.push(
      ok
        ? { kind: "success", title: "Public tryout page resynced" }
        : {
            kind: "error",
            title: "Resync failed",
            message:
              "Couldn't update the public page. Check your connection and try again.",
          },
    );
    return ok;
  }, [writePublicMirror, toast]);

  // Keep the public mirror in sync as the team changes. Backfills the mirror
  // for teams created before this feature (first snapshot writes it). Writing a
  // sibling doc doesn't retrigger the team subscription, so there's no loop. A
  // persistent failure raises one non-blocking warning toast with a Resync
  // action so coaches know their public page may be out of date.
  useEffect(() => {
    if (!activeTeamId || !teamData) return;
    void writePublicMirror().then((ok) => {
      if (ok || mirrorWarnedRef.current) return;
      mirrorWarnedRef.current = true;
      toast.push({
        kind: "warn",
        title: "Public tryout page may be out of date",
        message:
          "We couldn't update the page parents see. Your private data is safe; the public copy just didn't refresh.",
        duration: 0,
        action: { label: "Resync", onClick: () => void resyncPublicMirror() },
      });
    });
  }, [activeTeamId, teamData, writePublicMirror, resyncPublicMirror, toast]);

  // Backfill the sanitized invite-lookup doc for the active team. Teams created
  // before the /teamInvites path existed still carry their joinCode on the team
  // doc but have no lookup doc, so a code-holder couldn't resolve it (the full
  // team read is no longer permitted). The active coach is a member, so this
  // idempotent write satisfies the teamInvites create rule and lets joins work
  // for legacy teams. Guarded so it fires once per (team, code).
  const lastInviteBackfillRef = useRef("");
  useEffect(() => {
    if (!activeTeamId || !user) return;
    const code = String(teamData?.joinCode || "")
      .trim()
      .toUpperCase();
    if (!code) return;
    const key = `${activeTeamId}:${code}`;
    if (lastInviteBackfillRef.current === key) return;
    lastInviteBackfillRef.current = key;
    const ref = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "teamInvites",
      code,
    );
    setDoc(ref, {
      teamId: activeTeamId,
      teamName: teamData?.name || "",
      updatedAt: Date.now(),
    }).catch(() => {
      // Retry on next change; a missing invite doc only blocks NEW joiners.
      lastInviteBackfillRef.current = "";
    });
  }, [activeTeamId, user, teamData?.joinCode, teamData?.name]);

  const updateTeam = useCallback(
    (updates: Partial<Team>, opts?: { allowEmptyPlayers?: boolean }) => {
      // Snapshot the prior value of every key we're about to optimistically
      // overwrite so a failed save can be rolled back. teamDataRef holds the
      // freshest committed state without widening this callback's deps.
      const prev = teamDataRef.current || {};
      const prevValues: Record<string, unknown> = {};
      for (const k of Object.keys(updates)) prevValues[k] = prev[k];

      setTeamData((p: any) => ({ ...p, ...updates })); // optimistic
      void persistTeam(updates, {
        silent: true,
        allowEmptyPlayers: opts?.allowEmptyPlayers,
      }).then((ok) => {
        if (ok) return;
        // Persistence failed: revert the optimistic patch (but only for keys
        // the user hasn't since changed — see revertOptimisticUpdate) so the UI
        // never silently retains state Firestore rejected, and offer a retry.
        setTeamData((cur: any) =>
          revertOptimisticUpdate(cur, updates, prevValues),
        );
        // Surface the real Firestore error so the failure is self-diagnosing
        // without a console: the code distinguishes a rules rejection
        // (permission-denied) from the size cap (resource-exhausted /
        // invalid-argument) from a network drop (unavailable).
        const err = lastPersistErrorRef.current;
        const detail = err
          ? ` (${err.code || "error"}${err.message ? ": " + err.message : ""})`
          : "";
        toast.push({
          kind: "error",
          title: "Save failed — change reverted",
          message: `We couldn't save that change. Check your connection and try again.${detail}`,
          duration: 0,
          action: {
            label: "Retry",
            onClick: () => updateTeam(updates, opts),
          },
        });
      });
    },
    [persistTeam, toast],
  );

  // Concurrency-safe finance mutation (docs/FINANCES-AUDIT.md finding 3.2).
  // Unlike updateTeam's whole-object merge, each op becomes the narrowest
  // possible updateDoc — appends are arrayUnion (two coaches recording money
  // simultaneously both land), removes are arrayRemove of the exact entry,
  // edits replace one array computed from the LATEST committed state, and
  // scalars are per-field dotted paths. Optimistic apply + revert-on-failure
  // mirror updateTeam. Offline, updateDoc queues in the SDK buffer just like
  // setDoc — the Saving indicator resolves on reconnect.
  const updateFinances = useCallback(
    (update: FinanceUpdate) => {
      if (!activeTeamId) return;
      const prevFinances = (teamDataRef.current?.finances ||
        {}) as import("../types").TeamFinances;
      const nextFinances = applyFinanceUpdate(prevFinances, update);
      setTeamData((p: any) => ({ ...p, finances: nextFinances })); // optimistic
      const payload = buildFinancePayload(prevFinances, update, {
        arrayUnion,
        arrayRemove,
        deleteField,
        scrub: scrubUndefined,
      });
      if (!payload) return; // resolved as a no-op (e.g. id already removed)
      setSyncStatus("Saving");
      const ref = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        activeTeamId,
      );
      updateDoc(ref, payload).then(
        () => {
          setSyncStatus("Synced");
          setTimeout(() => setSyncStatus(""), 1500);
          lastPersistErrorRef.current = null;
        },
        (e) => {
          setSyncStatus("");
          const code = errCode(e);
          const message = errMessage(e);
          lastPersistErrorRef.current = { code, message };
          console.error("[updateFinances] write failed", code, message);
          // Revert only if the user hasn't since changed finances again —
          // same guarded rollback updateTeam uses.
          setTeamData((cur: any) =>
            revertOptimisticUpdate(
              cur,
              { finances: nextFinances },
              { finances: prevFinances },
            ),
          );
          const detail = ` (${code || "error"}${message ? ": " + message : ""})`;
          toast.push({
            kind: "error",
            title: "Save failed — change reverted",
            message: `We couldn't save that change. Check your connection and try again.${detail}`,
            duration: 0,
            action: {
              // Retrying re-resolves the op against then-current state; a
              // retried append that actually landed is deduped by arrayUnion.
              label: "Retry",
              onClick: () => updateFinances(update),
            },
          });
        },
      );
    },
    [activeTeamId, toast],
  );

  // Concurrency-safe mutations for the top-level team arrays (players / games
  // / evaluationEvents / practices) — updateFinances's pattern generalized via
  // src/utils/teamArrayUpdates.ts, so two coaches editing near-simultaneously
  // (the live-eval double-submit, a lineup save racing a roster add) can't
  // erase each other. Accepts one op or a list; a list becomes ONE merged
  // updateDoc so multi-array cascades (remove player → strip from games and
  // eval grades) stay atomic. No doc-size warning on this path (parity with
  // updateFinances — persistTeam still warns on the remaining whole-doc
  // writes); the accepted gap is bulk appends growing the doc unwarned.
  const updateTeamArrays = useCallback(
    (input: TeamArrayUpdate | TeamArrayUpdate[]) => {
      if (!activeTeamId) return;
      const updates = Array.isArray(input) ? input : [input];
      if (updates.length === 0) return;
      // One op per key per call — two ops on the same key would collide on
      // the same dotted payload path. A violation is a programming error, not
      // a user action, so it just logs and drops.
      const keys = updates.map((u) => u.key);
      if (new Set(keys).size !== keys.length) {
        console.error("[updateTeamArrays] duplicate key in op list:", keys);
        return;
      }
      const teamLoaded = loadedTeamIdRef.current === activeTeamId;
      // mapEntries over placeholder/default state is the "all my players were
      // deleted" class of bug — the map would rewrite the array from
      // DEFAULT_TEAM_DATA instead of the real doc. Appends and removes are
      // inherently safe pre-load (removeById resolves to a no-op).
      if (!teamLoaded && updates.some((u) => u.op === "mapEntries")) {
        const message =
          "This team's data hasn't finished loading on this device yet. Try again in a moment.";
        lastPersistErrorRef.current = { code: "team-not-loaded", message };
        console.error("[updateTeamArrays] blocked pre-load mapEntries");
        toast.push({ kind: "error", title: "Save blocked", message });
        return;
      }
      const prevTeam = teamDataRef.current || {};
      // Fold the ops into the optimistic patch and the merged payload, both
      // resolved against the LATEST committed state.
      const patch: Record<string, unknown> = {};
      const prevValues: Record<string, unknown> = {};
      const payload: Record<string, unknown> = {};
      let hasPayload = false;
      for (const rawUpdate of updates) {
        // Run each mapEntries map exactly once — it feeds both the optimistic
        // patch and the payload, and a non-deterministic map (fresh genId)
        // must not produce two different arrays.
        const update = resolveTeamArrayUpdate(prevTeam, rawUpdate);
        patch[update.key] = applyTeamArrayUpdate(prevTeam, update)[update.key];
        prevValues[update.key] = prevTeam[update.key];
        const p = buildTeamArrayPayload(prevTeam, update, {
          arrayUnion,
          arrayRemove,
          scrub: scrubUndefined,
        });
        if (p) {
          Object.assign(payload, p);
          hasPayload = true;
        }
      }
      // Same roster-wipe guard as persistTeam: refuse a players rewrite that
      // would empty a non-empty roster. removeById is exempt — deliberately
      // removing the last player is a real action, not placeholder leakage.
      if (updates.some((u) => u.key === "players" && u.op === "mapEntries")) {
        const wipeReason = blockedRosterWipeReason(
          { players: patch.players },
          prevTeam.players,
          teamLoaded,
        );
        if (wipeReason) {
          const message = `Refused to save an empty roster because ${wipeReason}.`;
          lastPersistErrorRef.current = {
            code: "roster-wipe-blocked",
            message,
          };
          console.error("[updateTeamArrays] roster wipe blocked:", message);
          toast.push({ kind: "error", title: "Save blocked", message });
          return;
        }
      }
      setTeamData((p: any) => ({ ...p, ...patch })); // optimistic
      if (!hasPayload) return; // resolved as a no-op (e.g. id already removed)
      setSyncStatus("Saving");
      const ref = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        activeTeamId,
      );
      updateDoc(ref, payload).then(
        () => {
          setSyncStatus("Synced");
          setTimeout(() => setSyncStatus(""), 1500);
          lastPersistErrorRef.current = null;
        },
        (e) => {
          setSyncStatus("");
          const code = errCode(e);
          const message = errMessage(e);
          lastPersistErrorRef.current = { code, message };
          console.error("[updateTeamArrays] write failed", code, message);
          // Revert only the keys the user hasn't since changed again — same
          // guarded rollback updateTeam uses.
          setTeamData((cur: any) =>
            revertOptimisticUpdate(cur, patch, prevValues),
          );
          const detail = ` (${code || "error"}${message ? ": " + message : ""})`;
          toast.push({
            kind: "error",
            title: "Save failed — change reverted",
            message: `We couldn't save that change. Check your connection and try again.${detail}`,
            duration: 0,
            action: {
              // Retrying re-resolves the ops against then-current state; a
              // retried append that actually landed is deduped by arrayUnion.
              label: "Retry",
              onClick: () => updateTeamArrays(input),
            },
          });
        },
      );
    },
    [activeTeamId, toast],
  );

  // One-time reclaim: player photos were removed from the app. Any team saved
  // before that still carries the old inline base64 photoUrl on its roster —
  // the single biggest contributor to the team doc's size. Strip them once per
  // active team so the next save frees the space (the persist gate above also
  // drops photoUrl from every players write, so they never come back). Guarded
  // by a per-team ref so this fires at most once per team per load.
  const photoStripAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeTeamId || photoStripAttemptedRef.current.has(activeTeamId))
      return;
    // Never derive a roster write from anything but this team's loaded doc —
    // before the snapshot lands, teamData may still hold the placeholder or
    // the PREVIOUS team's players.
    if (loadedTeamIdRef.current !== activeTeamId) return;
    const players = teamData.players;
    if (!Array.isArray(players) || players.length === 0) return;
    if (!players.some((p) => p && p.photoUrl)) return;
    photoStripAttemptedRef.current.add(activeTeamId);
    const stripped = players.map((p) => {
      if (!p || !("photoUrl" in p)) return p;
      const { photoUrl: _dropped, ...rest } = p;
      return rest;
    });
    updateTeam({ players: stripped });
  }, [activeTeamId, teamData.players, updateTeam]);

  // Player Info replace-on-resubmit. The public portal can only ever APPEND to
  // playerInfoSubmissions (the rules enforce append-only so an anonymous caller
  // can't rewrite other families' entries), so a parent correcting their info
  // leaves a stale duplicate behind. Reconcile coach-side: collapse to the
  // latest submission per person and persist. (Availability stays add-only.)
  // The signature ref makes this idempotent AND loop-safe: a failed, optimistic-
  // rolled-back write restores the same source array, whose signature we've
  // already acted on, so we don't retry-storm; a genuinely new submission
  // changes the signature and reconciles again.
  const playerInfoReconcileSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeTeamId || loadedTeamIdRef.current !== activeTeamId) return;
    const subs = teamData.playerInfoSubmissions;
    if (!Array.isArray(subs) || subs.length === 0) return;
    const deduped = dedupePlayerInfoSubmissions(subs);
    if (deduped.length === subs.length) return; // no duplicates to collapse
    const sig = subs.map((s: any) => `${s?.id}:${s?.submittedAt}`).join("|");
    if (playerInfoReconcileSigRef.current === sig) return;
    playerInfoReconcileSigRef.current = sig;
    updateTeam({ playerInfoSubmissions: deduped });
  }, [activeTeamId, teamData.playerInfoSubmissions, updateTeam]);

  // Auto-correct defenseSize on age/league change. BATCHED into a single write.
  // We read the four relevant fields outside the effect so the dependency list
  // literally matches what's used (avoids the ESLint exhaustive-deps confusion
  // that would otherwise want all of `teamData` in the deps).
  const _league = teamData.leagueRuleSet;
  const _teamAge = teamData.teamAge;
  const _defenseSize = teamData.defenseSize;
  const _pitchingFormat = teamData.pitchingFormat;
  // Guard against a self-perpetuating retry storm: updateTeam is optimistic and
  // rolls back on a failed persist, which restores the very field this effect
  // keys on (defenseSize/pitchingFormat) and would re-trigger the correction —
  // an unbounded loop of failed writes + sticky "change reverted" toasts when
  // persistence is failing for any reason. Remember the exact input tuple we
  // last acted on and skip if it's unchanged; a revert returns the tuple to
  // that value, so the loop can't re-arm. Any genuine league/age/size change
  // produces a new tuple and still corrects.
  const lastAutoCorrectRef = useRef("");
  useEffect(() => {
    // Only correct a REAL, loaded team. Before a team's doc has loaded,
    // teamData is the DEFAULT_TEAM_DATA placeholder (USSSA / defenseSize "10"),
    // which the USSSA branch below would "correct" to "9" — firing updateTeam
    // either with no activeTeamId yet (a phantom "save failed" toast for a write
    // that never reaches Firestore) or, mid-load, writing the placeholder value
    // onto the real team. Gating on loadedTeamIdRef closes both holes.
    if (!activeTeamId || loadedTeamIdRef.current !== activeTeamId) return;
    const leagueRuleSet = _league;
    const teamAge = _teamAge;
    const defenseSize = _defenseSize;
    const pitchingFormat = _pitchingFormat;
    const updates: Record<string, string> = {};
    if (leagueRuleSet === "NKB") {
      if (["6U", "7U", "8U"].includes(teamAge)) {
        if (defenseSize !== "10") updates.defenseSize = "10";
        if (pitchingFormat !== "Machine Pitch")
          updates.pitchingFormat = "Machine Pitch";
      } else if (teamAge === "10U") {
        if (defenseSize !== "10") updates.defenseSize = "10";
      } else if (teamAge !== "9U" && defenseSize !== "9") {
        updates.defenseSize = "9";
      }
    } else if (leagueRuleSet === "USSSA") {
      if (defenseSize !== "9") updates.defenseSize = "9";
      if (teamAge === "8U" && pitchingFormat === "Machine Pitch") {
        updates.pitchingFormat = "Kid Pitch";
      }
    }
    if (Object.keys(updates).length === 0) return;
    const sig = `${leagueRuleSet}|${teamAge}|${defenseSize}|${pitchingFormat}`;
    if (lastAutoCorrectRef.current === sig) return; // don't re-fire on revert
    lastAutoCorrectRef.current = sig;
    updateTeam(updates);
  }, [
    _league,
    _teamAge,
    _defenseSize,
    _pitchingFormat,
    updateTeam,
    activeTeamId,
    loadingActive,
  ]);
  // ----- Roster actions -----
  // ----- Player CRUD ----- (extracted to src/hooks/usePlayerCrud.ts)
  const { addPlayer, updatePlayer, updatePlayerNested, removePlayer } =
    usePlayerCrud({ teamData, updateTeamArrays, toast, confirm });

  // ----- Past-season CRUD ----- (extracted to src/hooks/usePastSeasonCrud.ts)
  const {
    addPastSeason,
    updatePastSeason,
    removePastSeason,
    bulkAddPastSeasons,
  } = usePastSeasonCrud({ updateTeamArrays, confirm });

  // ----- Coach actions -----
  const addCoach = useCallback(
    (form: { name: string; role: string }) => {
      if (!form.name.trim()) return;
      const newCoach = {
        id: genId("c"),
        name: form.name.trim(),
        role: form.role,
      };
      updateTeam({ coaches: [...teamData.coaches, newCoach] });
    },
    [teamData.coaches, updateTeam],
  );

  const removeCoach = useCallback(
    (id: string) => {
      updateTeam({
        coaches: teamData.coaches.filter((c: { id: string }) => c.id !== id),
      });
    },
    [teamData.coaches, updateTeam],
  );

  // ----- Game actions ----- (extracted to src/hooks/useGameCrud.ts)
  const { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame } =
    useGameCrud({ teamData, updateTeamArrays, toast, confirm });

  // ----- Practice CRUD ----- (src/hooks/usePracticeCrud.ts)
  const {
    addPractice,
    updatePractice,
    removePractice,
    savePracticeAttendance,
    addDrillToLibrary,
    updateDrillInLibrary,
    removeDrillFromLibrary,
  } = usePracticeCrud({
    teamData,
    updateTeam,
    updateTeamArrays,
    toast,
    confirm,
  });

  // ----- Lineup actions ----- (extracted to src/hooks/useLineupActions.ts)
  const {
    generateLineup,
    regenerateLineup,
    regenerateDefense,
    regenerateBatting,
    undoLineup,
    saveCurrentGame,
    saveAttendance,
    saveLineupTemplate,
    applyLineupTemplate,
    deleteLineupTemplate,
    removePlayerMidGame,
  } = useLineupActions({
    teamData,
    updateTeam,
    updateGame,
    persistTeam,
    toast,
    uiBridge,
    previousLineupRef,
  });

  // ----- Team management -----
  const switchTeam = useCallback(
    async (id: string) => {
      setActiveTeamId(id);
      if (!user) return;
      try {
        const ref = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams",
        );
        await setDoc(ref, { activeTeamId: id }, { merge: true });
      } catch {
        /* non-fatal */
      }
    },
    [user],
  );

  const createTeam = useCallback(
    async (name: string = "", leagueRuleSet?: "NKB" | "USSSA") => {
      if (!user || !name.trim()) return false;
      const id = genId("team");
      setSyncStatus("Creating");
      try {
        const teamRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          id,
        );
        await setDoc(teamRef, {
          ...DEFAULT_TEAM_DATA,
          // The coach picks Rec (NKB) or Tournament (USSSA) at creation; this
          // drives the play-style (fairness vs competitive) and the rules
          // auto-config (defense size / pitching format).
          leagueRuleSet: leagueRuleSet || DEFAULT_TEAM_DATA.leagueRuleSet,
          name: name.trim(),
          ownerId: user.uid,
          members: [user.uid],
        });
        const userRef = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams",
        );
        // Merge with the server's CURRENT team list, never just local state:
        // if this create was reached through a wrongly-shown WelcomeChooser
        // (teams state transiently empty), `[...teams, new]` would overwrite
        // the settings doc and orphan every existing team.
        let serverTeams: { id: string; name: string }[] | null = null;
        try {
          const settingsSnap = await getDoc(userRef);
          serverTeams = settingsSnap.exists()
            ? (((settingsSnap.data() as Record<string, unknown>)?.teams as
                | { id: string; name: string }[]
                | undefined) ?? null)
            : null;
        } catch {
          // Read failed — fall back to merging with local state only.
        }
        await setDoc(
          userRef,
          {
            teams: mergeTeamEntries(serverTeams, teams, [
              { id, name: name.trim() },
            ]),
            activeTeamId: id,
          },
          { merge: true },
        );
        toast.push({ kind: "success", title: "Team created" });
        setSyncStatus("");
        return true;
      } catch (e) {
        setSyncStatus("");
        toast.push({
          kind: "error",
          title: "Could not create team",
          message: errMessage(e),
        });
        return false;
      }
    },
    [user, teams, toast],
  );

  const advanceSeason = useCallback(
    async (
      opts: {
        skipConfirm?: boolean;
        tryoutsToPromote?: string[];
        tryoutDepositPayments?: Record<string, string>;
      } = {},
    ) => {
      const { skipConfirm = false, tryoutsToPromote = [] } = opts;
      const computed = computeNextSeason(teamData.currentSeason);
      if (!computed) {
        toast.push({
          kind: "warn",
          title: "Cannot determine next season",
          message: "Current season label needs to be like 'Spring 2026'.",
        });
        return;
      }
      const { nextSeason, shouldBump } = computed;
      const newAgeGroup = shouldBump
        ? bumpAgeTier(teamData.teamAge)
        : teamData.teamAge;

      // Compute team-level record from final games for the season being archived
      let wins = 0,
        losses = 0,
        ties = 0,
        runsScored = 0,
        runsAllowed = 0;
      for (const g of teamData.games) {
        if (!countsTowardStats(g)) continue;
        const ts = Number(g.teamScore);
        const os = Number(g.opponentScore);
        if (Number.isNaN(ts) || Number.isNaN(os)) continue;
        runsScored += ts;
        runsAllowed += os;
        if (ts > os) wins++;
        else if (ts < os) losses++;
        else ties++;
      }
      const seasonRecord = { wins, losses, ties, runsScored, runsAllowed };
      const archivedSeason = teamData.currentSeason;
      const archivedAge = teamData.teamAge;
      const archivedFormat = teamData.pitchingFormat;
      const playerCount = teamData.players.length;

      // Split current roster by the returning Y/N answer (with legacy
      // playerStatus fallback via isReturning). Returners keep their
      // slot; non-returners (explicit returning:false OR legacy
      // released/declined) are archived but dropped from the next
      // roster.
      const isDropped = (p: Player) => !isReturning(p);
      const droppedCount = teamData.players.filter(isDropped).length;
      // Tryout accepts ride on the same `team.players` array with
      // playerStatus === "accepted" — they join the new roster directly.
      const acceptedCount = teamData.players.filter(
        (p: Player) => p.playerStatus === "accepted",
      ).length;

      // The season YEAR runs Fall → Spring: the mid-year Fall→Spring advance
      // leaves the ledger and collections running untouched, and the money
      // rolls only when a new Fall begins. The full policy (and its tests)
      // lives in shouldRollFinances (utils/finances.ts).
      const hadFinanceActivity =
        ((teamData.finances?.payments || []).length ||
          (teamData.finances?.incomes || []).length ||
          (teamData.finances?.expenses || []).length) > 0;
      const rollFinances = shouldRollFinances(nextSeason, teamData.finances);
      const closingBalance =
        rollFinances && hadFinanceActivity
          ? financeSummary(teamData.finances, []).balanceNow
          : 0;

      // Confirmation
      const confirmMsg =
        `• ${playerCount} player${
          playerCount === 1 ? "" : "s"
        } will have stats archived to history\n` +
        (droppedCount > 0
          ? `• ${droppedCount} marked Released/Declined will be dropped\n`
          : "") +
        (acceptedCount > 0
          ? `• ${acceptedCount} tryout accept${
              acceptedCount === 1 ? "" : "s"
            } will join the new roster\n`
          : "") +
        `• Record being archived: ${wins}-${losses}${
          ties > 0 ? "-" + ties : ""
        }` +
        (wins + losses + ties === 0 ? " (no final games logged)" : "") +
        `\n` +
        `• Current stats and games will be cleared\n` +
        (rollFinances && hadFinanceActivity
          ? `• Club balance carried into the new season year: ${formatCurrency(
              closingBalance,
            )} (fee collections reset)\n`
          : rollFinances
            ? `• The planned team fee (${formatCurrency(
                teamData.finances?.nextClubFee,
              )}) takes effect for the new season\n`
            : hadFinanceActivity
              ? `• Finances keep running through the spring (fees cover the Fall–Spring year)\n`
              : "") +
        `• New season: ${nextSeason}` +
        (shouldBump
          ? ` (age advances ${archivedAge} → ${newAgeGroup})`
          : ` (age stays ${archivedAge})`) +
        `\n\n` +
        `This cannot be undone.`;

      // The AdvanceSeasonModal already walked the head through every
      // marking and showed a full summary, so the confirm here is a
      // duplicate gate when the call came from the wizard. Direct
      // callers (anywhere besides the modal) still see the confirm
      // dialog.
      if (!skipConfirm) {
        const ok = await confirm({
          title: `Archive ${archivedSeason}?`,
          message: `${archivedAge}, ${archivedFormat}\n\n${confirmMsg}`,
          confirmLabel: "Advance Season",
          danger: true,
        });
        if (!ok) return;
      }

      const nowIso = new Date().toISOString();

      // Archive each player's current stats into pastSeasons[]; drop the
      // ones marked Released/Declined; reset surviving statuses to
      // "returning" so the next cycle starts clean.
      const updatedPlayers = teamData.players
        .filter((p: Player) => !isDropped(p))
        .map((p: Player) => {
          // pastSeasons entries carry richer fields (ageGroup/record) than the
          // slim shared type, so widen locally before appending the archive row.
          const past: Array<Record<string, unknown>> = Array.isArray(
            p.pastSeasons,
          )
            ? [...(p.pastSeasons as Array<Record<string, unknown>>)]
            : [];
          // Only archive if there's something meaningful (skip totally-empty stat objects)
          const stats = p.stats || blankStats();
          const hasAnyData = Object.values(stats).some((v) => Number(v) > 0);
          if (hasAnyData) {
            past.push({
              season: archivedSeason,
              ageGroup: archivedAge,
              pitchingFormat: archivedFormat,
              record: seasonRecord,
              stats: { ...stats },
            });
          }
          return {
            ...p,
            pastSeasons: past,
            stats: blankStats(),
            pitching: { recentPitches: 0, lastPitchDate: null },
            // After advance, every surviving player is treated as
            // returning for the new season.
            playerStatus: "returning",
          };
        });

      // Tryout signups selected for promotion become full Player rows on
      // the new roster. Mirrors acceptTryout's mapping but bulk and at
      // advance-time. Every tryout signup is cleared from the team
      // afterward — they don't carry over to the new season regardless of
      // whether they were promoted (interest signups are untouched).
      const promotionSet = new Set(tryoutsToPromote);
      const promotedPairs = (teamData.tryoutSignups || [])
        .filter((s: TryoutSignup) => promotionSet.has(s.id))
        .map((s: TryoutSignup) => {
          const player = {
            id: genId("p"),
            name: `${s.firstName || ""} ${s.lastName || ""}`.trim() || "Player",
            number: s.tryoutNumber || s.number || "",
            dob: s.dob || "",
            bats: s.bats || "R",
            throws: s.throws || "R",
            comfortablePositions: [
              ...(Array.isArray(s.comfortablePositions)
                ? s.comfortablePositions
                : []
              ).filter((p: string) => p !== "C"),
              ...(s.isCatcher === true ? ["C"] : []),
            ],
            parentName: s.parentName || "",
            email: s.email || "",
            phone: s.phone || "",
            present: true,
            playerStatus: "returning",
            pastSeasons: [],
            stats: blankStats(),
            pitching: { recentPitches: 0, lastPitchDate: null },
            tryoutSignupId: s.id,
          };
          return { signup: s, player };
        });
      const promotedPlayers = promotedPairs.map(
        ({ player }: { signup: TryoutSignup; player: Player }) => player,
      );

      // Seed the new season's Preseason eval round: returning players carry
      // their most recent eval forward, promoted tryouts carry their tryout
      // evaluation. Null when there's nothing to seed → start with no rounds.
      const preseasonRound = buildPreseasonSeedRound(
        teamData.evaluationEvents || [],
        updatedPlayers,
        promotedPlayers,
        {
          date: dateToIsoLocal(new Date()),
          evaluatorId: user?.uid,
          tryoutSessions: teamData.tryoutSessions || [],
        },
      );

      const newSeasonFinances = rollFinances
        ? rollFinancesForNewSeason(
            teamData.finances,
            archivedSeason,
            nowIso,
            // The PRE-advance roster: the families who owed the closing year.
            teamData.players || [],
          )
        : teamData.finances;
      const depositAmount = Math.max(
        0,
        Number(newSeasonFinances?.depositAmount) || 0,
      );
      const tryoutDepositPayments = (opts?.tryoutDepositPayments ||
        {}) as Record<string, string>;
      const promotedDepositPayments =
        depositAmount > 0
          ? promotedPairs
              .filter(
                ({ signup }: { signup: TryoutSignup; player: Player }) =>
                  tryoutDepositPayments[signup.id] != null,
              )
              .map(
                ({
                  signup,
                  player,
                }: {
                  signup: TryoutSignup;
                  player: Player;
                }) => ({
                  id: genId(`pay-deposit-${signup.id}`),
                  playerId: player.id,
                  date: String(
                    tryoutDepositPayments[signup.id] || nowIso,
                  ).slice(0, 10),
                  amount: depositAmount,
                  // Attribution stamp (audit finding 3.7) — the advancing
                  // coach recorded these promoted deposits.
                  ...(user?.uid ? { recordedBy: user.uid } : {}),
                  recordedAt: nowIso,
                }),
              )
          : [];

      const financesWithTryoutDeposits =
        promotedDepositPayments.length > 0 || rollFinances
          ? {
              ...(newSeasonFinances || {}),
              payments: [
                ...(newSeasonFinances?.payments || []),
                ...promotedDepositPayments,
              ],
            }
          : undefined;

      // allowEmptyPlayers: a roster where nobody returns (and no tryout
      // promotions) is legitimately empty after an explicitly-confirmed
      // advance — the persistTeam wipe guard must not block it.
      updateTeam(
        {
          currentSeason: nextSeason,
          teamAge: newAgeGroup,
          players: [...updatedPlayers, ...promotedPlayers],
          games: [],
          // Practices belong to the season just closed — start the new season
          // with a clean slate rather than carrying last year's dates forward.
          practices: [],
          // GameChanger issues a new calendar feed per season, so the prior
          // season's URL is dead here. Clear it alongside the games reset so
          // the Schedule auto-sync doesn't fire against the stale feed and the
          // import modal starts blank, prompting the coach for the new link.
          gcCalendarUrl: "",
          evaluationEvents: preseasonRound ? [preseasonRound] : [],
          tryoutSessions: [],
          tryoutSignups: [],
          tryoutsOpen: false,
          lastSeasonAdvanceAt: nowIso,
          ...(financesWithTryoutDeposits
            ? {
                finances: financesWithTryoutDeposits,
              }
            : {}),
        },
        { allowEmptyPlayers: true },
      );
      toast.push({
        kind: "success",
        title: `Advanced to ${nextSeason}`,
        message:
          (shouldBump
            ? `Age group is now ${newAgeGroup}.`
            : `Age group stays ${newAgeGroup}.`) +
          (promotedPlayers.length > 0
            ? ` ${promotedPlayers.length} tryout${
                promotedPlayers.length === 1 ? "" : "s"
              } promoted to roster.`
            : ""),
      });
    },
    [teamData, updateTeam, toast, confirm, user],
  );

  const uploadLogo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Instead of rejecting an oversized logo, auto-shrink it: downscale to a
      // sensible logo size and re-encode (WebP when supported — keeps
      // transparency and compresses well) so it always fits inline under the
      // Firestore 1 MiB document cap. Images already small enough pass through
      // untouched, so we never degrade a good logo.
      downscaleImageToDataURL(file, { maxDim: 512, targetBytes: 200_000 })
        .then((dataUrl: string) => {
          const wasShrunk = dataUrl.length < (file.size || 0);
          // Final safety net: even a shrunk logo can't save if the rest of the
          // team doc is already near the cap. This should essentially never
          // fire now, but warn rather than let the write silently fail.
          const HARD_LIMIT = 900_000; // leave headroom for Firestore overhead
          const approxSize = JSON.stringify({
            ...teamData,
            logoUrl: dataUrl,
          }).length;
          if (approxSize > HARD_LIMIT) {
            toast.push({
              kind: "error",
              title: "Logo still too large to save",
              message:
                "Even after shrinking, your team data would exceed Firestore's 1 MB document limit. Try removing old data before adding a logo.",
              duration: 8000,
            });
            return;
          }
          updateTeam({ logoUrl: dataUrl });
          toast.push({
            kind: "success",
            title: wasShrunk ? "Logo resized & saved" : "Logo updated",
            message: wasShrunk
              ? "Your image was automatically compressed to fit."
              : undefined,
          });
        })
        .catch(() =>
          toast.push({
            kind: "error",
            title: "Could not process image",
            message: "That file didn't look like a valid image.",
          }),
        );
    },
    [teamData, updateTeam, toast],
  );

  const {
    uploadScheduleCsv,
    uploadStatsCsv,
    uploadGameStatsCsv,
    exportBackup,
    exportRosterCsv,
    exportPlayerInfoCsv,
    exportNewPlayersCsv,
    setPlayerStatus,
    setPlayerReturning,
    importBackup,
  } = useImportExportFlows({
    teamData,
    updateTeam,
    updateTeamArrays,
    activeTeamId,
    toast,
    confirm,
  });

  const deleteTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    const ok = await confirm({
      title: "Permanently delete this team?",
      message:
        "Roster, schedule, stats, and evaluations are all deleted. This cannot be undone.",
      confirmLabel: "Delete Team",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId!),
      );
      const remaining = teams.filter((t) => t.id !== activeTeamId);
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "teams",
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true },
      );
      toast.push({ kind: "success", title: "Team deleted" });
    } catch (e) {
      toast.push({
        kind: "error",
        title: "Delete failed",
        message: errMessage(e),
      });
    }
  }, [user, teams, activeTeamId, toast, confirm]);

  const leaveTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    const ok = await confirm({
      title: "Leave this team?",
      message: "A coach can re-invite you with a join code later.",
      confirmLabel: "Leave Team",
      danger: true,
    });
    if (!ok) return;
    try {
      const teamRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        activeTeamId!,
      );
      // Atomic self-removal: arrayRemove drops only this user without a
      // read-modify-write of the whole members array, so a concurrent join
      // can't be clobbered. The selfRemoveOnly() rule permits exactly this.
      await updateDoc(teamRef, { members: arrayRemove(user.uid) });
      const remaining = teams.filter((t) => t.id !== activeTeamId);
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "teams",
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true },
      );
      toast.push({ kind: "success", title: "Left team" });
    } catch (e) {
      toast.push({
        kind: "error",
        title: "Could not leave",
        message: errMessage(e),
      });
    }
  }, [user, teams, activeTeamId, toast, confirm]);

  // ----- Evaluation CRUD ----- (extracted to src/hooks/useEvaluationCrud.ts)
  const { saveTeamEvaluation, saveAssistantEvaluation, deleteEvaluation } =
    useEvaluationCrud({
      teamData,
      updateTeamArrays,
      toast,
      user,
      uiBridge,
      db,
      appId,
      teamId: activeTeamId,
    });

  // ─── Tryouts (PR M) ───────────────────────────────────────────────
  // Public sign-up flow lives at /tryouts/:shareId and writes to
  // team.tryoutSignups[]. Coach side reads from the same array; impact
  // analysis compares against returning roster.

  const {
    generateTryoutShareId,
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    appendTryoutSignup,
    updateTryoutSignup,
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
  } = useTryoutFlows({
    teamData,
    updateTeam,
    updateTeamArrays,
    toast,
    user,
    activeTeamId,
  });

  const { setCoachRole } = useTeamMembership({ teamData, updateTeam, user });
  const { regenerateJoinCode, joinTeamByCode } = useInviteFlows({
    user,
    teams,
    activeTeamId,
    teamData,
    updateTeam,
    switchTeam,
    toast,
  });

  // Session-only role override for the head coach to preview the assistant
  // view. Stored in sessionStorage so refreshes keep the preview but it
  // never persists to Firestore or other tabs. Reset to null on a fresh
  // browser session by design.
  const [viewAsRole, setViewAsRoleState] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = window.sessionStorage.getItem("lineuptool.viewAsRole");
      return v === "assistant" ? "assistant" : null;
    } catch {
      return null;
    }
  });
  const setViewAsRole = useCallback((next: string | null) => {
    setViewAsRoleState(next);
    try {
      if (next) window.sessionStorage.setItem("lineuptool.viewAsRole", next);
      else window.sessionStorage.removeItem("lineuptool.viewAsRole");
    } catch {
      /* ignore */
    }
  }, []);

  // Derive the current user's REAL role on the active team — separate from
  // currentRole so the override toggle UI can render even when the visible
  // role has been flipped to "assistant".
  //
  // Rules:
  //   - ownerId === user.uid  → head (definitive)
  //   - coachRoles[uid] === "head" → head
  //   - coachRoles[uid] === "assistant" → assistant
  //   - missing ownerId AND user is the sole member → head (legacy unclaimed
  //     team that this user is migrating)
  //   - everything else → assistant
  //
  // The old "missing ownerId → head" fallback was unconditionally generous
  // and let a second user who joined a legacy team see themselves as head
  // until their auto-claim raced ahead of the original head's. The sole-
  // member gate below closes that hole — once anyone else is in members[],
  // role resolution must come from ownerId or coachRoles, not a hopeful
  // default.
  const realRole = useMemo<"head" | "assistant">(() => {
    if (!user) return "head";
    if (user.uid === teamData.ownerId) return "head";
    const explicit = teamData.coachRoles?.[user.uid];
    if (explicit === "head") return "head";
    if (explicit === "assistant") return "assistant";
    if (!teamData.ownerId) {
      const members = Array.isArray(teamData.members) ? teamData.members : [];
      const others = members.filter((uid: string) => uid && uid !== user?.uid);
      if (others.length === 0) return "head";
    }
    return "assistant";
  }, [user, teamData.ownerId, teamData.coachRoles, teamData.members]);

  // True only when teamData carries enough signal for realRole to be
  // trustworthy. During the window between login and the first team
  // snapshot, teamData is the empty DEFAULT_TEAM_DATA and realRole
  // falls through to "head" via the legacy sole-member claim path —
  // that's the source of the "assistant briefly sees Head Coach
  // Dashboard then transfers" report. Gating role-sensitive routes
  // on this flag keeps the eval route in a loader until role lands.
  const roleResolved = useMemo(() => {
    if (!user) return false;
    return Boolean(
      teamData.ownerId ||
      (teamData.coachRoles && Object.keys(teamData.coachRoles).length > 0) ||
      (Array.isArray(teamData.members) && teamData.members.length > 0),
    );
  }, [user, teamData.ownerId, teamData.coachRoles, teamData.members]);

  // Visible role for the rest of the app. Only the head coach can flip
  // themselves to assistant; assistants can never escalate.
  const currentRole = useMemo<"head" | "assistant">(() => {
    if (realRole === "head" && viewAsRole === "assistant") return "assistant";
    return realRole;
  }, [realRole, viewAsRole]);

  // Step 2 of the finding-3.1 fix (docs/eval-authz-design.md): a SECOND,
  // role-scoped subscription to the per-author evalRounds subcollection that
  // assembles teamData.evaluationEvents from those docs instead of the shared
  // array. Deliberately isolated from the main team-doc subscription so the
  // live read path is untouched, and gated behind EVAL_ROUNDS_SUBCOLLECTION —
  // OFF by default, so this effect subscribes to nothing and never mutates
  // teamData in production. It only becomes live once the write path + data
  // migration land (steps 3-4) and the flag is flipped. Scoped by realRole (not
  // the view-as override): an assistant MUST use the where-filtered query or the
  // rules deny the read entirely. Errors here are swallowed — the array path
  // stays authoritative until the cutover.
  useEffect(() => {
    if (!EVAL_ROUNDS_SUBCOLLECTION) return;
    if (!activeTeamId || !user || !roleResolved) return;
    const q = buildEvalRoundsQuery(db, appId, activeTeamId, realRole, user.uid);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const assembled = assembleEvalRounds(
          snap.docs.map((d) => ({ id: d.id, data: d.data() })),
        );
        setTeamData((prev: any) => ({ ...prev, evaluationEvents: assembled }));
      },
      () => {
        // Non-fatal: keep the legacy array authoritative until the cutover.
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, user?.uid, roleResolved, realRole]);

  // Step 3 of the finding-3.1 fix: lazily backfill the CALLER'S OWN legacy
  // rounds from teamData.evaluationEvents into the evalRounds subcollection, so
  // the subcollection becomes complete without a server migration. Each coach
  // mirrors only their own rounds (the create rule is self-stamped), which also
  // covers future assistants — they backfill theirs on their next load. Runs
  // once per team per session, best-effort. Gated behind EVAL_ROUNDS_DUAL_WRITE
  // and OFF by default, so this is inert in production; the ongoing dual-write
  // in useEvaluationCrud keeps the subcollection in sync after the backfill.
  const backfilledTeamsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!EVAL_ROUNDS_DUAL_WRITE) return;
    if (!activeTeamId || !user || loadedTeamIdRef.current !== activeTeamId) {
      return;
    }
    if (backfilledTeamsRef.current.has(activeTeamId)) return;
    backfilledTeamsRef.current.add(activeTeamId);
    void backfillOwnEvalRounds(
      db,
      appId,
      activeTeamId,
      teamData.evaluationEvents,
      user.uid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, user?.uid, teamData.evaluationEvents]);

  // Auto-claim + persist legacy teams. Runs once per session per team
  // when ownerId is missing AND there is no plausible existing owner.
  //
  // The gate matters: if `members` contains anyone besides the current user,
  // or any coachRoles entry exists, the team has already been "touched" by
  // someone else — claiming ownership here would race ahead of the real
  // head's auto-claim and silently demote them. That regression is exactly
  // what knocked the original head out of their own team and is the root
  // cause this commit is fixing.
  //
  // After Firestore acknowledges the write, subsequent loads see ownerId
  // populated and this effect is a no-op. The session-level ref guards
  // against re-firing during the brief window between the write and the
  // next snapshot — the user shouldn't see a toast about it on every page
  // reload.
  useEffect(() => {
    if (!authReady || !user || !activeTeamId) return;
    if (loadingActive) return;
    if (teamData.ownerId) return;
    if (migrationAttemptedRef.current.has(activeTeamId)) return;
    const members = Array.isArray(teamData.members) ? teamData.members : [];
    const otherMembers = members.filter(
      (uid: string) => uid && uid !== user?.uid,
    );
    const hasCoachRoles =
      teamData.coachRoles && Object.keys(teamData.coachRoles).length > 0;
    if (otherMembers.length > 0 || hasCoachRoles) {
      // Someone else has been here. Don't claim — the real head needs to
      // recover via Settings → Coach Roles (or, if they truly never set
      // ownerId, via the Firebase Console).
      return;
    }
    migrationAttemptedRef.current.add(activeTeamId);
    const nextMembers = members.includes(user.uid)
      ? members
      : [...members, user.uid];
    persistTeamRef.current?.({
      ownerId: user.uid,
      members: nextMembers,
    });
  }, [
    authReady,
    user,
    activeTeamId,
    teamData.ownerId,
    teamData.members,
    teamData.coachRoles,
    loadingActive,
  ]);

  // PR K — Email eval prompts (client-only). When the HC opens the app
  // and the cadence is active for anyone on the team, fire one batch
  // of reminder emails via the head's signed-in Gmail. A
  // `lastEvalEmailedAt` cool-off guard (7 days) inside emailPromptStatus
  // prevents re-sending on every page load while a cadence stays active.
  // One-per-session ref keeps the same tab from sending twice while the
  // Firestore write is in flight.
  const emailPromptAttemptedRef = useRef(new Set());
  useEffect(() => {
    if (!authReady || !user || !activeTeamId) return;
    if (loadingActive) return;
    if (realRole !== "head") return; // only the head fires the batch
    if (emailPromptAttemptedRef.current.has(activeTeamId)) return;
    const status = emailPromptStatus(teamData);
    if (!status.active) return;
    if (!user.email) return; // signed-in via non-Google provider
    emailPromptAttemptedRef.current.add(activeTeamId);

    // Compose. The link points back to /evaluation so the recipient
    // lands on their own form on click.
    const teamName = teamData.name || "your team";
    const fromName = user.displayName || "Your head coach";
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}#/evaluation`
        : "/evaluation";
    const recipients = [];
    if (status.headDue) {
      recipients.push({ name: fromName, email: user.email });
    }
    const contacts = teamData.coachContacts || [];
    for (const [uid] of Object.entries(status.assistantsDue)) {
      // Pull the assistant's email from coachContacts when we have it.
      // Fall back to skipping: we can't look up emails for legacy
      // members without a contact entry.
      const c = contacts.find(
        (cc: { uid?: string; email?: string; name?: string }) =>
          cc.uid === uid ||
          (cc.email &&
            (teamData.coachRoles || {})[uid] === "assistant" &&
            // best-effort match: same email between members + contacts
            false),
      );
      // Fallback path: any contact with sourceRole containing "assistant"
      // gets emailed if there's an assistant due. Imperfect but useful
      // until we wire a proper uid->email map.
      if (c && c.email) recipients.push({ name: c.name, email: c.email });
    }
    // Dedupe by email (lowercased).
    const seen = new Set();
    const finalRecipients = recipients.filter((r) => {
      const k = (r.email || "").toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (finalRecipients.length === 0) {
      // Nothing actionable; mark the cool-off anyway so we don't retry
      // every page load for a team with no contacts.
      persistTeamRef.current?.({
        lastEvalEmailedAt: new Date().toISOString(),
      });
      return;
    }

    // Surface a one-click reminder the head sends from their own mail client.
    // (The Gmail API send was removed — gmail.send is a restricted scope an
    // unverified Spark-plan app can't use, so it failed silently.) Mark the
    // cool-off now so the prompt shows at most once per cadence window.
    const recipientEmails = finalRecipients
      .map((r) => r.email)
      .filter((e): e is string => !!e);
    persistTeamRef.current?.({
      lastEvalEmailedAt: new Date().toISOString(),
    });
    const draft = buildEvalReminderDraft({ teamName, fromName, url });
    toast.push({
      kind: "info",
      title: "Eval round due",
      message: "Email your coaches a reminder to submit their grades.",
      duration: 12000,
      action: {
        label: "Email coaches",
        onClick: () => {
          window.location.href = buildMailtoUrl(
            recipientEmails.join(","),
            draft.subject,
            draft.body,
          );
        },
      },
    });
  }, [authReady, user, activeTeamId, realRole, teamData, loadingActive, toast]);

  // Capture ?join= param immediately on first load so iOS redirect
  // auth can round-trip without losing the tokenized URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (join) sessionStorage.setItem("pendingJoin", join);
  }, []);

  // Resolve Firebase redirect auth results (used for iOS/in-app browsers
  // where popups are blocked).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (cancelled) return;
        if (result?.user) {
          authDiag("redirect_result_user", { uid: result.user.uid });
          clearRedirectPending();
        } else if (isRedirectLikelyStuck()) {
          authDiag("redirect_result_stuck");
          clearRedirectPending();
          setGenError(
            "Google sign-in redirect did not complete. Try opening this link in Safari/Chrome, then sign in again.",
          );
        }
      } catch (e) {
        if (cancelled) return;
        authDiag("redirect_result_error", {
          code: errCode(e) || null,
          message: errMessage(e) || null,
        });
        clearRedirectPending();
        setGenError(errMessage(e) || "Sign-in failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!isSignInWithEmailLink(auth, window.location.href)) return;
      const clearEmailLinkParams = () => {
        const url = new URL(window.location.href);
        [
          "oobCode",
          "mode",
          "apiKey",
          "lang",
          "continueUrl",
          "tenantId",
        ].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState(
          {},
          document.title,
          `${url.pathname}${url.search}${url.hash}`,
        );
      };
      const savedEmail = window.localStorage.getItem("emailForSignIn");
      const email =
        savedEmail ||
        (await promptText({
          title: "Complete sign-in",
          message: "Enter the email address this sign-in link was sent to.",
          label: "Email",
          inputType: "email",
          placeholder: "coach@example.com",
          confirmLabel: "Sign In",
        })) ||
        "";
      if (!email) return;
      try {
        await signInWithEmailLink(auth, email, window.location.href);
        if (cancelled) return;
        window.localStorage.removeItem("emailForSignIn");
        clearEmailLinkParams();
        authDiag("email_link_success");
        setGenError("");
      } catch (e) {
        if (cancelled) return;
        authDiag("email_link_error", {
          code: errCode(e) || null,
          message: errMessage(e) || null,
        });
        if (
          errCode(e) === "auth/invalid-action-code" ||
          errCode(e) === "auth/expired-action-code"
        ) {
          window.localStorage.removeItem("emailForSignIn");
          clearEmailLinkParams();
        }
        setGenError(errMessage(e) || "Email sign-in failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // promptText is referentially stable (provider useCallback with no deps),
    // so this still runs exactly once on mount.
  }, [promptText]);

  // Auto-redeem ?join= URL params once auth + team list are ready.
  // `?join=<code>` is the persistent 6-character team-code flow.
  useEffect(() => {
    if (!authReady || !user || loadingTeams) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join") || sessionStorage.getItem("pendingJoin");
    if (!join) return;
    const stripParams = () => {
      params.delete("join");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname +
        (newSearch ? `?${newSearch}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
    };
    sessionStorage.setItem("pendingJoin", join);
    stripParams();
    joinTeamByCode(join).then((result) => {
      // Preserve pending state for transient/retryable failures so we can
      // retry on the next load after URL params have been stripped.
      if (result?.ok || !result?.retryable) {
        sessionStorage.removeItem("pendingJoin");
        if (!result?.ok && teams.length === 0) {
          void bootstrapDefaultTeam();
        }
      }
    });
  }, [
    authReady,
    user,
    loadingTeams,
    joinTeamByCode,
    teams.length,
    bootstrapDefaultTeam,
  ]);

  // Win-loss record derived from final games only. `record` is the combined
  // (all non-scrimmage) record; `record.byFormat` splits it into Kid Pitch vs
  // Machine/Coach pitch so the dashboard can show how the team does at each.
  // A game's format is its own `pitchingFormat` override, else the team's.
  const teamPitchingFormat = teamData.pitchingFormat;
  const teamGames = teamData.games;
  const record = useMemo(() => {
    const blank = () => ({
      wins: 0,
      losses: 0,
      ties: 0,
      runsScored: 0,
      runsAllowed: 0,
    });
    const combined = blank();
    const kid = blank();
    const machine = blank();
    const teamFmt = teamPitchingFormat;
    for (const g of teamGames) {
      if (!countsTowardStats(g)) continue;
      const ts = Number(g.teamScore);
      const os = Number(g.opponentScore);
      if (Number.isNaN(ts) || Number.isNaN(os)) continue;
      const tally = (r: ReturnType<typeof blank>) => {
        r.runsScored += ts;
        r.runsAllowed += os;
        if (ts > os) r.wins++;
        else if (ts < os) r.losses++;
        else r.ties++;
      };
      tally(combined);
      if (isKidPitchFormat((g as Game)?.pitchingFormat || teamFmt)) tally(kid);
      else tally(machine);
    }
    return { ...combined, byFormat: { kidPitch: kid, machine } };
  }, [teamGames, teamPitchingFormat]);

  // True when a signed-in user has no teams yet AND there's no pending
  // ?join= flow in progress — that's the gate for showing the WelcomeChooser.
  const hasPendingJoinFlow =
    typeof window !== "undefined" &&
    Boolean(
      sessionStorage.getItem("pendingJoin") ||
      new URLSearchParams(window.location.search).get("join"),
    );
  const needsWelcomeChooser =
    !!user &&
    authReady &&
    !loadingTeams &&
    // A failed team-list READ is not "this coach has no teams" — never march
    // someone with a real team through the create/join orientation off an
    // error (the chooser is non-dismissible and create used to clobber the
    // settings doc's team list).
    !teamsLoadFailed &&
    teams.length === 0 &&
    !hasPendingJoinFlow;

  // Memoized context value — only changes when actual data does
  const value = useMemo(
    () => ({
      team: teamData,
      teams,
      activeTeamId,
      user,
      authReady,
      syncStatus,
      loading: loadingTeams || loadingActive,
      needsWelcomeChooser,
      genError,
      setGenError,
      record,
      currentRole,
      roleResolved,
      realRole,
      viewAsRole,
      setViewAsRole,
      uiBridge, // private — used by UIProvider
      // public mirror sync status + manual repair (Settings → Tryouts)
      mirrorStale,
      resyncPublicMirror,
      // actions
      updateTeam,
      updateFinances,
      updateTeamArrays,
      addPlayer,
      updatePlayer,
      updatePlayerNested,
      removePlayer,
      addPastSeason,
      updatePastSeason,
      removePastSeason,
      bulkAddPastSeasons,
      addCoach,
      removeCoach,
      addGame,
      updateGame,
      finalizeGame,
      postponeGame,
      deleteSavedGame,
      addPractice,
      updatePractice,
      removePractice,
      savePracticeAttendance,
      addDrillToLibrary,
      updateDrillInLibrary,
      removeDrillFromLibrary,
      generateLineup,
      regenerateLineup,
      regenerateBatting,
      regenerateDefense,
      undoLineup,
      saveCurrentGame,
      saveAttendance,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      uploadGameStatsCsv,
      exportBackup,
      exportRosterCsv,
      exportPlayerInfoCsv,
      exportNewPlayersCsv,
      setPlayerStatus,
      setPlayerReturning,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      saveTeamEvaluation,
      saveAssistantEvaluation,
      deleteEvaluation,
      generateTryoutShareId,
      generateTryoutDateLink,
      setTryoutsOpen,
      completeTryouts,
      setRosterCap,
      appendTryoutSignup,
      updateTryoutSignup,
      deleteTryoutSignup,
      deleteTryoutSignups,
      deleteInterestSignup,
      convertInterestToTryout,
      deletePlayerInfoSubmission,
      applyPlayerInfoToPlayer,
      deleteAvailabilitySubmission,
      applyAvailabilityToPlayer,
      autoApplyAvailability,
      acceptTryout,
      saveTryoutEvaluation,
      saveTryoutEvaluations,
      saveLineupTemplate,
      applyLineupTemplate,
      deleteLineupTemplate,
      removePlayerMidGame,
      setCoachRole,
      regenerateJoinCode,
      joinTeamByCode,
    }),
    [
      teamData,
      teams,
      activeTeamId,
      user,
      authReady,
      syncStatus,
      loadingTeams,
      loadingActive,
      needsWelcomeChooser,
      genError,
      record,
      currentRole,
      roleResolved,
      realRole,
      viewAsRole,
      setViewAsRole,
      mirrorStale,
      resyncPublicMirror,
      updateTeam,
      updateFinances,
      updateTeamArrays,
      addPlayer,
      updatePlayer,
      updatePlayerNested,
      removePlayer,
      addPastSeason,
      updatePastSeason,
      removePastSeason,
      bulkAddPastSeasons,
      addCoach,
      removeCoach,
      addGame,
      updateGame,
      finalizeGame,
      postponeGame,
      deleteSavedGame,
      addPractice,
      updatePractice,
      removePractice,
      savePracticeAttendance,
      addDrillToLibrary,
      updateDrillInLibrary,
      removeDrillFromLibrary,
      generateLineup,
      regenerateLineup,
      regenerateBatting,
      regenerateDefense,
      undoLineup,
      saveCurrentGame,
      saveAttendance,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      uploadGameStatsCsv,
      exportBackup,
      exportRosterCsv,
      exportPlayerInfoCsv,
      exportNewPlayersCsv,
      setPlayerStatus,
      setPlayerReturning,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      saveTeamEvaluation,
      saveAssistantEvaluation,
      deleteEvaluation,
      generateTryoutShareId,
      generateTryoutDateLink,
      setTryoutsOpen,
      completeTryouts,
      setRosterCap,
      appendTryoutSignup,
      updateTryoutSignup,
      deleteTryoutSignup,
      deleteTryoutSignups,
      deleteInterestSignup,
      convertInterestToTryout,
      deletePlayerInfoSubmission,
      applyPlayerInfoToPlayer,
      deleteAvailabilitySubmission,
      applyAvailabilityToPlayer,
      autoApplyAvailability,
      acceptTryout,
      saveTryoutEvaluation,
      saveTryoutEvaluations,
      saveLineupTemplate,
      applyLineupTemplate,
      deleteLineupTemplate,
      removePlayerMidGame,
      setCoachRole,
      regenerateJoinCode,
      joinTeamByCode,
    ],
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};
