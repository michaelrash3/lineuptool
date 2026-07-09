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
import { SpeedInsights } from "@vercel/speed-insights/react";
import {
  signInWithCustomToken,
  type User,
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
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  updateDoc,
  arrayRemove,
  DocumentSnapshot,
  FirestoreError,
} from "firebase/firestore";
import { Icons } from "./icons";
import { ToastProvider } from "./providers/ToastProvider";
import { UIProvider } from "./providers/UIProvider";
import { TeamProvider } from "./providers/TeamProvider";
import { errCode, errMessage, authDiag } from "./utils/diagnostics";
import {
  markRedirectPending,
  clearRedirectPending,
  isRedirectLikelyStuck,
  redirectAttemptsExceeded,
} from "./auth/googleRedirect";
import { featureEnabled } from "./constants/features";
import type {
  ToastInput,
  Team,
  Game,
  Inning,
  SlimPlayer,
  TournamentPlan,
  GradeMap,
  EvaluationEvent,
  Player,
  TryoutSignup,
} from "./types";
import { auth, db, appId } from "./firebase";
import {
  ToastContext,
  TeamContext,
  UIContext,
  useToast,
  useTeam,
  useUI,
  useConfirm,
} from "./contexts";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { SharedModals, downscaleImageToDataURL } from "./components/shared";
import {
  AppMotionProvider,
  AnimatePresence,
  m,
  FadeSlideIn,
} from "./components/motion";
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
import { LoginScreen, AppHeader, OfflineBanner } from "./components/Chrome";
import { AppLoadingScreen, ScreenLoader } from "./components/LoadingScreens";
import {
  PlayerProfilePage,
  AddPlayerModal,
  PastSeasonImportModal,
} from "./components/modals";
import {
  slimGame,
  scrubUndefined,
  blankStats,
  emailPromptStatus,
  restampEvalDueDates,
  evalRoundRecency,
  buildPreseasonSeedRound,
  dateToIsoLocal,
  isReturning,
  isGameFinalized,
  countsTowardStats,
  buildPublicMirror,
  revertOptimisticUpdate,
  estimateDocSizeBytes,
  mergeTeamEntries,
  blockedRosterWipeReason,
  isPlayerScheduledOut,
  financeSummary,
  formatCurrency,
  rollFinancesForNewSeason,
  dedupePlayerInfoSubmissions,
  genId,
  FIRESTORE_DOC_LIMIT_BYTES,
  DOC_SIZE_WARN_RATIO,
} from "./utils/helpers";
import { applyLineupSwap } from "./utils/lineupSwap";
import { buildEvalReminderDraft, buildMailtoUrl } from "./utils/reminderDraft";
import { useMainShellRouting } from "./hooks/useMainShellRouting";
import { useTeamMembership } from "./hooks/useTeamMembership";
import { useInviteFlows } from "./hooks/useInviteFlows";
import { useImportExportFlows } from "./hooks/useImportExportFlows";
import { useScheduleReminders } from "./hooks/useScheduleReminders";
import { useGameCrud } from "./hooks/useGameCrud";
import { applyTeamInkVars } from "./utils/contrast";
import { usePracticeCrud } from "./hooks/usePracticeCrud";
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
  isKidPitchFormat,
  APP_NAME,
} from "./constants/ui";

// Pure-function lineup engine. Lives in ./lineupEngine.js next to this file.

