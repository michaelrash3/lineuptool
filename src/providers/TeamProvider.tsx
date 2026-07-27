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
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField,
  DocumentSnapshot,
  FirestoreError,
} from "firebase/firestore";
import { auth, db, appId } from "../firebase";
import {
  TeamContext,
  TeamActionsContext,
  useToast,
  useConfirm,
} from "../contexts";
import { errCode, errMessage, authDiag } from "../utils/diagnostics";
import {
  clearRedirectPending,
  isRedirectLikelyStuck,
} from "../auth/googleRedirect";
import { buildEvalReminderDraft, buildMailtoUrl } from "../utils/reminderDraft";
import {
  buildEvalRoundsQuery,
  assembleEvalRounds,
  backfillOwnEvalRounds,
  allLegacyRoundsMigrated,
  dropEvalEventsArray,
} from "../utils/evalRounds";
import {
  signupCollectionRef,
  assembleSignups,
  backfillSignupDocs,
  allLegacyMigrated,
  dropLegacySignupArrays,
  type SignupCollectionKey,
} from "../utils/tryoutSignupDocs";
import {
  slimGame,
  scrubUndefined,
  emailPromptStatus,
  restampEvalDueDates,
  migrateLegacyTryoutGrades,
  countsTowardStats,
  isGameFinalized,
  buildPublicMirror,
  revertOptimisticUpdate,
  estimateDocSizeBytes,
  mergeTeamEntries,
  blockedRosterWipeReason,
  dedupePlayerInfoSubmissions,
  genId,
  FIRESTORE_DOC_LIMIT_BYTES,
  DOC_SIZE_WARN_RATIO,
} from "../utils/helpers";
import {
  DEFAULT_TEAM_DATA,
  NEW_TEAM_DOC,
  EVAL_SCHEMA_VERSION,
  isKidPitchFormat,
  allowedPitchingFormats,
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
import { useViewAsRole } from "../hooks/useViewAsRole";
import { useTeamLifecycle } from "../hooks/useTeamLifecycle";
import { useInviteFlows } from "../hooks/useInviteFlows";
import { useImportExportFlows } from "../hooks/useImportExportFlows";
import { useGameCrud } from "../hooks/useGameCrud";
import { useTournamentCrud } from "../hooks/useTournamentCrud";
import { useDevelopmentCrud } from "../hooks/useDevelopmentCrud";
import { usePracticeCrud } from "../hooks/usePracticeCrud";
import { usePlayerCrud } from "../hooks/usePlayerCrud";
import { usePastSeasonCrud } from "../hooks/usePastSeasonCrud";
import { useTryoutFlows } from "../hooks/useTryoutFlows";
import { useEvaluationCrud } from "../hooks/useEvaluationCrud";
import { useLineupActions } from "../hooks/useLineupActions";
import type {
  Team,
  TeamContextValue,
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

// How long BOTH signup lanes (the subcollections and the team doc's legacy
// arrays) must stay quiet before the head's client deletes those arrays — see
// the drop effect. Long enough for an in-flight legacy-lane append from
// another client to round-trip into this client's snapshot and abort the drop.
// The drop is a lazy long-tail cleanup with no user-visible effect, so waiting
// costs nothing a coach can perceive.
const SIGNUP_ARRAY_DROP_SETTLE_MS = 5000;

// How many times ONE team's signup backfill may be attempted in a session
// before the client stops trying and waits for a reload, and how long it waits
// between attempts. The budget is the whole reason the backfill can safely
// release its once-guard on failure: the effect re-runs on snapshots, so an
// unbounded retry against a team whose writes are denied is a billed write
// loop. Three is enough to ride out a transient blip (a dropped connection, a
// rules deploy landing mid-session) and small enough that a permanent denial
// costs at most three passes over the legacy arrays.
const SIGNUP_BACKFILL_MAX_ATTEMPTS = 3;
// Base delay before a failed pass retries; doubles per attempt (5s, 10s), so
// a real outage is not hammered at a fixed cadence while still riding out the
// transient blips the retry exists for.
const SIGNUP_BACKFILL_RETRY_MS = 5000;

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
    // Which game the snapshot was captured from. Readers in useLineupActions
    // refuse to apply it once a DIFFERENT game is selected — the game-scoped
    // sibling of the team-switch clear in the team-doc effect's cleanup.
    gameId?: string;
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
  // Keyed by team id: a session one-shot would let team A's warning silence
  // team B's for the whole session (multi-team coaches are the norm here).
  const docSizeWarnedRef = useRef<Set<string>>(new Set());
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
  // The team's legacy `evaluationEvents` ARRAY as last read from the doc
  // (post schema-migration). Held separately so the backfill can always migrate
  // from the real array even once reads switch to the subcollection — otherwise
  // a not-yet-soaked team would read its (empty) subcollection and never
  // populate. Finding-3.1 step 4.
  const rawEvalEventsRef = useRef<any[]>([]);
  // Same discipline for the legacy signup ARRAYS (Phase 1 of
  // docs/firestore-data-migration.md, mirroring rawEvalEventsRef): the signup
  // subscriptions union these with the subcollection docs, and the lazy
  // backfill migrates from them — never from teamData, which holds the
  // assembled value. Team-scoped: cleared with the rest of this team's
  // captured state in the team-doc effect's cleanup.
  const rawTryoutSignupsRef = useRef<any[]>([]);
  const rawInterestSignupsRef = useRef<any[]>([]);
  // The latest signup subcollection DOCS per collection, as delivered by the
  // subscription callbacks. Held because assembly has TWO inputs — these docs
  // and the raw legacy arrays above — and either one moving has to re-assemble:
  // the team-doc handler needs the docs to union a straggling legacy-array
  // append against, and the subscription callbacks need the arrays.
  const signupSubDocsRef = useRef<
    Record<SignupCollectionKey, Array<{ id: string; data: any }>>
  >({ tryoutSignups: [], interestSignups: [] });
  // Current signup subcollection doc-id sets, kept fresh by the subscription
  // callbacks. The backfill passes them as its overwrite guard and the array
  // drop as its coverage proof — refs, so neither effect has to depend on the
  // assembled arrays (see the circularity notes on those effects).
  const signupSubIdsRef = useRef<Record<SignupCollectionKey, Set<string>>>({
    tryoutSignups: new Set(),
    interestSignups: new Set(),
  });
  // Whether each signup subscription has delivered a snapshot for the active
  // team. Until it has, assembly paints the legacy arrays alone (signups
  // render on first load, and stay LIVE if lagging rules deny the
  // subcollection read); once it has, every publish is the union.
  const signupSubsLandedRef = useRef<Record<SignupCollectionKey, boolean>>({
    tryoutSignups: false,
    interestSignups: false,
  });
  // Strictly stronger than `landed`: whether each subscription has delivered a
  // snapshot the SERVER confirmed (metadata.fromCache === false). Firestore
  // runs persistentLocalCache + multi-tab (src/firebase.ts), so a collection
  // listener's first event is served from the local cache — EMPTY for a
  // collection this device never cached, stale or partial otherwise. `landed`
  // deliberately accepts that because it is only the PAINT gate (an offline
  // team whose arrays were already dropped must still render its cached
  // subdocs). The two migration WRITE effects must not: the id set is the
  // backfill's only overwrite guard and the drop's only coverage proof, and
  // both destroy data when it under-reports.
  const signupSubsServerConfirmedRef = useRef<
    Record<SignupCollectionKey, boolean>
  >({ tryoutSignups: false, interestSignups: false });
  // A lane whose read the server REFUSED. onSnapshot errors are terminal —
  // Firestore never calls that listener again — so a denied lane can never
  // land and signupsReady can never flip this session. Published so consumers
  // waiting on signupsReady (the letter pages' id lookup) can stop showing an
  // infinite loader and say what actually happened.
  const signupSubsDeniedRef = useRef<Record<SignupCollectionKey, boolean>>({
    tryoutSignups: false,
    interestSignups: false,
  });
  // Bumped when a signup subscription reaches a milestone the migration
  // effects gate on — first snapshot landed, then first server-confirmed
  // snapshot — so they re-evaluate at exactly those moments.
  const [signupSubsProgressTick, setSignupSubsProgressTick] = useState(0);
  // Pending backfill retries, keyed BY TEAM (see the backfill effect).
  // A single ref would let one team's settling pass cancel another's retry:
  // team A's pass is still in flight when the user switches to B, B fails and
  // arms a timer, then A's `.then` clears that timer and installs its own —
  // which the fire-time team check then no-ops. B silently loses its retry
  // with its budget unspent, and B is the team on screen. Declared with the
  // rest of the lanes' team-scoped state; the teardown below cancels them.
  const signupBackfillRetryTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  // Ids this session already mirrored, keyed `teamId:lane`. Unioned into the
  // backfill's existing-id guard so a retry cannot rewrite an entry an earlier
  // pass wrote — otherwise that promise rests on the local listener having
  // delivered a snapshot within the retry delay, and a coach edit landing in
  // that window would be clobbered by the stale legacy copy.
  const signupBackfillMirroredRef = useRef<Map<string, Set<string>>>(new Map());

  // Published on the context so id-lookup consumers can tell "not delivered
  // yet" from "genuinely absent". Derived from the same landed flags the tick
  // announces, so it flips in the render the first snapshots land.
  const signupsReady =
    signupSubsLandedRef.current.tryoutSignups &&
    signupSubsLandedRef.current.interestSignups;
  // True when a lane is dead-on-denial: signupsReady is false and will STAY
  // false, which is a different instruction to a waiting consumer than "still
  // in flight".
  const signupsDenied =
    signupSubsDeniedRef.current.tryoutSignups ||
    signupSubsDeniedRef.current.interestSignups;

  // Assemble ONE signup collection from BOTH of its inputs and return the
  // array to publish. Called from the team-doc snapshot handler (the legacy
  // array moved) AND from the subscription callbacks (the docs moved), because
  // assembly has to react to either: the deprecated public array lanes stay
  // open for one release, so a cached portal client appending to the ARRAY
  // after the subscription landed must still become visible — that visibility
  // is the entire reason those lanes were kept.
  const assembledSignups = useCallback((key: SignupCollectionKey): any[] => {
    const legacy =
      key === "tryoutSignups"
        ? rawTryoutSignupsRef.current
        : rawInterestSignupsRef.current;
    // Before the subscription lands there is no doc set to union, so paint the
    // legacy array alone: first load renders, and rules lag that denies the
    // subcollection read can't freeze a stale list. Once landed we always
    // union — never regress to raw-only, or the subscription's docs would be
    // clobbered by the (already-migrated, possibly stale) array.
    if (!signupSubsLandedRef.current[key]) return legacy;
    return assembleSignups(signupSubDocsRef.current[key], legacy);
  }, []);
  // JSON of the last public-mirror projection we wrote, so we only re-upsert
  // the sanitized teamPublic doc when a mirrored field actually changes.
  const lastMirrorRef = useRef<string>("");
  // One-shot guard so the "public page may be stale" warning fires once per
  // failure streak rather than on every team change while the mirror is down.
  // Keyed by team id for the same reason as docSizeWarnedRef above.
  const mirrorWarnedRef = useRef<Set<string>>(new Set());
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
  // teams"). Gates the /welcome page: forcing a coach with a real team
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
        ...NEW_TEAM_DOC,
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
        // No teams yet for this user. The MainShell renders the /welcome page
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
        // welcome page, look for team docs that already list this user as
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
    // the load as FAILED rather than "no teams", so the welcome page never
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
        // Legacy signup ARRAYS, captured for the signup subscriptions' union
        // and the lazy backfill. No schema migration touches them, so one
        // capture up front covers both branches below.
        rawTryoutSignupsRef.current = Array.isArray(raw.tryoutSignups)
          ? raw.tryoutSignups
          : [];
        rawInterestSignupsRef.current = Array.isArray(raw.interestSignups)
          ? raw.interestSignups
          : [];
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
            // Once the legacy array has been DROPPED from the doc (finding-3.1
            // phase 3b), the ladder must not resurrect it as an empty field —
            // only write the key while the doc still carries it.
            ...(raw.evaluationEvents !== undefined
              ? { evaluationEvents: migratedEvents }
              : {}),
            players: migratedPlayers,
            ...(migratedTryoutSessions !== undefined
              ? { tryoutSessions: migratedTryoutSessions }
              : {}),
            evalSchemaVersion: EVAL_SCHEMA_VERSION,
          });
          rawEvalEventsRef.current = migratedEvents;
          setTeamData((prev: any) => ({
            ...DEFAULT_TEAM_DATA,
            ...raw,
            // Coerce core collections to arrays: a malformed doc with
            // players/games set to null would otherwise override the
            // DEFAULT_TEAM_DATA [] and crash the many .map/.find call
            // sites downstream.
            games: Array.isArray(raw.games) ? raw.games : [],
            // The evalRounds subscription owns evaluationEvents — keep what it
            // set rather than clobbering it with the legacy (backup) array.
            evaluationEvents: prev.evaluationEvents,
            // Re-assemble from BOTH inputs on every doc snapshot (see
            // assembledSignups): the arrays captured above unioned with the
            // subscriptions' docs. Reading `prev` here instead would freeze a
            // straggling legacy-array append out of the UI for the rest of the
            // session — nothing else re-assembles when the ARRAY is what moved.
            tryoutSignups: assembledSignups("tryoutSignups"),
            interestSignups: assembledSignups("interestSignups"),
            players: migratedPlayers,
            evalSchemaVersion: EVAL_SCHEMA_VERSION,
          }));
        } else {
          rawEvalEventsRef.current = Array.isArray(raw.evaluationEvents)
            ? raw.evaluationEvents
            : [];
          setTeamData((prev: any) => ({
            ...DEFAULT_TEAM_DATA,
            ...raw,
            players: Array.isArray(raw.players) ? raw.players : [],
            games: Array.isArray(raw.games) ? raw.games : [],
            // The evalRounds subscription owns evaluationEvents.
            evaluationEvents: prev.evaluationEvents,
            // Re-assembled from both inputs (see the branch above).
            tryoutSignups: assembledSignups("tryoutSignups"),
            interestSignups: assembledSignups("interestSignups"),
          }));
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
      // Drop every piece of TEAM-SCOPED state this subscription captured. It
      // is written only in the exists() branch above, so without this it
      // outlives the team it came from: switch teams (or sign out, or open a
      // team whose doc is missing/denied) and the next team's subcollection
      // snapshot would union its docs with the PREVIOUS team's legacy arrays —
      // another family's PII in the coach UI — while the migration
      // write-effects aimed their backfill and their irreversible array drop
      // at entries that were never this team's. Cleared on teardown, before
      // the next team's subscriptions can deliver anything, so no window
      // exists where the two halves belong to different teams.
      loadedTeamIdRef.current = null;
      rawEvalEventsRef.current = [];
      rawTryoutSignupsRef.current = [];
      rawInterestSignupsRef.current = [];
      // The lineup UNDO buffer is team-scoped for the same reason: it holds a
      // snapshot of one team's roster in position/batting slots, and nothing
      // else ever clears it. The "Undo" action on the generate/re-roll toast
      // outlives a team switch (ToastProvider sits ABOVE TeamProvider, so its
      // stack is not unmounted), and it reads this ref at CLICK time — so a
      // coach who builds a lineup, switches teams and taps Undo pushes team
      // A's players into team B's editor, and the next Save writes them onto
      // team B's game. Dropping the snapshot here makes that tap a no-op.
      previousLineupRef.current = null;
    };
  }, [activeTeamId, toast, assembledSignups]);

  // Storage-headroom guard shared by persistTeam and updateFinances: the whole
  // team is one Firestore doc (~1 MiB cap). Estimate the post-write size and
  // warn ONCE when nearing the limit so a coach can archive old seasons before
  // a write silently fails. Non-blocking — the write still proceeds.
  const warnDocSizeOnce = useCallback(
    (estimatedDoc: Record<string, unknown>) => {
      if (!activeTeamId || docSizeWarnedRef.current.has(activeTeamId)) return;
      const estimated = estimateDocSizeBytes(estimatedDoc);
      if (estimated > FIRESTORE_DOC_LIMIT_BYTES * DOC_SIZE_WARN_RATIO) {
        docSizeWarnedRef.current.add(activeTeamId);
        toast.push({
          kind: "warn",
          title: "Team data is getting large",
          message: `Using ${Math.round(
            estimated / 1024,
          )} KB of the ~1 MB limit. Consider archiving old seasons (Advance Season) to free space.`,
          duration: 0,
        });
      }
    },
    [activeTeamId, toast],
  );

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
      if (activeTeamId && !docSizeWarnedRef.current.has(activeTeamId)) {
        const prev = teamDataRef.current || {};
        const mergedGames = Array.isArray(toPersist.games)
          ? toPersist.games
          : Array.isArray(prev.games)
            ? prev.games.map(slimGame)
            : [];
        warnDocSizeOnce({ ...prev, ...toPersist, games: mergedGames });
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
    [activeTeamId, toast, warnDocSizeOnce],
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
    if (activeTeamId) mirrorWarnedRef.current.delete(activeTeamId);
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
  }, [activeTeamId, writePublicMirror, toast]);

  // Keep the public mirror in sync as the team changes. Backfills the mirror
  // for teams created before this feature (first snapshot writes it). Writing a
  // sibling doc doesn't retrigger the team subscription, so there's no loop. A
  // persistent failure raises one non-blocking warning toast with a Resync
  // action so coaches know their public page may be out of date.
  useEffect(() => {
    if (!activeTeamId || !teamData) return;
    void writePublicMirror().then((ok) => {
      if (ok || !activeTeamId || mirrorWarnedRef.current.has(activeTeamId))
        return;
      mirrorWarnedRef.current.add(activeTeamId);
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
      // Storage-headroom guard: finance appends (payments/incomes/expenses/
      // budgetItems) are the app's only unbounded-growth arrays, and this write
      // path bypassed the size check persistTeam runs. Warn once near the cap.
      warnDocSizeOnce({
        ...(teamDataRef.current || {}),
        finances: nextFinances,
      });
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
    [activeTeamId, toast, warnDocSizeOnce],
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
      } else if (teamAge === "10U") {
        if (defenseSize !== "10") updates.defenseSize = "10";
      } else if (teamAge !== "9U" && defenseSize !== "9") {
        updates.defenseSize = "9";
      }
    } else if (leagueRuleSet === "USSSA") {
      if (defenseSize !== "9") updates.defenseSize = "9";
    }
    // Format legality lives in one helper (9U+ is always Kid Pitch; NKB
    // 6-8U is Machine; USSSA 8U is Kid/Coach) — heal a stored value the
    // current league + age can't play.
    const allowedFormats = allowedPitchingFormats(leagueRuleSet, teamAge);
    if (!allowedFormats.includes(pitchingFormat)) {
      updates.pitchingFormat = allowedFormats[0];
    }
    // When exactly one format is legal, per-game overrides that disagree are
    // stale (e.g. a Machine game left over from before an age change). Heal
    // upcoming games in the same pass; finalized games keep the format they
    // were actually played under (HomeTab/StatsTab byFormat history). Games
    // are read via teamDataRef and deliberately NOT in the deps — the scrub's
    // own write can't re-run the effect, and once landed nothing is
    // offending, so it self-extinguishes.
    if (allowedFormats.length === 1) {
      const offending = (g: Game) =>
        !!g.pitchingFormat &&
        !allowedFormats.includes(g.pitchingFormat) &&
        !isGameFinalized(g);
      if (((teamDataRef.current?.games || []) as Game[]).some(offending)) {
        updateTeamArrays({
          op: "mapEntries",
          key: "games",
          map: (games: Game[]) =>
            games.map((g) =>
              offending(g) ? { ...g, pitchingFormat: allowedFormats[0] } : g,
            ),
        });
      }
    }
    if (Object.keys(updates).length === 0) return;
    // Keyed by TEAM as well as by the tuple: the guard's job is to stop one
    // team's failed write from re-arming its own correction, and two teams
    // that share a league/age/size/format tuple (a coach running two 8U USSSA
    // squads) is ordinary. Without the id, correcting team A silently
    // suppresses the identical correction on team B, leaving B on a defenseSize
    // its league can't field — the same team-scoped-state-outliving-the-switch
    // class as the undo buffer above.
    const sig = `${activeTeamId}|${leagueRuleSet}|${teamAge}|${defenseSize}|${pitchingFormat}`;
    if (lastAutoCorrectRef.current === sig) return; // don't re-fire on revert
    lastAutoCorrectRef.current = sig;
    updateTeam(updates);
  }, [
    _league,
    _teamAge,
    _defenseSize,
    _pitchingFormat,
    updateTeam,
    updateTeamArrays,
    activeTeamId,
    loadingActive,
  ]);
  // ----- Roster actions -----
  // ----- Player CRUD ----- (extracted to src/hooks/usePlayerCrud.ts)
  const { addPlayer, updatePlayer, updatePlayerNested, removePlayer } =
    usePlayerCrud({
      teamDataRef,
      updateTeamArrays,
      toast,
      confirm,
      db,
      appId,
      teamId: activeTeamId,
    });

  // ----- Past-season CRUD ----- (extracted to src/hooks/usePastSeasonCrud.ts)
  const {
    addPastSeason,
    updatePastSeason,
    removePastSeason,
    bulkAddPastSeasons,
  } = usePastSeasonCrud({ updateTeamArrays, confirm });

  // ----- Coach actions -----
  // ----- Game actions ----- (extracted to src/hooks/useGameCrud.ts)
  const { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame } =
    useGameCrud({ teamDataRef, updateTeamArrays, toast, confirm });

  // ----- Tournament CRUD ----- (src/hooks/useTournamentCrud.ts)
  const {
    addTournament,
    updateTournament,
    setPlannedOutings,
    removeTournament,
  } = useTournamentCrud({ teamDataRef, updateTeamArrays, toast, confirm });

  // ----- Development plan / health CRUD ----- (src/hooks/useDevelopmentCrud.ts)
  const {
    setPlayerHealth,
    updateDevPlan,
    addGoal,
    setGoalStatus,
    removeGoal,
    addCheckIn,
    toggleAssignedDrill,
  } = useDevelopmentCrud({ teamDataRef, updateTeamArrays, toast });

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
    teamDataRef,
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
    teamDataRef,
    updateTeam,
    updateGame,
    persistTeam,
    toast,
    uiBridge,
    previousLineupRef,
  });

  // ----- Team management -----
  const {
    switchTeam,
    createTeam,
    advanceSeason,
    uploadLogo,
    deleteTeamCmd,
    leaveTeamCmd,
  } = useTeamLifecycle({
    user,
    teams,
    activeTeamId,
    setActiveTeamId,
    setSyncStatus,
    teamDataRef,
    updateTeam,
    toast,
    confirm,
  });

  const {
    uploadScheduleCsv,
    uploadStatsCsv,
    uploadGameStatsCsv,
    exportBackup,
    exportRosterCsv,
    exportPlayerInfoCsv,
    exportNewPlayersCsv,
    setPlayerReturning,
    importBackup,
  } = useImportExportFlows({
    teamDataRef,
    updateTeam,
    updateTeamArrays,
    activeTeamId,
    toast,
    confirm,
  });

  // ----- Evaluation CRUD ----- (extracted to src/hooks/useEvaluationCrud.ts)
  const { saveTeamEvaluation, saveAssistantEvaluation, deleteEvaluation } =
    useEvaluationCrud({
      teamDataRef,
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
  } = useTryoutFlows({
    teamDataRef,
    // Raw legacy arrays (not the assembled union): deletes consult these to
    // decide whether a legacy-array cleanup write is needed at all.
    rawTryoutSignupsRef,
    rawInterestSignupsRef,
    updateTeam,
    updateTeamArrays,
    toast,
    user,
    activeTeamId,
    db,
    appId,
    teamId: activeTeamId,
  });

  const { setCoachRole, addCoach, removeCoach } = useTeamMembership({
    teamDataRef,
    updateTeam,
    user,
  });
  const { regenerateJoinCode, joinTeamByCode } = useInviteFlows({
    user,
    teams,
    activeTeamId,
    teamDataRef,
    updateTeam,
    switchTeam,
    toast,
  });

  // Session-only role override for the head coach to preview the assistant
  // view. Stored in sessionStorage so refreshes keep the preview but it
  // never persists to Firestore or other tabs. Reset to null on a fresh
  // browser session by design.
  const { viewAsRole, setViewAsRole, realRole, roleResolved, currentRole } =
    useViewAsRole({ teamData, user });

  // The eval-rounds read path (finding-3.1, docs/eval-authz-design.md): a
  // SECOND, role-scoped subscription to the per-author evalRounds
  // subcollection that assembles teamData.evaluationEvents from those docs.
  // Deliberately isolated from the main team-doc subscription. Scoped by
  // realRole (not the view-as override): an assistant MUST use the
  // where-filtered query or the rules deny the read entirely.
  useEffect(() => {
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
    return () => {
      unsub();
      // Team-scoped, same discipline as the signup lanes' cleanup. THIS
      // subscription — not the team doc — owns evaluationEvents, which is why
      // the team-doc handler carries the field across snapshots
      // (`evaluationEvents: prev.evaluationEvents`). That carry is unqualified,
      // so without an explicit reset the previous team's rounds survive the
      // switch and render under the next team: per-player grades and notes,
      // the same cross-team PII exposure #583 closed on the signup lanes. And
      // it is not a brief window — this subscription's error arm is a
      // deliberate no-op, so a team whose evalRounds read is denied (rules lag,
      // assistant mid-promotion) would show the PREVIOUS team's grades for as
      // long as it stayed open.
      setTeamData((prev: any) =>
        (prev?.evaluationEvents || []).length === 0
          ? prev
          : { ...prev, evaluationEvents: [] },
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, user?.uid, roleResolved, realRole]);

  // Migration long tail (finding-3.1): lazily backfill the CALLER'S OWN legacy
  // rounds into the evalRounds subcollection, so a team not opened since the
  // cutover still becomes complete without a server migration. Reads from the
  // raw `evaluationEvents` ARRAY (via rawEvalEventsRef), NOT
  // teamData.evaluationEvents — teamData holds the subcollection's value, so
  // migrating from it would be circular and a not-yet-soaked team would never
  // populate. Each coach mirrors only their own rounds (the create rule is
  // self-stamped). Once per team per session, best-effort; self-limiting — a
  // no-op once the doc no longer carries the array.
  const backfilledTeamsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeTeamId || !user || loadedTeamIdRef.current !== activeTeamId) {
      return;
    }
    if (backfilledTeamsRef.current.has(activeTeamId)) return;
    backfilledTeamsRef.current.add(activeTeamId);
    void backfillOwnEvalRounds(
      db,
      appId,
      activeTeamId,
      rawEvalEventsRef.current,
      user.uid,
    );
    // Trigger on team-load completion (loadingActive true→false), NOT on
    // teamData.evaluationEvents: once reads come from the subcollection, a
    // not-yet-soaked team keeps an empty evaluationEvents that never changes, so
    // it would never fire and never populate. loadingActive flips per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, user?.uid, loadingActive]);

  // Migration long tail (finding-3.1 phase 3b) — the one irreversible step:
  // delete the legacy `evaluationEvents` ARRAY from the team doc once the
  // subcollection provably holds every round. Self-limiting: a no-op for docs
  // that no longer carry the array. Guards, in order:
  //   - HEAD ONLY: the head's subscription streams EVERY evalRounds doc, so
  //     coverage is verifiable; an assistant sees only their own rounds and
  //     could never prove the array is fully migrated;
  //   - doc loaded: rawEvalEventsRef must belong to THIS team;
  //   - coverage: every legacy round id present in the subcollection
  //     (allLegacyRoundsMigrated returns false for an empty legacy array, so a
  //     failed/empty read can never trigger a drop — and once dropped, the next
  //     snapshot carries no array, emptying rawEvalEventsRef so this never
  //     re-fires).
  // Depends on teamData.evaluationEvents so the check re-runs when the
  // subcollection snapshot lands (the async half of the coverage evidence).
  // On write failure the guard clears so a later session retries.
  const droppedArrayTeamsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (realRole !== "head") return;
    if (!activeTeamId || !user || loadedTeamIdRef.current !== activeTeamId) {
      return;
    }
    if (droppedArrayTeamsRef.current.has(activeTeamId)) return;
    const subIds = (teamData.evaluationEvents || [])
      .map((e: any) => e?.id)
      .filter(Boolean);
    if (!allLegacyRoundsMigrated(rawEvalEventsRef.current, subIds)) return;
    droppedArrayTeamsRef.current.add(activeTeamId);
    dropEvalEventsArray(db, appId, activeTeamId).catch(() => {
      droppedArrayTeamsRef.current.delete(activeTeamId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTeamId,
    user?.uid,
    realRole,
    loadingActive,
    teamData.evaluationEvents,
  ]);

  // The signup read path (Phase 1 of docs/firestore-data-migration.md): one
  // subscription per signup subcollection, mirroring the evalRounds wiring
  // above. Unlike evalRounds there is no role scoping — the rules grant every
  // team member the full read — so no query filter and no roleResolved gate.
  // The published value is the UNION of subcollection docs and
  // not-yet-migrated legacy array entries, so cached portal clients still
  // appending to the legacy arrays surface without a reload.
  //
  // Both collections are wired in ONE effect so their team-scoped state (docs,
  // id sets, landed + server-confirmed flags) arms and tears down together — a
  // half-reset pair is exactly what the migration write-effects below would
  // misread as proof.
  //
  // includeMetadataChanges is load-bearing, not a nicety: Firestore suppresses
  // the metadata-only cache→server transition, so on a device whose cached
  // copy already matches the server there is no second snapshot and
  // metadata.fromCache would read true forever — permanently stranding the two
  // write-effects that gate on server confirmation.
  useEffect(() => {
    if (!activeTeamId || !user) return;
    // The refs' OBJECTS are stable (only their fields mutate) — hoisted so the
    // cleanup mutates the same objects the callbacks armed.
    const landed = signupSubsLandedRef.current;
    const serverConfirmed = signupSubsServerConfirmedRef.current;
    const denied = signupSubsDeniedRef.current;
    const subDocs = signupSubDocsRef.current;
    const subIds = signupSubIdsRef.current;
    const keys: SignupCollectionKey[] = ["tryoutSignups", "interestSignups"];
    const unsubs = keys.map((key) =>
      onSnapshot(
        signupCollectionRef(db, appId, activeTeamId, key),
        { includeMetadataChanges: true },
        (snap) => {
          subDocs[key] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
          subIds[key] = new Set(snap.docs.map((d) => d.id));
          let progressed = false;
          // Flip the gates BEFORE assembling, so the very first snapshot
          // publishes the union rather than one last raw-only paint.
          if (!landed[key]) {
            landed[key] = true;
            progressed = true;
          }
          // A snapshot the server confirmed — the only kind the migration
          // write-effects may treat as evidence. Absent metadata reads as
          // unconfirmed, which is the safe direction.
          if (!serverConfirmed[key] && snap.metadata?.fromCache === false) {
            serverConfirmed[key] = true;
            progressed = true;
          }
          setTeamData((prev: any) => ({
            ...prev,
            [key]: assembledSignups(key),
          }));
          if (progressed) setSignupSubsProgressTick((t) => t + 1);
        },
        () => {
          // Non-fatal for PAINT: the legacy array stays authoritative, the
          // migration write-effects stay gated (a denied lane never lands and
          // never confirms). But the error is terminal for this listener, so
          // record it and re-render — consumers gating on signupsReady would
          // otherwise wait forever with no way to tell a dead lane from a
          // slow one.
          if (!denied[key]) {
            denied[key] = true;
            setSignupSubsProgressTick((t) => t + 1);
          }
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
      // Reset so the next team re-proves itself from scratch: its doc snapshot
      // paints its own legacy arrays until ITS subscriptions land, and the
      // backfill/drop guards below can never read another team's docs or id
      // set as proof.
      for (const key of keys) {
        landed[key] = false;
        serverConfirmed[key] = false;
        denied[key] = false;
        subDocs[key] = [];
        subIds[key] = new Set();
      }
      // The retry scheduled by a failed backfill of THE TEAM BEING TORN DOWN
      // — not any other team's. Each re-checks loadedTeamIdRef before firing,
      // so leaving it would be harmless, but cancelling keeps the lanes'
      // teardown complete and spares the next team a stray render.
      // activeTeamId here is the effect's captured value — the team being torn
      // down, not the one replacing it.
      const pendingRetry =
        signupBackfillRetryTimersRef.current.get(activeTeamId);
      if (pendingRetry) {
        clearTimeout(pendingRetry);
        signupBackfillRetryTimersRef.current.delete(activeTeamId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, user?.uid]);

  // Migration long tail (Phase 1): lazily backfill legacy signup-array entries
  // into the subcollections, so a team not opened since the cutover becomes
  // complete without a server migration. Any signed-in member may run it (the
  // member write lane covers both collections). Reads the raw ARRAYS (via
  // rawTryoutSignupsRef / rawInterestSignupsRef), NOT teamData — teamData
  // holds the assembled union, so migrating from it would be circular.
  // Deliberately unlike backfillOwnEvalRounds, the current subcollection id
  // sets ride along as an overwrite guard: an id already present as a subdoc
  // may have been EDITED by a coach, and re-mirroring its stale legacy copy
  // would clobber the edit. That guard is only meaningful once both
  // subscriptions have reported what exists — hence the landed gate, re-armed
  // by signupSubsProgressTick.
  //
  // Once per team per session ON SUCCESS, and up to
  // SIGNUP_BACKFILL_MAX_ATTEMPTS times when the writes are refused. The guard
  // used to be consumed BEFORE any write was issued and never released, which
  // — combined with a helper that swallowed every rejection — made a wholly
  // denied pass indistinguishable from a finished one: the union still painted
  // every family correctly, so the migration stalled for the session with no
  // symptom at all. backfillSignupDocs now resolves with {written, failed};
  // `failed > 0` releases the guard so a later cycle retries.
  //
  // The bound is the point. This effect re-runs on subscription milestones, so
  // an unconditional release would re-fire the whole mirror on every
  // subsequent snapshot — against a team whose writes are denied that is an
  // unbounded billed write loop, the same failure mode the drop guard was
  // fixed for. Three things bound it: a per-team attempt budget that is NEVER
  // refunded (not on team switch, not on revisit — a Map keyed by team id that
  // lives as long as the session), an in-flight guard so overlapping snapshots
  // cannot stack passes, and a delay before the self-scheduled retry so a
  // transient blip has time to clear instead of being hammered three times in
  // one tick. Spending the budget consumes the once-guard for good; the
  // migration then waits for a reload, exactly as it did before this fix.
  const signupsBackfilledTeamsRef = useRef<Set<string>>(new Set());
  const signupBackfillAttemptsRef = useRef<Map<string, number>>(new Map());
  const signupBackfillInFlightRef = useRef<Set<string>>(new Set());
  const [signupBackfillRetryTick, setSignupBackfillRetryTick] = useState(0);
  useEffect(() => {
    if (!activeTeamId || !user || loadedTeamIdRef.current !== activeTeamId) {
      return;
    }
    const landed = signupSubsLandedRef.current;
    if (!landed.tryoutSignups || !landed.interestSignups) return;
    // And a CACHE-served id set is not proof of what exists. It under-reports
    // (empty for a collection this device never cached, stale otherwise), and
    // every id it fails to report is one this backfill would setDoc from its
    // legacy twin — which is always the stale copy, since tryoutNumber, status
    // and measurements are written to the SUBDOC only. That silently reverts
    // coach edits. Offline this therefore never runs at all, which is the
    // right outcome: the writes would sit queued and commit verbatim on
    // reconnect, long after the once-guard below stopped anything from
    // re-running and repairing them.
    const serverConfirmed = signupSubsServerConfirmedRef.current;
    if (!serverConfirmed.tryoutSignups || !serverConfirmed.interestSignups) {
      return;
    }
    // Settled: either a clean pass, or the attempt budget is spent.
    if (signupsBackfilledTeamsRef.current.has(activeTeamId)) return;
    // A pass is already running for this team. Without this, the guard's
    // release-on-failure would let a snapshot arriving mid-pass start a second
    // one against the same unmirrored id set — duplicate writes, and two
    // attempts charged for one round trip.
    if (signupBackfillInFlightRef.current.has(activeTeamId)) return;
    const teamId = activeTeamId;
    const attempt = (signupBackfillAttemptsRef.current.get(teamId) || 0) + 1;
    signupBackfillAttemptsRef.current.set(teamId, attempt);
    signupBackfillInFlightRef.current.add(teamId);
    const backfillKeys: SignupCollectionKey[] = [
      "tryoutSignups",
      "interestSignups",
    ];
    void Promise.all(
      backfillKeys.map((key) =>
        backfillSignupDocs(
          db,
          appId,
          teamId,
          key,
          key === "tryoutSignups"
            ? rawTryoutSignupsRef.current
            : rawInterestSignupsRef.current,
          new Set([
            ...signupSubIdsRef.current[key],
            ...(signupBackfillMirroredRef.current.get(`${teamId}:${key}`) ||
              []),
          ]),
        ).then((result) => {
          if (result.writtenIds.length) {
            const mapKey = `${teamId}:${key}`;
            const seen =
              signupBackfillMirroredRef.current.get(mapKey) || new Set();
            result.writtenIds.forEach((id) => seen.add(id));
            signupBackfillMirroredRef.current.set(mapKey, seen);
          }
          return result;
        }),
      ),
    )
      .then((results) => {
        const failed = results.reduce((n, r) => n + r.failed, 0);
        // Nothing refused — including "nothing was pending", which is what a
        // team with no legacy arrays left reports. Done for the session.
        if (failed === 0) {
          signupsBackfilledTeamsRef.current.add(teamId);
          return;
        }
        if (attempt >= SIGNUP_BACKFILL_MAX_ATTEMPTS) {
          // Budget spent. Keep the guard so nothing retries this session, and
          // say so where a maintainer can see it — deliberately NOT a toast.
          // Nothing is broken from the coach's side (the union read still
          // shows every family, edits still work) and there is no action they
          // could take; the irreversible array drop is structurally blocked
          // from firing on data this never mirrored, because its coverage
          // proof reads the very id set these writes failed to populate. A
          // toast for an invisible, self-healing background migration is pure
          // noise on the surface real signup failures use.
          signupsBackfilledTeamsRef.current.add(teamId);
          console.error(
            "[signupBackfill] gave up after",
            attempt,
            "attempts;",
            failed,
            "legacy signup entries left unmirrored for team",
            teamId,
          );
          return;
        }
        // Guard stays released. Re-arm on a timer rather than immediately: the
        // effect's own triggers are subscription milestones that may never
        // come again this session, so the retry has to be self-scheduled, and
        // an instant one would just replay a transient failure.
        const priorRetry = signupBackfillRetryTimersRef.current.get(teamId);
        if (priorRetry) clearTimeout(priorRetry);
        const retry = setTimeout(
          () => {
            signupBackfillRetryTimersRef.current.delete(teamId);
            // Team-pinned, like the drop's settle timer: a switch during the
            // delay makes this a no-op instead of a spurious render.
            if (loadedTeamIdRef.current !== teamId) return;
            setSignupBackfillRetryTick((t) => t + 1);
          },
          SIGNUP_BACKFILL_RETRY_MS * 2 ** (attempt - 1),
        );
        signupBackfillRetryTimersRef.current.set(teamId, retry);
      })
      .finally(() => {
        signupBackfillInFlightRef.current.delete(teamId);
      });
    // Trigger on team-load completion (loadingActive) and on the
    // subscriptions' milestones (signupSubsProgressTick — landed, then
    // server-confirmed), NOT on the assembled teamData arrays: depending on
    // those would re-run this on every signup change for no reason, and they
    // can't distinguish "subscription landed" from "legacy array painted".
    // Plus the retry tick, the only trigger a failed pass can count on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTeamId,
    user?.uid,
    loadingActive,
    signupSubsProgressTick,
    signupBackfillRetryTick,
  ]);

  // Does the CURRENT ref state prove the subcollections hold every legacy
  // entry? Reads the refs at CALL time — never a snapshot captured earlier —
  // so the re-proof taken immediately before the irreversible write sees the
  // newest data rather than whatever armed the attempt.
  const signupArraysFullyMigrated = useCallback((): boolean => {
    const legacy: Record<SignupCollectionKey, any[]> = {
      tryoutSignups: rawTryoutSignupsRef.current || [],
      interestSignups: rawInterestSignupsRef.current || [],
    };
    // Nothing real to delete — never spend the irreversible write. This is
    // also what stops it re-firing after a successful drop: both refs then
    // read empty.
    if (
      legacy.tryoutSignups.length === 0 &&
      legacy.interestSignups.length === 0
    ) {
      return false;
    }
    // allLegacyMigrated is deliberately false-on-empty so a failed/empty read
    // can never trigger a drop. But the write spans BOTH fields and one empty
    // array must not strand the other — an empty array has nothing to lose. So
    // the per-collection bar is "empty OR fully migrated", with at least one
    // array non-empty overall (checked above).
    const ids = signupSubIdsRef.current;
    return (["tryoutSignups", "interestSignups"] as const).every(
      (key) =>
        legacy[key].length === 0 || allLegacyMigrated(legacy[key], ids[key]),
    );
  }, []);

  // Migration long tail (Phase 1) — the one irreversible step: delete BOTH
  // legacy signup ARRAYS from the team doc once the subcollections provably
  // hold every entry. Mirrors the evalRounds drop above. Guards, in order:
  //   - HEAD ONLY: one designated dropper, matching the evalRounds precedent;
  //   - doc loaded: the raw refs and id sets must belong to THIS team;
  //   - both subscriptions LANDED: an unlanded (possibly denied) subscription
  //     reads as an empty id set — never proof;
  //   - both subscriptions SERVER-CONFIRMED: a cache-served id set
  //     under-reports, and under-reporting here deletes signups that only ever
  //     existed in the array;
  //   - coverage, via signupArraysFullyMigrated.
  // Then a settle window, and the coverage proof is taken AGAIN at write time.
  //
  // Be honest about what that buys. The deprecated public array lane is still
  // open for this release, the proof is a point-in-time read, and the write is
  // an unconditional deleteField — so a legacy-lane append that commits
  // between our final re-proof and the server applying our delete is still
  // destroyed. Only a server-side compare-and-set could close that; from the
  // client the window can only be narrowed, and it is narrowed here two ways.
  // (1) The drop waits for BOTH signup lanes to go quiet for
  // SIGNUP_ARRAY_DROP_SETTLE_MS: any snapshot on either lane re-runs this
  // effect, which cancels and restarts the timer. That is the practical form
  // of "stable across a server snapshot" — demanding a literal second server
  // snapshot would deadlock the migration, because Firestore never re-delivers
  // an unchanged document. (2) The proof is re-taken from the refs when the
  // timer fires, so an append that has reached this client by then aborts the
  // drop instead of racing it.
  //
  // On write failure the guard clears so a later session retries.
  const droppedSignupArraysTeamsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (realRole !== "head") return;
    if (!activeTeamId || !user || loadedTeamIdRef.current !== activeTeamId) {
      return;
    }
    if (droppedSignupArraysTeamsRef.current.has(activeTeamId)) return;
    const landed = signupSubsLandedRef.current;
    if (!landed.tryoutSignups || !landed.interestSignups) return;
    const serverConfirmed = signupSubsServerConfirmedRef.current;
    if (!serverConfirmed.tryoutSignups || !serverConfirmed.interestSignups) {
      return;
    }
    if (!signupArraysFullyMigrated()) return;
    const teamId = activeTeamId;
    const timer = setTimeout(() => {
      // Re-prove everything that can still have moved during the settle
      // window. loadedTeamIdRef pins the refs to this team (its cleanup nulls
      // it on a switch), and the coverage check re-reads them.
      if (droppedSignupArraysTeamsRef.current.has(teamId)) return;
      if (loadedTeamIdRef.current !== teamId) return;
      if (!signupArraysFullyMigrated()) return;
      droppedSignupArraysTeamsRef.current.add(teamId);
      dropLegacySignupArrays(db, appId, teamId).catch(() => {
        droppedSignupArraysTeamsRef.current.delete(teamId);
      });
    }, SIGNUP_ARRAY_DROP_SETTLE_MS);
    // Any re-evaluation — a snapshot on either lane, a team switch, unmount —
    // cancels the pending drop; the next pass re-proves coverage and re-arms.
    // The once-guard is deliberately NOT consumed here: it is taken only when
    // the write is actually issued, so an interrupted settle window never
    // burns this team's single attempt for the session.
    return () => clearTimeout(timer);
    // Depends on the assembled arrays so the check re-runs as the
    // subscription snapshots land (the async half of the coverage evidence —
    // each backfilled doc arrives through them), and on the progress tick so
    // it re-runs the moment server confirmation arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTeamId,
    user?.uid,
    realRole,
    loadingActive,
    signupSubsProgressTick,
    teamData.tryoutSignups,
    teamData.interestSignups,
  ]);

  // Keep the team-switcher list's name in sync with the team doc. The doc is
  // authoritative (Settings edits it via updateTeam); each member's settings
  // doc carries its own {id, name} copy written at create/join time, so a
  // rename self-heals here on their next load. Only writes when the names
  // actually differ, so this never loops.
  useEffect(() => {
    if (!user || !activeTeamId) return;
    if (loadedTeamIdRef.current !== activeTeamId) return;
    const docName = String(teamData?.name || "").trim();
    if (!docName) return;
    const entry = teams.find((t) => t.id === activeTeamId);
    if (!entry || entry.name === docName) return;
    const next = teams.map((t) =>
      t.id === activeTeamId ? { ...t, name: docName } : t,
    );
    setTeams(next);
    const ref = doc(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "settings",
      "teams",
    );
    void setDoc(ref, { teams: next }, { merge: true }).catch(() => {
      // Best-effort: the local list already updated; the stored copy heals on
      // a later load.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamData?.name, activeTeamId, user?.uid, teams, loadingActive]);

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
  // and the cadence is active for anyone on the team, surface a one-tap
  // toast that opens a pre-filled mailto: draft to the coaches who haven't
  // submitted (the head sends it from their own mail app — the Gmail API
  // send was removed; see below). A `lastEvalEmailedAt` cool-off guard
  // (7 days) inside emailPromptStatus prevents re-prompting on every page
  // load while a cadence stays active. One-per-session ref keeps the same
  // tab from prompting twice while the Firestore write is in flight.
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
  // ?join= flow in progress — that's the gate for showing the /welcome page.
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
  // Split into two context values (see contexts.ts): the data half changes on
  // every Firestore snapshot; the actions half is ~90 stable callbacks whose
  // identities survive snapshots (they read the freshest team via
  // teamDataRef), so command-only consumers subscribed through
  // useTeamActions() never re-render on data changes.
  const dataValue = useMemo(
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
      // True once BOTH signup subscriptions have delivered a first snapshot.
      // Signups live in subcollections now, so an empty list is ambiguous —
      // "not delivered yet" vs "this team has none" — and `loading` covers
      // only the team doc. Consumers that look a signup up by id (the letter
      // pages) must not treat "absent" as "missing" until this is true, or a
      // deep link bounces the coach out of the page they opened.
      signupsReady,
      signupsDenied,
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
      signupsReady,
      signupsDenied,
    ],
  );

  const actionsValue = useMemo(
    () => ({
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
      addTournament,
      updateTournament,
      setPlannedOutings,
      removeTournament,
      setPlayerHealth,
      updateDevPlan,
      addGoal,
      setGoalStatus,
      removeGoal,
      addCheckIn,
      toggleAssignedDrill,
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
      addTournament,
      updateTournament,
      setPlannedOutings,
      removeTournament,
      setPlayerHealth,
      updateDevPlan,
      addGoal,
      setGoalStatus,
      removeGoal,
      addCheckIn,
      toggleAssignedDrill,
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

  return (
    <TeamContext.Provider value={dataValue as unknown as TeamContextValue}>
      <TeamActionsContext.Provider
        value={actionsValue as unknown as TeamContextValue}
      >
        {children}
      </TeamActionsContext.Provider>
    </TeamContext.Provider>
  );
};
