import React, { memo, useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { Icons } from "../icons";
import { auth } from "../firebase";
import { useTeam, useUI, useToast } from "../contexts";
import { A11yDialog, RecordBadge, Eyebrow } from "./shared";
import { useTheme } from "../hooks/useTheme";

// Light/dark toggle — sun in dark mode (tap to go light), moon in light mode.
const ThemeToggle = () => {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="shrink-0 p-3 text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink border border-line rounded-xl shadow-sm transition-colors"
    >
      {isDark ? (
        <Icons.Sun className="w-4 h-4" />
      ) : (
        <Icons.Moon className="w-4 h-4" />
      )}
    </button>
  );
};

export const LoginScreen = ({
  logoUrl,
  primaryColor,
  tertiaryColor,
  onSignIn,
  onEmailSignIn,
  genError,
  isSigningIn = false,
}: any) => (
  <div
    className="min-h-screen flex flex-col items-center justify-center p-6 bg-app relative overflow-hidden"
  >
    {/* Top accent strip — matches the in-app modal motif so the first
        thing a returning user sees feels like the same product. */}
    <div
      className="absolute top-0 left-0 right-0 h-2"
      style={{ backgroundColor: primaryColor }}
    />

    {logoUrl && (
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `url(${logoUrl})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "60%",
          opacity: 0.18,
        }}
      />
    )}

    <div className="bg-surface backdrop-blur shadow-card max-w-sm w-full rounded-2xl border border-line relative z-10 overflow-hidden">
      <div className="h-1 w-full" style={{ backgroundColor: primaryColor }} />
      <div className="p-8 text-center">
        <div className="flex justify-center mb-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-card"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Clipboard
              className="w-8 h-8"
              style={{ color: primaryColor }}
            />
          </div>
        </div>
        <Eyebrow className="block mb-2 text-ink-3">
          Sign In Required
        </Eyebrow>
        <h1 className="t-h1 mb-2">Coach's Card</h1>
        <p className="t-body mb-7">
          Lineups, in-game swaps, eval rounds, and season stats in one place.
        </p>
        <button
          onClick={onSignIn}
          disabled={isSigningIn}
          className="w-full py-3.5 px-4 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-md"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {isSigningIn ? (
            <>
              <Icons.Refresh className="w-4 h-4 animate-spin" /> Signing in…
            </>
          ) : (
            <>
              <Icons.Users className="w-4 h-4" /> Sign In with Google
            </>
          )}
        </button>
        {onEmailSignIn && (
          <button
            onClick={onEmailSignIn}
            className="w-full mt-3 py-3 px-4 font-black uppercase tracking-widest text-xs rounded-xl border border-line bg-surface text-ink hover:bg-surface-2 shadow-sm transition-colors"
            type="button"
          >
            Sign In with Email Link
          </button>
        )}
        {genError && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-xs font-bold"
          >
            {genError}
          </p>
        )}
      </div>
    </div>
    <p className="t-meta text-ink-3 mt-6 relative z-10">
      Built for youth-baseball coaches
    </p>
  </div>
);

// Thin banner shown when the device drops offline. Firestore's IndexedDB
// persistence keeps the app working — this just tells the coach their edits
// will sync once they're back (e.g. patchy connectivity at the field). The
// service worker already serves the cached shell, so the app itself stays up.
export const OfflineBanner = memo(() => {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false
  );
  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="print:hidden bg-amber-500 text-amber-950 text-xs font-black uppercase tracking-widest text-center px-4 py-1.5 flex items-center justify-center gap-2"
    >
      <Icons.Cloud className="w-3.5 h-3.5" />
      You're offline — changes will sync when you reconnect
    </div>
  );
});

export const AppHeader = memo(() => {
  const {
    team,
    teams,
    activeTeamId,
    syncStatus,
    switchTeam,
    createTeam,
    record,
    currentRole,
    realRole,
    viewAsRole,
    setViewAsRole,
    joinTeamByCode,
  } = useTeam();
  const {
    isAddingTeam,
    setIsAddingTeam,
    newTeamName,
    setNewTeamName,
    activeTab,
    setActiveTab,
  } = useUI();
  const [isJoiningTeam, setIsJoiningTeam] = React.useState(false);
  const [joinCodeInput, setJoinCodeInput] = React.useState("");
  // New teams must explicitly pick a type (Rec vs Tournament) — no default.
  const [newTeamType, setNewTeamType] = React.useState<"" | "NKB" | "USSSA">("");
  // In-app sign-out confirmation. Replaces window.confirm + window.alert
  // so an assistant on a demoted/locked-out team gets the same polished
  // dialog as the rest of the app, not a 1995 native chrome.
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const toast = useToast();

  const doSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.clear();
        } catch {}
      }
      await signOut(auth);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (err: any) {
      // Surface failure via toast instead of window.alert; let the user
      // decide whether to retry or reload manually.
      setSigningOut(false);
      setSignOutOpen(false);
      toast.push({
        kind: "error",
        title: "Sign-out failed",
        message:
          (err?.message || "Unknown error") + ". Try reloading the page.",
      });
    }
  };
  const activeTeamName =
    teams.find((t: any) => t.id === activeTeamId)?.name || "TEAM";
  const subtitle =
    currentRole === "assistant"
      ? "Assistant Coach View"
      : "Head Coach Dashboard";
  // Persistent chip when the head coach is previewing the assistant view.
  // Only the real head sees this — assistants can never toggle it on.
  const showViewAsChip = realRole === "head" && viewAsRole === "assistant";

  return (
    <header className="print:hidden w-full relative z-20 bg-surface shadow-[0_4px_20px_rgb(0,0,0,0.04)]">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: team.primaryColor }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 md:gap-5">
          {team.logoUrl ? (
            <img
              src={team.logoUrl}
              alt="Team Logo"
              className="w-16 h-16 md:w-20 md:h-20 object-contain p-1"
            />
          ) : (
            <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-surface border border-line shadow-sm">
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: team.primaryColor }}
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none text-ink">
                {activeTeamName}
              </h1>
              <RecordBadge
                record={record}
                variant="compact"
                primaryColor={team.primaryColor}
                tertiaryColor={team.tertiaryColor}
              />
            </div>
            <p className="text-xs uppercase tracking-widest font-extrabold mt-1 text-ink-3">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {showViewAsChip && (
            <div className="flex items-center gap-2 bg-amber-100 border border-amber-300 rounded-xl px-3 py-2 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-900 whitespace-nowrap">
                Viewing as Assistant
              </span>
              <button
                type="button"
                onClick={() => setViewAsRole?.(null)}
                className="text-[10px] font-black uppercase tracking-widest text-amber-900 underline hover:no-underline"
              >
                Revert
              </button>
            </div>
          )}
          <select
            value={activeTeamId}
            onChange={(e) => switchTeam(e.target.value)}
            className="p-3 outline-none flex-1 sm:w-64 text-sm font-black uppercase tracking-wider cursor-pointer rounded-xl bg-surface hover:bg-surface-2 transition-colors border border-line shadow-sm"
          >
            {teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {/*
            Always-visible Sign Out. The Settings → Sign Out button lives
            behind the head-only Settings tab, so anyone shown as assistant
            (including a head who got demoted by the ownership-race bug)
            had no way to sign out from the UI. This icon button is the
            backstop.
          */}
          <ThemeToggle />
          {/* Settings lives up here with the other account-level controls
              (theme, sign out) instead of taking a slot in the tab bar —
              it's visited rarely and is head-coach-only. */}
          {currentRole !== "assistant" && (
            <button
              type="button"
              onClick={() => setActiveTab?.("settings")}
              aria-label="Settings"
              title="Settings"
              aria-current={activeTab === "settings" ? "page" : undefined}
              className={`shrink-0 p-3 border rounded-xl shadow-sm transition-colors ${
                activeTab === "settings"
                  ? ""
                  : "text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink border-line"
              }`}
              style={
                activeTab === "settings"
                  ? {
                      backgroundColor: "var(--team-secondary)",
                      color: "var(--team-primary)",
                      borderColor: "var(--team-primary)",
                    }
                  : undefined
              }
            >
              <Icons.Settings className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            aria-label="Sign out"
            title="Sign out"
            className="shrink-0 p-3 text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink border border-line rounded-xl shadow-sm transition-colors"
          >
            <Icons.LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-slate-900/85 text-white print:hidden relative z-10 border-b border-slate-900 shadow-inner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full sm:max-w-md">
            {isJoiningTeam ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  // joinTeamByCode returns { ok, retryable } — the previous
                  // check was on the object itself (always truthy) so the
                  // form closed and cleared on failure too, hiding the
                  // "Couldn't join" toast behind the join button reappearing
                  // as if nothing happened. Now we only close on success.
                  const result = await joinTeamByCode?.(joinCodeInput);
                  if (result?.ok) {
                    setJoinCodeInput("");
                    setIsJoiningTeam(false);
                  }
                }}
                className="flex items-center gap-2 w-full"
              >
                <input
                  autoFocus
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) =>
                    setJoinCodeInput(e.target.value.toUpperCase())
                  }
                  placeholder="TEAM CODE"
                  maxLength={8}
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 uppercase tracking-widest font-mono bg-slate-900/50 text-white rounded-lg shadow-inner"
                />
                <button
                  type="submit"
                  className="p-2 text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                  style={{
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-tertiary)",
                  }}
                  title="Join team"
                >
                  <Icons.Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsJoiningTeam(false);
                    setJoinCodeInput("");
                  }}
                  className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </form>
            ) : isAddingTeam ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTeamType) return;
                  createTeam(newTeamName, newTeamType);
                }}
                className="flex items-center gap-2 w-full"
              >
                <input
                  autoFocus
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="NEW TEAM NAME"
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 uppercase bg-slate-900/50 text-white rounded-lg shadow-inner"
                />
                <select
                  value={newTeamType}
                  onChange={(e) =>
                    setNewTeamType(e.target.value as "" | "NKB" | "USSSA")
                  }
                  title="Team type"
                  className="p-2 text-xs bg-slate-900/50 text-white rounded-lg shadow-inner outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                >
                  <option value="">Type…</option>
                  <option value="NKB">Rec</option>
                  <option value="USSSA">Tournament</option>
                </select>
                <button
                  type="submit"
                  disabled={!newTeamType}
                  className="p-2 text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity disabled:opacity-40"
                  style={{
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-tertiary)",
                  }}
                >
                  <Icons.Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingTeam(false)}
                  className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAddingTeam(true)}
                  className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Plus className="w-3.5 h-3.5" /> New Team
                </button>
                <button
                  onClick={() => setIsJoiningTeam(true)}
                  className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Users className="w-3.5 h-3.5" /> Join Team
                </button>
              </div>
            )}
          </div>
          {syncStatus && (
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-ink-3">
              {syncStatus === "Saving" || syncStatus === "Creating" ? (
                <Icons.Refresh className="w-3 h-3 animate-spin text-blue-400" />
              ) : (
                <Icons.Cloud className="w-3 h-3 text-green-400" />
              )}
              {syncStatus}
            </div>
          )}
        </div>
      </div>

      {signOutOpen && (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
          onClick={() => !signingOut && setSignOutOpen(false)}
        >
          <A11yDialog
            aria-labelledby="sign-out-title"
            onClose={() => !signingOut && setSignOutOpen(false)}
            className="bg-surface max-w-sm w-full rounded-2xl shadow-2xl overflow-hidden"
          >
            <div
              className="h-1.5 w-full"
              style={{ backgroundColor: "var(--team-primary)" }}
            />
            <div className="p-6">
              <h3
                id="sign-out-title"
                className="text-lg font-black uppercase tracking-tight text-ink mb-1"
              >
                Sign out?
              </h3>
              <p className="text-sm text-ink-2 font-medium mb-5">
                You'll need to sign in again on this device. Any in-progress
                data is already saved.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => setSignOutOpen(false)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={doSignOut}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-md transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {signingOut ? (
                    <>
                      <Icons.Refresh className="w-4 h-4 animate-spin" />
                      Signing out…
                    </>
                  ) : (
                    "Sign Out"
                  )}
                </button>
              </div>
            </div>
          </A11yDialog>
        </div>
      )}
    </header>
  );
});

// Tabs that stay visible on phones; everything else collapses into "More".
// Order matters — it mirrors the coach's game-day loop.
const MOBILE_PRIORITY_TABS = ["home", "schedule", "roster", "stats"];

const activeTabStyle = {
  backgroundColor: "var(--team-secondary)",
  color: "var(--team-primary)",
  borderColor: "var(--team-primary)",
};

const TabPill = ({ btn, isActive, onClick, className = "" }: any) => {
  const Icon = btn.icon;
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`py-2.5 px-5 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 whitespace-nowrap rounded-full transition-all duration-200 border ${
        isActive
          ? "shadow-sm"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink border-transparent"
      } ${className}`}
      style={isActive ? activeTabStyle : undefined}
    >
      <Icon className="w-4 h-4" /> {btn.label}
    </button>
  );
};

export const TabBarNav = memo(({ activeTab, setActiveTab, navButtons }: any) => {
  const [moreOpen, setMoreOpen] = useState(false);

  // On phones, most of a head coach's 10 tabs scroll off-screen. Keep the
  // game-day four visible and fold the rest into a "More" pill; when the
  // active tab lives in the overflow, the pill takes the active style and
  // shows that tab's label. sm+ keeps the full pill row (desktop unchanged).
  const priority = navButtons.filter((b: any) =>
    MOBILE_PRIORITY_TABS.includes(b.id)
  );
  const overflow = navButtons.filter(
    (b: any) => !MOBILE_PRIORITY_TABS.includes(b.id)
  );
  const activeOverflowBtn = overflow.find((b: any) => b.id === activeTab);

  const pick = (id: string) => {
    setActiveTab(id);
    setMoreOpen(false);
  };

  return (
    <nav
      aria-label="Primary"
      className="bg-surface border-b border-line print:hidden relative z-10 shadow-sm"
    >
      {/* sm+: full pill row (unchanged) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 hidden sm:block">
        <div className="flex overflow-x-auto scrollbar-hide gap-2 pb-4">
          {navButtons.map((btn: any) => (
            <TabPill
              key={btn.id}
              btn={btn}
              isActive={activeTab === btn.id}
              onClick={() => setActiveTab(btn.id)}
            />
          ))}
        </div>
      </div>

      {/* Mobile: priority tabs + More overflow */}
      <div className="max-w-7xl mx-auto px-4 pt-4 sm:hidden relative">
        <div className="flex overflow-x-auto scrollbar-hide gap-2 pb-4">
          {priority.map((btn: any) => (
            <TabPill
              key={btn.id}
              btn={btn}
              isActive={activeTab === btn.id}
              onClick={() => pick(btn.id)}
            />
          ))}
          {overflow.length > 0 && (
            <button
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-current={activeOverflowBtn ? "page" : undefined}
              className={`py-2.5 px-5 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 whitespace-nowrap rounded-full transition-all duration-200 border ${
                activeOverflowBtn
                  ? "shadow-sm"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink border-transparent"
              }`}
              style={activeOverflowBtn ? activeTabStyle : undefined}
            >
              {activeOverflowBtn ? (
                <>
                  <activeOverflowBtn.icon className="w-4 h-4" />
                  {activeOverflowBtn.label}
                </>
              ) : (
                "More"
              )}
              <Icons.ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  moreOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>
        {moreOpen && (
          <>
            {/* Tap-away scrim under the panel */}
            <div
              className="fixed inset-0 z-10"
              aria-hidden="true"
              onClick={() => setMoreOpen(false)}
            />
            <div
              role="menu"
              aria-label="More tabs"
              className="absolute right-4 top-full mt-1 z-20 bg-surface border border-line rounded-2xl shadow-lg overflow-hidden min-w-[180px]"
            >
              {overflow.map((btn: any) => {
                const Icon = btn.icon;
                const isActive = activeTab === btn.id;
                return (
                  <button
                    key={btn.id}
                    role="menuitem"
                    onClick={() => pick(btn.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`w-full text-left px-4 py-3 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2.5 transition-colors ${
                      isActive ? "" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: "var(--team-secondary)",
                            color: "var(--team-primary)",
                          }
                        : undefined
                    }
                  >
                    <Icon className="w-4 h-4" /> {btn.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </nav>
  );
});