// Screens are lazy-loaded so the initial bundle stays small. The Routes
// blocks below are wrapped in <Suspense> with a tiny spinner fallback.
// `import().then(m => ({ default: m.X }))` is the named-export shim
// React.lazy needs — every screen here exports its component as a named
// const, not a default.
const HomeTab = lazy(() =>
  import("./screens/HomeTab").then((m) => ({ default: m.HomeTab })),
);
const RosterTab = lazy(() =>
  import("./screens/RosterTab").then((m) => ({ default: m.RosterTab })),
);
const StatsTab = lazy(() =>
  import("./screens/StatsTab").then((m) => ({ default: m.StatsTab })),
);
const DepthChartTab = lazy(() =>
  import("./screens/DepthChartTab").then((m) => ({ default: m.DepthChartTab })),
);
const ScheduleTab = lazy(() =>
  import("./screens/ScheduleTab").then((m) => ({ default: m.ScheduleTab })),
);
const EvaluationTab = lazy(() =>
  import("./screens/EvaluationTab").then((m) => ({
    default: m.EvaluationTab,
  })),
);
const SettingsTab = lazy(() =>
  import("./screens/SettingsTab").then((m) => ({ default: m.SettingsTab })),
);
const AssistantEvalTab = lazy(() =>
  import("./screens/AssistantEvalTab").then((m) => ({
    default: m.AssistantEvalTab,
  })),
);
const TryoutsTab = lazy(() =>
  import("./screens/TryoutsTab").then((m) => ({ default: m.TryoutsTab })),
);
const InterestTab = lazy(() =>
  import("./screens/InterestTab").then((m) => ({ default: m.InterestTab })),
);
const FinancesTab = lazy(() =>
  import("./screens/FinancesTab").then((m) => ({ default: m.FinancesTab })),
);
const TryoutsPortal = lazy(() =>
  import("./screens/TryoutsPortal").then((m) => ({
    default: m.TryoutsPortal,
  })),
);
const PlayerInfoPortal = lazy(() =>
  import("./screens/PlayerInfoPortal").then((m) => ({
    default: m.PlayerInfoPortal,
  })),
);
const AvailabilityPortal = lazy(() =>
  import("./screens/AvailabilityPortal").then((m) => ({
    default: m.AvailabilityPortal,
  })),
);
const AvailabilityTab = lazy(() =>
  import("./screens/AvailabilityTab").then((m) => ({
    default: m.AvailabilityTab,
  })),
);
const PlayerInfoTab = lazy(() =>
  import("./screens/PlayerInfoTab").then((m) => ({
    default: m.PlayerInfoTab,
  })),
);
const InGameView = lazy(() =>
  import("./screens/InGameView").then((m) => ({ default: m.InGameView })),
);
const PracticesTab = lazy(() =>
  import("./screens/PracticesTab").then((m) => ({ default: m.PracticesTab })),
);

// Screen labels used to build the dynamic browser-tab title
// ("<Team> · <Screen>"). "home" reads as "Dashboard" to match its nav label.

/* ============================================================================
   SECTION 2 · Firebase setup — see ./firebase.js
   SECTION 3 · Pure helpers — see ./utils/helpers.js
============================================================================ */

/* ============================================================================
   SECTION 4 · UI-only constants — see ./constants/ui.js
============================================================================ */

// Narrow an unknown caught value to its Firebase-style { code, message }.
// Catch clauses are `unknown` under strict mode; these readers pull the two
// fields the toasts/logging use without an `any` cast at each site.

/* ============================================================================
   SECTION 5 · Toast system (replaces scattered setGenerationError)
============================================================================ */

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
   SECTION 9 · LoginScreen, AppHeader, NavDrawer — see ./components/Chrome.jsx
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
   SECTION 15 · PlayerProfilePage — see ./components/modals.tsx
   SECTION 16 · AddPlayerModal     — see ./components/modals.jsx
============================================================================ */

/* ============================================================================
   SECTION 17 · TeamProvider — owns team state, Firebase subscriptions, actions
   This replaces the prop-drilled state/actions object in the original.
============================================================================ */

/* ============================================================================
   SECTION 18 · UIProvider — local UI state (modals, selections, attendance)
   Bridges back to TeamProvider through `uiBridge` ref so generate/save can
   read the current UI state without re-rendering on every keystroke.
============================================================================ */

/* ============================================================================
   SECTION 18.5 · InGameView — see ./screens/InGameView
============================================================================ */

