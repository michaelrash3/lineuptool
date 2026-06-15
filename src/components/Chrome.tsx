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
    {logoUrl && (
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `url(${logoUrl})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "min(85vw, 840px)",
          opacity: 0.07,
        }}
      />
    )}

    <div className="glass cc-sheen shadow-2xl glow-primary max-w-sm w-full rounded-sm border border-line relative z-10 overflow-hidden">
      <div
        className="h-1 w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${primaryColor}, transparent)`,
          boxShadow: `0 0 20px 1px ${primaryColor}`,
        }}
      />
      <div className="p-8 text-center">
        <div className="flex justify-center mb-6">
          <div
            className="w-14 h-14 rounded-sm flex items-center justify-center glow-primary"
            style={{
              background: `linear-gradient(160deg, ${primaryColor}, color-mix(in srgb, ${primaryColor} 55%, #000))`,
            }}
          >
            <Icons.Clipboard
              className="w-7 h-7"
              style={{ color: tertiaryColor }}
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
          className="btn-premium w-full py-3.5 px-4 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 rounded-sm disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ color: tertiaryColor }}
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
            className="w-full mt-3 py-3 px-4 font-black uppercase tracking-widest text-xs rounded-sm border border-line-strong bg-transparent text-ink-2 hover:text-ink hover:border-ink-3 transition-colors"
            type="button"
          >
            Sign In with Email Link
          </button>
        )}
        {genError && (
          <p
            role="alert"
            className="mt-5 rounded-sm bg-loss-bg border border-line text-loss px-3 py-2 text-xs font-bold"
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
      className="print:hidden bg-warn-bg text-warnfg border-b border-line text-xs font-black uppercase tracking-widest text-center px-4 py-1.5 flex items-center justify-center gap-2"
    >
      <Icons.Cloud className="w-3.5 h-3.5" />
      You're offline — changes will sync when you reconnect
    </div>
  );
});

