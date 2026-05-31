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
import { SharedModals } from "./components/shared";
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
import {
  LoginScreen,
  AppHeader,
  TabBarNav,
} from "./components/Chrome";
import {
  PlayerProfileModal,
  AddPlayerModal,
  PastSeasonImportModal,
} from "./components/modals";
import {
  normalizeDateToIso,
  slimGame,
  scrubUndefined,
  blankStats,
  emailPromptStatus,
  evalRoundDateForSave,
  restampEvalDueDates,
  isReturning,
  isGameFinalized,
} from "./utils/helpers";
import { sendGmailMessage } from "./integrations/gmailSend";
import { useMainShellRouting } from "./hooks/useMainShellRouting";
import { useTeamMembership } from "./hooks/useTeamMembership";
import { useInviteFlows } from "./hooks/useInviteFlows";
import { useImportExportFlows } from "./hooks/useImportExportFlows";
import {
  getLocalDateString,
  bumpAgeTier,
  computeNextSeason,
  DEFAULT_TEAM_DATA,
  EVAL_SCHEMA_VERSION,
} from "./constants/ui";

// Pure-function lineup engine. Lives in ./lineupEngine.js next to this file.
import {
  generateLineup as engineGenerateLineup,
  generateBattingOnly as engineGenerateBattingOnly,
} from "./lineupEngine";

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