/* ============================================================================
   SECTION 19 · Main App layout (consumes both contexts)
============================================================================ */
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
    activeTab,
    setActiveTab,
    selectedGameId,
    setSelectedGameId,
    inGameId,
    setInGameId,
  } = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const isAssistant = currentRole === "assistant";
  const { tabOrder } = useMainShellRouting({
    activeTab,
    setActiveTab,
    inGameId,
    setInGameId,
    selectedGameId,
    setSelectedGameId,
    isAssistant,
    disabledFeatures: team?.disabledFeatures,
    location,
    navigate,
  });
  // Settings-driven feature switches: a module the head turned off loses its
  // tab AND its routes (direct URLs bounce home) for every member.
  const featureOff = (id: string) => !featureEnabled(team, id);

  // Client-side game-day reminders while the app is open (opt-in via Settings).
  useScheduleReminders();

  const { promptText } = useConfirm();
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
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
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
    // Pick WHICH team color is legible as a font per background (--team-ink /
    // --team-on-primary / --team-on-secondary). Colors are never altered —
    // see utils/contrast.ts. Light/dark switching happens in CSS (--team-ink
    // resolves to the light or dark pick), so no theme dependency here.
    applyTeamInkVars(root, {
      primaryColor: team?.primaryColor,
      secondaryColor: team?.secondaryColor,
      tertiaryColor: team?.tertiaryColor,
    });
  }, [team?.primaryColor, team?.secondaryColor, team?.tertiaryColor]);

  if (!authReady || loading) {
    return <AppLoadingScreen />;
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
    return <AppLoadingScreen />;
  }

  const authEnv =
    typeof navigator !== "undefined" &&
    (() => {
      const ua = navigator.userAgent || "";
      const isInApp =
        /FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|GSA|wv\)|WebView|DuckDuckGo/i.test(
          ua,
        );
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
            if (authEnv && authEnv.isInApp) {
              if (isRedirectLikelyStuck() || redirectAttemptsExceeded()) {
                clearRedirectPending();
                setGenError(
                  "Google sign-in loop detected. Open this app in Safari/Chrome and try again.",
                );
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
          } catch (e) {
            const code = errCode(e);
            if (
              code === "auth/popup-closed-by-user" ||
              code === "auth/cancelled-popup-request"
            ) {
              authDiag("popup_dismissed", { code: code || null });
              popupDismissCountRef.current += 1;
              if (popupDismissCountRef.current >= 2) {
                // Two dismissals in a row strongly suggests a browser-level
                // block (third-party cookies disabled, in-app webview, etc.)
                // rather than the user genuinely changing their mind. Surface
                // the remediation tip instead of staying silent.
                setGenError(
                  "If the Google popup keeps closing right away, allow third-party cookies for lineupgenerator-79159.firebaseapp.com, or open this app directly in Safari/Chrome.",
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
                  setGenError(
                    "Google sign-in loop detected. Open this app in Safari/Chrome and try again.",
                  );
                  setIsSigningIn(false);
                  return;
                }
                markRedirectPending();
                authDiag("redirect_start", { source: "popup_fallback" });
                popupDismissCountRef.current = 0;
                await signInWithRedirect(auth, provider);
                return;
              } catch (redirectError) {
                authDiag("redirect_fallback_error", {
                  code: errCode(redirectError) || null,
                  message: errMessage(redirectError) || null,
                });
                setGenError(errMessage(redirectError) || "Sign-in failed");
                setIsSigningIn(false);
                return;
              }
            }
            authDiag("popup_error", {
              code: errCode(e) || null,
              message: errMessage(e) || null,
            });
            setGenError(errMessage(e));
            setIsSigningIn(false);
          }
        }}
        genError={genError}
        onEmailSignIn={async () => {
          if (typeof window === "undefined") return;
          const email =
            (await promptText({
              title: "Sign in with email",
              message: "We'll email you a one-tap sign-in link.",
              label: "Email",
              inputType: "email",
              placeholder: "coach@example.com",
              confirmLabel: "Send Link",
            })) || "";
          if (!email) return;
          try {
            const continueUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
            await sendSignInLinkToEmail(auth, email, {
              url: continueUrl,
              handleCodeInApp: true,
            });
            window.localStorage.setItem("emailForSignIn", email);
            authDiag("email_link_sent", { email });
            setGenError(
              "Email sign-in link sent. Check your inbox and open it on this device.",
            );
          } catch (e) {
            authDiag("email_link_send_error", {
              code: errCode(e) || null,
              message: errMessage(e) || null,
            });
            setGenError(errMessage(e) || "Could not send email sign-in link");
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
  // Head-only "Interest" tab. Keep it visible for heads even before the
  // first lead so coaches can always open the inbox and confirm whether a
  // dated submission landed in Interest or Tryouts.
  const interestButton = !isAssistant
    ? { id: "interest", icon: Icons.Clipboard, label: "Interest" }
    : null;
  // Head-only "Player Info" inbox for parent-submitted sizing/logistics.
  const playerInfoButton = !isAssistant
    ? { id: "playerInfo", icon: Icons.Users, label: "Player Info" }
    : null;
  // Head-only "Availability" calendar for parent-submitted absences.
  const availabilityButton = !isAssistant
    ? { id: "availability", icon: Icons.Calendar, label: "Availability" }
    : null;
  const navButtons = (
    isAssistant
      ? [
          { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
          { id: "roster", icon: Icons.Users, label: "Roster" },
          { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
          { id: "practices", icon: Icons.Clock, label: "Practices" },
          { id: "stats", icon: Icons.Chart, label: "Stats" },
          { id: "depthChart", icon: Icons.Glove, label: "Depth Chart" },
          tryoutsButton,
          { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
        ]
      : [
          { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
          { id: "roster", icon: Icons.Users, label: "Roster" },
          { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
          { id: "practices", icon: Icons.Clock, label: "Practices" },
          { id: "stats", icon: Icons.Chart, label: "Stats" },
          { id: "depthChart", icon: Icons.Glove, label: "Depth Chart" },
          tryoutsButton,
          ...(interestButton ? [interestButton] : []),
          ...(playerInfoButton ? [playerInfoButton] : []),
          ...(availabilityButton ? [availabilityButton] : []),
          { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
          // Money is the head coach's business alone — assistants never see
          // the Finances tab (mirrors the Settings route gate below).
          { id: "finances", icon: Icons.Wallet, label: "Finances" },
          // Settings intentionally absent: it lives in the AppHeader next to
          // theme/sign-out (account-level controls), not in the tab bar.
        ]
  )
    // Settings-driven feature switches hide their tabs for everyone.
    .filter((b) => featureEnabled(team, b.id));

  // Shared by /evaluation and its /evaluation/round/:roundId page so the
  // assistant's read-only past-round view is a real, deep-linkable route
  // (back button closes it) rather than local-state-only.
  const evalElement = !roleResolved ? (
    <ScreenLoader />
  ) : isAssistant ? (
    <AssistantEvalTab />
  ) : (
    <EvaluationTab />
  );

  return (
    <div className="min-h-screen bg-app print:bg-surface relative">
      {/* Keyboard/screen-reader users can jump past the header + tab bar straight
          to the screen content. Visually hidden until focused (first Tab press). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-[var(--team-primary)] focus:px-4 focus:py-2 focus:text-sm focus:font-extrabold focus:uppercase focus:tracking-widest focus:text-white focus:shadow-lg focus:outline-none"
      >
        Skip to content
      </a>
      {/* Massive team-logo watermark — part of the team's branding, fixed
          behind all content and visible through transparent non-modal cards. Only renders when the team has a logo set. */}
      {team?.logoUrl && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-0 pointer-events-none print:hidden grid place-items-center overflow-hidden"
        >
          <div
            className="w-[min(77vw,1030px)] aspect-square bg-center bg-no-repeat bg-contain opacity-[0.05] dark:opacity-[0.07]"
            style={{ backgroundImage: `url(${team.logoUrl})` }}
          />
        </div>
      )}
      <OfflineBanner />
      <AppHeader navButtons={navButtons} />
      {/* Desktop "control-panel" canvas: cap and center the content column on
          wide screens so tab layouts compose into panels instead of stretching
          edge-to-edge. Gated at lg so phone/tablet stay full-bleed and
          byte-identical. See the Desktop layout spec in docs/ARCHITECTURE.md. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 w-full lg:max-w-[1440px] lg:mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:max-w-none focus:outline-none"
      >
        <Suspense fallback={<ScreenLoader />}>
          <ErrorBoundary resetKey={location.pathname}>
            {/* Keyed entrance-only transition: replays on navigation. Exit
            animations (AnimatePresence mode="wait") are flaky around
            Suspense/lazy chunks, so entrances only. */}
            <FadeSlideIn key={location.pathname}>
              <Routes>
                <Route path="/" element={<HomeTab />} />
                <Route
                  path="/stats"
                  element={
                    featureOff("stats") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <StatsTab />
                    )
                  }
                />
                <Route path="/roster" element={<RosterTab />} />
                <Route
                  path="/roster/:playerId"
                  element={<PlayerProfilePage />}
                />
                <Route
                  path="/depth-chart"
                  element={
                    featureOff("depthChart") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <DepthChartTab />
                    )
                  }
                />
                <Route path="/schedule" element={<ScheduleTab />} />
                <Route
                  path="/practices"
                  element={
                    featureOff("practices") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <PracticesTab />
                    )
                  }
                />
                <Route path="/schedule/*" element={<ScheduleTab />} />
                <Route path="/evaluation" element={evalElement} />
                <Route
                  path="/evaluation/round/:roundId"
                  element={evalElement}
                />
                <Route
                  path="/tryouts"
                  element={
                    featureOff("tryouts") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <TryoutsTab />
                    )
                  }
                />
                <Route
                  path="/interest"
                  element={
                    isAssistant || featureOff("interest") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <InterestTab />
                    )
                  }
                />
                <Route
                  path="/player-info"
                  element={
                    isAssistant || featureOff("playerInfo") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <PlayerInfoTab />
                    )
                  }
                />
                <Route
                  path="/availability"
                  element={
                    isAssistant || featureOff("availability") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <AvailabilityTab />
                    )
                  }
                />
                <Route
                  path="/finances"
                  element={
                    isAssistant || featureOff("finances") ? (
                      <Navigate to="/" replace />
                    ) : (
                      <FinancesTab />
                    )
                  }
                />
                <Route
                  path="/settings"
                  element={
                    isAssistant ? <Navigate to="/" replace /> : <SettingsTab />
                  }
                />
                {/* In-Game renders standalone (no SharedModals scrim) below; the
              route just hides the main tab content while In-Game is active. */}
                <Route
                  path="/in-game/:gameId"
                  element={<div className="hidden" />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </FadeSlideIn>
          </ErrorBoundary>
        </Suspense>
      </main>
      <SharedModals />
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
      <m.button
        type="button"
        onClick={() => setTutorialOpen(true)}
        aria-label="Open tutorial"
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.92 }}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white font-black text-lg print:hidden"
        style={{ backgroundColor: "var(--team-primary)" }}
      >
        ?
      </m.button>
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
    (window.location.pathname.startsWith("/tryouts-portal/") ||
      window.location.pathname.startsWith("/player-info-portal/") ||
      window.location.pathname.startsWith("/availability-portal/"))
  ) {
    return (
      <AppMotionProvider>
        <ToastProvider>
          <Suspense fallback={<ScreenLoader />}>
            <ErrorBoundary>
              <Routes>
                <Route
                  path="/tryouts-portal/:slug"
                  element={<TryoutsPortal />}
                />
                <Route
                  path="/player-info-portal/:slug"
                  element={<PlayerInfoPortal />}
                />
                <Route
                  path="/availability-portal/:slug"
                  element={<AvailabilityPortal />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </Suspense>
        </ToastProvider>
      </AppMotionProvider>
    );
  }
  return (
    <AppMotionProvider>
      <ToastProvider>
        <ConfirmProvider>
          <TeamProvider>
            <UIProvider>
              <MainShell />
            </UIProvider>
          </TeamProvider>
        </ConfirmProvider>
      </ToastProvider>
      <SpeedInsights />
    </AppMotionProvider>
  );
};

export default App;
