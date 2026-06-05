import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  memo,
  lazy,
  Suspense,
} from "react";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
  arrayRemove,
} from "firebase/firestore";
import { Icons } from "./icons";
import { auth, db, appId } from "./firebase";
import {
  ToastContext,
  TeamContext,
  UIContext,
  useToast,
  useTeam,
  useUI,
} from "./contexts";
import { SharedModals, downscaleImageToDataURL } from "./components/shared";
import {
  OnboardingTutorial,
  onboardingHasBeenCompleted,
} from "./components/OnboardingTutorial";
import {
  useLocation,
  useNavigate,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { WelcomeChooser } from "./components/WelcomeChooser";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  LoginScreen,
  AppHeader,
  TabBarNav,
  OfflineBanner,
} from "./components/Chrome";
import {
  PlayerProfileModal,
  AddPlayerModal,
  PastSeasonImportModal,
} from "./components/modals";
import {
  slimGame,
  scrubUndefined,
  blankStats,
  emailPromptStatus,
  restampEvalDueDates,
  isReturning,
  isGameFinalized,
  countsTowardStats,
  buildPublicMirror,
  revertOptimisticUpdate,
  estimateDocSizeBytes,
  FIRESTORE_DOC_LIMIT_BYTES,
  DOC_SIZE_WARN_RATIO,
} from "./utils/helpers";
import { sendGmailMessage } from "./integrations/gmailSend";
import { useMainShellRouting } from "./hooks/useMainShellRouting";
import { useTeamMembership } from "./hooks/useTeamMembership";
import { useInviteFlows } from "./hooks/useInviteFlows";
import { useImportExportFlows } from "./hooks/useImportExportFlows";
import { useScheduleReminders } from "./hooks/useScheduleReminders";
import { useGameCrud } from "./hooks/useGameCrud";
import { usePlayerCrud } from "./hooks/usePlayerCrud";
import { usePastSeasonCrud } from "./hooks/usePastSeasonCrud";
import { useTryoutFlows } from "./hooks/useTryoutFlows";
import { useEvaluationCrud } from "./hooks/useEvaluationCrud";
import { useLineupActions } from "./hooks/useLineupActions";
import {
  getLocalDateString,
  bumpAgeTier,
  computeNextSeason,
  DEFAULT_TEAM_DATA,
  EVAL_SCHEMA_VERSION,
} from "./constants/ui";

// Pure-function lineup engine. Lives in ./lineupEngine.js next to this file.

// Screens are lazy-loaded so the initial bundle stays small. The Routes
// blocks below are wrapped in <Suspense> with a tiny spinner fallback.
// `import().then(m => ({ default: m.X }))` is the named-export shim
// React.lazy needs — every screen here exports its component as a named
// const, not a default.
const HomeTab = lazy(() =>
  import("./screens/HomeTab").then((m) => ({ default: m.HomeTab }))
);
const RosterTab = lazy(() =>
  import("./screens/RosterTab").then((m) => ({ default: m.RosterTab }))
);
const ScheduleTab = lazy(() =>
  import("./screens/ScheduleTab").then((m) => ({ default: m.ScheduleTab }))
);
const EvaluationTab = lazy(() =>
  import("./screens/EvaluationTab").then((m) => ({
    default: m.EvaluationTab,
  }))
);
const SettingsTab = lazy(() =>
  import("./screens/SettingsTab").then((m) => ({ default: m.SettingsTab }))
);
const AssistantEvalTab = lazy(() =>
  import("./screens/AssistantEvalTab").then((m) => ({
    default: m.AssistantEvalTab,
  }))
);
const TryoutsTab = lazy(() =>
  import("./screens/TryoutsTab").then((m) => ({ default: m.TryoutsTab }))
);
const InterestTab = lazy(() =>
  import("./screens/InterestTab").then((m) => ({ default: m.InterestTab }))
);
const TryoutsPortal = lazy(() =>
  import("./screens/TryoutsPortal").then((m) => ({
    default: m.TryoutsPortal,
  }))
);
const InGameView = lazy(() =>
  import("./screens/InGameView").then((m) => ({ default: m.InGameView }))
);

// Screen labels used to build the dynamic browser-tab title
// ("<Team> · <Screen>"). "home" reads as "Dashboard" to match its nav label.
const TAB_TITLE_LABELS: Record<string, string> = {
  home: "Dashboard",
  roster: "Roster",
  schedule: "Schedule",
  evaluation: "Evaluation",
  tryouts: "Tryouts",
  interest: "Interest",
  settings: "Settings",
};

// Suspense fallback used while a lazy-loaded screen chunk is fetching.
// Kept dead-simple and consistent across every route — a centered
// spinner so layout doesn't reflow when the chunk arrives.
const ScreenLoader = () => (
  <div className="flex items-center justify-center py-16 text-ink-3">
    <Icons.Refresh className="w-5 h-5 animate-spin" />
  </div>
);

/* ============================================================================
   SECTION 2 · Firebase setup — see ./firebase.js
   SECTION 3 · Pure helpers — see ./utils/helpers.js
============================================================================ */

/* ============================================================================
   SECTION 4 · UI-only constants — see ./constants/ui.js
============================================================================ */

const authDiag = (event: any, details = {}) => {
  if (typeof console === "undefined") return;
  console.info("[auth-diag]", event, {
    ts: new Date().toISOString(),
    ...details,
  });
};