export const AppHeader = memo(({ navButtons = [] }: any) => {
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
    <header className="print:hidden w-full relative z-20 glass border-b border-line shadow-lg">
      <div
        className="h-1 w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${team.primaryColor} 20%, ${team.primaryColor} 80%, transparent)`,
          boxShadow: `0 0 18px 1px ${team.primaryColor}`,
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 md:gap-5">
          <NavDrawer
            navButtons={navButtons}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            teamName={activeTeamName}
            subtitle={subtitle}
            showSettings={currentRole !== "assistant"}
            onSettings={() => setActiveTab?.("settings")}
            themeToggle={<ThemeToggle />}
            onSignOut={() => setSignOutOpen(true)}
          />
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
            <div className="flex items-center gap-2 bg-warn-bg border border-line rounded-xl px-3 py-2 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-warnfg whitespace-nowrap">
                Viewing as Assistant
              </span>
              <button
                type="button"
                onClick={() => setViewAsRole?.(null)}
                className="text-[10px] font-black uppercase tracking-widest text-warnfg underline hover:no-underline"
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
          {/* Theme, Settings and Sign Out now live in the hamburger nav
              drawer (top-left), pinned at its foot alongside the navigation.
              Sign Out stays reachable for everyone — including a head who got
              demoted by the ownership-race bug — because the drawer trigger is
              always present in the header. */}
        </div>
      </div>

      <div className="bg-surface-2 text-ink print:hidden relative z-10 border-b border-line shadow-inner">
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
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 uppercase tracking-widest font-mono bg-surface border border-line text-ink rounded-lg shadow-inner"
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
                  className="p-2 bg-surface border border-line text-ink-2 hover:text-ink rounded-lg"
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
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 uppercase bg-surface border border-line text-ink rounded-lg shadow-inner"
                />
                <select
                  value={newTeamType}
                  onChange={(e) =>
                    setNewTeamType(e.target.value as "" | "NKB" | "USSSA")
                  }
                  title="Team type"
                  className="p-2 text-xs bg-surface border border-line text-ink rounded-lg shadow-inner outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
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
                  className="p-2 bg-surface border border-line text-ink-2 hover:text-ink rounded-lg"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAddingTeam(true)}
                  className="text-xs bg-surface border border-line text-ink-2 hover:text-ink py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Plus className="w-3.5 h-3.5" /> New Team
                </button>
                <button
                  onClick={() => setIsJoiningTeam(true)}
                  className="text-xs bg-surface border border-line text-ink-2 hover:text-ink py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Users className="w-3.5 h-3.5" /> Join Team
                </button>
              </div>
            )}
          </div>
          {syncStatus && (
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-ink-3">
              {syncStatus === "Saving" || syncStatus === "Creating" ? (
                <Icons.Refresh className="w-3 h-3 animate-spin" style={{ color: "var(--info-fg)" }} />
              ) : (
                <Icons.Cloud className="w-3 h-3 text-win" />
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

const activeTabStyle = {
  backgroundColor: "var(--team-secondary)",
  color: "var(--team-primary)",
  borderColor: "var(--team-primary)",
  boxShadow: "var(--glow-primary)",
};

// The hamburger drawer is the app's sole navigation surface — it replaced the
// old horizontal tab bar on every screen size. The trigger lives top-left in
// the header; tapping it slides a panel in from the left over a dimmed,
// tap-away scrim. Every destination the current role can reach is listed, and
// the drawer auto-closes the instant one is picked. Account-level actions
// (Settings, theme, Sign Out) sit pinned at the bottom, where they used to
// live in the header's right rail.
const NavRow = ({ icon: Icon, label, isActive, onClick, role = "menuitem" }: any) => (
  <button
    type="button"
    role={role}
    onClick={onClick}
    aria-current={isActive ? "page" : undefined}
    className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl font-extrabold text-sm tracking-wide transition-colors border ${
      isActive
        ? "shadow-sm"
        : "text-ink-2 hover:bg-surface-2 hover:text-ink border-transparent"
    }`}
    style={isActive ? activeTabStyle : undefined}
  >
    <Icon className="w-5 h-5 shrink-0" /> {label}
  </button>
);

export const NavDrawer = memo(
  ({
    navButtons,
    activeTab,
    setActiveTab,
    teamName,
    subtitle,
    showSettings,
    onSettings,
    themeToggle,
    onSignOut,
  }: any) => {
    const [open, setOpen] = useState(false);

    // Close on Escape and lock background scroll while the drawer is open.
    useEffect(() => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        window.removeEventListener("keydown", onKey);
        document.body.style.overflow = prevOverflow;
      };
    }, [open]);

    const pick = (id: string) => {
      setActiveTab(id);
      setOpen(false);
    };

    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-haspopup="menu"
          title="Menu"
          className="shrink-0 p-3 text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink border border-line rounded-xl shadow-sm transition-colors"
        >
          <Icons.Menu className="w-5 h-5" />
        </button>

        {open && (
          <div className="fixed inset-0 z-[60] print:hidden">
            {/* Dimmed, tap-away backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />
            <nav
              role="menu"
              aria-label="Primary navigation"
              className="nav-drawer-panel absolute inset-y-0 left-0 w-[300px] max-w-[88vw] flex flex-col glass border-r border-line shadow-2xl"
              style={{ animation: "drawerIn 0.2s ease-out" }}
            >
              {/* team-accent edge strip */}
              <div
                className="absolute inset-y-0 left-0 w-[2px]"
                style={{
                  background:
                    "linear-gradient(180deg, transparent, var(--team-primary) 18%, var(--team-primary) 82%, transparent)",
                  boxShadow: "0 0 18px 1px var(--team-primary)",
                  opacity: 0.7,
                }}
                aria-hidden="true"
              />
              <div className="flex items-center gap-3 px-4 py-4 border-b border-line">
                <div className="min-w-0">
                  <div className="text-base font-black uppercase tracking-tight leading-none text-ink truncate">
                    {teamName}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest font-extrabold mt-1.5 text-ink-3">
                    {subtitle}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation menu"
                  className="ml-auto p-2 text-ink-3 hover:text-ink rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <Icons.X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="flex flex-col gap-1">
                  {navButtons.map((btn: any) => (
                    <NavRow
                      key={btn.id}
                      icon={btn.icon}
                      label={btn.label}
                      isActive={activeTab === btn.id}
                      onClick={() => pick(btn.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-line px-3 py-3 flex flex-col gap-2">
                {showSettings && (
                  <NavRow
                    icon={Icons.Settings}
                    label="Settings"
                    isActive={activeTab === "settings"}
                    onClick={() => {
                      onSettings?.();
                      setOpen(false);
                    }}
                  />
                )}
                <div className="flex items-center gap-2">
                  {themeToggle}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSignOut?.();
                    }}
                    className="flex-1 flex items-center gap-3 px-3 py-3 rounded-xl font-extrabold text-sm tracking-wide text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink border border-line transition-colors"
                  >
                    <Icons.LogOut className="w-5 h-5 shrink-0" /> Sign Out
                  </button>
                </div>
              </div>
            </nav>
          </div>
        )}
      </>
    );
  }
);