// Pull a display-able last name from a Firebase auth user. Eval rounds
// are tagged with this at save time so the head's "Mike · 2026-05-23"
// label survives across devices and stale auth profiles. Falls back to
// the email local-part, then to "Coach", before ever leaving the field
// blank.
const lastNameOfUser = (u: any) => {
  const dn = (u?.displayName || "").trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const email = (u?.email || "").trim();
  const local = email.split("@")[0];
  if (local) return local;
  return "Coach";
};

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
  const persistTeamRef = useRef<any>(null);
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

  // Helper: write a partial update to the active team document
  const persistTeam = useCallback(
    async (updates: any) => {
      if (!activeTeamId) return;
      // Slim any games being persisted — strip embedded player objects down
      // to {id, name, number} to stay under the Firestore 1MB document limit.
      let toPersist = updates;
      if (Array.isArray(updates.games)) {
        toPersist = { ...updates, games: updates.games.map(slimGame) };
      }
      // Scrub any undefined values from the tree — Firestore rejects them.
      toPersist = scrubUndefined(toPersist);
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
      } catch (e: any) {
        setSyncStatus("");
        toast.push({ kind: "error", title: "Save failed", message: e.message });
      }
    },
    [activeTeamId, toast]
  );

  // Expose persistTeam to the onSnapshot above so the eval schema migration
  // can write the cleared evaluationEvents back to Firestore.
  useEffect(() => {
    persistTeamRef.current = persistTeam;
  }, [persistTeam]);

  const updateTeam = useCallback(
    (updates: any) => {
      setTeamData((prev: any) => ({ ...prev, ...updates })); // optimistic
      persistTeam(updates);
    },
    [persistTeam]
  );

  // Auto-correct defenseSize on age/league change. BATCHED into a single write.
  // We read the four relevant fields outside the effect so the dependency list
  // literally matches what's used (avoids the ESLint exhaustive-deps confusion
  // that would otherwise want all of `teamData` in the deps).
  const _league = teamData.leagueRuleSet;
  const _teamAge = teamData.teamAge;
  const _defenseSize = teamData.defenseSize;
  const _pitchingFormat = teamData.pitchingFormat;
  useEffect(() => {
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
    if (Object.keys(updates).length > 0) updateTeam(updates);
  }, [_league, _teamAge, _defenseSize, _pitchingFormat, updateTeam]);
  // ----- Roster actions -----
  const addPlayer = useCallback(
    (form: any) => {
      const id =
        form.id || "p-" + Math.random().toString(36).substring(2, 10);
      const newPlayer = {
        id,
        name: form.name.trim(),
        number: form.number || "",
        bats: form.bats || "R",
        throws: form.throws || "R",
        photoUrl: form.photoUrl || "",
        present: true,
        restrictions: [],
        // Catcher is just "C" in this list — a new player isn't a catcher
        // until the coach adds C to their comfortable positions.
        comfortablePositions: Array.isArray(form.comfortablePositions)
          ? form.comfortablePositions
          : [],
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      updateTeam({ players: [...teamData.players, newPlayer] });
      return id;
    },
    [teamData.players, updateTeam]
  );

  const updatePlayer = useCallback(
    (id: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, ...updates } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const updatePlayerNested = useCallback(
    (id: any, key: any, updates: any) => {
      const next = teamData.players.map((p: any) =>
        p.id === id ? { ...p, [key]: { ...(p[key] || {}), ...updates } } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const removePlayer = useCallback(
    (id: any) => {
      if (!window.confirm("Remove this player from the roster?")) return;

      // Snapshot the pre-delete shapes for Undo. A mistap here cascades
      // through games / batting orders / attendance / pitch counts / eval
      // grades — a partial restore (just the roster row) would still leave
      // the player absent from the rest, so Undo has to revert all of them.
      const prevPlayers = teamData.players;
      const prevGames = teamData.games || [];
      const prevEvents = teamData.evaluationEvents || [];
      const removedPlayer = prevPlayers.find((p: any) => p.id === id);

      // Strip the player out of every shape that holds player references.
      const stripFromInning = (inning: any) => {
        if (!inning || typeof inning !== "object") return inning;
        const out: Record<string, any> = {};
        for (const pos in inning) {
          if (pos === "BENCH") {
            out.BENCH = (inning.BENCH || []).filter(
              (p: any) => p && p.id !== id
            );
          } else {
            const slot = inning[pos];
            out[pos] = slot && slot.id === id ? null : slot;
          }
        }
        return out;
      };

      const stripFromGame = (g: any) => {
        const next = { ...g };
        if (Array.isArray(g.lineup)) next.lineup = g.lineup.map(stripFromInning);
        if (Array.isArray(g.originalLineup))
          next.originalLineup = g.originalLineup.map(stripFromInning);
        if (Array.isArray(g.battingLineup))
          next.battingLineup = g.battingLineup.filter(
            (p: any) => p && p.id !== id
          );
        if (g.attendance && id in g.attendance) {
          const { [id]: _dropAtt, ...rest } = g.attendance;
          next.attendance = rest;
        }
        if (g.pitchCounts && id in g.pitchCounts) {
          const { [id]: _dropPc, ...rest } = g.pitchCounts;
          next.pitchCounts = rest;
        }
        return next;
      };

      const stripFromEvent = (ev: any) => {
        if (!ev?.grades || !(id in ev.grades)) return ev;
        const { [id]: _dropG, ...rest } = ev.grades;
        return { ...ev, grades: rest };
      };

      updateTeam({
        players: prevPlayers.filter((p: any) => p.id !== id),
        games: prevGames.map(stripFromGame),
        evaluationEvents: prevEvents.map(stripFromEvent),
      });

      toast.push({
        kind: "success",
        title: "Player removed",
        message: removedPlayer
          ? `${removedPlayer.name} removed. Tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () =>
            updateTeam({
              players: prevPlayers,
              games: prevGames,
              evaluationEvents: prevEvents,
            }),
        },
      });
    },
    [
      teamData.players,
      teamData.games,
      teamData.evaluationEvents,
      updateTeam,
      toast,
    ]
  );

  // Add a past-season entry to a single player.
  const addPastSeason = useCallback(
    (playerId: any, entry: any) => {
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        const past = Array.isArray(p.pastSeasons) ? [...p.pastSeasons] : [];
        const newEntry = {
          id: "ps-" + Math.random().toString(36).substring(2, 10),
          season: entry.season || "",
          ageGroup: entry.ageGroup || "",
          pitchingFormat: entry.pitchingFormat || "Kid Pitch",
          record: entry.record || {
            wins: 0,
            losses: 0,
            ties: 0,
            runsScored: 0,
            runsAllowed: 0,
          },
          stats: { ...blankStats(), ...(entry.stats || {}) },
        };
        past.push(newEntry);
        return { ...p, pastSeasons: past };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const updatePastSeason = useCallback(
    (playerId: any, entryId: any, patch: any) => {
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        const past = (p.pastSeasons || []).map((e: any) => {
          if (e.id !== entryId) return e;
          // Stats merge field-by-field; everything else replaces
          return {
            ...e,
            ...patch,
            stats: patch.stats
              ? { ...(e.stats || blankStats()), ...patch.stats }
              : e.stats,
          };
        });
        return { ...p, pastSeasons: past };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const removePastSeason = useCallback(
    (playerId: any, entryId: any) => {
      if (
        !window.confirm("Remove this past season entry? This cannot be undone.")
      )
        return;
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        return {
          ...p,
          pastSeasons: (p.pastSeasons || []).filter((e: any) => e.id !== entryId),
        };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  // Bulk add past-season entries from a CSV import. `assignments` is an array of
  // { playerId, season, ageGroup, pitchingFormat, stats }. Adds one entry per
  // assignment to the matching player.
  const bulkAddPastSeasons = useCallback(
    (assignments: any) => {
      if (!assignments || assignments.length === 0) return;
      const byPlayer = new Map();
      for (const a of assignments) {
        if (!a.playerId) continue;
        const list = byPlayer.get(a.playerId) || [];
        list.push({
          id: "ps-" + Math.random().toString(36).substring(2, 10),
          season: a.season || "",
          ageGroup: a.ageGroup || "",
          pitchingFormat: a.pitchingFormat || "Kid Pitch",
          record: a.record || {
            wins: 0,
            losses: 0,
            ties: 0,
            runsScored: 0,
            runsAllowed: 0,
          },
          stats: { ...blankStats(), ...(a.stats || {}) },
        });
        byPlayer.set(a.playerId, list);
      }
      const next = teamData.players.map((p: any) => {
        const adds = byPlayer.get(p.id);
        if (!adds) return p;
        return { ...p, pastSeasons: [...(p.pastSeasons || []), ...adds] };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

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

  // ----- Game actions -----
  const addGame = useCallback(
    (form: any) => {
      if (!form.date || !form.opponent.trim()) {
        toast.push({
          kind: "warn",
          title: "Missing info",
          message: "Date and opponent required.",
        });
        return;
      }
      const newGame = {
        id: "g-" + Math.random().toString(36).substring(2, 10),
        date: form.date,
        opponent: form.opponent.trim(),
        leagueRuleSet: form.leagueRuleSet,
        pitchingFormat: form.pitchingFormat,
        defenseSize: teamData.defenseSize,
        battingSize: teamData.battingSize,
        positionLock: teamData.positionLock,
        lineup: null,
        battingLineup: null,
        attendance: {},
        status: "scheduled",
        teamScore: null,
        opponentScore: null,
      };
      updateTeam({ games: [...teamData.games, newGame] });
    },
    [teamData, updateTeam, toast]
  );

  const updateGame = useCallback(
    (gameId: any, updates: any) => {
      // Defend against callers that pass empty/invalid dates from a cleared
      // input field. An empty `date` would break every `games.sort((a,b) =>
      // new Date(a.date) - new Date(b.date))` comparator and the upcoming-game
      // logic. If the date is empty/unparseable, drop just that key from the
      // update rather than persisting garbage.
      let safeUpdates = updates;
      if ("date" in safeUpdates) {
        const iso = normalizeDateToIso(safeUpdates.date);
        if (!iso) {
          const { date: _drop, ...rest } = safeUpdates;
          safeUpdates = rest;
        } else if (iso !== safeUpdates.date) {
          safeUpdates = { ...safeUpdates, date: iso };
        }
      }
      if (Object.keys(safeUpdates).length === 0) return;
      const next = teamData.games.map((g: any) =>
        g.id === gameId ? { ...g, ...safeUpdates } : g
      );
      updateTeam({ games: next });
    },
    [teamData.games, updateTeam]
  );

  // Helper: push the game's pitch counts to each pitcher's player record.
  // Replaces (not accumulates) the pitcher's recentPitches/lastPitchDate, since
  // the engine treats those as "most recent outing" for rest-day calculations.
  // Returns the next players array (or the unchanged players array if there's
  // nothing to commit). Caller is responsible for combining this with their
  // own game updates and writing both via updateTeam.
  const commitPitchCountsToPlayers = useCallback(
    (game: any) => {
      const pitchCounts = game?.pitchCounts || {};
      const pitchedPlayerIds = Object.keys(pitchCounts).filter(
        (pid) => Number.isFinite(pitchCounts[pid]) && pitchCounts[pid] > 0
      );
      if (pitchedPlayerIds.length === 0 || !game.date) {
        return teamData.players;
      }
      return teamData.players.map((p: any) => {
        if (!pitchedPlayerIds.includes(p.id)) return p;
        return {
          ...p,
          pitching: {
            ...(p.pitching || {}),
            recentPitches: pitchCounts[p.id],
            lastPitchDate: game.date,
          },
        };
      });
    },
    [teamData.players]
  );

  // Postpone a game: set status to "postponed", clear scores, AND commit any
  // pitch counts that were entered before the rain came. Pitchers still threw
  // their warm-up tosses or innings before the call; their counts should
  // count toward rest just like a finalized game.
  const postponeGame = useCallback(
    (gameId: any) => {
      const game = teamData.games.find((g: any) => g.id === gameId);
      if (!game) return;
      const nextPlayers = commitPitchCountsToPlayers(game);
      const nextGames = teamData.games.map((g: any) =>
        g.id === gameId
          ? {
              ...g,
              status: "postponed",
              teamScore: null,
              opponentScore: null,
            }
          : g
      );
      const playersChanged = nextPlayers !== teamData.players;
      if (playersChanged) {
        updateTeam({ players: nextPlayers, games: nextGames });
      } else {
        updateTeam({ games: nextGames });
      }
    },
    [teamData.games, teamData.players, commitPitchCountsToPlayers, updateTeam]
  );

  // Finalize a game: set score, mark final, and trim/restore the lineup to
  // match how many innings were actually played.
  //
  // Trim semantics:
  //  - First time we trim: stash full lineup in `originalLineup`, then slice.
  //  - Trimming further: leave `originalLineup` alone (still has the longest
  //    version we've ever seen).
  //  - Restoring (passing a count larger than current `lineup.length`):
  //    pull from `originalLineup` if it has enough entries.
  //  - If `inningsPlayed` matches current length, no lineup change is made.
  const finalizeGame = useCallback(
    (gameId: any, teamScore: any, opponentScore: any, inningsPlayed: any) => {
      const game = teamData.games.find((g: any) => g.id === gameId);
      if (!game) return;
      const gameUpdates: Record<string, any> = {
        teamScore,
        opponentScore,
        status: "final",
      };
      if (game.lineup?.length && Number.isFinite(inningsPlayed) && inningsPlayed > 0) {
        const longest = game.originalLineup?.length > game.lineup.length
          ? game.originalLineup
          : game.lineup;
        const target = Math.min(inningsPlayed, longest.length);
        if (target < game.lineup.length) {
          // Trim. Stash longest version (only on first trim).
          if (!game.originalLineup) {
            gameUpdates.originalLineup = game.lineup;
          }
          gameUpdates.lineup = game.lineup.slice(0, target);
        } else if (target > game.lineup.length) {
          // Restore from originalLineup if available.
          if (game.originalLineup && game.originalLineup.length >= target) {
            gameUpdates.lineup = game.originalLineup.slice(0, target);
          }
          // else: no-op (can't restore beyond what we have)
        }
      }

      // Commit any pitch counts entered for this game to the player records.
      const nextPlayers = commitPitchCountsToPlayers(game);
      const playersChanged = nextPlayers !== teamData.players;
      if (playersChanged) {
        const nextGames = teamData.games.map((g: any) =>
          g.id === gameId ? { ...g, ...gameUpdates } : g
        );
        updateTeam({ players: nextPlayers, games: nextGames });
      } else {
        updateGame(gameId, gameUpdates);
      }
    },
    [teamData.games, teamData.players, updateGame, updateTeam, commitPitchCountsToPlayers]
  );

  const deleteSavedGame = useCallback(
    (gameId: any) => {
      if (!window.confirm("Delete this game?")) return;
      const prevGames = teamData.games;
      const removed = prevGames.find((g: any) => g.id === gameId);
      updateTeam({ games: prevGames.filter((g: any) => g.id !== gameId) });
      toast.push({
        kind: "success",
        title: "Game deleted",
        message: removed?.opponent
          ? `vs ${removed.opponent} — tap Undo to restore.`
          : "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => updateTeam({ games: prevGames }),
        },
      });
    },
    [teamData.games, updateTeam, toast]
  );

  // ----- Lineup generation (uses the engine) -----
  // The UI sets these via useUI() and we read them at call time via a ref pattern,
  // but to keep things simple we pass them in to a closure exposed via a ref.
  const uiBridge = useRef<any>({ getInputs: () => null, applyResult: () => {} });

  const _runGenerate = useCallback(
    (seed: any, options: any = {}) => {
      const inputs = uiBridge.current.getInputs();
      if (!inputs) return;
      const {
        currentGame,
        currentGameAttendance,
        firstInningLineup,
        previousLineup,
        previousBattingLineup,
      } = inputs;
      if (!currentGame) {
        toast.push({ kind: "error", title: "No game selected" });
        return;
      }
      // Per-game toggle drives default; explicit options override (used by the
      // failure-prompt "Retry Relaxed" action).
      const gameSaysRelaxed = currentGame.applySeasonalFairness === false;
      const relaxFairness =
        options.relaxFairness != null
          ? options.relaxFairness
          : gameSaysRelaxed;

      const presentPlayers = teamData.players.filter(
        (p: any) => currentGameAttendance[p.id] !== false
      );
      if (presentPlayers.length < 7) {
        toast.push({
          kind: "error",
          title: "Not enough players",
          message: "Need at least 7 present.",
        });
        return;
      }

      const result = engineGenerateLineup({
        activePlayers: presentPlayers,
        allPlayers: teamData.players,
        games: teamData.games,
        evaluationEvents: teamData.evaluationEvents,
        currentGame,
        firstInningOverridesById: firstInningLineup,
        totalInnings:
          parseInt(currentGame.inningsCount || teamData.inningsCount, 10) || 6,
        leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
        teamAge: teamData.teamAge,
        defenseSize: currentGame.defenseSize || teamData.defenseSize,
        positionLock: currentGame.positionLock || teamData.positionLock,
        battingSize: currentGame.battingSize || teamData.battingSize,
        pitchingFormat: currentGame.pitchingFormat || teamData.pitchingFormat,
        catcherMaxInnings:
          currentGame.catcherMaxInnings || teamData.catcherMaxInnings,
        catcherConsecutive:
          currentGame.catcherConsecutive ?? teamData.catcherConsecutive,
        seed,
        relaxFairness,
        isBigGame: currentGame.isBigGame === true,
      });

      if (result.error) {
        // Engine internally retries with relaxed fairness if strict fairness
        // fails. So an error here means the constraints are genuinely
        // unsatisfiable (restrictions / locks / setup conflicts). The engine
        // gives us a specific message about WHAT broke.
        toast.push({
          kind: "error",
          title: "Could not build lineup",
          message: result.error,
          duration: 0,
        });
        return;
      }

      // Snapshot for undo
      previousLineupRef.current = {
        lineup: previousLineup,
        battingLineup: previousBattingLineup,
      };
      uiBridge.current.applyResult(result);

      // Push success toast with Undo action (only meaningful if there *was* a previous)
      const hasPrev = !!previousLineup;
      // Engine may have internally relaxed fairness when strict failed.
      // Treat that as a soft note, not an error.
      const internallyRelaxed = result.fairnessRelaxed === true;
      if (internallyRelaxed) {
        // Structured detail for diagnosis — surfaces the dominant strict-pass
        // failure (type/position/inning) alongside the coach-facing message.
        console.warn("[lineup] strict fairness relaxed:", {
          type: result.fairnessRelaxedType,
          reason: result.fairnessRelaxedReason,
        });
      }
      const showAsRelaxed = relaxFairness || internallyRelaxed;
      // When the engine fell back, show the ACTUAL blocker that defeated
      // strict fairness (e.g. "Bench schedule couldn't satisfy…") so the
      // cause can be locked down, not just a generic note.
      const relaxedBlocker =
        result.fairnessRelaxedReason ||
        "the bench distribution couldn't be scheduled";
      // The engine eases the rotation lock for an inning when keeping everyone
      // in their slot would otherwise make a fair, full defense impossible.
      const relaxedInns = Array.isArray(result.lockRelaxedInnings)
        ? result.lockRelaxedInnings
        : [];
      const lockNote =
        relaxedInns.length > 0
          ? ` Rotation eased in inning ${relaxedInns.join(", ")} to keep a full, fair defense.`
          : "";
      const successMessage = internallyRelaxed
        ? `Strict fairness blocked — ${relaxedBlocker} Built one-game balanced instead; catch up over future games.`
        : relaxFairness
        ? "Built without considering past games. Some kids may bench more than others this season."
        : hasPrev
        ? `Tap Undo to restore the previous lineup.${lockNote}`
        : lockNote.trim();
      toast.push({
        kind: showAsRelaxed ? "warn" : "success",
        title: showAsRelaxed
          ? "Lineup built (one-game balance)"
          : "Lineup generated",
        message: successMessage,
        duration: 10000,
        action: hasPrev
          ? {
              label: "Undo",
              onClick: () => {
                const snap = previousLineupRef.current;
                if (snap)
                  uiBridge.current.applyResult({
                    lineup: snap.lineup,
                    battingLineup: snap.battingLineup,
                  });
              },
            }
          : undefined,
      });
    },
    [
      teamData.players,
      teamData.games,
      teamData.evaluationEvents,
      teamData.inningsCount,
      teamData.leagueRuleSet,
      teamData.teamAge,
      teamData.defenseSize,
      teamData.positionLock,
      teamData.battingSize,
      teamData.pitchingFormat,
      teamData.catcherMaxInnings,
      teamData.catcherConsecutive,
      toast,
    ]
  );

  const generateLineup = useCallback(
    () => _runGenerate(Date.now()),
    [_runGenerate]
  );
  const regenerateLineup = useCallback(
    () => _runGenerate(Date.now() + Math.floor(Math.random() * 1e6)),
    [_runGenerate]
  );

  // Re-roll just the defensive schedule, preserving the current batting
  // order. The engine still computes both halves, but we throw away its
  // batting output and reapply the existing one. Mirror of
  // `regenerateBatting` from the other direction.
  const regenerateDefense = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs) return;
    const {
      currentGame,
      currentGameAttendance,
      firstInningLineup,
      lineup,
      battingLineup,
    } = inputs;
    if (!currentGame) {
      toast.push({ kind: "error", title: "No game selected" });
      return;
    }
    if (!lineup) {
      toast.push({
        kind: "error",
        title: "Generate a lineup first",
        message: "Re-roll defense works on top of an existing lineup.",
      });
      return;
    }
    const presentPlayers = teamData.players.filter(
      (p: any) => currentGameAttendance[p.id] !== false
    );
    if (presentPlayers.length < 7) {
      toast.push({
        kind: "error",
        title: "Not enough players",
        message: "Need at least 7 present.",
      });
      return;
    }

    const result = engineGenerateLineup({
      activePlayers: presentPlayers,
      allPlayers: teamData.players,
      games: teamData.games,
      evaluationEvents: teamData.evaluationEvents,
      currentGame,
      firstInningOverridesById: firstInningLineup,
      totalInnings:
        parseInt(currentGame.inningsCount || teamData.inningsCount, 10) || 6,
      leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
      teamAge: teamData.teamAge,
      defenseSize: currentGame.defenseSize || teamData.defenseSize,
      positionLock: currentGame.positionLock || teamData.positionLock,
      battingSize: currentGame.battingSize || teamData.battingSize,
      catcherMaxInnings:
        currentGame.catcherMaxInnings || teamData.catcherMaxInnings,
      catcherConsecutive:
        currentGame.catcherConsecutive ?? teamData.catcherConsecutive,
      seed: Date.now() + Math.floor(Math.random() * 1e6),
      relaxFairness: currentGame.applySeasonalFairness === false,
      isBigGame: currentGame.isBigGame === true,
    });

    if (result.error) {
      toast.push({
        kind: "error",
        title: "Couldn't re-roll defense",
        message: result.error,
        duration: 0,
      });
      return;
    }

    previousLineupRef.current = { lineup, battingLineup };
    uiBridge.current.applyResult({
      lineup: result.lineup,
      // Preserve the existing batting order — re-roll only touched defense.
      battingLineup,
    });
    toast.push({
      kind: "success",
      title: "Defense re-rolled",
      message: lineup ? "Tap Undo to restore the previous defense." : "",
      duration: 6000,
      action: lineup
        ? {
            label: "Undo",
            onClick: () => {
              const snap = previousLineupRef.current;
              if (snap)
                uiBridge.current.applyResult({
                  lineup: snap.lineup,
                  battingLineup: snap.battingLineup,
                });
            },
          }
        : undefined,
    });
  }, [
    teamData.players,
    teamData.games,
    teamData.evaluationEvents,
    teamData.inningsCount,
    teamData.leagueRuleSet,
    teamData.teamAge,
    teamData.defenseSize,
    teamData.positionLock,
    teamData.battingSize,
    teamData.catcherMaxInnings,
    teamData.catcherConsecutive,
    toast,
  ]);

  // Re-roll JUST the batting order. Defensive lineup, attendance, and
  // first-inning overrides are all left alone. Useful when the defense
  // looks right but the order doesn't, or when the coach wants to try a
  // different shuffle of similarly-rated kids in the middle of the order.
  const regenerateBatting = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs) return;
    const { currentGame, currentGameAttendance, lineup, battingLineup } = inputs;
    if (!currentGame) {
      toast.push({ kind: "error", title: "No game selected" });
      return;
    }
    if (!lineup) {
      toast.push({
        kind: "error",
        title: "Generate a lineup first",
        message: "Re-roll batting works on top of an existing lineup.",
      });
      return;
    }
    const presentPlayers = teamData.players.filter(
      (p: any) => currentGameAttendance[p.id] !== false
    );
    if (presentPlayers.length < 1) {
      toast.push({ kind: "error", title: "No players present to bat" });
      return;
    }

    const result = engineGenerateBattingOnly({
      activePlayers: presentPlayers,
      allPlayers: teamData.players,
      evaluationEvents: teamData.evaluationEvents,
      leagueRuleSet: currentGame.leagueRuleSet || teamData.leagueRuleSet,
      teamAge: teamData.teamAge,
      battingSize: currentGame.battingSize || teamData.battingSize,
      seed: Date.now() + Math.floor(Math.random() * 1e6),
    });

    if (result.error) {
      toast.push({
        kind: "error",
        title: "Couldn't build batting order",
        message: result.error,
      });
      return;
    }

    // Snapshot for undo (preserve current defensive lineup, swap batting).
    previousLineupRef.current = { lineup, battingLineup };
    uiBridge.current.applyResult({
      lineup,
      battingLineup: result.battingLineup,
    });
    toast.push({
      kind: "success",
      title: "Batting order re-rolled",
      message: battingLineup ? "Tap Undo to restore the previous order." : "",
      duration: 6000,
      action: battingLineup
        ? {
            label: "Undo",
            onClick: () => {
              const snap = previousLineupRef.current;
              if (snap)
                uiBridge.current.applyResult({
                  lineup: snap.lineup,
                  battingLineup: snap.battingLineup,
                });
            },
          }
        : undefined,
    });
  }, [
    teamData.players,
    teamData.evaluationEvents,
    teamData.leagueRuleSet,
    teamData.teamAge,
    teamData.battingSize,
    toast,
  ]);

  const undoLineup = useCallback(() => {
    const snap = previousLineupRef.current;
    if (snap)
      uiBridge.current.applyResult({
        lineup: snap.lineup,
        battingLineup: snap.battingLineup,
      });
  }, []);

  const saveCurrentGame = useCallback(() => {
    const inputs = uiBridge.current.getInputs();
    if (!inputs?.currentGame) return;
    const {
      currentGame,
      currentGameAttendance,
      lineup,
      battingLineup,
      lineupQualityPenalty,
    } = inputs;
    if (!lineup) {
      toast.push({ kind: "warn", title: "No lineup to save" });
      return;
    }
    // persistTeam slims the lineup down to {id, name, number} per player to
    // stay under Firestore's 1MB document limit. Full player data is in
    // team.players and rehydrated on read.
    updateGame(currentGame.id, {
      lineup,
      battingLineup,
      attendance: currentGameAttendance,
      // Persist quality penalty so the chip survives a reload. Cleared
      // when the lineup is reset.
      qualityPenalty:
        typeof lineupQualityPenalty === "number"
          ? lineupQualityPenalty
          : null,
    });
    toast.push({ kind: "success", title: "Game saved" });
    uiBridge.current.markSaved?.();
  }, [updateGame, toast]);

  // ----- Lineup templates -----
  // Save the current lineup + batting order as a named template the coach
  // can apply to future games (especially useful for tournaments with
  // repeating opponents). Capped at 10 templates per team to keep the doc
  // size in check.
  const saveLineupTemplate = useCallback(
    (name: any) => {
      const inputs = uiBridge.current.getInputs();
      const { lineup, battingLineup } = inputs || {};
      if (!lineup) {
        toast.push({ kind: "warn", title: "No lineup to save as template" });
        return;
      }
      const trimmed = (name || "").trim() || "Untitled Template";
      const tpl = {
        id: "tpl-" + Math.random().toString(36).substring(2, 10),
        name: trimmed,
        lineup,
        battingLineup,
        createdAt: new Date().toISOString(),
      };
      const existing = Array.isArray(teamData.lineupTemplates)
        ? teamData.lineupTemplates
        : [];
      const next = [...existing, tpl].slice(-10);
      updateTeam({ lineupTemplates: next });
      toast.push({
        kind: "success",
        title: "Template Saved",
        message: `"${trimmed}" is now available to apply to other games.`,
      });
    },
    [teamData.lineupTemplates, updateTeam, toast]
  );

  // Apply a template to the currently-selected game's in-flight editor.
  // Stored lineups reference players by id; we leave them as-is and let
  // the editor flag any roster-gone players visually.
  const applyLineupTemplate = useCallback(
    (templateId: any) => {
      const tpl = (teamData.lineupTemplates || []).find(
        (t: any) => t.id === templateId
      );
      if (!tpl) return;
      uiBridge.current.applyTemplate?.(tpl);
      toast.push({
        kind: "info",
        title: "Template Applied",
        message: `Loaded "${tpl.name}". Tweak and save to keep the changes.`,
      });
    },
    [teamData.lineupTemplates, toast]
  );

  const deleteLineupTemplate = useCallback(
    (templateId: any) => {
      const next = (teamData.lineupTemplates || []).filter(
        (t: any) => t.id !== templateId
      );
      updateTeam({ lineupTemplates: next });
    },
    [teamData.lineupTemplates, updateTeam]
  );

  // Mid-game player removal: rebuild the defensive lineup from the current
  // inning onward (engine fills the open slots with remaining roster), strip
  // the removed player from the batting order (the rest of the order stays
  // static), and record the removal so the engine's fairness math prorates
  // their played innings.
  const removePlayerMidGame = useCallback(
    (playerId: any, opts: any = {}) => {
      const { fromInning = 0, reason = "injury" } = opts;
      const inputs = uiBridge.current.getInputs?.() || {};
      const game =
        inputs.currentGame ||
        (teamData.games || []).find(
          (g: any) => g.id === (opts.gameId || teamData?.inGameId)
        );
      const gameId = game?.id || opts.gameId;
      if (!gameId) {
        toast.push({ kind: "error", title: "No game selected" });
        return;
      }
      // Re-read the game from teamData to make sure we have the latest
      // persisted lineup (InGameView passes its pendingLineup via opts).
      const persistedGame = (teamData.games || []).find((g: any) => g.id === gameId);
      const existingLineup = opts.currentLineup || persistedGame?.lineup || [];
      const existingBatting =
        opts.currentBatting || persistedGame?.battingLineup || [];
      if (!Array.isArray(existingLineup) || existingLineup.length === 0) {
        toast.push({
          kind: "warn",
          title: "No lineup to rebuild",
          message: "Generate a lineup first before removing a player.",
        });
        return;
      }
      const existingRemovals = persistedGame?.midGameRemovals || {};
      // Active set = currently-rostered players who are still on the field
      // for this game: present (or no attendance flag) AND not previously
      // removed AND not the player we're removing now.
      const attendance = persistedGame?.attendance || {};
      const activePlayers = (teamData.players || []).filter((p: any) => {
        if (!p?.id) return false;
        if (p.id === playerId) return false;
        if (existingRemovals[p.id]) return false;
        if (attendance[p.id] === false) return false;
        return true;
      });

      const fromInn = Math.min(
        Math.max(0, fromInning),
        existingLineup.length - 1
      );

      const result = engineGenerateLineup({
        activePlayers,
        allPlayers: teamData.players || [],
        games: teamData.games || [],
        evaluationEvents: teamData.evaluationEvents || [],
        currentGame: persistedGame,
        totalInnings: existingLineup.length,
        leagueRuleSet:
          persistedGame?.leagueRuleSet || teamData.leagueRuleSet,
        teamAge: persistedGame?.teamAge || teamData.teamAge,
        defenseSize: persistedGame?.defenseSize || teamData.defenseSize,
        positionLock: persistedGame?.positionLock || teamData.positionLock,
        battingSize: persistedGame?.battingSize || teamData.battingSize,
        pitchingFormat:
          persistedGame?.pitchingFormat || teamData.pitchingFormat,
        catcherMaxInnings:
          persistedGame?.catcherMaxInnings || teamData.catcherMaxInnings,
        catcherConsecutive:
          persistedGame?.catcherConsecutive ?? teamData.catcherConsecutive,
        isBigGame: persistedGame?.isBigGame === true,
        seed: Date.now() & 0xffffffff,
        relaxFairness: true,
        fromInning: fromInn,
        currentLineup: existingLineup,
      });

      if (result.error) {
        toast.push({
          kind: "error",
          title: "Rebuild failed",
          message: result.error,
        });
        return;
      }

      const nextLineup = Array.isArray(result.lineup)
        ? result.lineup
        : existingLineup;
      const nextBatting = (existingBatting || []).filter(
        (p: any) => p && p.id !== playerId
      );
      const nextRemovals = {
        ...existingRemovals,
        [playerId]: { fromInning: fromInn, reason },
      };

      updateGame(gameId, {
        lineup: nextLineup,
        battingLineup: nextBatting,
        midGameRemovals: nextRemovals,
      });

      const removedPlayer = (teamData.players || []).find(
        (p: any) => p.id === playerId
      );
      toast.push({
        kind: "success",
        title: "Player removed",
        message: `${
          removedPlayer?.name || "Player"
        } removed from inning ${fromInn + 1}+. Defense rebuilt; batting order shrunk by one.`,
        duration: 6000,
      });
    },
    [teamData, updateGame, toast]
  );

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
      if (!isGameFinalized(g)) continue;
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
      if (file.size > 1024 * 1024) {
        toast.push({
          kind: "error",
          title: "File too large",
          message: "Logo must be under 1 MB.",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev: any) => {
        const dataUrl = ev.target.result;
        // Firestore caps a single document at ~1,048,487 bytes. Base64 also
        // inflates the binary by ~1.33×, so a 1 MB image becomes ~1.33 MB of
        // JSON. Reject before writing if the merged team doc would exceed a
        // safe ceiling — otherwise the write fails server-side and the
        // user's logo silently doesn't stick.
        const HARD_LIMIT = 900_000; // leave headroom for Firestore overhead
        const SOFT_WARN = 750_000;
        const approxSize = JSON.stringify({
          ...teamData,
          logoUrl: dataUrl,
        }).length;
        if (approxSize > HARD_LIMIT) {
          toast.push({
            kind: "error",
            title: "Logo too large to save",
            message:
              "Combined with the rest of your team data this would exceed Firestore's 1 MB document limit. Please choose a smaller image.",
            duration: 8000,
          });
          return;
        }
        if (approxSize > SOFT_WARN) {
          toast.push({
            kind: "warn",
            title: "Logo accepted (close to limit)",
            message:
              "Your team document is large. Consider a smaller logo if saves start failing.",
            duration: 7000,
          });
        }
        updateTeam({ logoUrl: dataUrl });
      };
      reader.onerror = () =>
        toast.push({ kind: "error", title: "Could not read file" });
      reader.readAsDataURL(file);
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
      const snap = await getDoc(teamRef);
      if (snap.exists()) {
        const data = snap.data();
        const members = (data.members || []).filter((u: any) => u !== user.uid);
        await setDoc(teamRef, { members }, { merge: true });
      }
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

  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    if (!user) return;

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its
      // label/date/id/evaluatorName intact.
      const next = teamData.evaluationEvents.map((e: any) =>
        e.id === selectedRoundId ? { ...e, grades } : e
      );
      updateTeam({ evaluationEvents: next });
      toast.push({ kind: "success", title: "Eval updated" });
      return selectedRoundId;
    }

    // Creating a new round. Stamp it with the calendar due date it satisfies
    // (not the literal day) so rounds line up with the cadence schedule, and
    // denormalize the coach's last name so reads across devices don't need an
    // auth roundtrip.
    const roundDate = evalRoundDateForSave();
    const evaluatorName = lastNameOfUser(user);
    const newEvent = {
      id: "ev-" + Math.random().toString(36).substring(2, 10),
      date: roundDate,
      coachRole: "Head",
      evaluatorId: user.uid,
      evaluatorName,
      grades,
    };
    updateTeam({
      evaluationEvents: [...teamData.evaluationEvents, newEvent],
    });
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: `${evaluatorName} · ${roundDate}`,
    });
    // Return the created id so callers can lock onto this round for edits.
    return newEvent.id;
  }, [user, teamData.evaluationEvents, updateTeam, toast]);

  // Build an Assistant eval round and persist it. Mirrors saveTeamEvaluation's
  // upsert behavior — the round is stamped with the calendar due date it
  // satisfies, and the upsert key uses that same date so a second submission
  // inside the same window updates the round in place instead of duplicating.
  const saveAssistantEvaluation = useCallback(
    (grades: any) => {
      if (!user) return;
      const roundDate = evalRoundDateForSave();
      const existing = (teamData.evaluationEvents || []).find(
        (e: any) =>
          e.coachRole === "Assistant" &&
          e.evaluatorId === user.uid &&
          e.date === roundDate
      );
      let nextEvents;
      if (existing) {
        nextEvents = teamData.evaluationEvents.map((e: any) =>
          e.id === existing.id ? { ...e, grades } : e
        );
      } else {
        const newEvent = {
          id: "ev-" + Math.random().toString(36).substring(2, 10),
          date: roundDate,
          coachRole: "Assistant",
          evaluatorId: user.uid,
          evaluatorName: lastNameOfUser(user),
          grades,
        };
        nextEvents = [...(teamData.evaluationEvents || []), newEvent];
      }
      updateTeam({ evaluationEvents: nextEvents });
      toast.push({
        kind: "success",
        title: "Submitted to head coach",
      });
    },
    [user, teamData.evaluationEvents, updateTeam, toast]
  );

  // Drop an evaluation round (any role). HC-callable so the head coach
  // can clean up rounds entered in error — their own, or any assistant's
  // submission. Splices from team.evaluationEvents by id.
  const deleteEvaluation = useCallback(
    (roundId: any) => {
      if (!roundId) return;
      const next = (teamData.evaluationEvents || []).filter(
        (e: any) => e.id !== roundId
      );
      updateTeam({ evaluationEvents: next });
      toast.push({
        kind: "success",
        title: "Eval round deleted",
      });
    },
    [teamData.evaluationEvents, updateTeam, toast]
  );

  // ─── Tryouts (PR M) ───────────────────────────────────────────────
  // Public sign-up flow lives at /tryouts/:shareId and writes to
  // team.tryoutSignups[]. Coach side reads from the same array; impact
  // analysis compares against returning roster.

  const generateTryoutShareId = useCallback(() => {
    const id =
      Math.random().toString(36).slice(2, 8) +
      Math.random().toString(36).slice(2, 8);
    updateTeam({ tryoutShareId: id, tryoutsOpen: true, tryoutsPhase: "open" });
    return id;
  }, [updateTeam]);


  const generateTryoutDateLink = useCallback(
    (rawDate: any) => {
      const date = String(rawDate || "").trim();
      if (!date) return null;
      const base = String(activeTeamId || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const rand = Math.random().toString(36).slice(2, 8);
      const slug = `${base || "team"}-${date}-${rand}`;
      const dates = Array.isArray(teamData.tryoutDates) ? teamData.tryoutDates : [];
      const nextDates = dates.includes(date) ? dates : [...dates, date];
      updateTeam({
        tryoutDateSlug: slug,
        tryoutDates: nextDates,
        tryoutsOpen: true,
        tryoutsPhase: "open",
      });
      return slug;
    },
    [activeTeamId, teamData.tryoutDates, updateTeam]
  );

  const setTryoutsOpen = useCallback(
    (open: any) => {
      updateTeam({
        tryoutsOpen: !!open,
        tryoutsPhase: open ? "open" : "intake_closed",
      });
    },
    [updateTeam]
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
    [updateTeam]
  );

  const appendTryoutSignup = useCallback(
    (signup: any) => {
      const id =
        signup.id || "ts-" + Math.random().toString(36).slice(2, 10);
      const entry = {
        id,
        submittedAt: signup.submittedAt || new Date().toISOString(),
        status: signup.status || "tryout",
        ...signup,
      };
      const next = [...(teamData.tryoutSignups || []), entry];
      updateTeam({ tryoutSignups: next });
      return entry;
    },
    [teamData.tryoutSignups, updateTeam]
  );

  const updateTryoutSignup = useCallback(
    (id: any, patch: any) => {
      const next = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, ...patch } : s
      );
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam]
  );

  const deleteTryoutSignup = useCallback(
    (id: any) => {
      if (!id) return;
      // Two-tap armed confirm lives in TryoutsTab; no native confirm here.
      const next = (teamData.tryoutSignups || []).filter((s: any) => s.id !== id);
      updateTeam({ tryoutSignups: next });
    },
    [teamData.tryoutSignups, updateTeam]
  );

  // Drop an interest-survey lead. Coach-only; the two-tap confirm lives
  // in the InterestTab UI so there's no native confirm prompt here.
  const deleteInterestSignup = useCallback(
    (id: any) => {
      if (!id) return;
      const next = (teamData.interestSignups || []).filter((s: any) => s.id !== id);
      updateTeam({ interestSignups: next });
    },
    [teamData.interestSignups, updateTeam]
  );

  // Promote an interest-survey lead into a real tryout signup. Useful
  // when tryouts open and the HC wants to seed the signup list from
  // standing interest. Copies fields, marks status:"tryout", removes
  // the source lead from interestSignups in the same write.
  const convertInterestToTryout = useCallback(
    (id: any) => {
      if (!id) return;
      const lead = (teamData.interestSignups || []).find((s: any) => s.id === id);
      if (!lead) return;
      const signup = {
        id: `ts-${Math.random().toString(36).slice(2, 10)}`,
        submittedAt: new Date().toISOString(),
        firstName: lead.firstName,
        lastName: lead.lastName,
        dob: lead.dob || "",
        parentName: lead.parentName || "",
        email: lead.email || "",
        phone: lead.phone || "",
        currentTeam: lead.currentTeam || "",
        comfortablePositions: [
          ...(Array.isArray(lead.comfortablePositions) ? lead.comfortablePositions : []).filter(
            (p: any) => p !== "C"
          ),
          ...(lead.isCatcher === true ? ["C"] : []),
        ],
        notes: lead.notes || "",
        status: "tryout",
      };
      updateTeam({
        tryoutSignups: [...(teamData.tryoutSignups || []), signup],
        interestSignups: (teamData.interestSignups || []).filter(
          (s: any) => s.id !== id
        ),
      });
      toast.push({
        kind: "success",
        title: "Moved to tryouts",
        message: `${lead.firstName} ${lead.lastName}`.trim(),
      });
    },
    [teamData.interestSignups, teamData.tryoutSignups, updateTeam, toast]
  );

  // Tryout grades live in team.evaluationEvents alongside roster
  // evals but carry `tryoutSignupId` so getCombinedGrades ignores them
  // when scoring the roster. One event per (evaluator, signup).
  const saveTryoutEvaluation = useCallback(
    (signupId: any, grades: any, coachRole: any) => {
      if (!user || !signupId) return;
      const date = new Date().toISOString().slice(0, 10);
      const existing = (teamData.evaluationEvents || []).find(
        (e: any) =>
          e.tryoutSignupId === signupId && e.evaluatorId === user.uid
      );
      const event = {
        id:
          existing?.id || "ev-" + Math.random().toString(36).slice(2, 10),
        date,
        coachRole: coachRole || "Assistant",
        evaluatorId: user.uid,
        label: `Tryout · ${signupId}`,
        tryoutSignupId: signupId,
        grades: { signup: { ...grades } },
      };
      const next = existing
        ? teamData.evaluationEvents.map((e: any) =>
            e.id === existing.id ? event : e
          )
        : [...(teamData.evaluationEvents || []), event];
      updateTeam({ evaluationEvents: next });
    },
    [user, teamData.evaluationEvents, updateTeam]
  );

  // Accept-offer flow. Flips signup.status to "accepted" AND creates
  // a corresponding entry in team.players with playerStatus = "accepted"
  // so PR L's advanceSeason picks them up automatically.
  const acceptTryout = useCallback(
    (id: any) => {
      const signup = (teamData.tryoutSignups || []).find((s: any) => s.id === id);
      if (!signup) return;
      const name = `${signup.firstName || ""} ${signup.lastName || ""}`.trim();
      const player = {
        id: "p-" + Math.random().toString(36).slice(2, 10),
        name,
        number: signup.number || "",
        dob: signup.dob || "",
        bats: signup.bats || "R",
        throws: signup.throws || "R",
        comfortablePositions: [
          ...(Array.isArray(signup.comfortablePositions) ? signup.comfortablePositions : []).filter(
            (p: any) => p !== "C"
          ),
          ...(signup.isCatcher === true ? ["C"] : []),
        ],
        parentName: signup.parentName || "",
        email: signup.email || "",
        phone: signup.phone || "",
        present: true,
        playerStatus: "accepted",
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      const nextSignups = (teamData.tryoutSignups || []).map((s: any) =>
        s.id === id ? { ...s, status: "accepted" } : s
      );
      const nextPlayers = [...(teamData.players || []), player];
      updateTeam({
        tryoutSignups: nextSignups,
        players: nextPlayers,
      });
      toast.push({
        kind: "success",
        title: `${name} accepted`,
        message: "Added to roster with status “accepted”. They join on Advance Season.",
      });
    },
    [teamData.tryoutSignups, teamData.players, updateTeam, toast]
  );

  const { setCoachRole } = useTeamMembership({ teamData, updateTeam, user });
  const {
    regenerateJoinCode,
    joinTeamByCode,
  } = useInviteFlows({
    user,
    teams,
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
      if (!isGameFinalized(g)) continue;
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
      <AppHeader />
      <TabBarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        navButtons={navButtons}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:max-w-none">
        <Suspense fallback={<ScreenLoader />}>
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
          <Routes>
            <Route path="/tryouts-portal/:slug" element={<TryoutsPortal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