/* ============================================================================
   SECTION 5 · Toast system (replaces scattered setGenerationError)
============================================================================ */
const ToastProvider = ({ children }: any) => {
  const [toasts, setToasts] = useState<any[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: any) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: any) => {
      counter.current += 1;
      const id = counter.current;
      const t = { id, kind: "info", duration: 4000, ...toast };
      setToasts((cur) => [...cur, t]);
      if (t.duration > 0) {
        setTimeout(() => dismiss(id), t.duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const TOAST_TONES = {
  success: {
    accent: "#10b981",
    iconBg: "linear-gradient(180deg, #10b981, #059669)",
    iconShadow: "0 2px 6px rgba(16,185,129,0.35)",
    actionColor: "#047857",
    actionBorder: "#a7f3d0",
  },
  error: {
    accent: "#f43f5e",
    iconBg: "linear-gradient(180deg, #f43f5e, #e11d48)",
    iconShadow: "0 2px 6px rgba(244,63,94,0.35)",
    actionColor: "#b91c1c",
    actionBorder: "#fecaca",
  },
  warn: {
    accent: "#f59e0b",
    iconBg: "linear-gradient(180deg, #fbbf24, #f59e0b)",
    iconShadow: "0 2px 6px rgba(245,158,11,0.35)",
    actionColor: "#a16207",
    actionBorder: "#fcd34d",
  },
  info: {
    accent: "var(--team-primary)",
    iconBg: "linear-gradient(180deg, #3b82f6, var(--team-primary))",
    iconShadow: "0 2px 6px rgba(37,99,235,0.35)",
    actionColor: "var(--team-primary)",
    actionBorder: "#bfdbfe",
  },
};

const toastIcon = (kind: any) => {
  if (kind === "success") return Icons.Check;
  if (kind === "error") return Icons.Alert;
  if (kind === "warn") return Icons.Alert;
  return Icons.Cloud;
};

const ToastContainer = memo(({ toasts, dismiss }: any) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2.5 max-w-sm w-[min(92vw,360px)] print:hidden">
      {toasts.map((t: any) => {
        const tone = (TOAST_TONES as any)[t.kind] || TOAST_TONES.info;
        const Icon = toastIcon(t.kind);
        return (
          <div
            key={t.id}
            className="relative bg-surface rounded-xl shadow-lg border border-slate-900/5 overflow-hidden flex items-center gap-3 pl-4 pr-3 py-3"
            role="status"
          >
            <span
              className="absolute left-0 top-0 bottom-0 w-1"
              style={{ backgroundColor: tone.accent }}
            />
            <span
              className="shrink-0 w-9 h-9 rounded-[10px] grid place-items-center text-white"
              style={{ background: tone.iconBg, boxShadow: tone.iconShadow }}
            >
              <Icon className="w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              {t.title && (
                <div className="t-button text-ink" style={{ fontSize: "12px" }}>
                  {t.title}
                </div>
              )}
              {t.message && (
                <div className="text-[11.5px] font-semibold text-ink-2 mt-0.5 leading-snug">
                  {t.message}
                </div>
              )}
            </div>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 t-button px-2.5 py-1.5 rounded-lg border bg-transparent hover:bg-surface-2"
                style={{
                  color: tone.actionColor,
                  borderColor: tone.actionBorder,
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 w-[22px] h-[22px] grid place-items-center text-ink-3 hover:text-ink rounded-md"
            >
              <Icons.X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

/* ============================================================================
   SECTION 6 · TeamContext   — see ./contexts
   SECTION 7 · UIContext     — see ./contexts
   The hooks (useToast / useTeam / useUI) live in ./contexts so screens
   can import them without dragging the providers.
============================================================================ */

/* ============================================================================
   SECTION 8 · Small reusable presentational components — see ./components/shared.jsx
============================================================================ */

/* ============================================================================
   SECTION 9 · LoginScreen, AppHeader, TabBarNav — see ./components/Chrome.jsx
============================================================================ */

/* ============================================================================
   SECTION 10 · HomeTab — see ./screens/HomeTab
============================================================================ */

/* ============================================================================
   SECTION 11 · RosterTab — see ./screens/RosterTab
============================================================================ */

/* ============================================================================
   SECTION 12 · ScheduleTab — see ./screens/ScheduleTab (also includes ScoreEditor)
============================================================================ */

/* ============================================================================
   SECTION 13 · EvaluationTab + RosterDecisionsPanel — see ./screens/EvaluationTab
============================================================================ */

/* ============================================================================
   SECTION 14 · SettingsTab — see ./screens/SettingsTab
============================================================================ */

/* ============================================================================
   SECTION 15 · PlayerProfileModal — see ./components/modals.jsx
   SECTION 16 · AddPlayerModal     — see ./components/modals.jsx
============================================================================ */

/* ============================================================================
   SECTION 17 · TeamProvider — owns team state, Firebase subscriptions, actions
   This replaces the prop-drilled state/actions object in the original.
============================================================================ */
const TeamProvider = ({ children }: any) => {
  const toast = useToast();

  // Auth + team-list state
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(DEFAULT_TEAM_DATA);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingActive, setLoadingActive] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [genError, setGenError] = useState(""); // login screen only

  const previousLineupRef = useRef<any>(null);
  // Bridge to UIProvider: lineup/eval screens publish their in-progress inputs
  // and receive generated results through this ref. Owned here (TeamProvider)
  // and passed to the lineup/eval action hooks + exposed on the context value.
  const uiBridge = useRef<any>({ getInputs: () => null, applyResult: () => {} });
  const persistTeamRef = useRef<any>(null);
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
  const lastPersistErrorRef = useRef<{ code: string; message: string } | null>(null);
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

  const bootstrapDefaultTeam = useCallback(async () => {
    if (!user) return null;
    if (bootstrapAttemptedRef.current) return null;
    bootstrapAttemptedRef.current = true;
    const id = "team-" + Math.random().toString(36).substring(2, 10);
    const teamRef = doc(db, "artifacts", appId, "public", "data", "teams", id);
    const settingsRef = doc(db, "artifacts", appId, "users", user.uid, "settings", "teams");
    try {
      await setDoc(teamRef, {
        ...DEFAULT_TEAM_DATA,
        name: "My Team",
        ownerId: user.uid,
        members: [user.uid],
      });
      await setDoc(settingsRef, {
        teams: [{ id, name: "My Team" }],
        activeTeamId: id,
      });
      setTeams([{ id, name: "My Team" }]);
      setActiveTeamId(id);
      return id;
    } catch (e: any) {
      bootstrapAttemptedRef.current = false;
      toast.push({
        kind: "error",
        title: "Setup failed",
        message: "We couldn't create your default team yet. Please try again.",
      });
      return null;
    }
  }, [user, toast]);

  // Auth subscription
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenFromHost = (typeof window !== "undefined" && (window as any).__initial_auth_token) || null;
        if (tokenFromHost) {
          await signInWithCustomToken(auth, tokenFromHost);
        }
      } catch (e: any) {
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
      "teams"
    );
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        let data = snap.exists() ? snap.data() : null;
        if (!data || !data.teams || data.teams.length === 0) {
          // No teams yet for this user. The MainShell renders <WelcomeChooser>
          // off the empty `teams` list so the coach explicitly picks Join vs
          // Create. We no longer force-create "My Team" here — that produced a
          // throwaway team for anyone whose actual intent was to join via the
          // 6-char code. The ?join= redemption flow still goes through
          // bootstrapDefaultTeam() as a fallback when its lookup fails (see the
          // join effect below).
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
      },
      (err) => {
        toast.push({
          kind: "error",
          title: "Connection error",
          message: err.message,
        });
        setLoadingTeams(false);
      }
    );
    return () => unsub();
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
      activeTeamId
    );
    let unsub = () => {};
    let retryTimeout: any = null;
    let cancelled = false;
    let permissionRetried = false;

    const handleSnap = (snap: any) => {
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
              migratedEvents = migratedEvents.map((ev: any) => {
                if (!ev?.grades) return ev;
                const nextGrades: Record<string, any> = {};
                for (const [pid, grade] of Object.entries(ev.grades)) {
                  if (!grade || typeof grade !== "object") {
                    nextGrades[pid] = grade;
                    continue;
                  }
                  const out: Record<string, any> = {};
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
                "P", "C", "1B", "2B", "3B", "SS",
                "LF", "LCF", "CF", "RCF", "RF",
              ];
              migratedPlayers = migratedPlayers.map((p: any) => {
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
                  (pos) => !restrictions.includes(pos)
                );
                return {
                  ...p,
                  comfortablePositions:
                    Array.isArray(p.comfortablePositions)
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
              migratedPlayers = migratedPlayers.map((p: any) => {
                if (!p) return p;
                const comfort = Array.isArray(p.comfortablePositions)
                  ? p.comfortablePositions
                  : [];
                const isCatcher = comfort.includes("C")
                  ? p.primaryPosition === "C"
                  : p.isCatcher === true;
                const next = comfort.filter((pos: any) => pos !== "C");
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
              const avgGrade = (a: any, b: any): number | undefined => {
                const nums = [a, b].filter(
                  (x) => typeof x === "number" && Number.isFinite(x)
                );
                if (nums.length === 0) return undefined;
                return Math.max(
                  1,
                  Math.min(5, Math.round(nums.reduce((s, x) => s + x, 0) / nums.length))
                );
              };
              const carry = [
                "contact", "power", "baseballIQ", "coachability",
                "velocity", "offSpeed", "composure",
                "receiving", "blocking", "gameCalling",
                // already-merged ids (idempotent if a round was partly migrated)
                "approach", "fielding", "arm", "strikes", "speedBaserunning", "throwing",
              ];
              migratedEvents = migratedEvents.map((ev: any) => {
                if (!ev?.grades) return ev;
                const nextGrades: Record<string, any> = {};
                for (const [pid, grade] of Object.entries(ev.grades)) {
                  if (!grade || typeof grade !== "object") {
                    nextGrades[pid] = grade;
                    continue;
                  }
                  const g: any = grade;
                  const out: Record<string, any> = {};
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
            persistTeamRef.current?.({
              evaluationEvents: migratedEvents,
              players: migratedPlayers,
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
        }
        // Mark which team's data is now loaded so write-effects (auto-correct)
        // can safely run against real data instead of the placeholder.
        loadedTeamIdRef.current = activeTeamId;
        setLoadingActive(false);
    };

    // Immediately after a join/invite write, the server may still reject
    // our read because the membership change hasn't propagated to the
    // rules engine yet. Swallow the first permission-denied error and
    // re-subscribe after a short delay; only surface a toast if the
    // retry also fails.
    const handleErr = (err: any) => {
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
    async (updates: any, opts?: { silent?: boolean }): Promise<boolean> => {
      if (!activeTeamId) return false;
      // Slim any games being persisted — strip embedded player objects down
      // to {id, name, number} to stay under the Firestore 1MB document limit.
      let toPersist = updates;
      if (Array.isArray(updates.games)) {
        toPersist = { ...updates, games: updates.games.map(slimGame) };
      }
      // Scrub any undefined values from the tree — Firestore rejects them.
      toPersist = scrubUndefined(toPersist);

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
              estimated / 1024
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
          activeTeamId
        );
        await setDoc(ref, toPersist, { merge: true });
        setSyncStatus("Synced");
        setTimeout(() => setSyncStatus(""), 1500);
        lastPersistErrorRef.current = null;
        return true;
      } catch (e: any) {
        setSyncStatus("");
        const code = (e && e.code) || "";
        const message = (e && e.message) || String(e);
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
    [activeTeamId, toast]
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
        activeTeamId
      );
      try {
        await setDoc(ref, { ...mirror, updatedAt: Date.now() }, { merge: true });
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
    [activeTeamId]
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
            message: "Couldn't update the public page. Check your connection and try again.",
          }
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
    const code = String(teamData?.joinCode || "").trim().toUpperCase();
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
      code
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
    (updates: any) => {
      // Snapshot the prior value of every key we're about to optimistically
      // overwrite so a failed save can be rolled back. teamDataRef holds the
      // freshest committed state without widening this callback's deps.
      const prev = teamDataRef.current || {};
      const prevValues: Record<string, unknown> = {};
      for (const k of Object.keys(updates)) prevValues[k] = prev[k];

      setTeamData((p: any) => ({ ...p, ...updates })); // optimistic
      void persistTeam(updates, { silent: true }).then((ok) => {
        if (ok) return;
        // Persistence failed: revert the optimistic patch (but only for keys
        // the user hasn't since changed — see revertOptimisticUpdate) so the UI
        // never silently retains state Firestore rejected, and offer a retry.
        setTeamData((cur: any) => revertOptimisticUpdate(cur, updates, prevValues));
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
            onClick: () => updateTeam(updates),
          },
        });
      });
    },
    [persistTeam, toast]
  );

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
    const updates: Record<string, any> = {};
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
  }, [_league, _teamAge, _defenseSize, _pitchingFormat, updateTeam, activeTeamId, loadingActive]);
  // ----- Roster actions -----
  // ----- Player CRUD ----- (extracted to src/hooks/usePlayerCrud.ts)
  const { addPlayer, updatePlayer, updatePlayerNested, removePlayer } =
    usePlayerCrud({ teamData, updateTeam, toast });

  // ----- Past-season CRUD ----- (extracted to src/hooks/usePastSeasonCrud.ts)
  const { addPastSeason, updatePastSeason, removePastSeason, bulkAddPastSeasons } =
    usePastSeasonCrud({ teamData, updateTeam });

  // ----- Coach actions -----
  const addCoach = useCallback(
    (form: any) => {
      if (!form.name.trim()) return;
      const newCoach = {
        id: "c-" + Math.random().toString(36).substring(2, 10),
        name: form.name.trim(),
        role: form.role,
      };
      updateTeam({ coaches: [...teamData.coaches, newCoach] });
    },
    [teamData.coaches, updateTeam]
  );

  const removeCoach = useCallback(
    (id: any) => {
      updateTeam({ coaches: teamData.coaches.filter((c: any) => c.id !== id) });
    },
    [teamData.coaches, updateTeam]
  );

  // ----- Game actions ----- (extracted to src/hooks/useGameCrud.ts)
  const { addGame, updateGame, postponeGame, finalizeGame, deleteSavedGame } =
    useGameCrud({ teamData, updateTeam, toast });

  // ----- Lineup actions ----- (extracted to src/hooks/useLineupActions.ts)
  const {
    generateLineup,
    regenerateLineup,
    regenerateDefense,
    regenerateBatting,
    undoLineup,
    saveCurrentGame,
    saveLineupTemplate,
    applyLineupTemplate,
    deleteLineupTemplate,
    removePlayerMidGame,
  } = useLineupActions({ teamData, updateTeam, updateGame, persistTeam, toast, uiBridge, previousLineupRef });

  // ----- Team management -----
  const switchTeam = useCallback(
    async (id: any) => {
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
          "teams"
        );
        await setDoc(ref, { activeTeamId: id }, { merge: true });
      } catch (e: any) {
        /* non-fatal */
      }
    },
    [user]
  );

  const createTeam = useCallback(
    async (name: any) => {
      if (!user || !name.trim()) return false;
      const id = "team-" + Math.random().toString(36).substring(2, 10);
      setSyncStatus("Creating");
      try {
        const teamRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          id
        );
        await setDoc(teamRef, {
          ...DEFAULT_TEAM_DATA,
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
          "teams"
        );
        await setDoc(
          userRef,
          { teams: [...teams, { id, name: name.trim() }], activeTeamId: id },
          { merge: true }
        );
        toast.push({ kind: "success", title: "Team created" });
        setSyncStatus("");
        return true;
      } catch (e: any) {
        setSyncStatus("");
        toast.push({
          kind: "error",
          title: "Could not create team",
          message: e.message,
        });
        return false;
      }
    },
    [user, teams, toast]
  );

  const advanceSeason = useCallback((opts: any = {}) => {
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
    const isDropped = (p: any) => !isReturning(p);
    const droppedCount = teamData.players.filter(isDropped).length;
    // Tryout accepts ride on the same `team.players` array with
    // playerStatus === "accepted" — they join the new roster directly.
    const acceptedCount = teamData.players.filter(
      (p: any) => p.playerStatus === "accepted"
    ).length;

    // Confirmation
    const confirmMsg =
      `Archive ${archivedSeason} (${archivedAge}, ${archivedFormat})?\n\n` +
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
      `• New season: ${nextSeason}` +
      (shouldBump
        ? ` (age advances ${archivedAge} → ${newAgeGroup})`
        : ` (age stays ${archivedAge})`) +
      `\n\n` +
      `This cannot be undone.`;

    // The AdvanceSeasonModal already walked the head through every
    // marking and showed a full summary, so the window.confirm here is
    // a duplicate gate when the call came from the wizard. Direct
    // callers (anywhere besides the modal) still see the confirm
    // dialog.
    if (!skipConfirm && !window.confirm(confirmMsg)) return;

    const nowIso = new Date().toISOString();

    // Archive each player's current stats into pastSeasons[]; drop the
    // ones marked Released/Declined; reset surviving statuses to
    // "returning" so the next cycle starts clean.
    const updatedPlayers = teamData.players
      .filter((p: any) => !isDropped(p))
      .map((p: any) => {
        const past = Array.isArray(p.pastSeasons) ? [...p.pastSeasons] : [];
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
    const promotedPlayers = (teamData.tryoutSignups || [])
      .filter((s: any) => promotionSet.has(s.id))
      .map((s: any) => ({
        id: "p-" + Math.random().toString(36).slice(2, 10),
        name: `${s.firstName || ""} ${s.lastName || ""}`.trim() || "Player",
        number: s.tryoutNumber || s.number || "",
        dob: s.dob || "",
        bats: s.bats || "R",
        throws: s.throws || "R",
        comfortablePositions: [
          ...(Array.isArray(s.comfortablePositions) ? s.comfortablePositions : []).filter(
            (p: any) => p !== "C"
          ),
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
      }));

    updateTeam({
      currentSeason: nextSeason,
      teamAge: newAgeGroup,
      players: [...updatedPlayers, ...promotedPlayers],
      games: [],
      evaluationEvents: [],
      tryoutSignups: [],
      tryoutsOpen: false,
      lastSeasonAdvanceAt: nowIso,
    });
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
  }, [teamData, updateTeam, toast]);

  const uploadLogo = useCallback(
    (e: any) => {
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
          })
        );
    },
    [teamData, updateTeam, toast]
  );

  const {
    uploadScheduleCsv,
    uploadStatsCsv,
    exportBackup,
    exportRosterCsv,
    exportNewPlayersCsv,
    setPlayerStatus,
    setPlayerReturning,
    importBackup,
  } = useImportExportFlows({ teamData, updateTeam, activeTeamId, toast });

  const deleteTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    if (!window.confirm("Permanently delete this team? This cannot be undone."))
      return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId)
      );
      const remaining = teams.filter((t) => t.id !== activeTeamId);
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "teams"
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true }
      );
      toast.push({ kind: "success", title: "Team deleted" });
    } catch (e: any) {
      toast.push({ kind: "error", title: "Delete failed", message: e.message });
    }
  }, [user, teams, activeTeamId, toast]);

  const leaveTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    if (!window.confirm("Leave this team?")) return;
    try {
      const teamRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        activeTeamId
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
        "teams"
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true }
      );
      toast.push({ kind: "success", title: "Left team" });
    } catch (e: any) {
      toast.push({
        kind: "error",
        title: "Could not leave",
        message: e.message,
      });
    }
  }, [user, teams, activeTeamId, toast]);

  // ----- Evaluation CRUD ----- (extracted to src/hooks/useEvaluationCrud.ts)
  const {
    saveTeamEvaluation,
    saveAssistantEvaluation,
    deleteEvaluation,
  } = useEvaluationCrud({ teamData, updateTeam, toast, user, uiBridge });

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
    saveTryoutEvaluation,
    acceptTryout,
  } = useTryoutFlows({ teamData, updateTeam, toast, user, activeTeamId });

  const { setCoachRole } = useTeamMembership({ teamData, updateTeam, user });
  const {
    regenerateJoinCode,
    joinTeamByCode,
  } = useInviteFlows({
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
  const setViewAsRole = useCallback((next: any) => {
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
      const others = members.filter((uid: any) => uid && uid !== user.uid);
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
        (teamData.coachRoles &&
          Object.keys(teamData.coachRoles).length > 0) ||
        (Array.isArray(teamData.members) && teamData.members.length > 0)
    );
  }, [user, teamData.ownerId, teamData.coachRoles, teamData.members]);

  // Visible role for the rest of the app. Only the head coach can flip
  // themselves to assistant; assistants can never escalate.
  const currentRole = useMemo<"head" | "assistant">(() => {
    if (realRole === "head" && viewAsRole === "assistant") return "assistant";
    return realRole;
  }, [realRole, viewAsRole]);

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
    const otherMembers = members.filter((uid: any) => uid && uid !== user.uid);
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
    const subject = `[${teamName}] Eval round due`;
    const buildBody = (recipientName: any) =>
      [
        `Hi ${recipientName || "coach"},`,
        "",
        `${fromName} is asking for a fresh evaluation round for ${teamName}.`,
        "",
        "Open the eval form in LineupTool and submit your grades:",
        url,
        "",
        "This is an automatic reminder. You can mute these in Settings -> Coaches.",
      ].join("\n");

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
        (cc: any) =>
          cc.uid === uid ||
          (cc.email &&
            (teamData.coachRoles || {})[uid] === "assistant" &&
            // best-effort match: same email between members + contacts
            false)
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

    (async () => {
      let sent = 0;
      for (const r of finalRecipients) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await sendGmailMessage({
            auth,
            to: r.email,
            subject,
            body: buildBody(r.name),
            fromEmail: user.email,
            fromName,
          });
          sent++;
        } catch {
          // Silent on Gmail failures — we don't want a flood of toasts
          // on app open. If consent was declined, the user will see the
          // popup once.
        }
      }
      persistTeamRef.current?.({
        lastEvalEmailedAt: new Date().toISOString(),
      });
      if (sent > 0) {
        toast.push({
          kind: "success",
          title: `Reminder emails sent (${sent})`,
          message: "Coaches were notified that an eval round is due.",
        });
      }
    })();
  }, [
    authReady,
    user,
    activeTeamId,
    realRole,
    teamData,
    loadingActive,
    toast,
  ]);

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
          setGenError("Google sign-in redirect did not complete. Try opening this link in Safari/Chrome, then sign in again.");
        }
      } catch (e: any) {
        if (cancelled) return;
        authDiag("redirect_result_error", { code: e?.code || null, message: e?.message || null });
        clearRedirectPending();
        setGenError(e?.message || "Sign-in failed");
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
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      };
      const savedEmail = window.localStorage.getItem("emailForSignIn");
      const email = savedEmail || window.prompt("Enter your email to complete sign-in") || "";
      if (!email) return;
      try {
        await signInWithEmailLink(auth, email, window.location.href);
        if (cancelled) return;
        window.localStorage.removeItem("emailForSignIn");
        clearEmailLinkParams();
        authDiag("email_link_success");
        setGenError("");
      } catch (e: any) {
        if (cancelled) return;
        authDiag("email_link_error", { code: e?.code || null, message: e?.message || null });
        if (e?.code === "auth/invalid-action-code" || e?.code === "auth/expired-action-code") {
          window.localStorage.removeItem("emailForSignIn");
          clearEmailLinkParams();
        }
        setGenError(e?.message || "Email sign-in failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [authReady, user, loadingTeams, joinTeamByCode, teams.length, bootstrapDefaultTeam]);

  // Win-loss record derived from final games only.
  const record = useMemo(() => {
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
    return { wins, losses, ties, runsScored, runsAllowed };
  }, [teamData.games]);

  // True when a signed-in user has no teams yet AND there's no pending
  // ?join= flow in progress — that's the gate for showing the WelcomeChooser.
  const hasPendingJoinFlow =
    typeof window !== "undefined" &&
    Boolean(
      sessionStorage.getItem("pendingJoin") ||
        new URLSearchParams(window.location.search).get("join")
    );
  const needsWelcomeChooser =
    !!user &&
    authReady &&
    !loadingTeams &&
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
      generateLineup,
      regenerateLineup,
      regenerateBatting,
      regenerateDefense,
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      exportRosterCsv,
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
      acceptTryout,
      saveTryoutEvaluation,
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
      generateLineup,
      regenerateLineup,
      regenerateBatting,
      regenerateDefense,
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      exportRosterCsv,
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
      acceptTryout,
      saveTryoutEvaluation,
      saveLineupTemplate,
      applyLineupTemplate,
      deleteLineupTemplate,
      removePlayerMidGame,
      setCoachRole,
      regenerateJoinCode,
      joinTeamByCode,
    ]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

/* ============================================================================
   SECTION 18 · UIProvider — local UI state (modals, selections, attendance)
   Bridges back to TeamProvider through `uiBridge` ref so generate/save can
   read the current UI state without re-rendering on every keystroke.
============================================================================ */
const UIProvider = ({ children }: any) => {
  const team = useTeam();
  const toast = useToast();

  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
    onConfirm: null,
  });

  // Schedule tab state
  const [selectedGameId, setSelectedGameId] = useState<any>(null);
  const [isAddingGame, setIsAddingGame] = useState(false);
  const [newGameForm, setNewGameForm] = useState({
    date: getLocalDateString(),
    opponent: "",
    leagueRuleSet: "USSSA",
    pitchingFormat: "Kid Pitch",
    isScrimmage: false,
  });
  const [scoringGameId, setScoringGameId] = useState<any>(null); // game whose score is being entered inline
  const [inGameId, setInGameId] = useState<any>(null); // game currently in In-Game mode
  const [inGameInning, setInGameInning] = useState(0); // current inning during in-game mode (0-indexed)
  const [inGameSelection, setInGameSelection] = useState<any>(null); // { type: "position"|"bench", pos?, playerId } — first tap of a swap pair
  const [inGameUndoStack, setInGameUndoStack] = useState<any[]>([]); // last swap undo data
  const [activeTab, setActiveTab] = useState("home");
  const [pastSeasonImport, setPastSeasonImport] = useState<any>(null); // null when closed; { rows, season, ageGroup, pitchingFormat, assignments } when open
  const [currentGameAttendance, setCurrentGameAttendance] = useState<any>({});
  const [firstInningLineup, setFirstInningLineup] = useState<any>({});
  const [lineup, setLineup] = useState<any>(null);
  const [battingLineup, setBattingLineup] = useState<any>(null);
  // Penalty score emitted by the engine for the current in-editor lineup
  // (null when no generated lineup is in scope). Lower = better.
  const [lineupQualityPenalty, setLineupQualityPenalty] = useState<any>(null);
  const [swapSelection, setSwapSelection] = useState<any>(null);
  const [gameSaved, setGameSaved] = useState(false);
  const [opponentName, setOpponentName] = useState("");

  // Header state
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [assistantEvalOpen, setAssistantEvalOpen] = useState(false);

  // Roster/profile state
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [viewingPlayerId, setViewingPlayerId] = useState<any>(null);

  // Coach state
  const [isAddingCoach, setIsAddingCoach] = useState(false);
  const [newCoachForm, setNewCoachForm] = useState({
    name: "",
    role: "Head Coach",
  });

  // Eval state
  const [teamEvalGrades, setTeamEvalGrades] = useState<any>({});
  // Eval round selection: null = creating a new round, otherwise = id of an
  // existing eval event being viewed/edited.
  const [selectedRoundId, setSelectedRoundId] = useState<any>(null);
  // Player whose eval trend modal is currently open (null = closed)
  const [evalTrendPlayerId, setEvalTrendPlayerId] = useState<any>(null);

  // Sync attendance/firstInning/lineup with the selected game
  const gamesRef = useRef(team.team.games);
  useEffect(() => {
    gamesRef.current = team.team.games;
  }, [team.team.games]);

  // Dynamic browser-tab title: "<Team Name> · <Screen>" so the tab (and any
  // bookmark) reflects which team and screen the coach is on. Falls back to
  // the brand name before a team has loaded. The public Tryouts Portal sets
  // its own title (see TryoutsPortal) — this provider doesn't wrap it.
  const teamName = team.team?.name;
  useEffect(() => {
    const screen = inGameId ? "In-Game" : TAB_TITLE_LABELS[activeTab] || "";
    const name = (teamName || "").trim();
    document.title = name
      ? screen
        ? `${name} · ${screen}`
        : name
      : "Coach's Card";
  }, [teamName, activeTab, inGameId]);

  // Snapshot of the game data we last loaded into local editor state, used
  // by the conflict-detection effect below. We compare against this — not
  // against the live `team.team.games` reference — so we can tell whether
  // the *user* edited locally vs. whether a *remote* snapshot changed the
  // game underneath us.
  const loadedGameRef = useRef<any>(null);

  useEffect(() => {
    if (!selectedGameId) {
      loadedGameRef.current = null;
      return;
    }
    const game = gamesRef.current.find((g: any) => g.id === selectedGameId);
    if (!game) return;
    loadedGameRef.current = {
      id: game.id,
      lineupJson: JSON.stringify(game.lineup || null),
      battingJson: JSON.stringify(game.battingLineup || null),
    };
    setOpponentName(game.opponent || "");
    setLineup(game.lineup || null);
    setBattingLineup(game.battingLineup || null);
    setLineupQualityPenalty(
      typeof game.qualityPenalty === "number" ? game.qualityPenalty : null
    );
    setCurrentGameAttendance(game.attendance || {});
    setGameSaved(false);
  }, [selectedGameId]);

  // Detect when a remote Firestore snapshot updates the game we're editing.
  // If the user has no unsaved local changes, silently re-sync. If they do,
  // surface a toast so they know their next save will clobber the remote
  // edit (better than silently overwriting another coach's work).
  useEffect(() => {
    if (!selectedGameId || !loadedGameRef.current) return;
    if (loadedGameRef.current.id !== selectedGameId) return;
    const game = team.team.games.find((g: any) => g.id === selectedGameId);
    if (!game) return;

    const remoteLineupJson = JSON.stringify(game.lineup || null);
    const remoteBattingJson = JSON.stringify(game.battingLineup || null);
    const remoteChanged =
      remoteLineupJson !== loadedGameRef.current.lineupJson ||
      remoteBattingJson !== loadedGameRef.current.battingJson;
    if (!remoteChanged) return;

    const localLineupJson = JSON.stringify(lineup || null);
    const localBattingJson = JSON.stringify(battingLineup || null);
    const localUnsaved =
      localLineupJson !== loadedGameRef.current.lineupJson ||
      localBattingJson !== loadedGameRef.current.battingJson;
    // The remote snapshot already matches what we have locally — this is our
    // OWN save echoing back (or another device landing on the identical
    // lineup), NOT a conflict. Adopt it silently. Without this guard the
    // warning fired on every save you made, since loadedGameRef still held
    // the pre-edit version.
    const remoteMatchesLocal =
      remoteLineupJson === localLineupJson &&
      remoteBattingJson === localBattingJson;

    if (!localUnsaved || remoteMatchesLocal) {
      loadedGameRef.current = {
        id: game.id,
        lineupJson: remoteLineupJson,
        battingJson: remoteBattingJson,
      };
      setLineup(game.lineup || null);
      setBattingLineup(game.battingLineup || null);
      setCurrentGameAttendance(game.attendance || {});
    } else {
      toast.push({
        kind: "warn",
        title: "Game updated remotely",
        message:
          "Another device changed this game while you were editing. Saving now will overwrite those changes.",
        duration: 8000,
      });
      // Update the snapshot so we don't fire the warning again for the
      // same remote version.
      loadedGameRef.current = {
        id: game.id,
        lineupJson: remoteLineupJson,
        battingJson: remoteBattingJson,
      };
    }
  }, [team.team.games, selectedGameId, lineup, battingLineup, toast]);

  // Clear any selected/scoring/in-game id whose underlying game has been
  // deleted (locally or via a remote snapshot). Without this, the UI would
  // try to render against a non-existent game until the next interaction.
  useEffect(() => {
    const ids = new Set(team.team.games.map((g: any) => g.id));
    if (selectedGameId && !ids.has(selectedGameId)) setSelectedGameId(null);
    if (scoringGameId && !ids.has(scoringGameId)) setScoringGameId(null);
    if (inGameId && !ids.has(inGameId)) setInGameId(null);
  }, [team.team.games, selectedGameId, scoringGameId, inGameId]);
  // When players list changes, fill in attendance defaults
  useEffect(() => {
    setCurrentGameAttendance((prev: any) => {
      const next = { ...prev };
      let changed = false;
      for (const p of team.team.players) {
        if (next[p.id] === undefined) {
          next[p.id] = p.present !== false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [team.team.players]);

  // Sync teamEvalGrades based on selectedRoundId:
  //   - If a specific round is selected, load its grades for editing
  //   - If no round selected (= creating new), load from latest round as a
  //     starting baseline. Coach can then adjust and save as a new round.
  useEffect(() => {
    if (!team.user) return;
    const mine = team.team.evaluationEvents
      .filter((e: any) => e.coachRole === "Head" && e.evaluatorId === team.user.uid)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (selectedRoundId) {
      const target = mine.find((e: any) => e.id === selectedRoundId);
      if (target?.grades) setTeamEvalGrades(target.grades);
    } else {
      // Pre-fill with the latest round's grades when starting a new round
      if (mine[0]?.grades) setTeamEvalGrades(mine[0].grades);
    }
  }, [team.user, team.team.evaluationEvents, selectedRoundId]);

  // Lineup edits (swap / add inning / remove inning / reorder batters)
  const handleCellClick = useCallback(
    (innIdx: any, pos: any, player: any) => {
      if (!swapSelection) {
        if (player) setSwapSelection({ innIdx, pos, player });
        return;
      }
      if (swapSelection.innIdx !== innIdx) {
        setSwapSelection({ innIdx, pos, player });
        return;
      }
      if (swapSelection.pos === pos) {
        setSwapSelection(null);
        return;
      }
      setLineup((cur: any) => {
        if (!cur) return cur;
        const next = cur.map((inn: any) => ({
          ...inn,
          BENCH: inn.BENCH ? [...inn.BENCH] : [],
        }));
        const slot = next[innIdx];
        const a = swapSelection.player;
        const b = player;
        if (swapSelection.pos === "BENCH" && pos === "BENCH") return cur;
        if (swapSelection.pos === "BENCH") {
          // a is on bench, b is in pos (or pos empty)
          slot.BENCH = slot.BENCH.filter((p: any) => p.id !== a.id);
          if (b) slot.BENCH.push(b);
          slot[pos] = a;
        } else if (pos === "BENCH") {
          slot.BENCH = slot.BENCH.filter((p: any) => p.id !== b?.id);
          slot.BENCH.push(a);
          slot[swapSelection.pos] = null;
        } else {
          slot[swapSelection.pos] = b || null;
          slot[pos] = a;
        }
        return next;
      });
      setSwapSelection(null);
    },
    [swapSelection]
  );

  const addInning = useCallback(() => {
    if (!lineup) return;
    const last = lineup[lineup.length - 1] || {};
    // Deep-copy BENCH so the new inning doesn't share an array reference with
    // the previous one — a subsequent BENCH edit would otherwise mutate both.
    const cloned = {
      ...last,
      BENCH: Array.isArray(last.BENCH) ? [...last.BENCH] : [],
    };
    setLineup([...lineup, cloned]);
  }, [lineup]);

  const removeInning = useCallback(() => {
    if (!lineup || lineup.length <= 1) return;
    setLineup(lineup.slice(0, -1));
  }, [lineup]);

  const moveBatter = useCallback((idx: any, delta: any) => {
    setBattingLineup((cur: any) => {
      if (!cur) return cur;
      const target = idx + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const openPlayerProfile = useCallback((id: any) => setViewingPlayerId(id), []);

  // Wire the bridge that TeamProvider uses. The ref is a foreign object
  // owned by TeamProvider; mutating it during render would be a
  // setState-like side effect. Defer to an effect that runs after commit
  // so React's rules-of-hooks invariants hold and concurrent rendering
  // can't observe a half-written bridge.
  const uiBridgeRef = team.uiBridge;
  useEffect(() => {
    uiBridgeRef.current = {
      getInputs: () => {
        const currentGame = team.team.games.find(
          (g: any) => g.id === selectedGameId
        );
        return {
          currentGame,
          currentGameAttendance,
          firstInningLineup,
          previousLineup: lineup,
          previousBattingLineup: battingLineup,
          lineup,
          battingLineup,
          lineupQualityPenalty,
          teamEvalGrades,
          selectedRoundId,
        };
      },
      applyResult: ({
        lineup: newLineup,
        battingLineup: newBatting,
        qualityPenalty,
      }: any) => {
        setLineup(newLineup);
        setBattingLineup(newBatting);
        setLineupQualityPenalty(
          typeof qualityPenalty === "number" ? qualityPenalty : null
        );
        setSwapSelection(null);
        setGameSaved(false);
      },
      applyTemplate: (tpl: any) => {
        if (!tpl) return;
        setLineup(tpl.lineup || null);
        setBattingLineup(tpl.battingLineup || null);
        // Templates predate this field — clear it so the chip doesn't
        // show a stale quality score from a different lineup.
        setLineupQualityPenalty(null);
        setSwapSelection(null);
        setGameSaved(false);
      },
      markSaved: () => {
        setGameSaved(true);
        setTimeout(() => setGameSaved(false), 2000);
      },
    };
  });

  const value = useMemo(
    () => ({
      modal,
      setModal,
      selectedGameId,
      setSelectedGameId,
      isAddingGame,
      setIsAddingGame,
      newGameForm,
      setNewGameForm,
      scoringGameId,
      setScoringGameId,
      activeTab,
      setActiveTab,
      pastSeasonImport,
      setPastSeasonImport,
      inGameId,
      setInGameId,
      inGameInning,
      setInGameInning,
      inGameSelection,
      setInGameSelection,
      inGameUndoStack,
      setInGameUndoStack,
      currentGameAttendance,
      setCurrentGameAttendance,
      firstInningLineup,
      setFirstInningLineup,
      lineup,
      setLineup,
      battingLineup,
      setBattingLineup,
      lineupQualityPenalty,
      swapSelection,
      gameSaved,
      handleCellClick,
      addInning,
      removeInning,
      moveBatter,
      opponentName,
      setOpponentName,
      isAddingTeam,
      setIsAddingTeam,
      newTeamName,
      setNewTeamName,
      assistantEvalOpen,
      setAssistantEvalOpen,
      isAddingPlayer,
      setIsAddingPlayer,
      viewingPlayerId,
      setViewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      setIsAddingCoach,
      newCoachForm,
      setNewCoachForm,
      teamEvalGrades,
      setTeamEvalGrades,
      selectedRoundId,
      setSelectedRoundId,
      evalTrendPlayerId,
      setEvalTrendPlayerId,
    }),
    [
      modal,
      selectedGameId,
      isAddingGame,
      newGameForm,
      scoringGameId,
      activeTab,
      pastSeasonImport,
      inGameId,
      inGameInning,
      inGameSelection,
      inGameUndoStack,
      currentGameAttendance,
      firstInningLineup,
      lineup,
      battingLineup,
      lineupQualityPenalty,
      swapSelection,
      gameSaved,
      handleCellClick,
      addInning,
      removeInning,
      moveBatter,
      opponentName,
      isAddingTeam,
      newTeamName,
      assistantEvalOpen,
      isAddingPlayer,
      viewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      newCoachForm,
      teamEvalGrades,
      selectedRoundId,
      evalTrendPlayerId,
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

/* ============================================================================
   SECTION 18.5 · InGameView — see ./screens/InGameView
============================================================================ */

/* ============================================================================
   SECTION 19 · Main App layout (consumes both contexts)
============================================================================ */
// Tab order is computed below from team.tryoutsOpen so the Tryouts
const MainShell = () => {
  
  const {
    team,
    teams,
    user,
    authReady,
    loading,
    genError,
    setGenError,
    regenerateLineup,
    regenerateBatting,
    regenerateDefense,
    currentRole,
    roleResolved,
    needsWelcomeChooser,
    createTeam,
    joinTeamByCode,
  } = useTeam();
  const {
    viewingPlayerId,
    activeTab,
    setActiveTab,
    selectedGameId,
    inGameId,
    setInGameId,
  } = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const isAssistant = currentRole === "assistant";
  const tryoutsOpen = team?.tryoutsOpen === true;
  const tryoutsVisible = tryoutsOpen || team?.tryoutsPhase === "intake_closed";
  const { tabOrder } = useMainShellRouting({
    activeTab,
    setActiveTab,
    inGameId,
    setInGameId,
    isAssistant,
    tryoutsOpen: tryoutsVisible,
    location,
    navigate,
  });

  // Client-side game-day reminders while the app is open (opt-in via Settings).
  useScheduleReminders();

  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Counts consecutive "popup-closed-by-user" dismissals so the second one
  // can surface a tip about third-party cookies / in-app browsers. Reset to
  // 0 on a successful sign-in, or when we fall back to redirect (different
  // failure mode, different remedy already shown by that path).
  const popupDismissCountRef = useRef(0);

  // Keep the sign-in button disabled across the gap between
  // signInWithPopup resolving and onAuthStateChanged firing — otherwise
  // a fast re-click (or UA refocus event) can re-open the popup before
  // `user` populates, producing the reported popup loop.
  useEffect(() => {
    if (user) setIsSigningIn(false);
  }, [user]);

  // Only auto-open the onboarding tour once the user actually has a team to
  // see — otherwise the WelcomeChooser (which is non-dismissible) and the
  // tutorial scrim end up stacked on top of each other on first sign-in.
  useEffect(() => {
    if (
      authReady &&
      user &&
      teams.length > 0 &&
      !onboardingHasBeenCompleted()
    ) {
      setTutorialOpen(true);
    }
  }, [authReady, user, teams.length]);

  // Global keyboard shortcuts. Disabled while typing in form fields. Active
  // anywhere in the app:
  //   1-5 → switch primary tab
  //   ?    → open the tutorial
  //   G    → regenerate lineup (only when a game is selected for editing)
  //   B    → regenerate batting order (same gate as G)
  //   Esc  → close tutorial / does not handle modals here (each owns its own)
  useEffect(() => {
    if (!authReady || !user) return undefined;
    const onKey = (e: any) => {
      const target = e.target;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Cmd+K / Ctrl+K opens the command palette from anywhere — even inside
      // form fields, since that's the canonical Spotlight-style binding.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Bail in any form field or contentEditable region.
      if (inField) return;
      // Don't intercept when a modifier is held (we're not stealing OS shortcuts).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k >= "1" && k <= "5") {
        const idx = parseInt(k, 10) - 1;
        if (tabOrder[idx]) {
          e.preventDefault();
          setActiveTab(tabOrder[idx]);
        }
        return;
      }
      if (k === "?" || (k === "/" && e.shiftKey)) {
        e.preventDefault();
        setTutorialOpen(true);
        return;
      }
      if ((k === "g" || k === "G") && selectedGameId) {
        e.preventDefault();
        regenerateLineup?.();
        return;
      }
      if ((k === "b" || k === "B") && selectedGameId) {
        e.preventDefault();
        regenerateBatting?.();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    authReady,
    user,
    setActiveTab,
    selectedGameId,
    regenerateLineup,
    regenerateBatting,
    regenerateDefense,
    tabOrder,
  ]);

  useEffect(() => {
    const root = document.documentElement;
    if (team?.primaryColor) {
      root.style.setProperty("--team-primary", team.primaryColor);
    }
    if (team?.secondaryColor) {
      root.style.setProperty("--team-secondary", team.secondaryColor);
    }
    if (team?.tertiaryColor) {
      root.style.setProperty("--team-tertiary", team.tertiaryColor);
    }
  }, [team?.primaryColor, team?.secondaryColor, team?.tertiaryColor]);


  if (!authReady || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-ink-3 font-black uppercase tracking-widest text-sm flex items-center gap-3">
          <Icons.Refresh className="w-5 h-5 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  // After the auth + teams + active-team-doc gates clear, there's still
  // a brief window where teamData has just become non-default but the
  // role-resolution memo hasn't seen ownerId/coachRoles yet. During that
  // window realRole falls through to the "head" branch via the legacy
  // sole-member claim path — that's why assistant coaches reported
  // seeing the Head Coach Dashboard flash on first sign-in across the
  // whole app (not just /evaluation). Hold the shell behind the same
  // loader until role is trustworthy.
  if (user && teams.length > 0 && !roleResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-ink-3 font-black uppercase tracking-widest text-sm flex items-center gap-3">
          <Icons.Refresh className="w-5 h-5 animate-spin" /> Loading…
        </div>
      </div>
    );
  }


  const authEnv =
    typeof navigator !== "undefined" && (() => {
      const ua = navigator.userAgent || "";
      const isInApp = /FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|GSA|wv\)|WebView|DuckDuckGo/i.test(ua);
      return { isInApp };
    })();

  if (!user) {
    return (
      <LoginScreen
        logoUrl={team.logoUrl}
        primaryColor={team.primaryColor}
        tertiaryColor={team.tertiaryColor}
        isSigningIn={isSigningIn}
        onSignIn={async () => {
          if (isSigningIn) return;
          if (auth.currentUser) {
            clearRedirectPending();
            return;
          }
          setIsSigningIn(true);
          // Note: do NOT reset isSigningIn on the success path. The popup
          // resolves before onAuthStateChanged fires, so resetting here
          // re-enables the button during the gap and a fast re-click
          // re-opens the popup. The useEffect on `user` above drops the
          // flag once auth state actually propagates. Terminal failures
          // (popup dismissed / redirect started / hard error) explicitly
          // clear the flag below since the auth listener won't fire.
          try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });
            if ((authEnv as any)?.isInApp) {
              if (isRedirectLikelyStuck() || redirectAttemptsExceeded()) {
                clearRedirectPending();
                setGenError("Google sign-in loop detected. Open this app in Safari/Chrome and try again.");
                setIsSigningIn(false);
                return;
              }
              markRedirectPending();
              authDiag("redirect_start", { source: "in_app_first" });
              await signInWithRedirect(auth, provider);
              return;
            }
            authDiag("popup_start");
            await signInWithPopup(auth, provider);
            authDiag("popup_success");
            popupDismissCountRef.current = 0;
            clearRedirectPending();
          } catch (e: any) {
            const code = e?.code || "";
            if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
              authDiag("popup_dismissed", { code: code || null });
              popupDismissCountRef.current += 1;
              if (popupDismissCountRef.current >= 2) {
                // Two dismissals in a row strongly suggests a browser-level
                // block (third-party cookies disabled, in-app webview, etc.)
                // rather than the user genuinely changing their mind. Surface
                // the remediation tip instead of staying silent.
                setGenError(
                  "If the Google popup keeps closing right away, allow third-party cookies for lineupgenerator-79159.firebaseapp.com, or open this app directly in Safari/Chrome."
                );
              }
              setIsSigningIn(false);
              return;
            }
            if (
              code === "auth/popup-blocked" ||
              code === "auth/operation-not-supported-in-this-environment"
            ) {
              try {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: "select_account" });
                if (isRedirectLikelyStuck() || redirectAttemptsExceeded()) {
                  clearRedirectPending();
                  setGenError("Google sign-in loop detected. Open this app in Safari/Chrome and try again.");
                  setIsSigningIn(false);
                  return;
                }
                markRedirectPending();
                authDiag("redirect_start", { source: "popup_fallback" });
                popupDismissCountRef.current = 0;
                await signInWithRedirect(auth, provider);
                return;
              } catch (redirectError: any) {
                authDiag("redirect_fallback_error", { code: redirectError?.code || null, message: redirectError?.message || null });
                setGenError(redirectError?.message || "Sign-in failed");
                setIsSigningIn(false);
                return;
              }
            }
            authDiag("popup_error", { code: e?.code || null, message: e?.message || null });
            setGenError(e.message);
            setIsSigningIn(false);
          }
        }}
        genError={genError}
        onEmailSignIn={async () => {
          if (typeof window === "undefined") return;
          const email = window.prompt("Enter your email for a sign-in link") || "";
          if (!email) return;
          try {
            const continueUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
            await sendSignInLinkToEmail(auth, email, {
              url: continueUrl,
              handleCodeInApp: true,
            });
            window.localStorage.setItem("emailForSignIn", email);
            authDiag("email_link_sent", { email });
            setGenError("Email sign-in link sent. Check your inbox and open it on this device.");
          } catch (e: any) {
            authDiag("email_link_send_error", { code: e?.code || null, message: e?.message || null });
            setGenError(e?.message || "Could not send email sign-in link");
          }
        }}
      />
    );
  }

  const tryoutsButton = {
    id: "tryouts",
    icon: Icons.Users,
    label: "Tryouts",
  };
  // Head-only "Interest" tab. Only surfaces in the nav when the team
  // has at least one interest signup (otherwise it's just a dead
  // pixel for coaches who don't use the feature). The route stays
  // accessible regardless so heads can find it via direct URL.
  const interestButton =
    !isAssistant && (team?.interestSignups?.length ?? 0) > 0
      ? { id: "interest", icon: Icons.Clipboard, label: "Interest" }
      : null;
  const navButtons = isAssistant
    ? [
        { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
        { id: "roster", icon: Icons.Users, label: "Roster" },
        { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
        ...(tryoutsVisible ? [tryoutsButton] : []),
        { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
      ]
    : [
        { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
        { id: "roster", icon: Icons.Users, label: "Roster" },
        { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
        ...(tryoutsVisible ? [tryoutsButton] : []),
        ...(interestButton ? [interestButton] : []),
        { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
        { id: "settings", icon: Icons.Settings, label: "Settings" },
      ];

  return (
    <div className="min-h-screen bg-app print:bg-surface">
      <OfflineBanner />
      <AppHeader />
      <TabBarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        navButtons={navButtons}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:max-w-none">
        <Suspense fallback={<ScreenLoader />}>
        <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<HomeTab />} />
          <Route path="/roster" element={<RosterTab />} />
          <Route path="/schedule" element={<ScheduleTab />} />
          <Route path="/schedule/*" element={<ScheduleTab />} />
          <Route
            path="/evaluation"
            element={
              !roleResolved
                ? <ScreenLoader />
                : isAssistant
                ? <AssistantEvalTab />
                : <EvaluationTab />
            }
          />
          <Route
            path="/tryouts"
            element={
              tryoutsVisible ? <TryoutsTab /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/interest"
            element={
              isAssistant ? <Navigate to="/" replace /> : <InterestTab />
            }
          />
          <Route
            path="/settings"
            element={isAssistant ? <Navigate to="/" replace /> : <SettingsTab />}
          />
          {/* In-Game renders standalone (no SharedModals scrim) below; the
              route just hides the main tab content while In-Game is active. */}
          <Route path="/in-game/:gameId" element={<div className="hidden" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
        </Suspense>
      </main>
      <SharedModals />
      {viewingPlayerId && <PlayerProfileModal />}
      <AddPlayerModal />
      <PastSeasonImportModal />
      <Suspense fallback={null}>
        <InGameView />
      </Suspense>
      <OnboardingTutorial
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
      <WelcomeChooser
        open={needsWelcomeChooser}
        onCreate={createTeam}
        onJoin={joinTeamByCode}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
      <button
        type="button"
        onClick={() => setTutorialOpen(true)}
        aria-label="Open tutorial"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white font-black text-lg hover:-translate-y-0.5 transition-transform print:hidden"
        style={{ backgroundColor: "var(--team-primary)" }}
      >
        ?
      </button>
      {genError && (
        <div className="fixed bottom-4 left-4 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg max-w-sm text-xs font-bold print:hidden">
          {genError}
        </div>
      )}
    </div>
  );
};

const App = () => {
  // Public Tryouts Portal route bypasses the auth-gated TeamProvider so
  // parents can submit signups without signing in. The portal handles
  // its own (optional) anonymous Firebase auth and writes to the team
  // document via a shareId-scoped read.
  if (
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/tryouts-portal/")
  ) {
    return (
      <ToastProvider>
        <Suspense fallback={<ScreenLoader />}>
          <ErrorBoundary>
            <Routes>
              <Route path="/tryouts-portal/:slug" element={<TryoutsPortal />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </Suspense>
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <TeamProvider>
        <UIProvider>
          <MainShell />
        </UIProvider>
      </TeamProvider>
    </ToastProvider>
  );
};

export default App;
const REDIRECT_FLAG_KEY = "googleSignInRedirectPending";
const REDIRECT_STARTED_AT_KEY = "googleSignInRedirectStartedAt";
const REDIRECT_GUARD_MS = 45 * 1000;
const REDIRECT_ATTEMPTS_KEY = "googleSignInRedirectAttempts";
const MAX_REDIRECT_ATTEMPTS = 2;

const markRedirectPending = () => {
  if (typeof window === "undefined") return;
  const priorAttempts = Number(sessionStorage.getItem(REDIRECT_ATTEMPTS_KEY) || "0");
  sessionStorage.setItem(REDIRECT_ATTEMPTS_KEY, String(Number.isFinite(priorAttempts) ? priorAttempts + 1 : 1));
  sessionStorage.setItem(REDIRECT_FLAG_KEY, "1");
  sessionStorage.setItem(REDIRECT_STARTED_AT_KEY, String(Date.now()));
};

const clearRedirectPending = () => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(REDIRECT_FLAG_KEY);
  sessionStorage.removeItem(REDIRECT_STARTED_AT_KEY);
  sessionStorage.removeItem(REDIRECT_ATTEMPTS_KEY);
};

const isRedirectLikelyStuck = () => {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(REDIRECT_FLAG_KEY) !== "1") return false;
  const started = Number(sessionStorage.getItem(REDIRECT_STARTED_AT_KEY) || "0");
  if (!Number.isFinite(started) || started <= 0) return true;
  return Date.now() - started > REDIRECT_GUARD_MS;
};

const redirectAttemptsExceeded = () => {
  if (typeof window === "undefined") return false;
  const attempts = Number(sessionStorage.getItem(REDIRECT_ATTEMPTS_KEY) || "0");
  return Number.isFinite(attempts) && attempts >= MAX_REDIRECT_ATTEMPTS;
};
