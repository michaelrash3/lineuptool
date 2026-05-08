import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useContext,
  useRef,
  createContext,
  memo,
} from "react";
import {
  signInWithCustomToken,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
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
  formatStat,
  normalizeDateToIso,
  formatGameDateDisplay,
  slimGame,
  scrubUndefined,
  buildSeasonBenchImbalance,
  calculateBaseballAge,
  parseCsvLine,
  buildCsvHeaderIndex,
  parseGameChangerPastSeasonCsv,
  suggestPlayerMatch,
  parsePercent,
  blankStats,
} from "./utils/helpers";
import {
  EVAL_CATEGORIES,
  getLocalDateString,
  AGE_TIERS,
  bumpAgeTier,
  computeNextSeason,
  DEFAULT_TEAM_DATA,
} from "./constants/ui";
import {
  downloadLineupPdf,
  shareLineupCard,
} from "./lineup/lineupCard";

// Pure-function lineup engine. Lives in ./lineupEngine.js next to this file.
import {
  generateLineup as engineGenerateLineup,
  getPositionsForInning,
  getOffensiveScore,
  calculateTotalScore,
} from "./lineupEngine.js";

/* ============================================================================
   SECTION 2 · Firebase setup — see ./firebase.js
   SECTION 3 · Pure helpers — see ./utils/helpers.js
============================================================================ */

/* ============================================================================
   SECTION 4 · UI-only constants — see ./constants/ui.js
============================================================================ */

/* ============================================================================
   SECTION 5 · Toast system (replaces scattered setGenerationError)
============================================================================ */
const ToastContext = createContext({ push: () => {}, dismiss: () => {} });
const useToast = () => useContext(ToastContext);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast) => {
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

const ToastContainer = memo(({ toasts, dismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm print:hidden">
      {toasts.map((t) => {
        const tone =
          t.kind === "error"
            ? "bg-red-600 text-white border-red-700"
            : t.kind === "success"
            ? "bg-green-600 text-white border-green-700"
            : t.kind === "warn"
            ? "bg-amber-500 text-white border-amber-600"
            : "bg-slate-900 text-white border-slate-800";
        return (
          <div
            key={t.id}
            className={`shadow-lg border rounded-xl px-4 py-3 flex items-start gap-3 animate-in slide-in-from-right ${tone}`}
          >
            <div className="flex-1 min-w-0">
              {t.title && (
                <div className="font-black text-sm uppercase tracking-wider">
                  {t.title}
                </div>
              )}
              {t.message && (
                <div className="text-xs font-bold mt-0.5 opacity-95">
                  {t.message}
                </div>
              )}
            </div>
            {t.action && (
              <button
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-white/30 transition-colors"
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 p-1 hover:bg-white/20 rounded transition-colors"
            >
              <Icons.X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

/* ============================================================================
   SECTION 6 · TeamContext — single source of truth for team data + actions
   Replaces the prop-drilled state/actions pattern. Memoized so consumers only
   re-render when something they actually use changes.
============================================================================ */
const TeamContext = createContext(null);
const useTeam = () => {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used inside <TeamProvider>");
  return ctx;
};

/* ============================================================================
   SECTION 7 · UIContext — local UI state (modals, selections, attendance)
   Kept separate from TeamContext so editing a form input doesn't re-render
   tabs that only consume team data, and vice versa.
============================================================================ */
const UIContext = createContext(null);
const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
};

/* ============================================================================
   SECTION 8 · Small reusable presentational components
============================================================================ */
const LeaderboardCard = memo(
  ({
    title,
    icon: Icon,
    statKey,
    formatStr,
    asc,
    players,
    primaryColor,
    tertiaryColor,
    onPlayerClick,
  }) => {
    const sorted = useMemo(() => {
      return [...players]
        .filter((p) => {
          const val = p.stats?.[statKey];
          if (asc && statKey === "era" && (!p.stats?.ip || p.stats.ip === 0))
            return false;
          if (
            !asc &&
            (val === undefined || val === null || val === 0 || val === "0")
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const valA = a.stats?.[statKey] || 0;
          const valB = b.stats?.[statKey] || 0;
          return asc ? valA - valB : valB - valA;
        })
        .slice(0, 3);
    }, [players, statKey, asc]);

    return (
      <div className="bg-white/30 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 overflow-hidden hover:-translate-y-1 transition-transform duration-300">
        <div className="p-5 border-b border-white/40 flex items-center gap-4 bg-white/20">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icon className="w-5 h-5" style={{ color: primaryColor }} />
          </div>
          <h4 className="font-extrabold text-[11px] uppercase tracking-widest text-slate-700">
            {title}
          </h4>
        </div>
        <div className="p-5 space-y-4">
          {sorted.length > 0 ? (
            sorted.map((p, i) => (
              <div
                key={p.id}
                className="flex justify-between items-center group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-black text-slate-500 w-4 shrink-0">
                    {i + 1}.
                  </span>
                  <button
                    type="button"
                    onClick={() => onPlayerClick && onPlayerClick(p.id)}
                    className="text-sm font-extrabold text-slate-800 truncate text-left hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    {p.name}
                  </button>
                </div>
                <span
                  className="text-sm font-black tabular-nums px-3 py-1 rounded-lg shadow-sm border border-white/50 shrink-0 ml-2"
                  style={{
                    backgroundColor: primaryColor,
                    color: tertiaryColor,
                  }}
                >
                  {formatStr
                    ? formatStat(p.stats[statKey])
                    : (p.stats[statKey] || 0).toString()}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center py-6">
              Data Void
            </div>
          )}
        </div>
      </div>
    );
  }
);

/* Compact W-L record. `variant`: "compact" (header) | "full" (home/schedule).
   "compact" shows just "W-L" or "W-L-T". "full" adds RS/RA totals. */
const RecordBadge = memo(
  ({ record, variant = "compact", primaryColor, tertiaryColor }) => {
    const { wins, losses, ties, runsScored, runsAllowed } = record || {
      wins: 0,
      losses: 0,
    };
    if (!record || (wins === 0 && losses === 0 && ties === 0)) return null;
    const wl = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    if (variant === "compact") {
      return (
        <span
          className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-white/50 tabular-nums"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {wl}
        </span>
      );
    }
    return (
      <div className="inline-flex items-center gap-3 bg-white/80 px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          Record
        </span>
        <span className="text-base font-black tabular-nums text-slate-900">
          {wl}
        </span>
        <span className="h-4 w-px bg-slate-300" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RS
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsScored}
        </span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RA
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsAllowed}
        </span>
      </div>
    );
  }
);

const SharedModals = memo(() => {
  const { modal, setModal } = useUI();
  const { team } = useTeam();
  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-white/50">
        <div className="p-1.5" style={{ backgroundColor: team.primaryColor }} />
        <div className="p-6 bg-white">
          <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight">
            {modal.title}
          </h3>
          <p className="text-slate-600 font-medium mb-8 text-sm leading-relaxed whitespace-pre-line">
            {modal.message}
          </p>
          <div className="flex gap-3 justify-end">
            {modal.type === "confirm" && (
              <button
                onClick={() => setModal({ ...modal, isOpen: false })}
                className="px-5 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-colors shadow-sm"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                if (modal.onConfirm) modal.onConfirm();
                setModal({ ...modal, isOpen: false });
              }}
              className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
              style={{
                backgroundColor: team.primaryColor,
                color: team.tertiaryColor,
              }}
            >
              {modal.type === "confirm" ? "Confirm" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 9 · LoginScreen, AppHeader, TabBarNav
============================================================================ */
const LoginScreen = ({ logoUrl, primaryColor, tertiaryColor, onSignIn }) => (
  <div
    className="min-h-screen flex flex-col items-center justify-center p-6 border-t-8 bg-slate-50 relative"
    style={{ borderColor: primaryColor }}
  >
    {logoUrl && (
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `url(${logoUrl})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "60%",
          opacity: 0.25,
        }}
      />
    )}
    <div className="bg-white/40 p-10 shadow-2xl max-w-sm w-full text-center rounded-2xl border border-white/50 relative z-10">
      <div className="flex justify-center mb-6">
        <div className="p-4 rounded-full bg-white border border-white/40 shadow-sm">
          <Icons.Clipboard
            className="w-10 h-10"
            style={{ color: primaryColor }}
          />
        </div>
      </div>
      <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-slate-900">
        Lineup Generator
      </h1>
      <p className="text-slate-500 mb-8 text-sm font-bold uppercase tracking-wider">
        Authentication Required
      </p>
      <button
        onClick={onSignIn}
        className="w-full py-4 px-4 font-black uppercase tracking-wider flex items-center justify-center gap-3 transition-all rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5"
        style={{ backgroundColor: primaryColor, color: tertiaryColor }}
      >
        <Icons.Users className="w-5 h-5" /> Sign In with Google
      </button>
    </div>
  </div>
);

const AppHeader = memo(() => {
  const {
    team,
    teams,
    activeTeamId,
    syncStatus,
    switchTeam,
    copyTeamCode,
    createTeam,
    joinTeam,
    record,
  } = useTeam();
  const {
    isAddingTeam,
    setIsAddingTeam,
    newTeamName,
    setNewTeamName,
    isJoiningTeam,
    setIsJoiningTeam,
    joinTeamId,
    setJoinTeamId,
    linkCopied,
  } = useUI();
  const activeTeamName =
    teams.find((t) => t.id === activeTeamId)?.name || "TEAM";

  return (
    <header className="print:hidden w-full relative z-20 bg-white/40 shadow-[0_4px_20px_rgb(0,0,0,0.04)]">
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
            <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm">
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: team.primaryColor }}
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none text-slate-900">
                {activeTeamName}
              </h1>
              <RecordBadge
                record={record}
                variant="compact"
                primaryColor={team.primaryColor}
                tertiaryColor={team.tertiaryColor}
              />
            </div>
            <p className="text-xs uppercase tracking-widest font-extrabold mt-1 text-slate-500">
              Head Coach Dashboard
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <select
            value={activeTeamId}
            onChange={(e) => switchTeam(e.target.value)}
            className="p-3 outline-none flex-1 sm:w-64 text-sm font-black uppercase tracking-wider cursor-pointer rounded-xl bg-white/20 hover:bg-white transition-colors border border-slate-200 shadow-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          
            <button
              onClick={copyTeamCode}
              title="Copy this team's join code so another coach can join via Join Team"
              className={`flex-1 sm:flex-none text-xs py-3 px-5 transition-colors flex items-center justify-center gap-2 font-black uppercase tracking-wider rounded-xl border-2 shadow-sm ${
                linkCopied
                  ? "bg-green-50 border-green-500 text-green-700"
                  : "bg-white/20 hover:bg-white border-slate-200 hover:border-slate-300 text-slate-700"
              }`}
            >
              {linkCopied ? (
                <Icons.Check className="w-4 h-4" />
              ) : (
                <Icons.Clipboard className="w-4 h-4" />
              )}{" "}
              {linkCopied ? "Code Copied" : "Team Code"}
            </button>
          
        </div>
      </div>
      
        <div className="bg-slate-900/80 text-white print:hidden relative z-10 border-b border-slate-900 shadow-inner">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 w-full sm:max-w-md">
              {isAddingTeam ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createTeam(newTeamName);
                  }}
                  className="flex items-center gap-2 w-full"
                >
                  <input
                    autoFocus
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="NEW TEAM NAME"
                    className="p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 flex-1 uppercase bg-slate-900/50 text-white rounded-lg shadow-inner"
                  />
                  <button
                    type="submit"
                    className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-sm"
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
              ) : isJoiningTeam ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    joinTeam(joinTeamId);
                  }}
                  className="flex items-center gap-2 w-full"
                >
                  <input
                    autoFocus
                    type="text"
                    value={joinTeamId}
                    onChange={(e) => setJoinTeamId(e.target.value)}
                    placeholder="ENTER TEAM CODE"
                    className="p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 flex-1 uppercase bg-slate-900/50 text-white rounded-lg shadow-inner"
                  />
                  <button
                    type="submit"
                    className="p-2 bg-green-600 hover:bg-green-500 text-white rounded-lg shadow-sm"
                  >
                    <Icons.Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsJoiningTeam(false)}
                    className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => setIsAddingTeam(true)}
                    className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm flex-1 sm:flex-none"
                  >
                    <Icons.Plus className="w-3.5 h-3.5" /> New Team
                  </button>
                  <button
                    onClick={() => setIsJoiningTeam(true)}
                    className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm flex-1 sm:flex-none"
                  >
                    <Icons.Users className="w-3.5 h-3.5" /> Join Team
                  </button>
                </div>
              )}
            </div>
            {syncStatus && (
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
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
      
    </header>
  );
});

const TabBarNav = memo(({ activeTab, setActiveTab, navButtons }) => {
  const { team } = useTeam();
  return (
    <div className="bg-white/30 border-b border-white/40 print:hidden relative z-10 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="flex overflow-x-auto scrollbar-hide gap-2 pb-4">
          {navButtons.map((btn) => {
            const Icon = btn.icon;
            const isActive = activeTab === btn.id;
            return (
              <button
                key={btn.id}
                onClick={() => setActiveTab(btn.id)}
                className={`py-2.5 px-5 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 whitespace-nowrap rounded-full transition-all duration-200 ${
                  isActive
                    ? "shadow-sm border border-transparent"
                    : "text-slate-600 hover:bg-white/80 hover:text-slate-900 border border-transparent"
                } ${btn.id === "settings" ? "ml-auto" : ""}`}
                style={
                  isActive
                    ? {
                        backgroundColor: team.secondaryColor,
                        color: team.primaryColor,
                        borderColor: team.primaryColor,
                      }
                    : {}
                }
              >
                <Icon className="w-4 h-4" /> {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 10 · HomeTab
============================================================================ */
const STATS_CONFIG = [
  { title: "Batting Average", statKey: "avg", formatStr: true, asc: false },
  { title: "On Base Percentage", statKey: "obp", formatStr: true, asc: false },
  { title: "OPS Rating", statKey: "ops", formatStr: true, asc: false },
  { title: "Total Season Hits", statKey: "h", formatStr: false, asc: false },
  { title: "Doubles (2B)", statKey: "doubles", formatStr: false, asc: false },
  { title: "Triples (3B)", statKey: "triples", formatStr: false, asc: false },
  { title: "Home Runs", statKey: "hr", formatStr: false, asc: false },
  { title: "Runs Batted In", statKey: "rbi", formatStr: false, asc: false },
];

/* Compact card shown at the top of the Home dashboard for the next upcoming
   game (within 7 days). Handles same-day games (with an extra-games hint),
   already-final today games (shows score + edit option), and the navigation
   to the Schedule editor when the user taps the action button. */
const UpcomingGameCard = memo(({ primaryColor, tertiaryColor }) => {
  const { team } = useTeam();
  const {
    setActiveTab,
    setSelectedGameId,
    setOpponentName,
    setLineup,
    setBattingLineup,
    setCurrentGameAttendance,
    setScoringGameId,
    setInGameId,
    setInGameInning,
    setInGameSelection,
    setInGameUndoStack,
  } = useUI();

  const { games, leagueRuleSet, pitchingFormat } = team;

  // Compute today as a Y-M-D string in local time so comparison matches
  // the way games store dates (also Y-M-D).
  const todayStr = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  }, []);

  const upcoming = useMemo(() => {
    const eligible = (games || [])
      .filter((g) => (g.status || "scheduled") !== "postponed")
      .filter((g) => g.date && g.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (eligible.length === 0) return null;

    const next = eligible[0];
    const dayDiff = Math.round(
      (new Date(next.date) - new Date(todayStr)) / 86400000
    );
    if (dayDiff > 7) return null;

    const sameDayCount = eligible.filter((g) => g.date === next.date).length;
    return { game: next, dayDiff, sameDayCount };
  }, [games, todayStr]);

  if (!upcoming) return null;

  const { game, dayDiff, sameDayCount } = upcoming;
  const status = game.status || "scheduled";
  const isFinal =
    status === "final" &&
    Number.isFinite(game.teamScore) &&
    Number.isFinite(game.opponentScore);

  // Friendly "when" label
  let whenLabel;
  if (dayDiff === 0) whenLabel = "Today";
  else if (dayDiff === 1) whenLabel = "Tomorrow";
  else {
    // game.date is "YYYY-MM-DD". Construct via local-time components so the
    // weekday matches the user's calendar — `new Date("YYYY-MM-DD")` parses
    // as UTC midnight and shifts a day back for any timezone west of UTC.
    const [y, m, d] = game.date.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    whenLabel = dateObj.toLocaleDateString(undefined, { weekday: "long" });
  }

  // Pretty date line
  const fullDate = formatGameDateDisplay(game.date);

  // Navigate to the game's editor in the Schedule tab
  const openInSchedule = () => {
    setSelectedGameId(game.id);
    setOpponentName(game.opponent);
    setLineup(game.lineup || null);
    setBattingLineup(game.battingLineup || null);
    setCurrentGameAttendance(game.attendance || {});
    setActiveTab("schedule");
  };

  const openScoreEditor = () => {
    setScoringGameId(game.id);
    setActiveTab("schedule");
  };

  // Result info if final
  const result = isFinal
    ? game.teamScore > game.opponentScore
      ? "win"
      : game.teamScore < game.opponentScore
      ? "loss"
      : "tie"
    : null;

  return (
    <div className="rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 overflow-hidden bg-white/40">
      <div className="h-1.5" style={{ backgroundColor: primaryColor }} />
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <div
            className="hidden sm:flex w-14 h-14 rounded-2xl items-center justify-center shrink-0 shadow-inner"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Calendar
              className="w-7 h-7"
              style={{ color: primaryColor }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                {whenLabel}
              </span>
              {isFinal && (
                <span
                  className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border tabular-nums ${
                    result === "win"
                      ? "bg-green-50 text-green-800 border-green-200"
                      : result === "loss"
                      ? "bg-red-50 text-red-800 border-red-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  }`}
                >
                  {result === "win" ? "W" : result === "loss" ? "L" : "T"}{" "}
                  {game.teamScore}-{game.opponentScore}
                </span>
              )}
              {!isFinal && game.lineup && (
                <span className="bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-green-200">
                  Lineup Ready
                </span>
              )}
              {!isFinal && !game.lineup && (
                <span className="bg-amber-50 text-amber-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-amber-200">
                  Lineup Needed
                </span>
              )}
            </div>
            <h3 className="font-black text-xl sm:text-2xl text-slate-900 uppercase tracking-tight leading-tight">
              {game.isBigGame && (
                <span
                  className="inline-block mr-1.5 text-yellow-500"
                  title="Big Game"
                  aria-label="Big Game"
                >
                  ⚡
                </span>
              )}
              VS. {game.opponent}
            </h3>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1 flex items-center gap-2 flex-wrap">
              <Icons.Clock className="w-3.5 h-3.5" /> {fullDate}
              <span className="text-slate-300">|</span>
              <span>
                {game.leagueRuleSet || leagueRuleSet}{" "}
                {game.pitchingFormat || pitchingFormat}
              </span>
              {sameDayCount > 1 && (
                <>
                  <span className="text-slate-300">|</span>
                  <span className="text-blue-700">
                    +{sameDayCount - 1} more{" "}
                    {whenLabel.toLowerCase() === "today" ? "today" : "this day"}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
          {dayDiff === 0 && !isFinal && game.lineup && (
            <button
              onClick={() => {
                setInGameId(game.id);
                setInGameInning(0);
                setInGameSelection(null);
                setInGameUndoStack([]);
              }}
              className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-lg bg-green-600 text-white hover:bg-green-700"
            >
              <Icons.Refresh className="w-4 h-4" /> In-Game
            </button>
          )}
          <button
            onClick={openInSchedule}
            className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            {isFinal ? (
              <>
                <Icons.Edit className="w-4 h-4" /> Edit Lineup
              </>
            ) : game.lineup ? (
              <>
                <Icons.Edit className="w-4 h-4" /> Edit Lineup
              </>
            ) : (
              <>
                <Icons.Clipboard className="w-4 h-4" /> Plan Lineup
              </>
            )}
          </button>
          {dayDiff === 0 && !isFinal && (
            <button
              onClick={openScoreEditor}
              className="flex-1 sm:flex-none text-xs px-5 py-3 bg-white/80 text-slate-800 border border-slate-200 font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-colors rounded-xl shadow-sm"
            >
              <Icons.FileText className="w-4 h-4" /> Final Score
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const HomeTab = memo(() => {
  const { team, teams, activeTeamId, record } = useTeam();
  const { openPlayerProfile } = useUI();
  const {
    players,
    coaches,
    games,
    leagueRuleSet,
    teamAge,
    currentSeason,
    pitchingFormat,
    primaryColor,
    tertiaryColor,
  } = team;
  const activeTeamName =
    teams.find((t) => t.id === activeTeamId)?.name || "TEAM";
  const headCoaches = coaches.filter((c) => c.role === "Head Coach");
  const assistantCoaches = coaches.filter((c) => c.role === "Assistant Coach");

  return (
    <div className="space-y-8">
      <UpcomingGameCard
        primaryColor={primaryColor}
        tertiaryColor={tertiaryColor}
        onPlayerClick={openPlayerProfile}
      />
      <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row justify-between items-start gap-8">
        <div>
          <h2 className="font-black text-3xl sm:text-4xl uppercase tracking-tight text-slate-900 mb-3">
            {activeTeamName}
          </h2>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs font-black text-slate-600 uppercase tracking-widest mb-4">
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {currentSeason}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {teamAge}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {leagueRuleSet}
            </span>
            <span className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {pitchingFormat}
            </span>
          </div>
          {(record.wins > 0 || record.losses > 0 || record.ties > 0) && (
            <div className="mb-6">
              <RecordBadge record={record} variant="full" />
            </div>
          )}
          {(headCoaches.length > 0 || assistantCoaches.length > 0) && (
            <div className="space-y-3 bg-white/60 p-5 rounded-xl border border-slate-200 shadow-sm inline-block min-w-full sm:min-w-[320px]">
              {headCoaches.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 sm:w-32 shrink-0 sm:pt-0.5">
                    Head Coach:
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {headCoaches.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
              {assistantCoaches.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400 sm:w-32 shrink-0 sm:pt-0.5">
                    Assistant Coaches:
                  </span>
                  <span className="text-sm font-bold text-slate-800">
                    {assistantCoaches.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="flex-1 md:flex-none bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
            <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Roster Size
            </span>
            <span className="block text-3xl font-black text-slate-900">
              {players.length}
            </span>
          </div>
          <div className="flex-1 md:flex-none bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
            <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Games
            </span>
            <span className="block text-3xl font-black text-slate-900">
              {games.length}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-6 px-2">
          <div className="p-2 rounded-full bg-white/40 shadow-sm border border-white/50">
            <Icons.Bat className="w-5 h-5 text-slate-600" />
          </div>
          <h3 className="text-lg font-black uppercase tracking-widest text-slate-800">
            Hitting Leaders
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {STATS_CONFIG.map((stat, i) => (
            <LeaderboardCard
              key={i}
              {...stat}
              icon={Icons.Bat}
              players={players}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onPlayerClick={openPlayerProfile}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-6 px-2 mt-10">
          <div className="p-2 rounded-full bg-white/40 shadow-sm border border-white/50">
            <Icons.Glove className="w-5 h-5 text-slate-600" />
          </div>
          <h3 className="text-lg font-black uppercase tracking-widest text-slate-800">
            Fielding Leaders
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <LeaderboardCard
            title="Fielding Pct"
            icon={Icons.Glove}
            statKey="fpct"
            formatStr
            asc={false}
            players={players}
            primaryColor={primaryColor}
            tertiaryColor={tertiaryColor}
            onPlayerClick={openPlayerProfile}
          />
          <LeaderboardCard
            title="Total Chances"
            icon={Icons.Glove}
            statKey="tc"
            formatStr={false}
            asc={false}
            players={players}
            primaryColor={primaryColor}
            tertiaryColor={tertiaryColor}
            onPlayerClick={openPlayerProfile}
          />
          <LeaderboardCard
            title="Putouts"
            icon={Icons.Glove}
            statKey="po"
            formatStr={false}
            asc={false}
            players={players}
            primaryColor={primaryColor}
            tertiaryColor={tertiaryColor}
            onPlayerClick={openPlayerProfile}
          />
          <LeaderboardCard
            title="Assists"
            icon={Icons.Glove}
            statKey="a"
            formatStr={false}
            asc={false}
            players={players}
            primaryColor={primaryColor}
            tertiaryColor={tertiaryColor}
            onPlayerClick={openPlayerProfile}
          />
        </div>
      </div>

      {pitchingFormat === "Kid Pitch" && (
        <div>
          <div className="flex items-center gap-3 mb-6 px-2 mt-10">
            <div className="p-2 rounded-full bg-red-50/80 border border-red-100 shadow-sm">
              <Icons.Pitch className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-800">
              Pitching Leaders
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <LeaderboardCard
              title="ERA"
              icon={Icons.Pitch}
              statKey="era"
              formatStr
              asc
              players={players}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onPlayerClick={openPlayerProfile}
            />
            <LeaderboardCard
              title="Innings Pitched"
              icon={Icons.Pitch}
              statKey="ip"
              formatStr
              asc={false}
              players={players}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onPlayerClick={openPlayerProfile}
            />
          </div>
        </div>
      )}
    </div>
  );
});

/* ============================================================================
   SECTION 11 · RosterTab
============================================================================ */
const RosterTab = memo(() => {
  const { team } = useTeam();
  const { setIsAddingPlayer, openPlayerProfile } = useUI();
  const {
    players,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    logoUrl,
    currentSeason,
  } = team;

  const sortedRosterPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const numA = parseInt(a.number, 10);
      const numB = parseInt(b.number, 10);
      if (isNaN(numA) && isNaN(numB)) return a.name.localeCompare(b.name);
      if (isNaN(numA)) return 1;
      if (isNaN(numB)) return -1;
      return numA - numB;
    });
  }, [players]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white/30 shadow-sm border border-white/50 rounded-2xl overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/20 border-b border-white/40">
          <div className="flex items-center gap-4">
            <div
              className="p-2.5 rounded-full"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Icons.Jersey
                className="w-6 h-6"
                style={{ color: primaryColor }}
              />
            </div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider flex items-center gap-3">
              Team Roster{" "}
              <span
                className="px-2.5 py-1 text-[10px] rounded-lg font-extrabold"
                style={{ backgroundColor: secondaryColor, color: primaryColor }}
              >
                {players.length} Active
              </span>
            </h2>
          </div>
          
            <button
              onClick={() => setIsAddingPlayer(true)}
              className="flex-1 sm:flex-none py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              <Icons.UserPlus className="w-4 h-4" /> Add Player
            </button>
          
        </div>
        <div className="p-4 sm:p-6 bg-transparent">
          {players.length === 0 ? (
            <div className="text-center py-20 bg-white/30 border border-white/50 shadow-sm rounded-2xl">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Team Logo"
                  className="w-24 h-24 mx-auto mb-6 opacity-40 grayscale"
                />
              ) : (
                <Icons.Jersey className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              )}
              <h3 className="font-black uppercase tracking-widest text-slate-500 text-lg mb-2">
                No Roster Found
              </h3>
              <p className="text-slate-500 text-sm font-semibold max-w-sm mx-auto">
                Manually add players to build your team, or head to Settings to
                import your stats file.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sortedRosterPlayers.map((player) => (
                <div
                  key={player.id}
                  className={`flex flex-col lg:flex-row items-start lg:items-center justify-between bg-white/40 border border-white/50 shadow-sm rounded-xl p-3 transition-all hover:shadow-md hover:bg-white/60 ${
                    player.present === false ? "opacity-60 grayscale" : ""
                  }`}
                  style={{
                    borderLeftWidth: "4px",
                    borderLeftColor: primaryColor,
                  }}
                >
                  <div className="flex items-center gap-4 sm:gap-6 min-w-[260px]">
                    <div
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center font-black text-2xl sm:text-3xl shadow-inner shrink-0 border border-white/50"
                      style={{
                        backgroundColor: `${primaryColor}15`,
                        color: primaryColor,
                      }}
                    >
                      {player.number || ""}
                    </div>
                    <div className="flex flex-col">
                      <h3 className="font-black text-xl sm:text-2xl uppercase tracking-tight text-slate-900 flex items-center gap-2 leading-none mb-1.5">
                        {player.name}
                        {player.present === false && (
                          <span className="text-[10px] bg-red-500/20 text-red-700 px-2 py-0.5 font-black uppercase tracking-widest rounded">
                            Out
                          </span>
                        )}
                      </h3>
                      <div className="text-[11px] sm:text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2 mt-1">
                        <span style={{ color: primaryColor }}>
                          P: {player.primaryPosition || "N/A"}
                        </span>
                        <span className="opacity-30">|</span>
                        <span>
                          B/T: {player.bats || "R"}/{player.throws || "R"}
                        </span>
                        {player.dob && (
                          <>
                            <span className="opacity-30">|</span>
                            <span>
                              Age:{" "}
                              {calculateBaseballAge(
                                player.dob,
                                currentSeason
                              ) || "?"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-1 items-center justify-center">
                    {player.stats?.ab > 0 || player.stats?.ip > 0 ? (
                      <div className="flex gap-6 sm:gap-10">
                        <div className="text-center">
                          <span className="block text-[11px] uppercase font-black text-slate-400 tracking-widest leading-none mb-1.5">
                            AVG
                          </span>
                          <span
                            className="font-black text-base sm:text-lg"
                            style={{ color: tertiaryColor }}
                          >
                            {formatStat(player.stats?.avg)}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[11px] uppercase font-black text-slate-400 tracking-widest leading-none mb-1.5">
                            OPS
                          </span>
                          <span
                            className="font-black text-base sm:text-lg"
                            style={{ color: tertiaryColor }}
                          >
                            {formatStat(player.stats?.ops)}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[11px] uppercase font-black text-slate-400 tracking-widest leading-none mb-1.5">
                            H
                          </span>
                          <span
                            className="font-black text-base sm:text-lg"
                            style={{ color: tertiaryColor }}
                          >
                            {player.stats?.h || 0}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[11px] uppercase font-black text-slate-400 tracking-widest leading-none mb-1.5">
                            RBI
                          </span>
                          <span
                            className="font-black text-base sm:text-lg"
                            style={{ color: tertiaryColor }}
                          >
                            {player.stats?.rbi || 0}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest italic">
                        No Stats Logged
                      </div>
                    )}
                  </div>
                  <div className="flex w-full lg:w-auto justify-end shrink-0 pr-2">
                    <button
                      onClick={() => openPlayerProfile(player.id)}
                      className="flex-1 sm:flex-none px-4 py-2.5 bg-white/60 text-slate-500 hover:text-blue-600 hover:bg-white font-black text-[11px] uppercase tracking-widest rounded-lg transition-colors border border-white/50 flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Icons.FileText className="w-4 h-4" /> View Profile
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* Inline score editor used inside the schedule list. Manages its own input
   state so typing doesn't write to Firestore on every keystroke. */
const ScoreEditor = memo(
  ({ game, primaryColor, tertiaryColor, onSave, onClear, onCancel }) => {
    const [ts, setTs] = useState(game.teamScore ?? "");
    const [os, setOs] = useState(game.opponentScore ?? "");
    // Innings played defaults to the current lineup length (or 6 if there's no
    // lineup yet). User can dial this down if the game ended early.
    const lineupMaxInnings = (game.originalLineup?.length || game.lineup?.length || 6);
    const initialInningsPlayed = game.lineup?.length || lineupMaxInnings;
    const [inningsPlayed, setInningsPlayed] = useState(initialInningsPlayed);

    const tsNum = ts === "" ? null : parseInt(ts, 10);
    const osNum = os === "" ? null : parseInt(os, 10);
    const valid =
      Number.isFinite(tsNum) &&
      tsNum >= 0 &&
      Number.isFinite(osNum) &&
      osNum >= 0;
    const hadScore =
      Number.isFinite(game.teamScore) && Number.isFinite(game.opponentScore);
    const result = valid
      ? tsNum > osNum
        ? "win"
        : tsNum < osNum
        ? "loss"
        : "tie"
      : null;

    return (
      <div className="px-5 pb-5 pt-1 border-t border-white/40">
        <div className="bg-white/80 border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
            <div className="w-full sm:w-28">
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Our Score
              </label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                autoFocus
                value={ts}
                onChange={(e) => setTs(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-200 text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-inner tabular-nums text-center"
              />
            </div>
            <div className="w-full sm:w-28">
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Opp. Score
              </label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={os}
                onChange={(e) => setOs(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-200 text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-inner tabular-nums text-center"
              />
            </div>
            {game.lineup?.length > 0 && (
              <div className="w-full sm:w-32">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Innings Played
                </label>
                <select
                  value={inningsPlayed}
                  onChange={(e) => setInningsPlayed(parseInt(e.target.value, 10))}
                  className="w-full p-2.5 bg-white border border-slate-200 text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm tabular-nums text-center cursor-pointer"
                >
                  {Array.from({ length: lineupMaxInnings }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {valid && (
              <div
                className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-sm self-end mb-0.5 ${
                  result === "win"
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : result === "loss"
                    ? "bg-red-50 text-red-800 border border-red-200"
                    : "bg-amber-50 text-amber-800 border border-amber-200"
                }`}
              >
                {result === "win" ? "Win" : result === "loss" ? "Loss" : "Tie"}
              </div>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                className="text-[10px] font-black uppercase tracking-widest px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
              >
                Cancel
              </button>
              {hadScore && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-[10px] font-black uppercase tracking-widest px-4 py-2.5 bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 transition-colors shadow-sm"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                disabled={!valid}
                onClick={() => valid && onSave(tsNum, osNum, inningsPlayed)}
                className="text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-lg shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                Save Final
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-3 font-medium">
            Saving marks this game Final — its innings will count toward future lineup fairness. Trimmed innings are saved separately and can be restored from the game editor.
          </p>
        </div>
      </div>
    );
  }
);

/* ============================================================================
   SECTION 12 · ScheduleTab
============================================================================ */
const ScheduleTab = memo(() => {
  const {
    team,
    addGame,
    updateGame,
    finalizeGame,
    postponeGame,
    deleteSavedGame,
    saveCurrentGame,
    generateLineup,
    regenerateLineup,
    record,
  } = useTeam();
  const {
    selectedGameId,
    setSelectedGameId,
    isAddingGame,
    setIsAddingGame,
    newGameForm,
    setNewGameForm,
    scoringGameId,
    setScoringGameId,
    currentGameAttendance,
    setCurrentGameAttendance,
    firstInningLineup,
    setFirstInningLineup,
    lineup,
    setLineup,
    battingLineup,
    setBattingLineup,
    swapSelection,
    gameSaved,
    handleCellClick,
    addInning,
    removeInning,
    moveBatter,
    setOpponentName,
    openPlayerProfile,
    setInGameId,
    setInGameInning,
    setInGameSelection,
    setInGameUndoStack,
  } = useUI();

  const {
    games,
    players,
    leagueRuleSet,
    pitchingFormat,
    defenseSize,
    positionLock,
    battingSize,
    teamAge,
    primaryColor,
    tertiaryColor,
    logoUrl,
  } = team;

  const toast = useToast();

  // Sort games by ISO date string once per games-array change instead of on
  // every keystroke into newGameForm (which triggers a ScheduleTab re-render).
  // ISO YYYY-MM-DD is lexicographically equivalent to chronological, so
  // string compare beats new Date(...) - new Date(...) on cost.
  const sortedGames = useMemo(
    () =>
      [...games].sort((a, b) =>
        (a.date || "").localeCompare(b.date || "")
      ),
    [games]
  );

  const currentGame = games.find((g) => g.id === selectedGameId);

  // Game editor view
  if (selectedGameId && currentGame) {
    const gameDefenseSize = currentGame.defenseSize || defenseSize;
    const gameBattingSize = currentGame.battingSize || battingSize;
    const gamePositionLock = currentGame.positionLock || positionLock;
    const gameLeague = currentGame.leagueRuleSet || leagueRuleSet;
    const gamePitching = currentGame.pitchingFormat || pitchingFormat;
    // Default ON: apply season-cumulative bench fairness when generating.
    // Coach can flip this OFF for a specific game (e.g. tough opponent / playoff)
    // to ignore accumulated debt and just balance THIS game cleanly.
    const applySeasonalFairness =
      currentGame.applySeasonalFairness !== false;
    // Big Game flag: when true, also weights strong players to premium
    // defensive positions (P/SS/3B/C/1B for kid-pitch ages, C/1B/SS for 8U).
    // Implies seasonal fairness is off.
    const isBigGame = currentGame.isBigGame === true;

    const presentPlayers = players.filter(
      (p) => currentGameAttendance[p.id] !== false
    );
    const presentCount = presentPlayers.length;

    return (
      <div className="space-y-6">
        <div className="bg-white/30 shadow-sm border border-white/50 print:hidden rounded-2xl overflow-hidden">
          <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5 border-b border-white/40 bg-white/20">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedGameId(null)}
                className="p-2 hover:bg-white/60 text-slate-500 hover:text-slate-900 rounded-full transition-colors"
              >
                <Icons.ChevronUp className="w-6 h-6 -rotate-90" />
              </button>
              <div
                className="p-2.5 rounded-full"
                style={{ backgroundColor: `${primaryColor}15` }}
              >
                <Icons.Settings
                  className="w-5 h-5"
                  style={{ color: primaryColor }}
                />
              </div>
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider">
                Game Command Center
              </h2>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
              <div className="bg-white/60 border border-white/50 px-4 py-2.5 rounded-xl shrink-0 shadow-sm">
                <span className="block text-[9px] text-slate-500 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Opponent
                </span>
                <span className="block text-sm text-slate-900 font-black uppercase leading-none">
                  {currentGame.opponent}
                </span>
              </div>
              <div className="bg-white/60 border border-white/50 px-4 py-2.5 rounded-xl shrink-0 hidden sm:block shadow-sm">
                <span className="block text-[9px] text-slate-500 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Rotation
                </span>
                <span className="block text-sm text-slate-900 font-black uppercase leading-none">
                  {gamePositionLock === "full"
                    ? "Full Game"
                    : `${gamePositionLock} Inn`}
                </span>
              </div>
              <div className="bg-white/60 border border-white/50 px-4 py-2.5 rounded-xl shrink-0 hidden sm:block shadow-sm">
                <span className="block text-[9px] text-slate-500 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Batters
                </span>
                <span className="block text-sm text-slate-900 font-black uppercase leading-none">
                  {gameBattingSize === "roster" ? "Roster" : gameBattingSize}
                </span>
              </div>
              {presentCount >= 7 && (
                <>
                  <button
                    onClick={() => generateLineup()}
                    className="shrink-0 py-3 px-6 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-transform hover:-translate-y-0.5 rounded-xl shadow-md text-xs"
                    style={{
                      backgroundColor: primaryColor,
                      color: tertiaryColor,
                    }}
                  >
                    <Icons.Settings className="w-4 h-4" /> Build Lineup
                  </button>
                  {lineup && (
                    <button
                      onClick={regenerateLineup}
                      title="Re-roll a different valid lineup"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700"
                    >
                      <Icons.Refresh className="w-4 h-4" /> Re-roll
                    </button>
                  )}
                  {lineup && (
                    <button
                      onClick={() =>
                        shareLineupCard({
                          game: { ...currentGame, lineup, battingLineup },
                          team,
                          formatDate: formatGameDateDisplay,
                          toast,
                        })
                      }
                      title="Share this lineup as a PNG image"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700"
                    >
                      <Icons.Link className="w-4 h-4" /> Share
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 p-6 bg-transparent border-b border-white/40">
              <div className="w-full col-span-2 md:col-span-1">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={normalizeDateToIso(currentGame.date) || ""}
                  onChange={(e) =>
                    updateGame(selectedGameId, { date: e.target.value })
                  }
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                />
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Game Rules
                </label>
                <select
                  value={gameLeague}
                  onChange={(e) => {
                    const newLeague = e.target.value;
                    let newFormat = gamePitching;
                    if (
                      newLeague === "NKB" &&
                      ["6U", "7U", "8U"].includes(teamAge)
                    )
                      newFormat = "Machine Pitch";
                    if (
                      newLeague === "USSSA" &&
                      teamAge === "8U" &&
                      newFormat === "Machine Pitch"
                    )
                      newFormat = "Kid Pitch";
                    updateGame(selectedGameId, {
                      leagueRuleSet: newLeague,
                      pitchingFormat: newFormat,
                    });
                  }}
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                >
                  <option value="USSSA">USSSA Baseball</option>
                  <option value="NKB">Northern Kentucky Baseball (NKB)</option>
                </select>
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Pitching
                </label>
                <select
                  value={gamePitching}
                  onChange={(e) =>
                    updateGame(selectedGameId, {
                      pitchingFormat: e.target.value,
                    })
                  }
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                >
                  {gameLeague === "NKB" &&
                  ["6U", "7U", "8U"].includes(teamAge) ? (
                    <option value="Machine Pitch">Machine Pitch</option>
                  ) : gameLeague === "USSSA" && teamAge === "8U" ? (
                    <>
                      <option value="Kid Pitch">Kid Pitch</option>
                      <option value="Coach Pitch">Coach Pitch</option>
                    </>
                  ) : (
                    <>
                      <option value="Kid Pitch">Kid Pitch</option>
                      <option value="Coach Pitch">Coach Pitch</option>
                      <option value="Machine Pitch">Machine Pitch</option>
                    </>
                  )}
                </select>
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Fielders
                </label>
                <select
                  value={gameDefenseSize}
                  onChange={(e) =>
                    updateGame(selectedGameId, { defenseSize: e.target.value })
                  }
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                >
                  <option value="9">9 Fielders</option>
                  <option value="10">10 Fielders</option>
                </select>
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Rotation
                </label>
                <select
                  value={gamePositionLock}
                  onChange={(e) =>
                    updateGame(selectedGameId, { positionLock: e.target.value })
                  }
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                >
                  <option value="1">1 Inn</option>
                  <option value="2">2 Inn</option>
                  <option value="3">3 Inn</option>
                  <option value="full">Full Game</option>
                </select>
              </div>
              <div className="w-full col-span-2 md:col-span-1">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                  Batters
                </label>
                <select
                  value={gameBattingSize}
                  onChange={(e) =>
                    updateGame(selectedGameId, { battingSize: e.target.value })
                  }
                  className="w-full p-2.5 bg-white/80 border border-slate-200 text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                >
                  <option value="roster">Roster</option>
                  <option value="9">9</option>
                  <option value="10">10</option>
                  <option value="11">11</option>
                </select>
              </div>
            </div>

            {/* Big Game toggle — when ON, the engine builds the strongest
                possible defense (premium positions get strong players) and
                automatically ignores seasonal fairness. */}
            <div className="bg-yellow-50/80 border border-yellow-300 rounded-xl p-3 mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  updateGame(selectedGameId, {
                    isBigGame: !isBigGame,
                  })
                }
                className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                  isBigGame ? "bg-yellow-500" : "bg-slate-300"
                }`}
                aria-label="Toggle big game"
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                    isBigGame ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                  <span aria-hidden>⚡</span>
                  Big Game {isBigGame ? "ON" : "OFF"}
                </div>
                <div className="text-[10px] text-slate-600 font-medium leading-tight mt-0.5">
                  {isBigGame
                    ? "Strongest defense possible. Past games don't factor in."
                    : "Off — engine builds a normal lineup."}
                </div>
              </div>
            </div>

            {/* Seasonal fairness toggle — controls whether the engine applies
                cumulative bench debt when generating this game's lineup. Default ON. */}
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  updateGame(selectedGameId, {
                    applySeasonalFairness: !applySeasonalFairness,
                  })
                }
                disabled={isBigGame}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                  isBigGame
                    ? "bg-slate-200 cursor-not-allowed"
                    : applySeasonalFairness
                    ? "bg-emerald-500"
                    : "bg-slate-300"
                }`}
                aria-label="Toggle even out playing time"
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                    isBigGame || !applySeasonalFairness ? "left-0.5" : "left-5"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[11px] font-black uppercase tracking-widest ${
                    isBigGame ? "text-slate-400" : "text-slate-700"
                  }`}
                >
                  Even Out Playing Time{" "}
                  {isBigGame ? "(off — Big Game)" : applySeasonalFairness ? "ON" : "OFF"}
                </div>
                <div
                  className={`text-[10px] font-medium leading-tight mt-0.5 ${
                    isBigGame ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {isBigGame
                    ? "Big Game mode is on — fairness is off automatically."
                    : applySeasonalFairness
                    ? "Kids with more bench time in past games will play more today."
                    : "Treat this game on its own — past games don't carry over."}
                </div>
              </div>
            </div>

            {/* Season Defense Balance — attendance-aware. For each present
                player, compares their actual defensive innings to the fair-
                share expected across the games they actually attended.
                Positive (red) = played more than fair, Negative (green) =
                played less. Absences are correctly excluded. */}
            {(() => {
              const imbalance = buildSeasonBenchImbalance(games, currentGame.id);
              const rows = presentPlayers
                .map((p) => {
                  const data = imbalance.get(p.id) || {
                    totalDefense: 0,
                    expectedDefense: 0,
                    gamesAttended: 0,
                  };
                  return {
                    player: p,
                    delta: data.totalDefense - data.expectedDefense,
                    gamesAttended: data.gamesAttended,
                  };
                })
                .sort((a, b) => b.delta - a.delta);
              // Hide if everyone is within 1 inning of their fair share
              const anyImbalance = rows.some((r) => Math.abs(r.delta) >= 1);
              if (!anyImbalance) return null;
              return (
                <div className="bg-white/40 border border-white/60 rounded-xl p-3 mt-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2 flex items-center gap-2">
                    <Icons.Users className="w-3.5 h-3.5" />
                    Innings Played This Season
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {rows.map((r) => {
                      const rounded = Math.round(r.delta);
                      const isOver = rounded > 0;
                      const isUnder = rounded < 0;
                      return (
                        <div
                          key={r.player.id}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] border ${
                            isOver
                              ? "bg-red-50 border-red-200"
                              : isUnder
                              ? "bg-green-50 border-green-200"
                              : "bg-white border-slate-200"
                          }`}
                        >
                          <span className="font-bold text-slate-700 truncate">
                            {r.player.name.split(" ")[0]}
                          </span>
                          <span
                            className={`font-black tabular-nums shrink-0 ${
                              isOver
                                ? "text-red-700"
                                : isUnder
                                ? "text-green-700"
                                : "text-slate-400"
                            }`}
                          >
                            {isOver ? `+${rounded}` : rounded === 0 ? "0" : rounded}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-slate-500 italic font-medium mt-2">
                    Red = played more than the team average. Green = played
                    less. With the toggle on, green kids get more time today.
                    Missed games don&apos;t count against anyone.
                  </div>
                </div>
              );
            })()}


          {/* Innings Played editor — only shown for Final games. Lets the
              coach trim down (e.g., game ended in 4 innings) or restore (if
              they trimmed too aggressively). Restore is only possible up to
              the longest version of the lineup the engine has produced. */}
          {currentGame.status === "final" &&
            currentGame.lineup?.length > 0 && (() => {
              const longest = currentGame.originalLineup?.length > currentGame.lineup.length
                ? currentGame.originalLineup
                : currentGame.lineup;
              const maxInnings = longest.length;
              const currentInningsPlayed = currentGame.lineup.length;
              return (
                <div className="px-6 py-4 bg-amber-50/50 border-b border-amber-200/50 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Icons.Clock className="w-4 h-4 text-amber-700" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-800">
                      Final Game Adjustments
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-2 select-none">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
                      Innings Played:
                    </span>
                    <select
                      value={currentInningsPlayed}
                      onChange={(e) => {
                        const target = parseInt(e.target.value, 10);
                        if (!Number.isFinite(target) || target < 1) return;
                        if (target === currentInningsPlayed) return;
                        const updates = {};
                        if (target < currentInningsPlayed) {
                          if (!currentGame.originalLineup) {
                            updates.originalLineup = currentGame.lineup;
                          }
                          updates.lineup = currentGame.lineup.slice(0, target);
                        } else if (
                          currentGame.originalLineup &&
                          currentGame.originalLineup.length >= target
                        ) {
                          updates.lineup = currentGame.originalLineup.slice(0, target);
                        } else {
                          return; // can't restore beyond what we have
                        }
                        updateGame(selectedGameId, updates);
                      }}
                      className="text-[11px] font-bold p-1.5 bg-white border border-amber-300 rounded-md outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer tabular-nums"
                    >
                      {Array.from({ length: maxInnings }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  {currentGame.originalLineup &&
                    currentGame.originalLineup.length > currentGame.lineup.length && (
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                        ({currentGame.originalLineup.length - currentGame.lineup.length} inning{currentGame.originalLineup.length - currentGame.lineup.length === 1 ? "" : "s"} trimmed — restorable)
                      </span>
                    )}
                </div>
              );
            })()}

          
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/40 bg-transparent">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-1.5 rounded bg-white/60 border border-white/50 shadow-sm">
                    <Icons.Users className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">
                    Game Day Attendance
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {players.map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        setCurrentGameAttendance({
                          ...currentGameAttendance,
                          [p.id]:
                            currentGameAttendance[p.id] === false
                              ? true
                              : false,
                        })
                      }
                      className={`text-left p-3 text-xs font-extrabold uppercase tracking-wider border rounded-xl transition-all flex justify-between items-center ${
                        currentGameAttendance[p.id] !== false
                          ? "bg-white/80 border-slate-200 text-slate-800 shadow-sm hover:bg-white"
                          : "bg-white/30 border-slate-200/50 text-slate-500 grayscale opacity-60"
                      }`}
                    >
                      <span className="truncate mr-2">
                        {p.number ? `#${p.number} ` : ""}
                        {p.name}
                      </span>
                      {currentGameAttendance[p.id] !== false ? (
                        <Icons.Check className="w-4 h-4 text-green-500 shrink-0" />
                      ) : (
                        <Icons.X className="w-4 h-4 shrink-0 opacity-50" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded bg-white/60 border border-white/50 shadow-sm">
                      <Icons.MapPin className="w-4 h-4 text-amber-600" />
                    </div>
                    <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">
                      First Inning Setup
                    </h3>
                  </div>
                  <button
                    onClick={() => setFirstInningLineup({})}
                    className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 transition-colors bg-white/60 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm"
                  >
                    Clear All
                  </button>
                </div>
                {presentCount < 7 ? (
                  <div className="p-5 bg-red-50/80 text-red-800 text-xs font-bold uppercase tracking-wide border border-red-200 rounded-xl flex items-center gap-3 shadow-sm">
                    <Icons.Alert className="w-6 h-6 shrink-0" /> Set at least 7
                    players to 'Present' to configure positions.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 max-w-sm gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {getPositionsForInning(presentCount, gameDefenseSize).map(
                      (pos) => (
                        <div
                          key={pos}
                          className="flex items-center gap-3 bg-white/80 border border-slate-200 rounded-xl p-2 shadow-sm"
                        >
                          <span className="font-black text-[11px] w-8 text-center text-slate-700 shrink-0 uppercase tracking-widest">
                            {pos}
                          </span>
                          <div className="h-6 w-px bg-slate-200 shrink-0" />
                          <select
                            value={firstInningLineup[pos] || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val)
                                setFirstInningLineup({
                                  ...firstInningLineup,
                                  [pos]: val,
                                });
                              else {
                                const next = { ...firstInningLineup };
                                delete next[pos];
                                setFirstInningLineup(next);
                              }
                            }}
                            className={`flex-1 p-1.5 outline-none rounded-lg text-xs font-extrabold transition-colors cursor-pointer w-full truncate ${
                              firstInningLineup[pos]
                                ? "bg-amber-100 text-amber-900"
                                : "bg-transparent text-slate-600 hover:bg-white/50"
                            }`}
                          >
                            <option value="">Auto Assign</option>
                            {presentPlayers.map((p) => {
                              const isAssignedElsewhere = Object.entries(
                                firstInningLineup
                              ).some(([pP, pI]) => pI === p.id && pP !== pos);
                              const isRestricted =
                                p.restrictions && p.restrictions.includes(pos);
                              return (
                                <option
                                  key={p.id}
                                  value={p.id}
                                  disabled={isAssignedElsewhere || isRestricted}
                                >
                                  {p.name}{" "}
                                  {isRestricted
                                    ? "(RES)"
                                    : isAssignedElsewhere
                                    ? "(ASG)"
                                    : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          
        </div>

        {lineup && (
          <div className="bg-white/30 shadow-sm border border-white/50 print:border-none print:shadow-none rounded-2xl overflow-hidden mb-12">
            <div className="p-5 flex flex-col lg:flex-row justify-between items-center gap-4 print:hidden bg-white/40 border-b border-white/40">
              <div className="flex items-center gap-4">
                <div
                  className="p-2.5 rounded-full"
                  style={{ backgroundColor: `${primaryColor}15` }}
                >
                  <Icons.Clipboard
                    className="w-6 h-6"
                    style={{ color: primaryColor }}
                  />
                </div>
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider">
                  Active Lineup Grid
                </h2>
              </div>
              <div className="flex flex-wrap justify-center gap-3 items-center w-full lg:w-auto">
                
                  <div className="flex items-center bg-white/80 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <button
                      onClick={removeInning}
                      disabled={lineup.length <= 1}
                      className="px-4 py-2.5 hover:bg-slate-100 disabled:opacity-50 transition-colors text-slate-600"
                    >
                      <Icons.Minus className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-black px-4 text-slate-800 tracking-widest border-x border-slate-200 bg-slate-50/50 py-2.5">
                      {lineup.length} INN
                    </span>
                    <button
                      onClick={addInning}
                      className="px-4 py-2.5 hover:bg-slate-100 transition-colors text-slate-600"
                    >
                      <Icons.Plus className="w-4 h-4" />
                    </button>
                  </div>
                
                <button
                  onClick={() =>
                    downloadLineupPdf({
                      game: { ...currentGame, lineup, battingLineup },
                      team,
                      formatDate: formatGameDateDisplay,
                      toast,
                    })
                  }
                  title="Download lineup as a PDF for emailing or texting"
                  className="text-xs bg-white/80 border border-slate-200 text-slate-700 py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-white transition-colors rounded-xl shadow-sm"
                >
                  <Icons.FileText className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={() => window.print()}
                  className="text-xs bg-white/80 border border-slate-200 text-slate-700 py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-white transition-colors rounded-xl shadow-sm"
                >
                  <Icons.Printer className="w-4 h-4" /> Print
                </button>
                
                  <button
                    onClick={saveCurrentGame}
                    className="text-xs py-2.5 px-6 font-black uppercase tracking-wider flex items-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {gameSaved ? (
                      <>
                        <Icons.Check className="w-4 h-4" /> Saved
                      </>
                    ) : (
                      <>
                        <Icons.Save className="w-4 h-4" /> Save Game Data
                      </>
                    )}
                  </button>
                
              </div>
            </div>

            <div className="hidden print:flex p-6 border-b border-slate-200 items-center justify-center gap-4 bg-white">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Team Logo"
                  className="w-24 h-24 object-contain drop-shadow-md"
                />
              )}
              <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900">
                GAME VS {currentGame.opponent || "OPPONENT"}
              </h2>
            </div>

            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-left border-collapse print:text-xs">
                <thead>
                  <tr className="bg-white/40 border-b border-slate-200/50 print:bg-slate-200">
                    <th className="p-4 print:p-2 font-black text-[11px] uppercase tracking-widest text-center w-20 print:w-12 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-slate-500 bg-white/60 print:bg-slate-200 print:text-slate-900 border-r border-slate-200/50">
                      Pos
                    </th>
                    {lineup.map((_, idx) => (
                      <th
                        key={`inn-${idx}-${lineup.length}`}
                        className="p-4 print:p-2 border-r border-slate-200/50 font-black text-[11px] uppercase tracking-widest text-center min-w-[140px] print:min-w-0 text-slate-700"
                      >
                        Inn {idx + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getPositionsForInning(presentCount, gameDefenseSize).map(
                    (pos) => (
                      <tr
                        key={pos}
                        className="border-b border-slate-200/50 hover:bg-white/50 break-inside-avoid transition-colors"
                      >
                        <td className="p-3 print:p-1.5 font-black text-sm border-r border-slate-200/50 sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none text-center bg-white/80 print:bg-transparent text-slate-800">
                          {pos}
                        </td>
                        {lineup.map((inning, idx) => {
                          const pAtPos = inning[pos];
                          const isSelected =
                            swapSelection?.innIdx === idx &&
                            swapSelection?.pos === pos;
                          return (
                            <td
                              key={`${pos}-${idx}-${lineup.length}`}
                              className="p-2 print:p-1 border-r border-slate-200/50 relative"
                            >
                              <div
                                onClick={() =>
                                  handleCellClick(idx, pos, pAtPos)
                                }
                                className={`w-full p-3 text-xs font-bold text-center rounded-lg cursor-pointer transition-all border ${
                                  isSelected
                                    ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 shadow-md scale-105 z-20 relative"
                                    : pAtPos
                                    ? "bg-white/80 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300"
                                    : "bg-white/30 border-dashed border-slate-300 text-slate-400 hover:bg-white/80"
                                }`}
                              >
                                {pAtPos ? (
                                  pAtPos.name
                                ) : (
                                  <span className="italic font-medium">
                                    Assign
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    )
                  )}
                  <tr className="break-inside-avoid border-t-2 border-slate-200/80 bg-white/20">
                    <td className="p-3 print:p-1.5 font-black text-[10px] sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:static print:shadow-none uppercase tracking-widest text-center text-slate-500 bg-white/60 print:bg-transparent border-r border-slate-200/50">
                      Bench
                    </td>
                    {lineup.map((inning, idx) => (
                      <td
                        key={`bench-${idx}-${lineup.length}`}
                        className="p-3 print:p-1 align-top border-r border-slate-200/50 min-w-[140px] print:min-w-0"
                      >
                        <div className="flex flex-col gap-2 items-center">
                          {inning.BENCH?.map((p) => {
                            const isSelected =
                              swapSelection?.innIdx === idx &&
                              swapSelection?.pos === "BENCH" &&
                              swapSelection?.player?.id === p.id;
                            return (
                              <div
                                key={p.id}
                                onClick={() => handleCellClick(idx, "BENCH", p)}
                                className={`text-[11px] print:p-0 px-3 py-2 border font-bold w-full text-center truncate rounded-lg shadow-sm transition-all cursor-pointer ${
                                  isSelected
                                    ? "ring-2 ring-yellow-400 bg-yellow-50 text-yellow-900 border-yellow-400 scale-105 z-20 relative"
                                    : "bg-white/90 border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300"
                                }`}
                              >
                                {p.name}
                              </div>
                            );
                          })}
                          {(!inning.BENCH || inning.BENCH.length === 0) && (
                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400/50 py-2">
                              Empty
                            </div>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {battingLineup && (
              <div className="p-6 border-t border-slate-200/80 print:hidden bg-transparent">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200/50">
                  <div className="p-2 rounded-full bg-white/60 border border-slate-200 shadow-sm">
                    <Icons.Bat className="w-5 h-5 text-slate-600" />
                  </div>
                  <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest">
                    Batting Order
                  </h3>
                </div>
                <div className="flex flex-col gap-3 max-w-2xl">
                  {battingLineup.map((p, idx) => (
                    <div
                      key={`batter_${idx}`}
                      className="bg-white/80 border border-slate-200 p-2.5 shadow-sm rounded-xl transition-all hover:shadow-md hover:bg-white"
                    >
                      <div className="flex items-center gap-4">
                      
                        <div className="flex flex-col items-center gap-1 text-slate-400 border-r border-slate-200/50 pr-3 mr-1">
                          <button
                            onClick={() => moveBatter(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 hover:bg-slate-100 hover:text-blue-600 rounded disabled:opacity-30 transition-colors"
                          >
                            <Icons.ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => moveBatter(idx, 1)}
                            disabled={idx === battingLineup.length - 1}
                            className="p-1 hover:bg-slate-100 hover:text-blue-600 rounded disabled:opacity-30 transition-colors"
                          >
                            <Icons.ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      
                      <div
                        className="w-10 h-10 shrink-0 flex items-center justify-center font-black text-sm rounded-lg shadow-inner"
                        style={{
                          backgroundColor: `${primaryColor}15`,
                          color: primaryColor,
                        }}
                      >
                        {idx + 1}
                      </div>
                      <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pl-1 pr-3">
                        <button
                          type="button"
                          onClick={() =>
                            openPlayerProfile && openPlayerProfile(p.id)
                          }
                          className="flex-1 text-sm font-black text-slate-800 text-left hover:text-blue-600 transition-colors cursor-pointer truncate"
                        >
                          {p.name}
                        </button>
                        {(p.stats?.ab > 0 ||
                          p.stats?.ops > 0 ||
                          p.stats?.avg > 0 ||
                          p.stats?.contact > 0) && (
                          <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest flex items-center gap-3 bg-white/60 px-3 py-1.5 border border-slate-200 rounded-lg">
                            <span>
                              {p.stats.h || 0}/{p.stats.ab || 0}
                            </span>
                            <span className="text-slate-300">|</span>
                            <span>
                              AVG:{" "}
                              <span className="text-slate-800">
                                {formatStat(p.stats.avg)}
                              </span>
                            </span>
                            <span className="text-slate-300">|</span>
                            <span>
                              OPS:{" "}
                              <span className="text-slate-800">
                                {formatStat(p.stats.ops)}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Schedule list view
  return (
    <div className="bg-white/30 shadow-sm border border-white/50 rounded-2xl overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/20 border-b border-white/40">
        <div className="flex items-center gap-4">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Calendar
              className="w-6 h-6"
              style={{ color: primaryColor }}
            />
          </div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider flex items-center gap-3">
            Schedule & Lineups
          </h2>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {(record.wins > 0 || record.losses > 0 || record.ties > 0) && (
            <RecordBadge record={record} variant="full" />
          )}
          
            <button
              onClick={() => setIsAddingGame(true)}
              className="flex-1 sm:flex-none py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              <Icons.Plus className="w-4 h-4" /> Add Game
            </button>
          
        </div>
      </div>
      {isAddingGame && (
        <div className="p-5 bg-white/40 border-b border-white/30 flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={newGameForm.date}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, date: e.target.value })
            }
            className="p-2.5 bg-white/80 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 flex-1 shadow-inner"
          />
          <input
            type="text"
            value={newGameForm.opponent}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, opponent: e.target.value })
            }
            placeholder="Opponent Name"
            className="p-2.5 bg-white/80 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 flex-1 uppercase shadow-inner"
          />
          <select
            value={newGameForm.leagueRuleSet}
            onChange={(e) => {
              const newLeague = e.target.value;
              let newFormat = newGameForm.pitchingFormat;
              if (newLeague === "NKB" && ["6U", "7U", "8U"].includes(teamAge))
                newFormat = "Machine Pitch";
              if (
                newLeague === "USSSA" &&
                teamAge === "8U" &&
                newFormat === "Machine Pitch"
              )
                newFormat = "Kid Pitch";
              setNewGameForm({
                ...newGameForm,
                leagueRuleSet: newLeague,
                pitchingFormat: newFormat,
              });
            }}
            className="p-2.5 bg-white/80 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
          >
            <option value="USSSA">USSSA</option>
            <option value="NKB">NKB</option>
          </select>
          <select
            value={newGameForm.pitchingFormat}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, pitchingFormat: e.target.value })
            }
            className="p-2.5 bg-white/80 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
          >
            {newGameForm.leagueRuleSet === "NKB" &&
            ["6U", "7U", "8U"].includes(teamAge) ? (
              <option value="Machine Pitch">Machine Pitch</option>
            ) : newGameForm.leagueRuleSet === "USSSA" && teamAge === "8U" ? (
              <>
                <option value="Kid Pitch">Kid Pitch</option>
                <option value="Coach Pitch">Coach Pitch</option>
              </>
            ) : (
              <>
                <option value="Kid Pitch">Kid Pitch</option>
                <option value="Coach Pitch">Coach Pitch</option>
                <option value="Machine Pitch">Machine Pitch</option>
              </>
            )}
          </select>
          <button
            onClick={() => addGame(newGameForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-md transition-colors flex items-center justify-center gap-2"
          >
            <Icons.Save className="w-4 h-4" /> Save
          </button>
          <button
            onClick={() => setIsAddingGame(false)}
            className="bg-white/80 hover:bg-white text-slate-700 font-bold uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-sm border border-slate-200 transition-colors flex items-center justify-center"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="p-0">
        {games.length === 0 ? (
          <div className="text-center py-20 bg-transparent">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Team Logo"
                className="w-24 h-24 mx-auto mb-6 opacity-40 grayscale"
              />
            ) : (
              <Icons.Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            )}
            <h3 className="font-black uppercase tracking-widest text-slate-500 text-lg mb-2">
              No Games Scheduled
            </h3>
            <p className="text-slate-500 text-sm font-semibold max-w-sm mx-auto">
              Add a game manually or head to Settings to import your schedule.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-4 sm:p-6 bg-transparent">
            {sortedGames.map((game) => {
                const status = game.status || "scheduled";
                const isFinal =
                  status === "final" &&
                  Number.isFinite(game.teamScore) &&
                  Number.isFinite(game.opponentScore);
                const isPostponed = status === "postponed";
                const result = isFinal
                  ? game.teamScore > game.opponentScore
                    ? "win"
                    : game.teamScore < game.opponentScore
                    ? "loss"
                    : "tie"
                  : null;
                const isEnteringScore = scoringGameId === game.id;
                const today = new Date();
                today.setMinutes(
                  today.getMinutes() - today.getTimezoneOffset()
                );
                const todayStr = today.toISOString().split("T")[0];
                const isToday = game.date === todayStr;
                const canStartInGame =
                  isToday && !isPostponed && !isFinal && game.lineup;

                return (
                  <div
                    key={game.id}
                    className={`bg-white/40 border border-white/50 shadow-sm rounded-xl hover:shadow-md hover:bg-white/60 transition-all ${
                      isPostponed ? "opacity-60" : ""
                    }`}
                  >
                    <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <h3 className="font-black text-xl text-slate-900 uppercase tracking-tight">
                            VS. {game.opponent}
                          </h3>
                          {isFinal ? (
                            <span
                              className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border tabular-nums ${
                                result === "win"
                                  ? "bg-green-50 text-green-800 border-green-200"
                                  : result === "loss"
                                  ? "bg-red-50 text-red-800 border-red-200"
                                  : "bg-amber-50 text-amber-800 border-amber-200"
                              }`}
                            >
                              {result === "win"
                                ? "W"
                                : result === "loss"
                                ? "L"
                                : "T"}{" "}
                              {game.teamScore}-{game.opponentScore}
                            </span>
                          ) : isPostponed ? (
                            <span className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border border-slate-300">
                              Postponed
                            </span>
                          ) : game.lineup ? (
                            <span className="bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-green-200">
                              Lineup Ready
                            </span>
                          ) : (
                            <span className="bg-amber-50 text-amber-700 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-amber-200">
                              Lineup Needed
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Icons.Clock className="w-3.5 h-3.5" />{" "}
                          {formatGameDateDisplay(game.date)}{" "}
                          <span className="text-slate-300">|</span>{" "}
                          {game.leagueRuleSet || leagueRuleSet}{" "}
                          {game.pitchingFormat || pitchingFormat}
                        </p>
                        
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isPostponed}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  if (checked) {
                                    postponeGame(game.id);
                                    if (scoringGameId === game.id)
                                      setScoringGameId(null);
                                  } else {
                                    updateGame(game.id, {
                                      status: "scheduled",
                                    });
                                  }
                                }}
                                className="w-4 h-4 rounded border-slate-300 cursor-pointer"
                              />
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                Postponed
                              </span>
                            </label>
                            {isPostponed && (
                              <label className="inline-flex items-center gap-2 select-none">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                  Reschedule:
                                </span>
                                <input
                                  type="date"
                                  value={normalizeDateToIso(game.date) || ""}
                                  onChange={(e) => {
                                    const newDate = e.target.value;
                                    if (!newDate) return;
                                    // Setting a new date on a postponed game implicitly un-postpones it
                                    updateGame(game.id, {
                                      date: newDate,
                                      status: "scheduled",
                                    });
                                  }}
                                  className="text-[11px] font-bold p-1.5 bg-white border border-slate-300 rounded-md outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
                                />
                              </label>
                            )}
                          </div>
                        
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto flex-wrap justify-end">
                        <button
                          onClick={() => {
                            setSelectedGameId(game.id);
                            setOpponentName(game.opponent);
                            setLineup(game.lineup || null);
                            setBattingLineup(game.battingLineup || null);
                            setCurrentGameAttendance(game.attendance || {});
                          }}
                          className="flex-1 sm:flex-none text-xs px-5 py-3 bg-white/80 text-slate-800 border border-slate-200 font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-white transition-colors rounded-xl shadow-sm"
                        >
                          {game.lineup ? (
                            <Icons.Edit className="w-4 h-4" />
                          ) : (
                            <Icons.Clipboard className="w-4 h-4" />
                          )}{" "}
                          {game.lineup ? "Edit Game" : "Plan Game"}
                        </button>
                        {canStartInGame && (
                          <button
                            onClick={() => {
                              setInGameId(game.id);
                              setInGameInning(0);
                              setInGameSelection(null);
                              setInGameUndoStack([]);
                            }}
                            className="flex-1 sm:flex-none text-xs px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
                          >
                            <Icons.Refresh className="w-4 h-4" /> In-Game
                          </button>
                        )}
                        {!isPostponed && (
                          <button
                            onClick={() =>
                              setScoringGameId(isEnteringScore ? null : game.id)
                            }
                            className={`flex-1 sm:flex-none text-xs px-5 py-3 font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors rounded-xl shadow-sm border ${
                              isFinal
                                ? "bg-white/80 text-slate-800 border-slate-200 hover:bg-white"
                                : "text-white border-transparent hover:-translate-y-0.5"
                            }`}
                            style={
                              !isFinal
                                ? {
                                    backgroundColor: primaryColor,
                                    color: tertiaryColor,
                                  }
                                : {}
                            }
                          >
                            <Icons.FileText className="w-4 h-4" />{" "}
                            {isFinal ? "Edit Score" : "Final Score"}
                          </button>
                        )}
                        
                          <button
                            onClick={() => deleteSavedGame(game.id)}
                            className="text-slate-400 hover:text-red-600 bg-white/80 border border-slate-200 hover:border-red-200 hover:bg-red-50 p-3 transition-colors rounded-xl shadow-sm"
                          >
                            <Icons.Trash className="w-4 h-4" />
                          </button>
                        
                      </div>
                    </div>
                    {isEnteringScore && !isPostponed && (
                      <ScoreEditor
                        game={game}
                        primaryColor={primaryColor}
                        tertiaryColor={tertiaryColor}
                        onSave={(ts, os, inningsPlayed) => {
                          finalizeGame(game.id, ts, os, inningsPlayed);
                          setScoringGameId(null);
                        }}
                        onClear={() => {
                          updateGame(game.id, {
                            teamScore: null,
                            opponentScore: null,
                            status: "scheduled",
                          });
                          setScoringGameId(null);
                        }}
                        onCancel={() => setScoringGameId(null)}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 13 · EvaluationTab + RosterDecisionsPanel
============================================================================ */

/* RosterDecisionsPanel — advisory roster recommendations.
   Combines (a) latest eval grades (weighted average across categories),
   (b) eval trend (first vs latest grades), (c) current stats vs team
   average, and (d) age eligibility (DOB-based baseball age vs team age
   tier) to bucket each player into:
     - "Strong fit" — high performer, age-appropriate or playing up well
     - "Watchlist" — declining trend OR low performance for review
     - "Better suited for younger group" — eligible to drop AND not thriving

   This is advisory only. Coach makes the call.
*/
const RosterDecisionsPanel = memo(() => {
  const { team, user } = useTeam();
  const { setEvalTrendPlayerId } = useUI();
  const {
    players,
    primaryColor,
    evaluationEvents,
    teamAge,
    currentSeason,
  } = team;

  const decisions = useMemo(() => {
    if (!players || players.length === 0) return null;

    // Eval rounds for this user, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Compute team-wide stat averages for current season (used as baseline
    // for "below team average" performance signal)
    const statsAvg = (() => {
      const fields = ["ops", "avg", "obp"];
      const sums = Object.create(null);
      const counts = Object.create(null);
      for (const f of fields) {
        sums[f] = 0;
        counts[f] = 0;
      }
      for (const p of players) {
        const s = p.stats || {};
        for (const f of fields) {
          const v = +s[f];
          if (Number.isFinite(v) && v > 0) {
            sums[f] += v;
            counts[f] += 1;
          }
        }
      }
      const out = Object.create(null);
      for (const f of fields) {
        out[f] = counts[f] > 0 ? sums[f] / counts[f] : 0;
      }
      return out;
    })();

    // Determine team's age tier as a number (e.g., "8U" -> 8, "11U to 12U" -> 12)
    const teamAgeNum = (() => {
      if (!teamAge) return null;
      const m = String(teamAge).match(/(\d+)/g);
      if (!m) return null;
      // For ranges like "11U to 12U", use the upper bound (the team's max)
      return parseInt(m[m.length - 1], 10);
    })();

    return players.map((player) => {
      // ---- Latest eval grade (average across categories) ----
      let latestEvalAvg = null;
      const evalsForPlayer = myEvals
        .map((ev) => {
          const g = ev.grades?.[player.id];
          if (!g) return null;
          const vals = EVAL_CATEGORIES.map((c) => +g[c.id]).filter((v) =>
            Number.isFinite(v)
          );
          if (vals.length === 0) return null;
          return {
            date: ev.date,
            label: ev.label || ev.date,
            avg: vals.reduce((a, b) => a + b, 0) / vals.length,
          };
        })
        .filter(Boolean);

      if (evalsForPlayer.length > 0) {
        latestEvalAvg = evalsForPlayer[evalsForPlayer.length - 1].avg;
      }

      // ---- Eval trend (first vs latest) ----
      let evalTrend = null; // "improving" | "declining" | "flat" | null
      let evalDelta = null;
      if (evalsForPlayer.length >= 2) {
        const first = evalsForPlayer[0].avg;
        const last = evalsForPlayer[evalsForPlayer.length - 1].avg;
        evalDelta = last - first;
        if (Math.abs(evalDelta) < 0.4) evalTrend = "flat";
        else if (evalDelta > 0) evalTrend = "improving";
        else evalTrend = "declining";
      }

      // ---- Stats vs team average ----
      const stats = player.stats || {};
      let statsPctVsAvg = null;
      let statsRatio = null;
      if (Number.isFinite(+stats.ops) && +stats.ops > 0 && statsAvg.ops > 0) {
        statsPctVsAvg = (+stats.ops / statsAvg.ops - 1) * 100;
        statsRatio = +stats.ops / statsAvg.ops; // 1.0 = team avg
      }

      // ---- Age eligibility ----
      const baseballAge = calculateBaseballAge(player.dob, currentSeason);
      const playingUp =
        Number.isFinite(baseballAge) &&
        teamAgeNum != null &&
        baseballAge < teamAgeNum;

      // ---- Bucket assignment ----
      // Eval scale used here: 6-7 = average for the age tier, 8-10 = above avg,
      // 5-6 = a little below, <5 = notably struggling, <4 = genuinely struggling.
      // Stats: ratio of player OPS to team avg OPS. 1.0 = team avg.
      //
      // Buckets:
      //   "younger" — playing up + eval avg <5 + not strongly improving
      //               (kid is genuinely struggling at the higher tier)
      //   "watch"   — declining eval trend, OR eval avg <5 (struggling),
      //               OR stats are notably below team baseline
      //   "strong"  — default: average-or-better at the level

      let bucket = "strong"; // default
      const rationale = [];

      // Strongest signal first: declining trend always means review
      if (evalTrend === "declining") {
        bucket = "watch";
        rationale.push(
          `Eval trend declining (${evalDelta.toFixed(1)} from first eval)`
        );
      }

      // Notable struggle at this level
      if (latestEvalAvg != null && latestEvalAvg < 5) {
        // Strongly improving = give them another eval before flagging
        const stronglyImproving =
          evalTrend === "improving" && evalDelta != null && evalDelta >= 1.0;
        if (playingUp && !stronglyImproving) {
          bucket = "younger";
          rationale.length = 0; // override
          rationale.push(
            `Eval avg ${latestEvalAvg.toFixed(1)} below the team's age tier baseline`
          );
          rationale.push(`Eligible for younger group (age ${baseballAge})`);
        } else if (!stronglyImproving) {
          bucket = "watch";
          if (
            !rationale.some((r) => r.startsWith("Eval trend"))
          ) {
            rationale.push(
              `Eval avg ${latestEvalAvg.toFixed(1)} below the level's baseline (avg ~6-7)`
            );
          }
        } else if (stronglyImproving) {
          // Strongly improving but still <5 — still watch, but with positive note
          bucket = "watch";
          rationale.push(
            `Eval avg ${latestEvalAvg.toFixed(1)} but improving fast (+${evalDelta.toFixed(1)})`
          );
        }
      }

      // Stats well below team avg are a watch signal (only if not already in younger)
      if (
        bucket !== "younger" &&
        statsRatio != null &&
        statsRatio < 0.7 &&
        evalTrend !== "improving"
      ) {
        if (bucket !== "watch") {
          bucket = "watch";
        }
        rationale.push(
          `Stats ${Math.round((1 - statsRatio) * 100)}% below team OPS avg`
        );
      }

      // Strong Fit positive notes (only if currently default-strong)
      if (bucket === "strong") {
        if (latestEvalAvg != null && latestEvalAvg >= 7.5) {
          rationale.push(`Eval ${latestEvalAvg.toFixed(1)} — above average`);
        } else if (latestEvalAvg != null) {
          rationale.push(`Eval ${latestEvalAvg.toFixed(1)} — at level`);
        }
        if (evalTrend === "improving") rationale.push("Improving");
        if (statsRatio != null && statsRatio >= 1.15) {
          rationale.push(
            `Stats +${Math.round((statsRatio - 1) * 100)}% vs team OPS avg`
          );
        }
        if (rationale.length === 0) {
          rationale.push("Steady contributor");
        }
      }

      return {
        player,
        baseballAge,
        playingUp,
        latestEvalAvg,
        evalTrend,
        evalDelta,
        evalCount: evalsForPlayer.length,
        statsPctVsAvg,
        statsRatio,
        bucket,
        rationale,
      };
    });
  }, [players, evaluationEvents, user, teamAge, currentSeason]);

  if (!decisions || decisions.length === 0) return null;

  const byBucket = {
    strong: decisions.filter((d) => d.bucket === "strong"),
    watch: decisions.filter((d) => d.bucket === "watch"),
    younger: decisions.filter((d) => d.bucket === "younger"),
  };

  // Sort each bucket by perfScore descending (strong) or ascending (watch/younger)
  byBucket.strong.sort((a, b) => (b.perfScore ?? 0) - (a.perfScore ?? 0));
  byBucket.watch.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));
  byBucket.younger.sort((a, b) => (a.perfScore ?? 0) - (b.perfScore ?? 0));

  const renderCard = (d) => (
    <button
      key={d.player.id}
      type="button"
      onClick={() => setEvalTrendPlayerId(d.player.id)}
      className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="font-black text-sm uppercase tracking-tight text-slate-900 truncate">
          {d.player.name}
        </div>
        {Number.isFinite(d.baseballAge) && (
          <div className="text-[9px] font-bold text-slate-400 shrink-0">
            Age {d.baseballAge}
            {d.playingUp ? " ↑" : ""}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        {d.latestEvalAvg != null && (
          <span className="text-[10px] font-bold text-slate-600 tabular-nums">
            Eval {d.latestEvalAvg.toFixed(1)}
          </span>
        )}
        {d.evalTrend && (
          <span
            className={`text-[10px] font-black tabular-nums ${
              d.evalTrend === "improving"
                ? "text-green-700"
                : d.evalTrend === "declining"
                ? "text-red-700"
                : "text-slate-500"
            }`}
          >
            {d.evalTrend === "improving"
              ? "↑"
              : d.evalTrend === "declining"
              ? "↓"
              : "—"}
          </span>
        )}
        {d.statsPctVsAvg != null && (
          <span
            className={`text-[10px] font-bold tabular-nums ${
              d.statsPctVsAvg > 5
                ? "text-green-700"
                : d.statsPctVsAvg < -5
                ? "text-red-700"
                : "text-slate-500"
            }`}
          >
            {d.statsPctVsAvg > 0 ? "+" : ""}
            {d.statsPctVsAvg.toFixed(0)}% OPS
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 italic font-medium">
        {d.rationale.join(" · ")}
      </div>
    </button>
  );

  return (
    <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl overflow-hidden">
      <div className="p-5 bg-white/40 border-b border-white/40">
        <div className="flex items-center gap-4">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Users className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider">
              Roster Decisions
            </h2>
            <p className="text-[10px] font-extrabold uppercase tracking-widest mt-1 text-slate-500">
              Advisory only — uses eval trends, stats, and age
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Strong Fit */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-emerald-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Strong Fit ({byBucket.strong.length})
          </div>
          {byBucket.strong.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No players in this group yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.strong.map(renderCard)}
            </div>
          )}
        </div>

        {/* Watchlist */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Watchlist ({byBucket.watch.length})
          </div>
          {byBucket.watch.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No players need a closer look right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.watch.map(renderCard)}
            </div>
          )}
        </div>

        {/* Better Suited for Younger Group */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-600 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Better Suited for Younger ({byBucket.younger.length})
          </div>
          {byBucket.younger.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic font-medium px-1">
              No candidates eligible for this recommendation.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {byBucket.younger.map(renderCard)}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pb-4 text-[10px] text-slate-500 italic font-medium">
        Tap any card to see that player&apos;s full evaluation trend.
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 13b · EvaluationTab
============================================================================ */
const EvaluationTab = memo(() => {
  const { team, user, saveTeamEvaluation } = useTeam();
  const {
    teamEvalGrades,
    setTeamEvalGrades,
    selectedRoundId,
    setSelectedRoundId,
    newRoundLabel,
    setNewRoundLabel,
    evalTrendPlayerId,
    setEvalTrendPlayerId,
  } = useUI();
  const { players, primaryColor, evaluationEvents } = team;

  // Eval rounds belonging to this head coach, newest first
  const myRounds = useMemo(() => {
    return (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!user || e.evaluatorId === user.uid)
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [evaluationEvents, user]);

  const isNewRound = !selectedRoundId;
  const activeRound = selectedRoundId
    ? myRounds.find((r) => r.id === selectedRoundId)
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/40 border-b border-white/40">
          <div className="flex items-center gap-4">
            <div
              className="p-2.5 rounded-full"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: primaryColor }}
              />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-wider flex items-center gap-3">
                Player Evaluation
              </h2>
              <p className="text-[10px] font-extrabold uppercase tracking-widest mt-1 text-slate-500">
                Head Coach Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
            <button
              onClick={() => {
                saveTeamEvaluation();
                if (isNewRound) setNewRoundLabel("");
              }}
              className="flex-1 sm:flex-none text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <Icons.Save className="w-4 h-4" />{" "}
              {isNewRound ? "Save New Eval" : "Update Eval"}
            </button>
          </div>
        </div>

        {/* Round selection bar */}
        <div className="px-5 py-3 bg-amber-50/40 border-b border-amber-100 flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600 shrink-0">
              Eval:
            </span>
            <select
              value={selectedRoundId || "__new"}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedRoundId(v === "__new" ? null : v);
              }}
              className="flex-1 min-w-0 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg cursor-pointer hover:bg-white/90 transition-colors"
            >
              <option value="__new">+ Start a new Eval</option>
              {myRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || `Eval (${r.date})`} — {r.date}
                </option>
              ))}
            </select>
          </label>
          {isNewRound && (
            <label className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600 shrink-0">
                Label:
              </span>
              <input
                type="text"
                value={newRoundLabel}
                onChange={(e) => setNewRoundLabel(e.target.value)}
                placeholder="e.g., Preseason 2026, Midseason, Tryouts"
                className="flex-1 min-w-0 text-xs font-bold border border-slate-200 bg-white text-slate-700 px-3 py-2 outline-none rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </label>
          )}
          {!isNewRound && activeRound && (
            <span className="text-[10px] font-bold text-slate-500 italic">
              Editing &quot;{activeRound.label || activeRound.date}&quot;
            </span>
          )}
        </div>
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-white/40 border-b border-slate-200/50">
                <th className="p-5 font-black text-slate-500 text-xs uppercase tracking-widest sticky left-0 bg-white/60 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.03)] w-64 border-r border-slate-200/50">
                  Player Name
                </th>
                {EVAL_CATEGORIES.map((cat) => (
                  <th
                    key={cat.id}
                    className="p-5 font-black text-slate-500 text-[10px] uppercase tracking-widest text-center"
                  >
                    {cat.label}
                  </th>
                ))}
                <th className="p-5 font-black text-slate-800 text-[10px] uppercase tracking-widest text-center border-l border-slate-200/50">
                  Offense (Stats)
                </th>
                <th className="p-5 font-black text-slate-800 text-[10px] uppercase tracking-widest text-center bg-white/50 border-l border-slate-200/50 shadow-inner">
                  Total Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/50">
              {players.map((player) => {
                const grades = teamEvalGrades[player.id] || {
                  fielding: 5,
                  armStrength: 5,
                  armAccuracy: 5,
                  speedAgility: 5,
                  baseballIQ: 5,
                  coachability: 5,
                };
                const offScore = getOffensiveScore(player.stats);
                const totalScore = calculateTotalScore(grades, player.stats);
                return (
                  <tr
                    key={player.id}
                    className="hover:bg-white/60 transition-colors"
                  >
                    <td className="p-4 font-black text-sm text-slate-800 sticky left-0 bg-white/90 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] truncate max-w-[250px] uppercase border-r border-slate-100/50">
                      <button
                        type="button"
                        onClick={() => setEvalTrendPlayerId(player.id)}
                        className="text-left hover:text-blue-700 hover:underline transition-colors flex items-center gap-1.5"
                        title="View evaluation trend"
                      >
                        {player.name}
                        <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      </button>
                    </td>
                    {EVAL_CATEGORIES.map((cat) => (
                      <td key={cat.id} className="p-3 text-center">
                        <select
                          value={grades[cat.id]}
                          onChange={(e) => {
                            setTeamEvalGrades({
                              ...teamEvalGrades,
                              [player.id]: {
                                ...grades,
                                [cat.id]: parseInt(e.target.value, 10),
                              },
                            });
                          }}
                          className="text-sm font-black border rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500 w-20 text-center shadow-sm transition-colors bg-white/80 border-slate-200 text-slate-700 cursor-pointer hover:bg-white"
                        >
                          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((num) => (
                            <option key={num} value={num}>
                              {num}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td className="p-4 font-black text-lg text-center text-slate-800 bg-white/40 border-l border-slate-200/50">
                      {offScore}
                    </td>
                    <td className="p-4 font-black text-xl text-center bg-white/60 border-l border-slate-200/50 text-slate-900 shadow-inner">
                      {totalScore}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roster Decisions panel — advisory recommendations based on
          eval trends, current performance, and age eligibility */}
      <RosterDecisionsPanel />

      {/* Trend modal — opens when a player name is clicked */}
      {evalTrendPlayerId && (
        <EvalTrendModal
          player={players.find((p) => p.id === evalTrendPlayerId)}
          evaluationEvents={evaluationEvents}
          userUid={user?.uid}
          primaryColor={primaryColor}
          onClose={() => setEvalTrendPlayerId(null)}
        />
      )}
    </div>
  );
});

/* ============================================================================
   SECTION 14 · SettingsTab
============================================================================ */
const SettingsTab = memo(() => {
  const {
    team,
    teams,
    updateTeam,
    advanceSeason,
    uploadLogo,
    uploadScheduleCsv,
    uploadStatsCsv,
    exportBackup,
    importBackup,
    deleteTeamCmd,
    leaveTeamCmd,
    addCoach,
    removeCoach,
  } = useTeam();
  const {
    isAddingCoach,
    setIsAddingCoach,
    newCoachForm,
    setNewCoachForm,
    setPastSeasonImport,
  } = useUI();
  const toast = useToast();
  const {
    leagueRuleSet,
    pitchingFormat,
    teamAge,
    inningsCount,
    positionLock,
    battingSize,
    defenseSize,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    logoUrl,
    coaches,
    players,
    currentSeason,
  } = team;
  const isDefenseLocked = !(leagueRuleSet === "NKB" && teamAge === "9U");

  // Past-season CSV import: parse the file, open the review modal.
  const startPastSeasonImport = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = parseGameChangerPastSeasonCsv(ev.target.result);
        if (result.error) {
          toast.push({
            kind: "error",
            title: "Could not import",
            message: result.error,
          });
          return;
        }
        if (result.rows.length === 0) {
          toast.push({ kind: "warn", title: "No player rows found in file" });
          return;
        }
        // Pre-populate assignments with auto-suggested matches
        const assignments = {};
        for (const row of result.rows) {
          assignments[row.csvName] =
            suggestPlayerMatch(row.csvName, players) || "skip";
        }
        setPastSeasonImport({
          rows: result.rows,
          season: "",
          ageGroup: "",
          pitchingFormat: "Kid Pitch",
          assignments,
        });
      };
      reader.onerror = () =>
        toast.push({ kind: "error", title: "Could not read file" });
      reader.readAsText(file);
      e.target.value = "";
    },
    [players, setPastSeasonImport, toast]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl overflow-hidden">
        <div className="p-5 flex items-center gap-4 bg-white/40 border-b border-white/40">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Settings
              className="w-6 h-6"
              style={{ color: primaryColor }}
            />
          </div>
          <h2 className="text-xl font-black uppercase tracking-wider text-slate-800">
            Team Settings
          </h2>
        </div>
        <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-10">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-5 border-b border-slate-200/50 pb-3 flex items-center gap-2">
                <Icons.Settings className="w-4 h-4" /> Game Default
                Configuration
              </h3>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      League Rules
                    </label>
                    <select
                      value={leagueRuleSet}
                      onChange={(e) =>
                        updateTeam({ leagueRuleSet: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="USSSA">USSSA Baseball</option>
                      <option value="NKB">
                        Northern Kentucky Baseball (NKB)
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Pitching Format
                    </label>
                    <select
                      value={pitchingFormat}
                      onChange={(e) =>
                        updateTeam({ pitchingFormat: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      {leagueRuleSet === "NKB" &&
                      ["6U", "7U", "8U"].includes(teamAge) ? (
                        <option value="Machine Pitch">Machine Pitch</option>
                      ) : leagueRuleSet === "USSSA" && teamAge === "8U" ? (
                        <>
                          <option value="Kid Pitch">Kid Pitch</option>
                          <option value="Coach Pitch">Coach Pitch</option>
                        </>
                      ) : (
                        <>
                          <option value="Kid Pitch">Kid Pitch</option>
                          <option value="Coach Pitch">Coach Pitch</option>
                          <option value="Machine Pitch">Machine Pitch</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Age Group
                    </label>
                    <select
                      value={teamAge}
                      onChange={(e) => updateTeam({ teamAge: e.target.value })}
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="6U">6U</option>
                      <option value="7U">7U</option>
                      <option value="8U">8U</option>
                      <option value="9U">9U</option>
                      <option value="10U">10U</option>
                      <option value="11U to 12U">11U to 12U</option>
                      <option value="13U to 14U">13U to 14U</option>
                      <option value="15U to 18U">15U to 18U</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Innings
                    </label>
                    <select
                      value={inningsCount}
                      onChange={(e) =>
                        updateTeam({ inningsCount: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                        <option key={num} value={num}>
                          {num}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Rotation
                    </label>
                    <select
                      value={positionLock}
                      onChange={(e) =>
                        updateTeam({ positionLock: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="1">1 Inn</option>
                      <option value="2">2 Inn</option>
                      <option value="3">3 Inn</option>
                      <option value="full">Full Game</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Batters
                    </label>
                    <select
                      value={battingSize}
                      onChange={(e) =>
                        updateTeam({ battingSize: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="roster">Roster</option>
                      <option value="9">9</option>
                      <option value="10">10</option>
                      <option value="11">11</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Defense Mode
                  </label>
                  <div className="flex border border-slate-200 bg-white/60 rounded-xl shadow-sm overflow-hidden p-1">
                    <button
                      onClick={() => updateTeam({ defenseSize: "9" })}
                      disabled={isDefenseLocked}
                      className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                        defenseSize === "9"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                          : "text-slate-500 hover:bg-white/80 border border-transparent"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      9 Fielders
                    </button>
                    <button
                      onClick={() => updateTeam({ defenseSize: "10" })}
                      disabled={isDefenseLocked}
                      className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                        defenseSize === "10"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                          : "text-slate-500 hover:bg-white/80 border border-transparent"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      10 Fielders
                    </button>
                  </div>
                  {isDefenseLocked ? (
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">
                      Locked by {leagueRuleSet} rules
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">
                      Unlocked for Recreational Rules
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Users className="w-4 h-4" /> Coaching Staff
              </h3>
              <div className="space-y-3 mb-4">
                {coaches.map((c) => (
                  <div
                    key={c.id}
                    className="flex justify-between items-center bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm"
                  >
                    <div>
                      <span className="block text-sm font-black text-slate-800 uppercase">
                        {c.name}
                      </span>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                        {c.role}
                      </span>
                    </div>
                    <button
                      onClick={() => removeCoach(c.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              {isAddingCoach ? (
                <div className="bg-white/80 p-4 border border-slate-200 rounded-xl space-y-3 shadow-sm">
                  <input
                    type="text"
                    value={newCoachForm.name}
                    onChange={(e) =>
                      setNewCoachForm({ ...newCoachForm, name: e.target.value })
                    }
                    placeholder="Coach Name"
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 rounded-lg shadow-inner"
                  />
                  <select
                    value={newCoachForm.role}
                    onChange={(e) =>
                      setNewCoachForm({ ...newCoachForm, role: e.target.value })
                    }
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 rounded-lg bg-white shadow-sm"
                  >
                    <option value="Head Coach">Head Coach</option>
                    <option value="Assistant Coach">Assistant Coach</option>
                  </select>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => addCoach(newCoachForm)}
                      className="flex-1 text-white text-xs font-black uppercase tracking-widest py-3 rounded-lg shadow-sm transition-transform hover:-translate-y-0.5"
                      style={{ backgroundColor: primaryColor }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsAddingCoach(false)}
                      className="flex-1 bg-white border border-slate-300 text-slate-600 text-xs font-black uppercase tracking-widest py-3 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsAddingCoach(true)}
                  className="w-full bg-white/60 hover:bg-white text-slate-600 text-xs font-black uppercase tracking-widest py-3.5 rounded-xl border-2 border-dashed border-slate-300 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <Icons.Plus className="w-4 h-4" /> Add Coach
                </button>
              )}
            </div>
          </div>

          <div className="space-y-10">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-200/50 pb-3 flex items-center gap-2">
                <Icons.MapPin className="w-4 h-4" /> Team Identity & Season
              </h3>
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row gap-5">
                  <div className="flex-1">
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Current Season
                    </label>
                    <input
                      type="text"
                      value={currentSeason}
                      onChange={(e) =>
                        updateTeam({ currentSeason: e.target.value })
                      }
                      placeholder="Spring 2026"
                      className="w-full p-3 bg-white/80 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={advanceSeason}
                      className="p-3 bg-slate-900 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 w-full sm:w-auto h-[46px] rounded-xl shadow-md"
                    >
                      <Icons.Forward className="w-4 h-4" /> Advance Season
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Team Colors
                  </label>
                  <div className="flex gap-8 bg-white/80 p-4 border border-slate-200 rounded-xl shadow-sm">
                    {[
                      {
                        key: "primaryColor",
                        val: primaryColor,
                        label: "Primary",
                      },
                      {
                        key: "secondaryColor",
                        val: secondaryColor,
                        label: "Accent",
                      },
                      {
                        key: "tertiaryColor",
                        val: tertiaryColor,
                        label: "Tertiary",
                      },
                    ].map(({ key, val, label }) => (
                      <div
                        key={key}
                        className="flex flex-col items-center gap-2"
                      >
                        <div className="w-10 h-10 rounded-full shadow-inner border-2 border-white overflow-hidden relative">
                          <input
                            type="color"
                            value={val}
                            onChange={(e) =>
                              updateTeam({ [key]: e.target.value })
                            }
                            className="absolute -inset-2 w-16 h-16 cursor-pointer opacity-0"
                          />
                          <div
                            className="w-full h-full"
                            style={{ backgroundColor: val }}
                          />
                        </div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Logo Upload
                  </label>
                  <div className="flex items-center gap-4 bg-white/80 p-4 border border-slate-200 rounded-xl shadow-sm">
                    {logoUrl ? (
                      <div className="relative group">
                        <img
                          src={logoUrl}
                          alt="Logo"
                          className="w-16 h-16 object-contain bg-white border border-slate-200 p-1.5 rounded-xl shadow-sm"
                        />
                        <button
                          onClick={() => updateTeam({ logoUrl: "" })}
                          className="absolute -top-2 -right-2 p-1.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Icons.X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-white border border-slate-200 border-dashed rounded-xl flex items-center justify-center">
                        <Icons.Upload className="w-6 h-6 text-slate-300" />
                      </div>
                    )}
                    <label className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl p-3.5 text-xs text-center cursor-pointer font-black text-slate-700 uppercase tracking-widest transition-colors shadow-sm">
                      Choose File{" "}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={uploadLogo}
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 font-medium">
                    PNG/JPG up to 1 MB. Stored inline in your team document.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Cloud className="w-4 h-4" /> Data Management
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Schedule CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={uploadScheduleCsv}
                    />
                  </label>
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Roster / Stats CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={uploadStatsCsv}
                    />
                  </label>
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md col-span-2 md:col-span-1">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-amber-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Past Season CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={startPastSeasonImport}
                    />
                  </label>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={exportBackup}
                    className="flex-1 bg-white border border-slate-300 rounded-xl py-3.5 text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                  >
                    <Icons.Download className="w-4 h-4" /> Backup
                  </button>
                  <label className="flex-1 bg-white border border-slate-300 rounded-xl py-3.5 text-[10px] sm:text-xs text-center cursor-pointer font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2">
                    <Icons.Upload className="w-4 h-4" /> Restore{" "}
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={importBackup}
                    />
                  </label>
                </div>
              </div>
            </div>
            {/* Storage usage indicator — shows how close the team document is
                to Firestore's 1MB hard limit. Mostly useful as an early warning
                if the document starts approaching the cap. Slim lineup data
                keeps this well under control during normal use. */}
            {(() => {
              const FIRESTORE_LIMIT = 1048576; // 1 MB in bytes
              let docSize = 0;
              try {
                docSize = new TextEncoder().encode(
                  JSON.stringify(team || {})
                ).length;
              } catch {
                docSize = 0;
              }
              const pct = Math.min(100, (docSize / FIRESTORE_LIMIT) * 100);
              const sizeKb = Math.round(docSize / 1024);
              const limitKb = Math.round(FIRESTORE_LIMIT / 1024);
              const color =
                pct >= 90
                  ? "bg-red-500"
                  : pct >= 70
                  ? "bg-amber-500"
                  : "bg-emerald-500";
              const label =
                pct >= 90
                  ? "Critical — saves may fail soon"
                  : pct >= 70
                  ? "Watch — getting close to the limit"
                  : "Healthy";
              return (
                <div className="pt-6 border-t border-slate-200/50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-slate-800 text-sm">
                      Storage Usage
                    </h4>
                    <span className="text-xs font-black tabular-nums text-slate-700">
                      {sizeKb} KB / {limitKb} KB
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 font-medium">
                    {label} ({pct.toFixed(0)}%). Saves are limited to 1 MB per
                    team. Data resets at season rollover.
                  </p>
                </div>
              );
            })()}
            <div className="pt-6 border-t border-slate-200/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">
                  Team Management
                </h4>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Leave this team or permanently delete it.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={leaveTeamCmd}
                  disabled={teams.length <= 1}
                  className="px-6 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
                >
                  Leave Team
                </button>
                <button
                  onClick={deleteTeamCmd}
                  disabled={teams.length <= 1}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
                >
                  Delete Team
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 15 · PlayerProfileModal
============================================================================ */
const PROFILE_TABS = [
  { id: "general", label: "General Info" },
  { id: "report", label: "Season Report" },
  { id: "stats", label: "Season Stats" },
  { id: "innings", label: "Innings Played" },
  { id: "contact", label: "Contact" },
];
const STATS_TAB_KEYS = [
  "ops",
  "obp",
  "avg",
  "contact",
  "totalPitches",
  "ab",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "fpct",
  "tc",
  "a",
  "po",
  "ip",
  "era",
  "ld",
  "fb",
  "gb",
  "hard",
  "qab",
  "babip",
];

// Per-stat metadata used by the Season Stats tab and the year-over-year chart.
// `kind`: "decimal" (e.g. .345 avg), "int" (e.g. 12 hr), "percent" (e.g. 45%),
//          "ip" (innings pitched, shows as 12.1 for 12 1/3).
// `label`: shown on cards/chart axes
// `category`: groups stats; pitching is hidden for non-Kid Pitch seasons
// `higherIsBetter`: used for the trend arrow direction
const STAT_META = {
  ops: {
    label: "OPS",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  obp: {
    label: "OBP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  avg: {
    label: "AVG",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  contact: {
    label: "Contact%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  ab: { label: "AB", kind: "int", category: "hitting", higherIsBetter: true },
  h: { label: "H", kind: "int", category: "hitting", higherIsBetter: true },
  doubles: {
    label: "2B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  triples: {
    label: "3B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  hr: { label: "HR", kind: "int", category: "hitting", higherIsBetter: true },
  rbi: { label: "RBI", kind: "int", category: "hitting", higherIsBetter: true },
  ld: {
    label: "LD%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  fb: {
    label: "FB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  gb: {
    label: "GB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: false,
  },
  hard: {
    label: "Hard%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  qab: {
    label: "QAB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  babip: {
    label: "BABIP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  fpct: {
    label: "FPCT",
    kind: "decimal",
    category: "fielding",
    higherIsBetter: true,
  },
  tc: { label: "TC", kind: "int", category: "fielding", higherIsBetter: true },
  a: { label: "A", kind: "int", category: "fielding", higherIsBetter: true },
  po: { label: "PO", kind: "int", category: "fielding", higherIsBetter: true },
  ip: { label: "IP", kind: "ip", category: "pitching", higherIsBetter: true },
  era: {
    label: "ERA",
    kind: "decimal",
    category: "pitching",
    higherIsBetter: false,
  },
  totalPitches: {
    label: "TP",
    kind: "int",
    category: "pitching",
    higherIsBetter: false,
  },
};

// Format a stat value for display. Returns "—" for missing/zero values when
// appropriate (so a kid with 0 HR shows as 0, but a kid with no AVG shows as —).
const formatStatValue = (key, value) => {
  if (value === null || value === undefined) return "—";
  const meta = STAT_META[key];
  if (!meta) return String(value);
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  switch (meta.kind) {
    case "decimal":
      // Convention: drop leading 0 for sub-1 stats (.345 not 0.345)
      if (n > 0 && n < 1) return n.toFixed(3).replace(/^0/, "");
      return n.toFixed(3);
    case "percent":
      // Stored as decimal (0.45 = 45%) or already as percent (45)?
      // We treat values <= 1 as decimals to convert; otherwise display as-is.
      const pct = n <= 1 ? n * 100 : n;
      return `${pct.toFixed(1)}%`;
    case "int":
      return Math.round(n).toString();
    case "ip": {
      // IP convention: integer.thirds (e.g. 5.2 = 5 and 2/3)
      return n.toFixed(1);
    }
    default:
      return String(n);
  }
};
const ALL_POSITIONS = [
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

/* ============================================================================
   SECTION X · Lineup Card generator — see ./lineup/lineupCard.js
============================================================================ */

/* ============================================================================
   PastSeasonImportModal — review screen for bulk past-season CSV import.
   Lets the user assign each CSV row to an existing player (or skip), then
   commits all assignments at once via bulkAddPastSeasons.
============================================================================ */
const PastSeasonImportModal = memo(() => {
  const { team, bulkAddPastSeasons } = useTeam();
  const { pastSeasonImport, setPastSeasonImport } = useUI();
  const toast = useToast();

  if (!pastSeasonImport) return null;
  const { rows, season, ageGroup, pitchingFormat, assignments } =
    pastSeasonImport;
  const { players, primaryColor, tertiaryColor } = team;

  const setField = (patch) =>
    setPastSeasonImport({ ...pastSeasonImport, ...patch });
  const setAssignment = (csvName, value) =>
    setField({ assignments: { ...assignments, [csvName]: value } });

  const close = () => setPastSeasonImport(null);

  // Players already assigned, so we can de-duplicate dropdowns
  const usedPlayerIds = new Set();
  for (const v of Object.values(assignments)) {
    if (v && v !== "skip" && v !== "new") usedPlayerIds.add(v);
  }

  // Counts
  const assignedCount = Object.values(assignments).filter(
    (v) => v && v !== "skip"
  ).length;
  const skipCount = Object.values(assignments).filter(
    (v) => v === "skip"
  ).length;

  const canCommit =
    season.trim() && ageGroup && pitchingFormat && assignedCount > 0;

  const commit = () => {
    if (!canCommit) return;
    const toAdd = [];
    for (const row of rows) {
      const a = assignments[row.csvName];
      if (!a || a === "skip") continue;
      let playerId = a;
      if (a === "new") {
        // Add as a new player first (simple shape — user can edit later)
        // We can't directly call addPlayer here without making team the source of truth synchronously.
        // Skip "new" for now and surface a warning. (See note below.)
        toast.push({
          kind: "warn",
          title: `Skipped "${row.csvName}"`,
          message: "Add the player first via the Roster tab, then re-import.",
        });
        continue;
      }
      toAdd.push({
        playerId,
        season: season.trim(),
        ageGroup,
        pitchingFormat,
        stats: row.stats,
      });
    }
    if (toAdd.length === 0) {
      toast.push({
        kind: "warn",
        title: "Nothing to import",
        message: "No rows are matched to a player.",
      });
      return;
    }
    bulkAddPastSeasons(toAdd);
    toast.push({
      kind: "success",
      title: `Past season imported`,
      message: `${toAdd.length} player${
        toAdd.length === 1 ? "" : "s"
      } updated for ${season}.`,
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-1.5" style={{ backgroundColor: primaryColor }} />

        <div className="p-6 sm:p-7 border-b border-slate-200">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                Import Past Season Stats
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Review and confirm which player each row belongs to.
              </p>
            </div>
            <button
              onClick={close}
              className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Season *
              </label>
              <input
                type="text"
                value={season}
                onChange={(e) => setField({ season: e.target.value })}
                placeholder="e.g., Spring 2025"
                className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Age Group *
              </label>
              <select
                value={ageGroup}
                onChange={(e) => setField({ ageGroup: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
              >
                <option value="">Select…</option>
                {AGE_TIERS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Pitching Format *
              </label>
              <select
                value={pitchingFormat}
                onChange={(e) => setField({ pitchingFormat: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
              >
                <option value="Kid Pitch">Kid Pitch</option>
                <option value="Coach/Machine">Coach / Machine</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 bg-slate-50/50">
          <div className="p-4 sm:p-6 space-y-2">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 grid grid-cols-12 gap-3 px-3 pb-2">
              <div className="col-span-5">From CSV</div>
              <div className="col-span-7">Assign To</div>
            </div>
            {rows.map((row) => {
              const value = assignments[row.csvName] || "skip";
              const isSkip = value === "skip";
              return (
                <div
                  key={row.csvName}
                  className={`grid grid-cols-12 gap-3 items-center bg-white border rounded-xl p-3 shadow-sm ${
                    isSkip ? "opacity-60" : "border-slate-200"
                  }`}
                >
                  <div className="col-span-5">
                    <div className="text-sm font-black text-slate-800 truncate">
                      {row.csvName}
                    </div>
                    {row.number && (
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        #{row.number}
                      </div>
                    )}
                  </div>
                  <div className="col-span-7">
                    <select
                      value={value}
                      onChange={(e) =>
                        setAssignment(row.csvName, e.target.value)
                      }
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
                    >
                      <option value="skip">Skip this row</option>
                      <optgroup label="Match to existing player">
                        {players.map((p) => {
                          // Allow the current selection plus any unassigned player
                          const taken =
                            usedPlayerIds.has(p.id) && p.id !== value;
                          return (
                            <option key={p.id} value={p.id} disabled={taken}>
                              {p.name}
                              {p.number ? ` (#${p.number})` : ""}
                              {taken ? " (already matched)" : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border-t border-slate-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            {assignedCount} matched · {skipCount} skipped
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={close}
              className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canCommit}
              onClick={commit}
              className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* PastSeasonForm — used inline for Add and Edit of a single past-season entry. */
const PastSeasonForm = memo(
  ({ initial, primaryColor, tertiaryColor, onSave, onCancel, onDelete }) => {
    const [season, setSeason] = useState(initial?.season || "");
    const [ageGroup, setAgeGroup] = useState(initial?.ageGroup || "");
    const [pitchingFormat, setPitchingFormat] = useState(
      initial?.pitchingFormat || "Kid Pitch"
    );
    const [stats, setStats] = useState(() => ({
      ...blankStats(),
      ...(initial?.stats || {}),
    }));

    const setStat = (key, raw) => {
      const n = parseFloat(raw);
      setStats((s) => ({ ...s, [key]: Number.isNaN(n) ? 0 : n }));
    };
    const showPitching = pitchingFormat === "Kid Pitch";

    const handleSave = () => {
      if (!season.trim() || !ageGroup) return;
      onSave({ season: season.trim(), ageGroup, pitchingFormat, stats });
    };

    // Stats fields shown — hide pitching fields when format isn't Kid Pitch
    const fields = STATS_TAB_KEYS.filter((k) => {
      const isPitch = ["ip", "era", "totalPitches"].includes(k);
      return !isPitch || showPitching;
    });

    return (
      <div className="bg-white border-2 border-blue-200 rounded-xl p-4 shadow-md mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Season *
            </label>
            <input
              type="text"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="e.g., Spring 2025"
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
            />
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Age Group *
            </label>
            <select
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
            >
              <option value="">Select…</option>
              {AGE_TIERS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Pitching Format
            </label>
            <select
              value={pitchingFormat}
              onChange={(e) => setPitchingFormat(e.target.value)}
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm"
            >
              <option value="Kid Pitch">Kid Pitch</option>
              <option value="Coach/Machine">Coach / Machine</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          {fields.map((key) => (
            <div key={key}>
              <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">
                {key.toUpperCase()}
              </label>
              <input
                type="number"
                step="0.001"
                value={stats[key] || 0}
                onChange={(e) => setStat(key, e.target.value)}
                className="w-full p-1.5 bg-white border border-slate-200 rounded-md text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner tabular-nums"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 transition-colors shadow-sm mr-auto"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!season.trim() || !ageGroup}
            onClick={handleSave}
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            {initial ? "Save Changes" : "Add Season"}
          </button>
        </div>
      </div>
    );
  }
);

/* StatTrendModal — overlays the player profile when a stat is tapped.
   Shows a hand-rolled SVG line chart of that stat across seasons (current +
   any past-season entries that have data for it). For pitching stats, only
   plots seasons whose pitchingFormat === "Kid Pitch". */
const StatTrendModal = memo(
  ({
    statKey,
    player,
    currentSeason,
    currentPitchingFormat,
    primaryColor,
    tertiaryColor,
    onClose,
  }) => {
    if (!statKey) return null;
    const meta = STAT_META[statKey];
    if (!meta) return null;

    // Build a chronological data series. Each entry: { season, ageGroup, value, isCurrent }.
    // Sort: by year ascending, then Spring before Fall within a year.
    const seasonSortKey = (label) => {
      if (!label) return 99999;
      const m = String(label).match(/(spring|fall)\s+(\d{4})/i);
      if (!m) return 99999;
      const year = parseInt(m[2], 10);
      const seasonOffset = m[1].toLowerCase() === "spring" ? 0 : 1;
      return year * 10 + seasonOffset;
    };

    const series = [];

    // Past seasons
    for (const ps of player.pastSeasons || []) {
      // Skip pitching stats for non-Kid Pitch seasons
      if (meta.category === "pitching" && ps.pitchingFormat !== "Kid Pitch")
        continue;
      const v = ps.stats?.[statKey];
      if (v === null || v === undefined) continue;
      const num = Number(v);
      if (Number.isNaN(num)) continue;
      series.push({
        season: ps.season,
        ageGroup: ps.ageGroup,
        value: num,
        sortKey: seasonSortKey(ps.season),
        isCurrent: false,
      });
    }

    // Current season
    if (
      !(meta.category === "pitching" && currentPitchingFormat !== "Kid Pitch")
    ) {
      const v = player.stats?.[statKey];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
        series.push({
          season: currentSeason,
          ageGroup: null,
          value: Number(v),
          sortKey: seasonSortKey(currentSeason),
          isCurrent: true,
        });
      }
    }

    series.sort((a, b) => a.sortKey - b.sortKey);

    // Geometry: SVG drawn into a 600x300 viewBox, but the parent flexes the
    // width responsively. Margins reserved for axis labels.
    const W = 600,
      H = 300;
    const ML = 60,
      MR = 24,
      MT = 24,
      MB = 56;
    const innerW = W - ML - MR;
    const innerH = H - MT - MB;

    // Y range: pad by 10%; for percent stats clamp to [0, 100] sensibly.
    const values = series.map((s) => s.value);
    let yMin = values.length ? Math.min(...values) : 0;
    let yMax = values.length ? Math.max(...values) : 1;
    if (yMin === yMax) {
      // Single point or all-equal: pad symmetrically
      if (yMin === 0) {
        yMin = 0;
        yMax = 1;
      } else {
        yMin = yMin * 0.9;
        yMax = yMax * 1.1;
      }
    } else {
      const range = yMax - yMin;
      yMin = yMin - range * 0.1;
      yMax = yMax + range * 0.1;
    }
    // Don't go negative for stats that can't be negative
    if (meta.kind === "int" || meta.kind === "percent" || meta.kind === "ip") {
      if (yMin < 0) yMin = 0;
    }

    const xPos = (i) =>
      series.length === 1
        ? ML + innerW / 2
        : ML + (i / (series.length - 1)) * innerW;
    const yPos = (v) => MT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    // Axis ticks: 4-5 evenly spaced on Y
    const yTicks = [];
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) {
      const v = yMin + ((yMax - yMin) * i) / tickCount;
      yTicks.push(v);
    }

    // Compute trend (first vs last)
    let trend = null;
    if (series.length >= 2) {
      const first = series[0].value;
      const last = series[series.length - 1].value;
      if (first !== last) {
        const direction = last > first ? "up" : "down";
        const isImproving = (direction === "up") === meta.higherIsBetter;
        const change = last - first;
        trend = { direction, isImproving, change };
      }
    }

    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-0.5">
                {player.name}
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">
                {meta.label}
              </h3>
              {trend && (
                <div
                  className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border tabular-nums ${
                    trend.isImproving
                      ? "bg-green-50 text-green-800 border-green-200"
                      : "bg-red-50 text-red-800 border-red-200"
                  }`}
                >
                  {trend.direction === "up" ? "↑" : "↓"}
                  {meta.kind === "decimal" || meta.kind === "ip"
                    ? Math.abs(trend.change).toFixed(3)
                    : meta.kind === "percent"
                    ? `${Math.abs(
                        trend.change <= 1 ? trend.change * 100 : trend.change
                      ).toFixed(1)}%`
                    : Math.abs(Math.round(trend.change))}
                  {trend.isImproving ? "Improving" : "Declining"}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {series.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-12 text-center">
                <Icons.Bat className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-slate-500 mb-1">
                  No Data Available
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  {meta.category === "pitching"
                    ? "No Kid Pitch seasons with this stat on file."
                    : "No seasons have data for this stat yet."}
                </p>
              </div>
            ) : series.length === 1 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
                  {series[0].season}
                  {series[0].ageGroup ? ` · ${series[0].ageGroup}` : ""}
                </div>
                <div className="text-5xl font-black tabular-nums text-slate-900 mb-2">
                  {formatStatValue(statKey, series[0].value)}
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  Add past seasons to see year-over-year trends.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-auto"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Y-axis grid lines + labels */}
                    {yTicks.map((v, i) => (
                      <g key={i}>
                        <line
                          x1={ML}
                          y1={yPos(v)}
                          x2={ML + innerW}
                          y2={yPos(v)}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={
                            i === 0 || i === tickCount ? "0" : "3,3"
                          }
                        />
                        <text
                          x={ML - 8}
                          y={yPos(v) + 4}
                          textAnchor="end"
                          className="text-[11px]"
                          fill="#64748b"
                          style={{
                            fontWeight: 700,
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {formatStatValue(statKey, v)}
                        </text>
                      </g>
                    ))}

                    {/* X-axis labels (season names, rotated for fit) */}
                    {series.map((s, i) => (
                      <g key={i}>
                        <text
                          x={xPos(i)}
                          y={MT + innerH + 18}
                          textAnchor="middle"
                          className="text-[10px]"
                          fill={s.isCurrent ? primaryColor : "#64748b"}
                          style={{ fontWeight: s.isCurrent ? 900 : 700 }}
                        >
                          {s.season.replace(
                            /^(\w+)\s+(\d{4})$/,
                            (_, sn, yr) => `${sn.slice(0, 3)} '${yr.slice(2)}`
                          )}
                        </text>
                        {s.ageGroup && (
                          <text
                            x={xPos(i)}
                            y={MT + innerH + 32}
                            textAnchor="middle"
                            className="text-[9px]"
                            fill="#94a3b8"
                            style={{ fontWeight: 700 }}
                          >
                            {s.ageGroup}
                          </text>
                        )}
                      </g>
                    ))}

                    {/* Connecting line */}
                    <polyline
                      fill="none"
                      stroke={primaryColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={series
                        .map((s, i) => `${xPos(i)},${yPos(s.value)}`)
                        .join(" ")}
                    />

                    {/* Data points */}
                    {series.map((s, i) => (
                      <g key={i}>
                        <circle
                          cx={xPos(i)}
                          cy={yPos(s.value)}
                          r={s.isCurrent ? 7 : 5}
                          fill={s.isCurrent ? primaryColor : "#fff"}
                          stroke={primaryColor}
                          strokeWidth="2.5"
                        />
                        <text
                          x={xPos(i)}
                          y={yPos(s.value) - 14}
                          textAnchor="middle"
                          className="text-[11px] tabular-nums"
                          fill="#0f172a"
                          style={{ fontWeight: 900 }}
                        >
                          {formatStatValue(statKey, s.value)}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>

                {/* Season-by-season breakdown table */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-3 px-4 py-2 bg-slate-50 border-b border-slate-200">
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                      Season
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                      Age
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 text-right">
                      {meta.label}
                    </div>
                  </div>
                  {series.map((s, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-3 px-4 py-2 ${
                        i < series.length - 1 ? "border-b border-slate-100" : ""
                      } ${s.isCurrent ? "bg-blue-50/30" : ""}`}
                    >
                      <div className="text-xs font-black text-slate-900 uppercase">
                        {s.season}
                        {s.isCurrent ? " ·" : ""}
                      </div>
                      <div className="text-xs font-bold text-slate-600">
                        {s.ageGroup || "—"}
                      </div>
                      <div className="text-xs font-black tabular-nums text-slate-900 text-right">
                        {formatStatValue(statKey, s.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

/* EvalTrendModal — shows a per-player trend chart of all 6 eval categories
   plotted across all eval rounds (head-coach evals only, this user only).
   Each category is its own colored line. Y-axis is the 1-10 grade scale.
   X-axis is the eval rounds in chronological order. */
const EvalTrendModal = memo(
  ({ player, evaluationEvents, userUid, primaryColor, onClose }) => {
    if (!player) return null;

    // Collect this user's head-coach evals, oldest first
    const myEvals = (evaluationEvents || [])
      .filter(
        (e) => e.coachRole === "Head" && (!userUid || e.evaluatorId === userUid)
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Each category gets its own line. Build series of {label, date, value}
    // entries per category, only including evals where the player has a grade.
    const categorySeries = EVAL_CATEGORIES.map((cat) => {
      const points = [];
      for (const ev of myEvals) {
        const grade = ev.grades?.[player.id]?.[cat.id];
        if (Number.isFinite(grade)) {
          points.push({
            label: ev.label || `Eval (${ev.date})`,
            date: ev.date,
            value: grade,
          });
        }
      }
      return { ...cat, points };
    });

    // X-axis evals (use the union of all dates that have any data)
    const xLabels = [];
    const seenIds = new Set();
    for (const ev of myEvals) {
      // Only include this eval if at least one category has a value
      const hasAny = EVAL_CATEGORIES.some((cat) =>
        Number.isFinite(ev.grades?.[player.id]?.[cat.id])
      );
      if (hasAny && !seenIds.has(ev.id)) {
        seenIds.add(ev.id);
        xLabels.push({ id: ev.id, label: ev.label || `(${ev.date})`, date: ev.date });
      }
    }
    const evalCount = xLabels.length;

    // Geometry — same scheme as StatTrendModal for visual consistency
    const W = 600,
      H = 320;
    const ML = 50,
      MR = 24,
      MT = 24,
      MB = 64;
    const innerW = W - ML - MR;
    const innerH = H - MT - MB;
    // Y range is fixed: 1-10 (the grade scale)
    const yMin = 1,
      yMax = 10;
    const xPos = (i) =>
      evalCount === 1 ? ML + innerW / 2 : ML + (i / (evalCount - 1)) * innerW;
    const yPos = (v) => MT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const yTicks = [1, 3, 5, 7, 10];

    // Color palette for the 6 categories — distinct, accessible
    const palette = [
      "#2563eb", // blue (Fielding)
      "#9333ea", // purple (Baseball IQ)
      "#dc2626", // red (Arm Strength)
      "#ea580c", // orange (Arm Accuracy)
      "#16a34a", // green (Speed & Agility)
      "#0891b2", // teal (Coachability)
    ];

    // Trend summary per category: first vs last
    const trends = categorySeries.map((cs, idx) => {
      if (cs.points.length < 2) return null;
      const first = cs.points[0].value;
      const last = cs.points[cs.points.length - 1].value;
      const change = last - first;
      return {
        label: cs.label,
        change,
        color: palette[idx % palette.length],
      };
    });

    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
          <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-0.5">
                {player.name}
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">
                Evaluation Trend
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                {evalCount === 0
                  ? "No eval data yet."
                  : evalCount === 1
                  ? "1 eval recorded — add more to see trends."
                  : `${evalCount} evals over time`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {evalCount === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-12 text-center">
                <Icons.Clipboard className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-slate-500 mb-1">
                  No Evals Recorded
                </p>
                <p className="text-xs text-slate-500 font-medium">
                  Save an eval round to start tracking this player&apos;s trends.
                </p>
              </div>
            ) : evalCount === 1 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
                  {xLabels[0].label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                  {categorySeries.map((cs, idx) => (
                    <div
                      key={cs.id}
                      className="bg-white border border-slate-200 rounded-lg p-3"
                    >
                      <div
                        className="text-[10px] font-black uppercase tracking-widest mb-1"
                        style={{ color: palette[idx % palette.length] }}
                      >
                        {cs.label}
                      </div>
                      <div className="text-2xl font-black tabular-nums text-slate-900">
                        {cs.points[0]?.value ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 font-medium mt-4">
                  Add more eval rounds to see trends.
                </p>
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-auto"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Y-axis grid + labels */}
                    {yTicks.map((v, i) => (
                      <g key={`y-${i}`}>
                        <line
                          x1={ML}
                          y1={yPos(v)}
                          x2={ML + innerW}
                          y2={yPos(v)}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={
                            i === 0 || i === yTicks.length - 1 ? "0" : "3,3"
                          }
                        />
                        <text
                          x={ML - 8}
                          y={yPos(v) + 4}
                          textAnchor="end"
                          className="text-[11px]"
                          fill="#64748b"
                          style={{
                            fontWeight: 700,
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {v}
                        </text>
                      </g>
                    ))}

                    {/* X-axis labels (eval names, rotated for fit) */}
                    {xLabels.map((s, i) => (
                      <g key={`x-${i}`}>
                        <text
                          x={xPos(i)}
                          y={MT + innerH + 18}
                          textAnchor="middle"
                          className="text-[10px]"
                          fill="#64748b"
                          style={{ fontWeight: 700 }}
                          transform={
                            evalCount > 4
                              ? `rotate(-30 ${xPos(i)} ${MT + innerH + 18})`
                              : undefined
                          }
                        >
                          {s.label.length > 18
                            ? `${s.label.slice(0, 16)}…`
                            : s.label}
                        </text>
                      </g>
                    ))}

                    {/* Lines per category */}
                    {categorySeries.map((cs, idx) => {
                      if (cs.points.length === 0) return null;
                      const color = palette[idx % palette.length];
                      // Map each point to its X position based on its eval id
                      const pts = cs.points
                        .map((p) => {
                          const xLabel = xLabels.findIndex(
                            (x) => x.date === p.date
                          );
                          if (xLabel === -1) return null;
                          return { x: xPos(xLabel), y: yPos(p.value), value: p.value };
                        })
                        .filter(Boolean);
                      if (pts.length === 0) return null;
                      const path = pts
                        .map(
                          (p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`
                        )
                        .join(" ");
                      return (
                        <g key={`line-${cs.id}`}>
                          <path
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {pts.map((p, i) => (
                            <circle
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r="3.5"
                              fill={color}
                              stroke="white"
                              strokeWidth="1.5"
                            />
                          ))}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Legend with trend summary */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categorySeries.map((cs, idx) => {
                    const trend = trends[idx];
                    const color = palette[idx % palette.length];
                    return (
                      <div
                        key={cs.id}
                        className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center gap-2"
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-700 truncate">
                            {cs.label}
                          </div>
                          {trend && (
                            <div
                              className={`text-[10px] font-black tabular-nums ${
                                trend.change > 0
                                  ? "text-green-700"
                                  : trend.change < 0
                                  ? "text-red-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {trend.change > 0 ? "↑" : trend.change < 0 ? "↓" : "—"}
                              {trend.change !== 0 ? ` ${Math.abs(trend.change)}` : " flat"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

const PlayerProfileModal = memo(() => {
  const {
    team,
    updatePlayer,
    updatePlayerNested,
    removePlayer,
    addPastSeason,
    updatePastSeason,
    removePastSeason,
  } = useTeam();
  const { viewingPlayerId, setViewingPlayerId } = useUI();
  const {
    players,
    games,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    currentSeason,
    pitchingFormat,
    defenseSize,
  } = team;
  const [activeProfileTab, setActiveProfileTab] = useState("general");
  const [editingContact, setEditingContact] = useState(false);
  const [editingPlayerName, setEditingPlayerName] = useState(false);
  const [tempPlayerName, setTempPlayerName] = useState("");
  const [showTimeline, setShowTimeline] = useState(false);
  const [trendStatKey, setTrendStatKey] = useState(null); // key of stat whose year-over-year chart is open
  const [addingPastSeason, setAddingPastSeason] = useState(false);
  const [editingPastSeasonId, setEditingPastSeasonId] = useState(null);

  // Aggregate fielding history across FINAL games only (matches engine fairness logic).
  // Returns { byPosition: {P: 4, C: 2, ...}, bench, firstInningBench, totalDefensive,
  //           gamesPlayed, gamesAvailable }.
  const inningsBreakdown = useMemo(() => {
    const byPosition = {};
    let bench = 0;
    let firstInningBench = 0;
    let totalDefensive = 0;
    let gamesPlayed = 0;
    let gamesAvailable = 0;
    const pid = viewingPlayerId;
    if (!pid)
      return {
        byPosition,
        bench,
        firstInningBench,
        totalDefensive,
        gamesPlayed,
        gamesAvailable,
      };

    for (const g of games || []) {
      // Only finalized games count
      if ((g.status || "scheduled") !== "final") continue;
      if (!g.lineup?.length) continue;

      // Did this player attend the game?
      const present = g.attendance?.[pid] !== false;
      if (!present) continue;
      gamesAvailable++;

      let appearedThisGame = false;

      // First-inning bench check
      const firstBench = g.lineup[0]?.BENCH || [];
      if (firstBench.some((p) => p?.id === pid)) firstInningBench++;

      // Walk every inning
      for (const inning of g.lineup) {
        // Position appearances
        for (const pos in inning) {
          if (pos === "BENCH") continue;
          if (inning[pos]?.id === pid) {
            byPosition[pos] = (byPosition[pos] || 0) + 1;
            totalDefensive++;
            appearedThisGame = true;
          }
        }
        // Bench appearances
        const benchList = inning.BENCH || [];
        if (benchList.some((p) => p?.id === pid)) {
          bench++;
          appearedThisGame = true;
        }
      }
      if (appearedThisGame) gamesPlayed++;
    }
    return {
      byPosition,
      bench,
      firstInningBench,
      totalDefensive,
      gamesPlayed,
      gamesAvailable,
    };
  }, [games, viewingPlayerId]);

  // Per-game timeline for this player. Final games only, sorted by date desc.
  // Each entry: { id, date, opponent, result, score, positions, batOrder, benchInnings, totalInnings }
  const timeline = useMemo(() => {
    const out = [];
    const pid = viewingPlayerId;
    if (!pid) return out;
    for (const g of games || []) {
      if ((g.status || "scheduled") !== "final") continue;
      if (!g.lineup?.length) continue;
      if (g.attendance?.[pid] === false) continue;

      const positionsPlayed = {};
      let benchInnings = 0;
      let totalInnings = 0;
      for (const inning of g.lineup) {
        let inThisInning = false;
        for (const pos in inning) {
          if (pos === "BENCH") continue;
          if (inning[pos]?.id === pid) {
            positionsPlayed[pos] = (positionsPlayed[pos] || 0) + 1;
            totalInnings++;
            inThisInning = true;
          }
        }
        if (!inThisInning) {
          const benchList = inning.BENCH || [];
          if (benchList.some((bp) => bp?.id === pid)) {
            benchInnings++;
          }
        }
      }
      // Skip if player wasn't on the field or bench at all
      if (totalInnings === 0 && benchInnings === 0) continue;

      const batOrderIdx = (g.battingLineup || []).findIndex(
        (bp) => bp?.id === pid
      );
      const ts = Number(g.teamScore),
        os = Number(g.opponentScore);
      const hasScore = Number.isFinite(ts) && Number.isFinite(os);
      const result = hasScore ? (ts > os ? "W" : ts < os ? "L" : "T") : null;

      out.push({
        id: g.id,
        date: g.date,
        opponent: g.opponent,
        result,
        score: hasScore ? `${ts}-${os}` : null,
        positions: positionsPlayed,
        batOrder: batOrderIdx >= 0 ? batOrderIdx + 1 : null,
        benchInnings,
        totalInnings,
      });
    }
    out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return out;
  }, [games, viewingPlayerId]);

  const player = players.find((p) => p.id === viewingPlayerId);
  if (!player) return null;

  const positions =
    defenseSize === "10"
      ? ALL_POSITIONS
      : ALL_POSITIONS.filter((p) => p !== "LCF" && p !== "RCF")
          .concat(["CF"])
          .filter((v, i, a) => a.indexOf(v) === i);

  const close = () => {
    setViewingPlayerId(null);
    setActiveProfileTab("general");
    setEditingContact(false);
    setEditingPlayerName(false);
    setTrendStatKey(null);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm overflow-y-auto"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
        <div className="p-6 sm:p-7 flex flex-col sm:flex-row items-start gap-5 border-b border-slate-100">
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center font-black text-3xl sm:text-4xl shadow-inner shrink-0"
            style={{
              backgroundColor: `${primaryColor}15`,
              color: primaryColor,
            }}
          >
            {player.number || "?"}
          </div>
          <div className="flex-1 w-full">
            {editingPlayerName ? (
              <input
                type="text"
                value={tempPlayerName}
                autoFocus
                onChange={(e) => setTempPlayerName(e.target.value)}
                onBlur={() => {
                  if (
                    tempPlayerName.trim() &&
                    tempPlayerName.trim() !== player.name
                  )
                    updatePlayer(player.id, { name: tempPlayerName.trim() });
                  setEditingPlayerName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") setEditingPlayerName(false);
                }}
                className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-slate-900 mb-1 w-full p-2 -ml-2 border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500 rounded-xl bg-white shadow-inner"
              />
            ) : (
              <h2
                onClick={() => {
                  setTempPlayerName(player.name);
                  setEditingPlayerName(true);
                }}
                className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-slate-900 mb-1 truncate cursor-pointer hover:bg-blue-50 px-2 py-1 -ml-2 rounded-xl transition-colors"
              >
                {player.name}
              </h2>
            )}
            <p className="text-xs uppercase tracking-widest text-slate-500 font-extrabold mb-3">
              Athlete Profile
            </p>
            <div className="flex gap-2 flex-wrap">
              <span
                className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg"
                style={{ backgroundColor: secondaryColor, color: primaryColor }}
              >
                P: {player.primaryPosition || "N/A"}
              </span>
              <span className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg bg-slate-100 text-slate-700">
                B/T: {player.bats || "R"}/{player.throws || "R"}
              </span>
              {player.dob && (
                <span className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg bg-slate-100 text-slate-700">
                  Age: {calculateBaseballAge(player.dob, currentSeason) || "?"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={close}
            className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mr-2 -mt-2 absolute top-6 right-4 sm:relative sm:top-0 sm:right-0"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-white border-b border-slate-200 flex-shrink-0">
          <div className="flex overflow-x-auto px-6 sm:px-7 scrollbar-hide">
            {PROFILE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveProfileTab(t.id)}
                className={`py-3.5 px-4 font-extrabold text-[10px] uppercase tracking-widest whitespace-nowrap relative transition-colors border-b-2 ${
                  activeProfileTab === t.id
                    ? "text-slate-900"
                    : "text-slate-400 border-transparent hover:text-slate-700"
                }`}
                style={
                  activeProfileTab === t.id ? { borderColor: primaryColor } : {}
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 bg-slate-50/50">
          {activeProfileTab === "general" && (
            <div className="p-6 sm:p-7 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    Number
                  </label>
                  <input
                    type="text"
                    value={player.number || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, { number: e.target.value })
                    }
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    Bats
                  </label>
                  <select
                    value={player.bats || "R"}
                    onChange={(e) =>
                      updatePlayer(player.id, { bats: e.target.value })
                    }
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-sm"
                  >
                    <option value="R">R</option>
                    <option value="L">L</option>
                    <option value="S">S</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    Throws
                  </label>
                  <select
                    value={player.throws || "R"}
                    onChange={(e) =>
                      updatePlayer(player.id, { throws: e.target.value })
                    }
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-sm"
                  >
                    <option value="R">R</option>
                    <option value="L">L</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={player.dob || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, { dob: e.target.value })
                    }
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    Primary Pos
                  </label>
                  <select
                    value={player.primaryPosition || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, {
                        primaryPosition: e.target.value,
                      })
                    }
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-sm"
                  >
                    <option value="">N/A</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                  Position Restrictions
                </label>
                <p className="text-[11px] text-slate-500 font-medium mb-3">
                  Click positions this player should NOT play.
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                  {positions.map((pos) => {
                    const isRestricted =
                      player.restrictions && player.restrictions.includes(pos);
                    return (
                      <button
                        key={pos}
                        onClick={() => {
                          const next = isRestricted
                            ? (player.restrictions || []).filter(
                                (p) => p !== pos
                              )
                            : [...(player.restrictions || []), pos];
                          updatePlayer(player.id, { restrictions: next });
                        }}
                        className={`p-2 text-xs font-black uppercase rounded-lg transition-all border ${
                          isRestricted
                            ? "bg-red-50 border-red-200 text-red-700 line-through shadow-sm"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {pos}
                      </button>
                    );
                  })}
                </div>
              </div>

              {pitchingFormat === "Kid Pitch" && (
                <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm">
                  <h4 className="font-black text-xs uppercase tracking-widest text-slate-700 mb-4 flex items-center gap-2">
                    <Icons.Pitch className="w-4 h-4" /> Recent Pitching
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        Pitches Last Game
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={player.pitching?.recentPitches || 0}
                        onChange={(e) =>
                          updatePlayerNested(player.id, "pitching", {
                            recentPitches: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="w-full p-2.5 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-100 disabled:text-slate-500 shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        Last Date Pitched
                      </label>
                      <input
                        type="date"
                        value={player.pitching?.lastPitchDate || ""}
                        onChange={(e) =>
                          updatePlayerNested(player.id, "pitching", {
                            lastPitchDate: e.target.value,
                          })
                        }
                        className="w-full p-2.5 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-100 disabled:text-slate-500 shadow-inner"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeProfileTab === "report" && (
            <div className="p-6 sm:p-7 space-y-6">
              {/* Lineup Settings — editable engine inputs */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h4 className="font-black text-[11px] uppercase tracking-widest text-slate-700 mb-4 flex items-center gap-2">
                  <Icons.Settings className="w-4 h-4" /> Lineup Settings
                </h4>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Throws
                    </label>
                    <select
                      value={player.throws || "R"}
                      onChange={(e) =>
                        updatePlayer(player.id, { throws: e.target.value })
                      }
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm disabled:bg-slate-50"
                    >
                      <option value="R">R</option>
                      <option value="L">L</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Primary Position
                    </label>
                    <select
                      value={player.primaryPosition || ""}
                      onChange={(e) =>
                        updatePlayer(player.id, {
                          primaryPosition: e.target.value,
                        })
                      }
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm disabled:bg-slate-50"
                    >
                      <option value="">N/A</option>
                      {positions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                  Position Restrictions
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {positions.map((pos) => {
                    const isRestricted = (player.restrictions || []).includes(
                      pos
                    );
                    return (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => {
                          const next = isRestricted
                            ? (player.restrictions || []).filter(
                                (p) => p !== pos
                              )
                            : [...(player.restrictions || []), pos];
                          updatePlayer(player.id, { restrictions: next });
                        }}
                        className={`p-2 text-xs font-black uppercase rounded-lg transition-all border ${
                          isRestricted
                            ? "bg-red-50 border-red-200 text-red-700 line-through shadow-sm"
                            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {pos}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Current season summary */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-black text-[11px] uppercase tracking-widest text-slate-700 flex items-center gap-2">
                    <Icons.Bat className="w-4 h-4" /> {currentSeason}
                  </h4>
                </div>

                {/* Hitting */}
                <div className="mb-5">
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Hitting
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { label: "AVG", v: formatStat(player.stats?.avg) },
                      { label: "OBP", v: formatStat(player.stats?.obp) },
                      { label: "OPS", v: formatStat(player.stats?.ops) },
                      { label: "H", v: player.stats?.h || 0 },
                      { label: "HR", v: player.stats?.hr || 0 },
                      { label: "RBI", v: player.stats?.rbi || 0 },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-slate-50 rounded-lg p-2 text-center"
                      >
                        <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
                          {s.label}
                        </div>
                        <div className="text-sm font-black tabular-nums text-slate-900">
                          {s.v}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pitching (only when team is Kid Pitch) */}
                {pitchingFormat === "Kid Pitch" && (
                  <div className="mb-5">
                    <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                      Pitching
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { label: "IP", v: player.stats?.ip || 0 },
                        { label: "ERA", v: formatStat(player.stats?.era) },
                        { label: "TP", v: player.stats?.totalPitches || 0 },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className="bg-slate-50 rounded-lg p-2 text-center"
                        >
                          <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
                            {s.label}
                          </div>
                          <div className="text-sm font-black tabular-nums text-slate-900">
                            {s.v}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fielding */}
                <div>
                  <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Fielding
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { label: "FPCT", v: formatStat(player.stats?.fpct) },
                      { label: "TC", v: player.stats?.tc || 0 },
                      { label: "PO", v: player.stats?.po || 0 },
                      { label: "A", v: player.stats?.a || 0 },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-slate-50 rounded-lg p-2 text-center"
                      >
                        <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
                          {s.label}
                        </div>
                        <div className="text-sm font-black tabular-nums text-slate-900">
                          {s.v}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Position innings — reused from Innings Played tab logic */}
              {inningsBreakdown.gamesAvailable > 0 &&
                (() => {
                  const entries = Object.entries(
                    inningsBreakdown.byPosition
                  ).sort((a, b) => b[1] - a[1]);
                  const maxCount = entries[0]?.[1] || 1;
                  return (
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                      <h4 className="font-black text-[11px] uppercase tracking-widest text-slate-700 mb-4 flex items-center gap-2">
                        <Icons.Glove className="w-4 h-4" /> Innings by Position
                      </h4>
                      {entries.length === 0 ? (
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center py-3">
                          All Innings on Bench
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entries.map(([pos, count]) => {
                            const pct = (count / maxCount) * 100;
                            return (
                              <div
                                key={pos}
                                className="flex items-center gap-3"
                              >
                                <div className="w-10 text-[11px] font-black uppercase tracking-widest text-slate-700 shrink-0">
                                  {pos}
                                </div>
                                <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
                                  <div
                                    className="h-full rounded-md transition-all"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: primaryColor,
                                      opacity: 0.85,
                                    }}
                                  />
                                </div>
                                <div className="w-8 text-right text-sm font-black tabular-nums text-slate-800 shrink-0">
                                  {count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Past Seasons */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-black text-[11px] uppercase tracking-widest text-slate-700 flex items-center gap-2">
                    <Icons.Clock className="w-4 h-4" /> Past Seasons
                  </h4>
                  {!addingPastSeason && (
                    <button
                      type="button"
                      onClick={() => setAddingPastSeason(true)}
                      className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-1.5"
                    >
                      <Icons.Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  )}
                </div>

                {addingPastSeason && (
                  <PastSeasonForm
                    primaryColor={primaryColor}
                    tertiaryColor={tertiaryColor}
                    onCancel={() => setAddingPastSeason(false)}
                    onSave={(entry) => {
                      addPastSeason(player.id, entry);
                      setAddingPastSeason(false);
                    }}
                  />
                )}

                {(player.pastSeasons || []).length === 0 &&
                !addingPastSeason ? (
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center py-4">
                    No Past Seasons On File
                  </div>
                ) : (
                  <div className="space-y-2 mt-3">
                    {(player.pastSeasons || []).map((entry) => {
                      const isEditing = editingPastSeasonId === entry.id;
                      if (isEditing) {
                        return (
                          <PastSeasonForm
                            key={entry.id}
                            initial={entry}
                            primaryColor={primaryColor}
                            tertiaryColor={tertiaryColor}
                            onCancel={() => setEditingPastSeasonId(null)}
                            onSave={(patch) => {
                              updatePastSeason(player.id, entry.id, patch);
                              setEditingPastSeasonId(null);
                            }}
                            onDelete={() => {
                              removePastSeason(player.id, entry.id);
                              setEditingPastSeasonId(null);
                            }}
                          />
                        );
                      }
                      const showPitching = entry.pitchingFormat === "Kid Pitch";
                      return (
                        <div
                          key={entry.id}
                          className="bg-slate-50 border border-slate-200 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                              <div className="text-sm font-black text-slate-900 uppercase">
                                {entry.season}
                              </div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                {entry.ageGroup} · {entry.pitchingFormat}
                                {entry.record &&
                                entry.record.wins +
                                  entry.record.losses +
                                  entry.record.ties >
                                  0
                                  ? ` · Team ${entry.record.wins}-${
                                      entry.record.losses
                                    }${
                                      entry.record.ties > 0
                                        ? "-" + entry.record.ties
                                        : ""
                                    }`
                                  : ""}
                              </div>
                            </div>
                            
                              <button
                                type="button"
                                onClick={() => setEditingPastSeasonId(entry.id)}
                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                              >
                                <Icons.Edit className="w-4 h-4" />
                              </button>
                            
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {[
                              { label: "AVG", v: formatStat(entry.stats?.avg) },
                              { label: "OBP", v: formatStat(entry.stats?.obp) },
                              { label: "OPS", v: formatStat(entry.stats?.ops) },
                              { label: "H", v: entry.stats?.h || 0 },
                              { label: "HR", v: entry.stats?.hr || 0 },
                              { label: "RBI", v: entry.stats?.rbi || 0 },
                            ].map((s) => (
                              <div
                                key={s.label}
                                className="bg-white rounded-lg p-2 text-center border border-slate-200"
                              >
                                <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
                                  {s.label}
                                </div>
                                <div className="text-sm font-black tabular-nums text-slate-900">
                                  {s.v}
                                </div>
                              </div>
                            ))}
                          </div>
                          {showPitching &&
                          (entry.stats?.ip ||
                            entry.stats?.era ||
                            entry.stats?.totalPitches) ? (
                            <div className="grid grid-cols-3 gap-2 mt-2">
                              {[
                                { label: "IP", v: entry.stats?.ip || 0 },
                                {
                                  label: "ERA",
                                  v: formatStat(entry.stats?.era),
                                },
                                {
                                  label: "TP",
                                  v: entry.stats?.totalPitches || 0,
                                },
                              ].map((s) => (
                                <div
                                  key={s.label}
                                  className="bg-white rounded-lg p-2 text-center border border-slate-200"
                                >
                                  <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">
                                    {s.label}
                                  </div>
                                  <div className="text-sm font-black tabular-nums text-slate-900">
                                    {s.v}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Game-by-game timeline (collapsed by default) */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTimeline((s) => !s)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Icons.Calendar className="w-4 h-4 text-slate-700" />
                    <span className="font-black text-[11px] uppercase tracking-widest text-slate-700">
                      Game by Game
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      ({timeline.length})
                    </span>
                  </div>
                  {showTimeline ? (
                    <Icons.ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                {showTimeline &&
                  (timeline.length === 0 ? (
                    <div className="px-5 pb-5 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                      No Final Games On File
                    </div>
                  ) : (
                    <div className="border-t border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto custom-scrollbar">
                      {timeline.map((g) => {
                        const positions = Object.entries(g.positions)
                          .sort((a, b) => b[1] - a[1])
                          .map(([p, c]) => `${p}×${c}`)
                          .join(" ");
                        return (
                          <div
                            key={g.id}
                            className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-black text-slate-800 uppercase truncate">
                                  vs. {g.opponent}
                                </span>
                                {g.result && (
                                  <span
                                    className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded tabular-nums ${
                                      g.result === "W"
                                        ? "bg-green-100 text-green-800"
                                        : g.result === "L"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {g.result} {g.score}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                {formatGameDateDisplay(g.date)}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] font-bold text-slate-700 tabular-nums">
                                {positions || "Bench"}
                              </div>
                              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                {g.batOrder ? `Bat ${g.batOrder} · ` : ""}
                                {g.benchInnings} bench
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {activeProfileTab === "stats" && (
            <div className="p-6 sm:p-7 space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <Icons.Bat className="w-4 h-4" /> Season Statistics
                </h4>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Tap a stat for trend
                </span>
              </div>

              {["hitting", "pitching", "fielding"].map((category) => {
                // Skip pitching section if team isn't running Kid Pitch
                if (category === "pitching" && pitchingFormat !== "Kid Pitch")
                  return null;
                const keys = STATS_TAB_KEYS.filter(
                  (k) => STAT_META[k]?.category === category
                );
                if (keys.length === 0) return null;
                return (
                  <div
                    key={category}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm"
                  >
                    <h5 className="font-black text-[11px] uppercase tracking-widest text-slate-700 mb-3 capitalize">
                      {category}
                    </h5>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                      {keys.map((key) => {
                        const value = player.stats?.[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setTrendStatKey(key)}
                            className="group bg-slate-50 hover:bg-blue-50 hover:border-blue-200 border border-transparent rounded-lg p-2 text-center transition-colors cursor-pointer"
                          >
                            <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-0.5">
                              {STAT_META[key].label}
                            </div>
                            <div className="text-sm font-black tabular-nums text-slate-900 group-hover:text-blue-700">
                              {formatStatValue(key, value)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeProfileTab === "innings" && (
            <div className="p-6 sm:p-7 space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <Icons.Glove className="w-4 h-4" /> Defensive Innings
                </h4>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  From Final games only
                </span>
              </div>

              {inningsBreakdown.gamesAvailable === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
                  <Icons.Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-black uppercase tracking-widest text-slate-500 mb-1">
                    No Game History Yet
                  </p>
                  <p className="text-xs text-slate-500 font-medium">
                    Mark games as Final on the Schedule tab to start tracking
                    innings here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        Games Played
                      </div>
                      <div className="text-2xl font-black text-slate-900 tabular-nums">
                        {inningsBreakdown.gamesPlayed}
                        <span className="text-sm text-slate-400 font-bold">
                          /{inningsBreakdown.gamesAvailable}
                        </span>
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        Defensive Inn.
                      </div>
                      <div className="text-2xl font-black text-slate-900 tabular-nums">
                        {inningsBreakdown.totalDefensive}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        Bench Inn.
                      </div>
                      <div className="text-2xl font-black text-slate-900 tabular-nums">
                        {inningsBreakdown.bench}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                        1st Inn. Bench
                      </div>
                      <div className="text-2xl font-black text-slate-900 tabular-nums">
                        {inningsBreakdown.firstInningBench}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <h5 className="font-black text-[11px] uppercase tracking-widest text-slate-700 mb-4">
                      By Position
                    </h5>
                    {(() => {
                      const entries = Object.entries(
                        inningsBreakdown.byPosition
                      ).sort((a, b) => b[1] - a[1]);
                      if (entries.length === 0) {
                        return (
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center py-4">
                            All Innings on Bench
                          </div>
                        );
                      }
                      const maxCount = entries[0][1];
                      return (
                        <div className="space-y-2.5">
                          {entries.map(([pos, count]) => {
                            const pct = (count / maxCount) * 100;
                            return (
                              <div
                                key={pos}
                                className="flex items-center gap-3"
                              >
                                <div className="w-10 text-[11px] font-black uppercase tracking-widest text-slate-700 shrink-0">
                                  {pos}
                                </div>
                                <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden relative">
                                  <div
                                    className="h-full rounded-md transition-all"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: primaryColor,
                                      opacity: 0.85,
                                    }}
                                  />
                                </div>
                                <div className="w-10 text-right text-sm font-black tabular-nums text-slate-800 shrink-0">
                                  {count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {activeProfileTab === "contact" && (
            <div className="p-6 sm:p-7 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-black text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <Icons.User className="w-4 h-4" /> Family Contact
                </h4>
                
                  <button
                    onClick={() => setEditingContact(!editingContact)}
                    className="text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                  >
                    {editingContact ? "Done" : "Edit"}
                  </button>
                
              </div>
              {[
                { key: "parentName", label: "Parent / Guardian Name" },
                { key: "phone", label: "Phone Number" },
                { key: "email", label: "Email Address" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={player[key] || ""}
                    disabled={!editingContact}
                    onChange={(e) =>
                      updatePlayer(player.id, { [key]: e.target.value })
                    }
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold disabled:bg-slate-50 disabled:text-slate-500 shadow-inner"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border-t border-slate-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
          
            <button
              onClick={() =>
                updatePlayer(player.id, { present: player.present === false })
              }
              className={`text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl transition-colors shadow-sm border ${
                player.present === false
                  ? "bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                  : "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200"
              }`}
            >
              {player.present === false ? "MARK ACTIVE" : "MARK INACTIVE"}
            </button>
          
          <div className="flex gap-3 ml-auto">
            
              <button
                onClick={() => removePlayer(player.id)}
                className="text-[10px] font-black uppercase tracking-widest bg-white border border-red-200 text-red-700 hover:bg-red-50 px-4 py-2.5 rounded-xl shadow-sm transition-colors flex items-center gap-2"
              >
                <Icons.Trash className="w-3.5 h-3.5" /> Delete
              </button>
            
            <button
              onClick={close}
              className="text-[10px] font-black uppercase tracking-widest text-white px-4 py-2.5 rounded-xl shadow-md transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
      {trendStatKey && (
        <StatTrendModal
          statKey={trendStatKey}
          player={player}
          currentSeason={currentSeason}
          currentPitchingFormat={pitchingFormat}
          primaryColor={primaryColor}
          tertiaryColor={tertiaryColor}
          onClose={() => setTrendStatKey(null)}
        />
      )}
    </div>
  );
});

/* ============================================================================
   SECTION 16 · AddPlayerModal
============================================================================ */
const AddPlayerModal = memo(() => {
  const { team, addPlayer } = useTeam();
  const { isAddingPlayer, setIsAddingPlayer } = useUI();
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
    primaryPosition: "",
  });

  if (!isAddingPlayer) return null;

  const close = () => {
    setIsAddingPlayer(false);
    setForm({
      name: "",
      number: "",
      bats: "R",
      throws: "R",
      primaryPosition: "",
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addPlayer(form);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-white/50"
      >
        <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
        <form onSubmit={submit} className="p-6 sm:p-7 space-y-4">
          <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight mb-2">
            Add Player
          </h3>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Name *
            </label>
            <input
              autoFocus
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-inner"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Number
              </label>
              <input
                type="text"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-inner"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Bats
              </label>
              <select
                value={form.bats}
                onChange={(e) => setForm({ ...form, bats: e.target.value })}
                className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-sm"
              >
                <option>R</option>
                <option>L</option>
                <option>S</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                Throws
              </label>
              <select
                value={form.throws}
                onChange={(e) => setForm({ ...form, throws: e.target.value })}
                className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-sm"
              >
                <option>R</option>
                <option>L</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
              Primary Position
            </label>
            <select
              value={form.primaryPosition}
              onChange={(e) =>
                setForm({ ...form, primaryPosition: e.target.value })
              }
              className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-sm"
            >
              <option value="">N/A</option>
              {ALL_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-3 justify-end">
            <button
              type="button"
              onClick={close}
              className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Add Player
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

/* ============================================================================
   SECTION 17 · TeamProvider — owns team state, Firebase subscriptions, actions
   This replaces the prop-drilled state/actions object in the original.
============================================================================ */
const TeamProvider = ({ children }) => {
  const toast = useToast();

  // Auth + team-list state
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [teamData, setTeamData] = useState(DEFAULT_TEAM_DATA);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingActive, setLoadingActive] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [genError, setGenError] = useState(""); // login screen only

  const previousLineupRef = useRef(null);

  // Auth subscription
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokenFromHost = (typeof window !== "undefined" && window.__initial_auth_token) || null;
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
      "teams"
    );
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        let data = snap.exists() ? snap.data() : null;
        if (!data || !data.teams || data.teams.length === 0) {
          // Bootstrap: create first team for this user
          const id = "team-" + Math.random().toString(36).substring(2, 10);
          const teamRef = doc(
            db,
            "artifacts",
            appId,
            "public",
            "data",
            "teams",
            id
          );
          try {
            await setDoc(teamRef, {
              ...DEFAULT_TEAM_DATA,
              name: "My Team",
              ownerId: user.uid,
              members: [user.uid],
            });
            await setDoc(ref, {
              teams: [{ id, name: "My Team" }],
              activeTeamId: id,
            });
          } catch (e) {
            toast.push({
              kind: "error",
              title: "Setup failed",
              message: e.message,
            });
          }
          return;
        }
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
    if (!activeTeamId) return;
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
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setTeamData({ ...DEFAULT_TEAM_DATA, ...snap.data() });
        }
        setLoadingActive(false);
      },
      (err) => {
        toast.push({
          kind: "error",
          title: "Failed to load team",
          message: err.message,
        });
        setLoadingActive(false);
      }
    );
    return () => unsub();
  }, [activeTeamId, toast]);

  // Helper: write a partial update to the active team document
  const persistTeam = useCallback(
    async (updates) => {
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
      } catch (e) {
        setSyncStatus("");
        toast.push({ kind: "error", title: "Save failed", message: e.message });
      }
    },
    [activeTeamId, toast]
  );

  const updateTeam = useCallback(
    (updates) => {
      setTeamData((prev) => ({ ...prev, ...updates })); // optimistic
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
    const updates = {};
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
    (form) => {
      const newPlayer = {
        id: "p-" + Math.random().toString(36).substring(2, 10),
        name: form.name.trim(),
        number: form.number || "",
        bats: form.bats || "R",
        throws: form.throws || "R",
        primaryPosition: form.primaryPosition || "",
        present: true,
        restrictions: [],
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      updateTeam({ players: [...teamData.players, newPlayer] });
    },
    [teamData.players, updateTeam]
  );

  const updatePlayer = useCallback(
    (id, updates) => {
      const next = teamData.players.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const updatePlayerNested = useCallback(
    (id, key, updates) => {
      const next = teamData.players.map((p) =>
        p.id === id ? { ...p, [key]: { ...(p[key] || {}), ...updates } } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const removePlayer = useCallback(
    (id) => {
      if (!window.confirm("Remove this player from the roster?")) return;

      // Strip the player out of every shape that holds player references —
      // otherwise stat aggregation, the In-Game view, and PDF lineups will
      // surface phantom names long after the player is "removed".
      const stripFromInning = (inning) => {
        if (!inning || typeof inning !== "object") return inning;
        const out = {};
        for (const pos in inning) {
          if (pos === "BENCH") {
            out.BENCH = (inning.BENCH || []).filter(
              (p) => p && p.id !== id
            );
          } else {
            const slot = inning[pos];
            out[pos] = slot && slot.id === id ? null : slot;
          }
        }
        return out;
      };

      const stripFromGame = (g) => {
        const next = { ...g };
        if (Array.isArray(g.lineup)) next.lineup = g.lineup.map(stripFromInning);
        if (Array.isArray(g.originalLineup))
          next.originalLineup = g.originalLineup.map(stripFromInning);
        if (Array.isArray(g.battingLineup))
          next.battingLineup = g.battingLineup.filter(
            (p) => p && p.id !== id
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

      const stripFromEvent = (ev) => {
        if (!ev?.grades || !(id in ev.grades)) return ev;
        const { [id]: _dropG, ...rest } = ev.grades;
        return { ...ev, grades: rest };
      };

      updateTeam({
        players: teamData.players.filter((p) => p.id !== id),
        games: (teamData.games || []).map(stripFromGame),
        evaluationEvents: (teamData.evaluationEvents || []).map(stripFromEvent),
      });
    },
    [teamData.players, teamData.games, teamData.evaluationEvents, updateTeam]
  );

  // Add a past-season entry to a single player.
  const addPastSeason = useCallback(
    (playerId, entry) => {
      const next = teamData.players.map((p) => {
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
    (playerId, entryId, patch) => {
      const next = teamData.players.map((p) => {
        if (p.id !== playerId) return p;
        const past = (p.pastSeasons || []).map((e) => {
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
    (playerId, entryId) => {
      if (
        !window.confirm("Remove this past season entry? This cannot be undone.")
      )
        return;
      const next = teamData.players.map((p) => {
        if (p.id !== playerId) return p;
        return {
          ...p,
          pastSeasons: (p.pastSeasons || []).filter((e) => e.id !== entryId),
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
    (assignments) => {
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
      const next = teamData.players.map((p) => {
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
    (form) => {
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
    (id) => {
      updateTeam({ coaches: teamData.coaches.filter((c) => c.id !== id) });
    },
    [teamData.coaches, updateTeam]
  );

  // ----- Game actions -----
  const addGame = useCallback(
    (form) => {
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
    (gameId, updates) => {
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
      const next = teamData.games.map((g) =>
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
    (game) => {
      const pitchCounts = game?.pitchCounts || {};
      const pitchedPlayerIds = Object.keys(pitchCounts).filter(
        (pid) => Number.isFinite(pitchCounts[pid]) && pitchCounts[pid] > 0
      );
      if (pitchedPlayerIds.length === 0 || !game.date) {
        return teamData.players;
      }
      return teamData.players.map((p) => {
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
    (gameId) => {
      const game = teamData.games.find((g) => g.id === gameId);
      if (!game) return;
      const nextPlayers = commitPitchCountsToPlayers(game);
      const nextGames = teamData.games.map((g) =>
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
    (gameId, teamScore, opponentScore, inningsPlayed) => {
      const game = teamData.games.find((g) => g.id === gameId);
      if (!game) return;
      const gameUpdates = {
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
        const nextGames = teamData.games.map((g) =>
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
    (gameId) => {
      if (!window.confirm("Delete this game?")) return;
      updateTeam({ games: teamData.games.filter((g) => g.id !== gameId) });
    },
    [teamData.games, updateTeam]
  );

  // ----- Lineup generation (uses the engine) -----
  // The UI sets these via useUI() and we read them at call time via a ref pattern,
  // but to keep things simple we pass them in to a closure exposed via a ref.
  const uiBridge = useRef({ getInputs: () => null, applyResult: () => {} });

  const _runGenerate = useCallback(
    (seed, options = {}) => {
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
        (p) => currentGameAttendance[p.id] !== false
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
      const showAsRelaxed = relaxFairness || internallyRelaxed;
      const successMessage = internallyRelaxed
        ? "Couldn't satisfy strict fairness — built without past games. Catch up over future games."
        : relaxFairness
        ? "Built without considering past games. Some kids may bench more than others this season."
        : hasPrev
        ? "Tap Undo to restore the previous lineup."
        : "";
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
    [teamData, toast]
  );

  const generateLineup = useCallback(
    () => _runGenerate(Date.now()),
    [_runGenerate]
  );
  const regenerateLineup = useCallback(
    () => _runGenerate(Date.now() + Math.floor(Math.random() * 1e6)),
    [_runGenerate]
  );
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
    const { currentGame, currentGameAttendance, lineup, battingLineup } =
      inputs;
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
    });
    toast.push({ kind: "success", title: "Game saved" });
    uiBridge.current.markSaved?.();
  }, [updateGame, toast]);

  // ----- Team management -----
  const switchTeam = useCallback(
    async (id) => {
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
      } catch (e) {
        /* non-fatal */
      }
    },
    [user]
  );

  const createTeam = useCallback(
    async (name) => {
      if (!user || !name.trim()) return;
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
      } catch (e) {
        setSyncStatus("");
        toast.push({
          kind: "error",
          title: "Could not create team",
          message: e.message,
        });
      }
    },
    [user, teams, toast]
  );

  const joinTeam = useCallback(
    async (id) => {
      if (!user || !id.trim()) return;
      const cleanId = id.trim();
      setSyncStatus("Joining");
      try {
        const teamRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          cleanId
        );
        const snap = await getDoc(teamRef);
        if (!snap.exists()) {
          toast.push({ kind: "error", title: "Team not found" });
          setSyncStatus("");
          return;
        }
        const data = snap.data();
        const members = Array.isArray(data.members) ? data.members : [];
        if (!members.includes(user.uid))
          await setDoc(
            teamRef,
            { members: [...members, user.uid] },
            { merge: true }
          );
        const userRef = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams"
        );
        const newEntry = { id: cleanId, name: data.name || "Joined Team" };
        const exists = teams.some((t) => t.id === cleanId);
        const nextTeams = exists ? teams : [...teams, newEntry];
        await setDoc(
          userRef,
          { teams: nextTeams, activeTeamId: cleanId },
          { merge: true }
        );
        toast.push({ kind: "success", title: "Joined team" });
        setSyncStatus("");
      } catch (e) {
        setSyncStatus("");
        toast.push({
          kind: "error",
          title: "Could not join",
          message: e.message,
        });
      }
    },
    [user, teams, toast]
  );

  const advanceSeason = useCallback(() => {
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
      if (g.status !== "final") continue;
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

    // Confirmation
    const confirmMsg =
      `Archive ${archivedSeason} (${archivedAge}, ${archivedFormat})?\n\n` +
      `• ${playerCount} player${
        playerCount === 1 ? "" : "s"
      } will have stats archived to history\n` +
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

    if (!window.confirm(confirmMsg)) return;

    // Archive each player's current stats into pastSeasons[]. Keep all stat fields
    // unconditionally; the display layer hides pitching when format isn't Kid Pitch.
    const updatedPlayers = teamData.players.map((p) => {
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
      };
    });

    updateTeam({
      currentSeason: nextSeason,
      teamAge: newAgeGroup,
      players: updatedPlayers,
      games: [],
      evaluationEvents: [],
    });
    toast.push({
      kind: "success",
      title: `Advanced to ${nextSeason}`,
      message: shouldBump
        ? `Age group is now ${newAgeGroup}.`
        : `Age group stays ${newAgeGroup}.`,
    });
  }, [teamData, updateTeam, toast]);

  const uploadLogo = useCallback(
    (e) => {
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
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        // Estimate the team doc size — Firestore caps at 1 MB total.
        const approxSize = JSON.stringify({
          ...teamData,
          logoUrl: dataUrl,
        }).length;
        if (approxSize > 900_000) {
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

  const uploadScheduleCsv = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target.result;
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length < 2) throw new Error("File appears to be empty.");
          const headers = parseCsvLine(lines[0]).map((h) =>
            h.toLowerCase().trim()
          );
          const dateIdx = headers.findIndex((h) => h.includes("date"));
          const oppIdx = headers.findIndex(
            (h) => h.includes("opponent") || h.includes("home/away")
          );
          if (dateIdx === -1) throw new Error("Could not find a date column.");
          const newGames = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const rawDate = cols[dateIdx];
            if (!rawDate) continue;
            const isoDate = normalizeDateToIso(rawDate);
            if (!isoDate) continue;
            const opp = oppIdx !== -1 ? cols[oppIdx] : "TBD";
            newGames.push({
              id: "g-" + Math.random().toString(36).substring(2, 10),
              date: isoDate,
              opponent: opp || "TBD",
              leagueRuleSet: teamData.leagueRuleSet,
              pitchingFormat: teamData.pitchingFormat,
              defenseSize: teamData.defenseSize,
              battingSize: teamData.battingSize,
              positionLock: teamData.positionLock,
              lineup: null,
              battingLineup: null,
              attendance: {},
              status: "scheduled",
              teamScore: null,
              opponentScore: null,
            });
          }
          updateTeam({ games: [...teamData.games, ...newGames] });
          toast.push({
            kind: "success",
            title: `Imported ${newGames.length} games`,
          });
        } catch (err) {
          toast.push({
            kind: "error",
            title: "Schedule import failed",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [teamData, updateTeam, toast]
  );

  const uploadStatsCsv = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          // Strip UTF-8 BOM if present (GameChanger exports include one)
          const text = ev.target.result.replace(/^\uFEFF/, "");
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length < 2) throw new Error("Empty file.");

          // Detect GameChanger's two-row header layout. The first row is just
          // "Batting", "Pitching", "Fielding" section labels with most cells empty.
          // The second row has the real column names.
          let headerRowIndex = 0;
          const firstRow = parseCsvLine(lines[0]).map((h) =>
            h.toLowerCase().trim()
          );
          const filledFirstRow = firstRow.filter(Boolean).length;
          const hasSectionLabels = firstRow.some((h) =>
            ["batting", "pitching", "fielding"].includes(h)
          );
          if (hasSectionLabels && filledFirstRow < firstRow.length / 3) {
            headerRowIndex = 1;
          }
          const rawHeaders = parseCsvLine(lines[headerRowIndex]).map((h) =>
            h.toLowerCase().trim()
          );
          const idx = buildCsvHeaderIndex(rawHeaders);
          if (idx.fn === -1 && idx.ln === -1)
            throw new Error("Could not find name columns.");

          // Auto-detect file type by header signatures.
          // TeamSnap members export has "Contact 1 Name" / "Jersey Number" / "Position" with role values.
          // GameChanger stats export has "OPS" / "AVG" / "AB" with no contact columns.
          const isTeamSnap =
            idx.isTeamSnap || idx.parent !== -1 || idx.dob !== -1;
          const isGameChanger =
            !isTeamSnap && (idx.ops !== -1 || idx.avg !== -1 || idx.ab !== -1);

          if (!isTeamSnap && !isGameChanger) {
            throw new Error(
              "Unrecognized CSV format. Expected TeamSnap members export or GameChanger stats export."
            );
          }

          const next = [...teamData.players];
          let updated = 0,
            added = 0,
            skipped = 0;
          const dataStartIndex = headerRowIndex + 1;

          for (let i = dataStartIndex; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const fn = (idx.fn !== -1 ? cols[idx.fn] : "").trim();
            const ln = (idx.ln !== -1 ? cols[idx.ln] : "").trim();
            const name = `${fn} ${ln}`.trim();
            if (!name) continue;

            // Skip GameChanger summary/footer rows
            if (isGameChanger) {
              const lcFn = fn.toLowerCase();
              const lcLn = ln.toLowerCase();
              if (
                lcFn === "totals" ||
                lcLn === "totals" ||
                lcFn === "glossary" ||
                lcLn === "glossary" ||
                !ln /* GC always has Last */
              ) {
                continue;
              }
            }

            // Skip TeamSnap coach rows
            if (isTeamSnap && idx.position !== -1) {
              const role = (cols[idx.position] || "").toLowerCase();
              if (role.includes("coach") || role.includes("manager")) {
                skipped++;
                continue;
              }
            }

            const existingIndex = next.findIndex(
              (p) => p.name.toLowerCase() === name.toLowerCase()
            );

            if (isTeamSnap) {
              // Roster info only — never touch stats or pitching
              const rosterFields = {};
              if (idx.num !== -1 && cols[idx.num])
                rosterFields.number = cols[idx.num];
              if (idx.dob !== -1 && cols[idx.dob])
                rosterFields.dob = cols[idx.dob];
              if (idx.phone !== -1 && cols[idx.phone])
                rosterFields.phone = cols[idx.phone];
              if (idx.email !== -1 && cols[idx.email])
                rosterFields.email = cols[idx.email];
              if (idx.parent !== -1 && cols[idx.parent])
                rosterFields.parentName = cols[idx.parent];

              if (existingIndex >= 0) {
                next[existingIndex] = {
                  ...next[existingIndex],
                  ...rosterFields,
                };
                updated++;
              } else {
                next.push({
                  id: "p-" + Math.random().toString(36).substring(2, 10),
                  name,
                  number: rosterFields.number || "",
                  dob: rosterFields.dob || "",
                  phone: rosterFields.phone || "",
                  email: rosterFields.email || "",
                  parentName: rosterFields.parentName || "",
                  primaryPosition: "",
                  bats: "R",
                  throws: "R",
                  present: true,
                  restrictions: [],
                  stats: blankStats(),
                  pitching: { recentPitches: 0, lastPitchDate: null },
                });
                added++;
              }
              continue;
            }

            // GameChanger path — stats only.
            // Build a stats patch with ONLY fields actually present in this CSV.
            const statsPatch = {};
            const setNum = (key, colIdx) => {
              if (colIdx === -1) return;
              const raw = cols[colIdx];
              if (raw === undefined || raw === "" || raw === "-") return;
              const n = parseFloat(raw);
              if (!Number.isNaN(n)) statsPatch[key] = n;
            };
            const setInt = (key, colIdx) => {
              if (colIdx === -1) return;
              const raw = cols[colIdx];
              if (raw === undefined || raw === "" || raw === "-") return;
              const n = parseInt(raw, 10);
              if (!Number.isNaN(n)) statsPatch[key] = n;
            };
            const setPct = (key, colIdx) => {
              if (colIdx === -1) return;
              const raw = cols[colIdx];
              if (raw === undefined || raw === "" || raw === "-") return;
              statsPatch[key] = parsePercent(raw);
            };

            setNum("ops", idx.ops);
            setNum("obp", idx.obp);
            setNum("avg", idx.avg);
            setPct("contact", idx.contact);
            setInt("totalPitches", idx.tp);
            setNum("ip", idx.ip);
            setNum("era", idx.era);
            setInt("ab", idx.ab);
            setInt("h", idx.h);
            setInt("doubles", idx.doubles);
            setInt("triples", idx.triples);
            setInt("hr", idx.hr);
            setInt("rbi", idx.rbi);
            setNum("fpct", idx.fpct);
            setInt("tc", idx.tc);
            setInt("a", idx.a);
            setInt("po", idx.po);
            setPct("ld", idx.ld);
            setPct("fb", idx.fb);
            setPct("gb", idx.gb);
            setPct("hard", idx.hard);
            setPct("qab", idx.qab);
            setNum("babip", idx.babip);

            if (Object.keys(statsPatch).length === 0) continue;

            if (existingIndex >= 0) {
              // Merge stats over existing — preserves any field not in this CSV
              next[existingIndex] = {
                ...next[existingIndex],
                stats: {
                  ...(next[existingIndex].stats || blankStats()),
                  ...statsPatch,
                },
                // pitching state (recentPitches / lastPitchDate) is intentionally untouched
              };
              updated++;
            } else {
              // New player from a stats CSV — minimal record
              next.push({
                id: "p-" + Math.random().toString(36).substring(2, 10),
                name,
                number: idx.num !== -1 ? cols[idx.num] || "" : "",
                dob: "",
                phone: "",
                email: "",
                parentName: "",
                primaryPosition: "",
                bats: "R",
                throws: "R",
                present: true,
                restrictions: [],
                stats: { ...blankStats(), ...statsPatch },
                pitching: { recentPitches: 0, lastPitchDate: null },
              });
              added++;
            }
          }

          // ---- Pitch count sanity check (kid-pitch only) ----
          // For each pitcher whose CSV totalPitches changed since the last
          // import, compare the CSV delta against the sum of manual pitchCounts
          // entered for games played since that previous import. Mismatches
          // (>5 pitches off) raise a toast warning so the coach can investigate
          // and fix manually if needed. We do NOT auto-override anything.
          //
          // Skip entirely for machine-pitch teams: the totalPitches field is
          // still populated by GameChanger (scorers count pitches faced) but
          // no kid actually pitched, so there's nothing to validate.
          const teamFmt = (teamData.pitchingFormat || "").toLowerCase();
          const isMachinePitchTeam = teamFmt.includes("machine");
          const prevImportDate = teamData.lastCsvImportDate || "";
          const todayIso = new Date().toISOString().slice(0, 10);
          const sanityWarnings = [];
          if (!isMachinePitchTeam) {
            for (let pi = 0; pi < next.length; pi++) {
              const newPlayer = next[pi];
              const newTp = newPlayer.stats?.totalPitches;
              if (!Number.isFinite(newTp)) continue;
              const prevTp = newPlayer.pitching?.csvTotalPitches ?? 0;
              const csvDelta = newTp - prevTp;
              if (csvDelta <= 0) {
                // No new pitches this import; just update the stored TP and skip
                next[pi] = {
                  ...newPlayer,
                  pitching: {
                    ...(newPlayer.pitching || { recentPitches: 0, lastPitchDate: null }),
                    csvTotalPitches: newTp,
                  },
                };
                continue;
              }
              // Sum manual pitchCounts across games on/after the previous import
              let manualDelta = 0;
              for (const g of teamData.games) {
                if (!g.date) continue;
                if (prevImportDate && g.date < prevImportDate) continue;
                const cnt = g.pitchCounts?.[newPlayer.id];
                if (Number.isFinite(cnt)) manualDelta += cnt;
              }
              const diff = Math.abs(csvDelta - manualDelta);
              if (diff > 5) {
                sanityWarnings.push({
                  name: newPlayer.name,
                  csvDelta,
                  manualDelta,
                });
              }
              // Update stored TP regardless of warning state
              next[pi] = {
                ...newPlayer,
                pitching: {
                  ...(newPlayer.pitching || { recentPitches: 0, lastPitchDate: null }),
                  csvTotalPitches: newTp,
                },
              };
            }
          }

          updateTeam({ players: next, lastCsvImportDate: todayIso });
          const kind = isTeamSnap ? "Roster" : "Stats";
          let message = `${updated} updated, ${added} added.`;
          if (skipped > 0)
            message += ` (Skipped ${skipped} coach row${
              skipped === 1 ? "" : "s"
            }.)`;
          toast.push({ kind: "success", title: `${kind} imported`, message });
          // Surface each pitch-count discrepancy as its own warning toast.
          // duration: 0 = persistent (won't auto-dismiss). Coach taps the X to clear.
          for (const w of sanityWarnings) {
            toast.push({
              kind: "warn",
              duration: 0,
              title: `Pitch count mismatch: ${w.name}`,
              message: `CSV shows +${w.csvDelta} pitches since last import; you entered ${w.manualDelta}. Off by ${Math.abs(w.csvDelta - w.manualDelta)}.`,
            });
          }
        } catch (err) {
          toast.push({
            kind: "error",
            title: "CSV import failed",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [teamData, updateTeam, toast]
  );

  const exportBackup = useCallback(() => {
    const blob = new Blob([JSON.stringify(teamData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lineup-backup-${activeTeamId}-${getLocalDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [teamData, activeTeamId]);

  const importBackup = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!window.confirm("Replace this team's data with the backup file?")) {
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          updateTeam(data);
          toast.push({ kind: "success", title: "Backup restored" });
        } catch (err) {
          toast.push({
            kind: "error",
            title: "Could not parse backup",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [updateTeam, toast]
  );

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
    } catch (e) {
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
        const members = (data.members || []).filter((u) => u !== user.uid);
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
    } catch (e) {
      toast.push({
        kind: "error",
        title: "Could not leave",
        message: e.message,
      });
    }
  }, [user, teams, activeTeamId, toast]);

  const copyTeamCode = useCallback(() => {
    if (!activeTeamId) return;
    if (navigator.clipboard) navigator.clipboard.writeText(activeTeamId);
    toast.push({
      kind: "success",
      title: "Team Code copied",
      message: "Paste it into another coach's Join Team prompt.",
    });
  }, [activeTeamId, toast]);

  const saveTeamEvaluation = useCallback(() => {
    const inputs = uiBridge.current.getInputs?.();
    const grades = inputs?.teamEvalGrades || {};
    const selectedRoundId = inputs?.selectedRoundId || null;
    const newRoundLabel = (inputs?.newRoundLabel || "").trim();
    if (!user) return;

    const myEvents = teamData.evaluationEvents.filter(
      (e) => e.coachRole === "Head" && e.evaluatorId === user.uid
    );

    if (selectedRoundId) {
      // Editing an existing round — update its grades, keep its label/date/id
      const next = teamData.evaluationEvents.map((e) =>
        e.id === selectedRoundId ? { ...e, grades } : e
      );
      updateTeam({ evaluationEvents: next });
      toast.push({ kind: "success", title: "Eval updated" });
      return;
    }

    // Creating a new round
    const today = getLocalDateString();
    const roundNumber = myEvents.length + 1;
    const label = newRoundLabel || `Eval ${roundNumber} (${today})`;
    const newEvent = {
      id: "ev-" + Math.random().toString(36).substring(2, 10),
      date: today,
      coachRole: "Head",
      evaluatorId: user.uid,
      label,
      grades,
    };
    updateTeam({
      evaluationEvents: [...teamData.evaluationEvents, newEvent],
    });
    toast.push({
      kind: "success",
      title: "Eval saved",
      message: label,
    });
    // Caller is expected to clear newRoundLabel and re-select the new round if desired
  }, [user, teamData.evaluationEvents, updateTeam, toast]);

  // Win-loss record derived from final games only.
  const record = useMemo(() => {
    let wins = 0,
      losses = 0,
      ties = 0,
      runsScored = 0,
      runsAllowed = 0;
    for (const g of teamData.games) {
      if (g.status !== "final") continue;
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
      genError,
      setGenError,
      record,
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
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      joinTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      copyTeamCode,
      saveTeamEvaluation,
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
      genError,
      record,
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
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      joinTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      copyTeamCode,
      saveTeamEvaluation,
    ]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

/* ============================================================================
   SECTION 18 · UIProvider — local UI state (modals, selections, attendance)
   Bridges back to TeamProvider through `uiBridge` ref so generate/save can
   read the current UI state without re-rendering on every keystroke.
============================================================================ */
const UIProvider = ({ children }) => {
  const team = useTeam();

  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
    onConfirm: null,
  });
  const [linkCopied, setLinkCopied] = useState(false);

  // Schedule tab state
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [isAddingGame, setIsAddingGame] = useState(false);
  const [newGameForm, setNewGameForm] = useState({
    date: getLocalDateString(),
    opponent: "",
    leagueRuleSet: "USSSA",
    pitchingFormat: "Kid Pitch",
  });
  const [scoringGameId, setScoringGameId] = useState(null); // game whose score is being entered inline
  const [inGameId, setInGameId] = useState(null); // game currently in In-Game mode
  const [inGameInning, setInGameInning] = useState(0); // current inning during in-game mode (0-indexed)
  const [inGameSelection, setInGameSelection] = useState(null); // { type: "position"|"bench", pos?, playerId } — first tap of a swap pair
  const [inGameUndoStack, setInGameUndoStack] = useState([]); // last swap undo data
  const [activeTab, setActiveTab] = useState("home");
  const [pastSeasonImport, setPastSeasonImport] = useState(null); // null when closed; { rows, season, ageGroup, pitchingFormat, assignments } when open
  const [currentGameAttendance, setCurrentGameAttendance] = useState({});
  const [firstInningLineup, setFirstInningLineup] = useState({});
  const [lineup, setLineup] = useState(null);
  const [battingLineup, setBattingLineup] = useState(null);
  const [swapSelection, setSwapSelection] = useState(null);
  const [gameSaved, setGameSaved] = useState(false);
  const [opponentName, setOpponentName] = useState("");

  // Header state
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [isJoiningTeam, setIsJoiningTeam] = useState(false);
  const [joinTeamId, setJoinTeamId] = useState("");

  // Roster/profile state
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [viewingPlayerId, setViewingPlayerId] = useState(null);

  // Coach state
  const [isAddingCoach, setIsAddingCoach] = useState(false);
  const [newCoachForm, setNewCoachForm] = useState({
    name: "",
    role: "Head Coach",
  });

  // Eval state
  const [teamEvalGrades, setTeamEvalGrades] = useState({});
  // Eval round selection: null = creating a new round, otherwise = id of an
  // existing eval event being viewed/edited.
  const [selectedRoundId, setSelectedRoundId] = useState(null);
  // Label for a new round (only used when selectedRoundId === null).
  const [newRoundLabel, setNewRoundLabel] = useState("");
  // Player whose eval trend modal is currently open (null = closed)
  const [evalTrendPlayerId, setEvalTrendPlayerId] = useState(null);

  // Sync attendance/firstInning/lineup with the selected game
  const gamesRef = useRef(team.team.games);
  useEffect(() => {
    gamesRef.current = team.team.games;
  }, [team.team.games]);

  useEffect(() => {
    if (!selectedGameId) return;
    const game = gamesRef.current.find((g) => g.id === selectedGameId);
    if (!game) return;
    setOpponentName(game.opponent || "");
    setLineup(game.lineup || null);
    setBattingLineup(game.battingLineup || null);
    setCurrentGameAttendance(game.attendance || {});
    setGameSaved(false);
  }, [selectedGameId]);

  // Clear any selected/scoring/in-game id whose underlying game has been
  // deleted (locally or via a remote snapshot). Without this, the UI would
  // try to render against a non-existent game until the next interaction.
  useEffect(() => {
    const ids = new Set(team.team.games.map((g) => g.id));
    if (selectedGameId && !ids.has(selectedGameId)) setSelectedGameId(null);
    if (scoringGameId && !ids.has(scoringGameId)) setScoringGameId(null);
    if (inGameId && !ids.has(inGameId)) setInGameId(null);
  }, [team.team.games, selectedGameId, scoringGameId, inGameId]);
  // When players list changes, fill in attendance defaults
  useEffect(() => {
    setCurrentGameAttendance((prev) => {
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
      .filter((e) => e.coachRole === "Head" && e.evaluatorId === team.user.uid)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (selectedRoundId) {
      const target = mine.find((e) => e.id === selectedRoundId);
      if (target?.grades) setTeamEvalGrades(target.grades);
    } else {
      // Pre-fill with the latest round's grades when starting a new round
      if (mine[0]?.grades) setTeamEvalGrades(mine[0].grades);
    }
  }, [team.user, team.team.evaluationEvents, selectedRoundId]);

  // Handle copy-link feedback
  const copyTeamCode = useCallback(() => {
    team.copyTeamCode();
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [team]);

  // Lineup edits (swap / add inning / remove inning / reorder batters)
  const handleCellClick = useCallback(
    (innIdx, pos, player) => {
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
      setLineup((cur) => {
        if (!cur) return cur;
        const next = cur.map((inn) => ({
          ...inn,
          BENCH: inn.BENCH ? [...inn.BENCH] : [],
        }));
        const slot = next[innIdx];
        const a = swapSelection.player;
        const b = player;
        if (swapSelection.pos === "BENCH" && pos === "BENCH") return cur;
        if (swapSelection.pos === "BENCH") {
          // a is on bench, b is in pos (or pos empty)
          slot.BENCH = slot.BENCH.filter((p) => p.id !== a.id);
          if (b) slot.BENCH.push(b);
          slot[pos] = a;
        } else if (pos === "BENCH") {
          slot.BENCH = slot.BENCH.filter((p) => p.id !== b?.id);
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

  const moveBatter = useCallback((idx, delta) => {
    setBattingLineup((cur) => {
      if (!cur) return cur;
      const target = idx + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const openPlayerProfile = useCallback((id) => setViewingPlayerId(id), []);

  // Wire the bridge that TeamProvider uses
  team.uiBridge.current = {
    getInputs: () => {
      const currentGame = team.team.games.find((g) => g.id === selectedGameId);
      return {
        currentGame,
        currentGameAttendance,
        firstInningLineup,
        previousLineup: lineup,
        previousBattingLineup: battingLineup,
        lineup,
        battingLineup,
        teamEvalGrades,
        selectedRoundId,
        newRoundLabel,
      };
    },
    applyResult: ({ lineup: newLineup, battingLineup: newBatting }) => {
      setLineup(newLineup);
      setBattingLineup(newBatting);
      setSwapSelection(null);
      setGameSaved(false);
    },
    markSaved: () => {
      setGameSaved(true);
      setTimeout(() => setGameSaved(false), 2000);
    },
  };

  const value = useMemo(
    () => ({
      modal,
      setModal,
      linkCopied,
      copyTeamCode,
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
      isJoiningTeam,
      setIsJoiningTeam,
      joinTeamId,
      setJoinTeamId,
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
      newRoundLabel,
      setNewRoundLabel,
      evalTrendPlayerId,
      setEvalTrendPlayerId,
    }),
    [
      modal,
      linkCopied,
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
      swapSelection,
      gameSaved,
      handleCellClick,
      addInning,
      removeInning,
      moveBatter,
      opponentName,
      isAddingTeam,
      newTeamName,
      isJoiningTeam,
      joinTeamId,
      isAddingPlayer,
      viewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      newCoachForm,
      teamEvalGrades,
      copyTeamCode,
      selectedRoundId,
      newRoundLabel,
      evalTrendPlayerId,
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

/* ============================================================================
   SECTION 18.5 · InGameView — live in-game mode for tap-to-sub
============================================================================ */
const InGameView = memo(() => {
  const { team, updateGame, finalizeGame } = useTeam();
  const toast = useToast();
  const {
    inGameId,
    setInGameId,
    inGameInning,
    setInGameInning,
    inGameSelection,
    setInGameSelection,
    inGameUndoStack,
    setInGameUndoStack,
  } = useUI();
  const [showEndGameScore, setShowEndGameScore] = useState(false);

  if (!inGameId) return null;

  const game = team.games.find((g) => g.id === inGameId);
  if (!game) return null;
  if (!game.lineup?.length) {
    // Edge case: someone hit "Start Game" before generating a lineup
    return (
      <div className="fixed inset-0 z-[85] bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
          <Icons.Clipboard className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 mb-2">
            No Lineup Generated
          </h3>
          <p className="text-sm text-slate-500 font-medium mb-6">
            You need to generate a lineup before starting in-game mode.
          </p>
          <button
            onClick={() => setInGameId(null)}
            className="text-xs font-black uppercase tracking-widest px-5 py-3 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const totalInnings = game.lineup.length;
  const currentInning = Math.min(Math.max(0, inGameInning), totalInnings - 1);
  const inn = game.lineup[currentInning];
  const { primaryColor, tertiaryColor } = team;

  // Position order — display order (matches existing lineup grid)
  const positionOrder = [
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
  const presentPositions = positionOrder.filter((pos) => inn[pos]);

  // Update a specific inning's lineup with a patch.
  const patchInning = (idx, patch) => {
    const newLineup = game.lineup.map((existingInn, i) => {
      if (i !== idx) return existingInn;
      return { ...existingInn, ...patch };
    });
    updateGame(game.id, { lineup: newLineup });
  };

  // Perform a swap and record undo info.
  const performSwap = (firstSel, secondSel) => {
    const undoEntry = {
      inning: currentInning,
      first: firstSel,
      second: secondSel,
    };
    const lineupInning = { ...game.lineup[currentInning] };
    lineupInning.BENCH = [...(lineupInning.BENCH || [])];

    const getPlayer = (sel) => {
      if (sel.type === "position") return lineupInning[sel.pos];
      // bench
      return lineupInning.BENCH.find((p) => p.id === sel.playerId);
    };

    const setPlayer = (sel, player) => {
      if (sel.type === "position") {
        lineupInning[sel.pos] = player;
      } else {
        // bench: replace the player at this id
        lineupInning.BENCH = lineupInning.BENCH.map((p) =>
          p.id === sel.playerId ? player : p
        );
      }
    };

    const playerA = getPlayer(firstSel);
    const playerB = getPlayer(secondSel);
    if (!playerA || !playerB) {
      setInGameSelection(null);
      return;
    }
    setPlayer(firstSel, playerB);
    setPlayer(secondSel, playerA);

    patchInning(currentInning, lineupInning);
    setInGameUndoStack([undoEntry, ...inGameUndoStack].slice(0, 5));
    setInGameSelection(null);
  };

  const handleTap = (sel) => {
    // If nothing selected → select this one
    if (!inGameSelection) {
      setInGameSelection(sel);
      return;
    }
    // If tapping the same cell → deselect
    const isSame =
      inGameSelection.type === sel.type &&
      ((sel.type === "position" && inGameSelection.pos === sel.pos) ||
        (sel.type === "bench" && inGameSelection.playerId === sel.playerId));
    if (isSame) {
      setInGameSelection(null);
      return;
    }
    // Otherwise → swap
    performSwap(inGameSelection, sel);
  };

  const undo = () => {
    if (inGameUndoStack.length === 0) return;
    const entry = inGameUndoStack[0];
    // Re-do the swap (it's symmetric — swapping again undoes it)
    const lineupInning = { ...game.lineup[entry.inning] };
    lineupInning.BENCH = [...(lineupInning.BENCH || [])];

    const getPlayer = (sel) => {
      if (sel.type === "position") return lineupInning[sel.pos];
      return lineupInning.BENCH.find((p) => p.id === sel.playerId);
    };
    const setPlayer = (sel, player) => {
      if (sel.type === "position") lineupInning[sel.pos] = player;
      else
        lineupInning.BENCH = lineupInning.BENCH.map((p) =>
          p.id === sel.playerId ? player : p
        );
    };

    // To undo, we need to find the players who are CURRENTLY at the swap positions.
    // But the player IDs in entry.first/second referred to the originals — after the
    // swap, the locations now contain the OTHER player. So we just swap again.
    const playerA = getPlayer(entry.first);
    const playerB = getPlayer(entry.second);
    if (playerA && playerB) {
      setPlayer(entry.first, playerB);
      setPlayer(entry.second, playerA);
      patchInning(entry.inning, lineupInning);
    }
    setInGameUndoStack(inGameUndoStack.slice(1));
    setInGameSelection(null);
  };

  const isCellSelected = (sel) => {
    if (!inGameSelection) return false;
    if (inGameSelection.type !== sel.type) return false;
    if (sel.type === "position") return inGameSelection.pos === sel.pos;
    return inGameSelection.playerId === sel.playerId;
  };

  const close = () => {
    setInGameId(null);
    setInGameSelection(null);
    setInGameUndoStack([]);
    setShowEndGameScore(false);
  };

  const benchKids = inn.BENCH || [];

  return (
    <div className="fixed inset-0 z-[85] bg-slate-900 overflow-y-auto">
      {/* Top bar */}
      <div className="bg-white shadow-md">
        <div className="h-1.5" style={{ backgroundColor: primaryColor }} />
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={close}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
            aria-label="Close in-game mode"
          >
            <Icons.X className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 truncate">
              vs. {game.opponent}
            </div>
            <div className="text-base font-black uppercase tracking-tight text-slate-900 truncate">
              In-Game Mode
            </div>
          </div>
          <button
            onClick={undo}
            disabled={inGameUndoStack.length === 0}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Undo last swap"
          >
            <Icons.Refresh className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Inning navigator + score */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => setInGameInning(Math.max(0, currentInning - 1))}
            disabled={currentInning === 0}
            className="p-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous inning"
          >
            <Icons.ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
              Inning
            </div>
            <div className="text-3xl font-black text-slate-900 tabular-nums">
              {currentInning + 1}
              <span className="text-slate-300 text-lg"> / {totalInnings}</span>
            </div>
          </div>
          <button
            onClick={() =>
              setInGameInning(Math.min(totalInnings - 1, currentInning + 1))
            }
            disabled={currentInning >= totalInnings - 1}
            className="p-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next inning"
          >
            <Icons.ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Available Pitchers — eligibility status + who's been used this game.
            Only shown for kid-pitch divisions (machine pitch has no pitch counts). */}
        {(() => {
          const fmt = game.pitchingFormat || team.pitchingFormat || "";
          if (fmt.toLowerCase().includes("machine")) return null;
          const ageGroup = game.teamAge || team.teamAge;

          // Pitchers used in this game so far (anyone at P through current inning)
          const usedPitcherIds = new Set();
          const usedPitcherList = [];
          for (let i = 0; i <= currentInning; i++) {
            const pitcher = game.lineup[i]?.P;
            if (pitcher && !usedPitcherIds.has(pitcher.id)) {
              usedPitcherIds.add(pitcher.id);
              usedPitcherList.push({ player: pitcher, firstInning: i + 1 });
            }
          }
          // Available pool: present players not yet used, eligible by rest rules
          const targetDate = game.date || new Date().toISOString().slice(0, 10);
          const presentPlayers = team.players.filter(
            (p) =>
              (game.attendance?.[p.id] !== false) && !usedPitcherIds.has(p.id)
          );
          const availablePitchers = presentPlayers.filter((p) => {
            const pitching = p.pitching;
            if (!pitching?.lastPitchDate || !pitching.recentPitches) return true;
            const recent = pitching.recentPitches;
            if (recent === 0) return true;
            const maxByAge = {
              "9U": 75, "10U": 75, "11U to 12U": 85,
              "13U to 14U": 95, "15U to 18U": 105,
            };
            const max = maxByAge[ageGroup] ?? 105;
            if (recent >= max) return false;
            const diffDays = Math.floor(
              (new Date(targetDate).getTime() -
                new Date(pitching.lastPitchDate).getTime()) /
                86_400_000
            );
            const restNeeded =
              recent >= 66 ? 4 : recent >= 51 ? 3 : recent >= 36 ? 2 : recent >= 21 ? 1 : 0;
            return diffDays > restNeeded;
          });

          const pitchCounts = game.pitchCounts || {};
          const updatePitchCount = (playerId, val) => {
            const next = { ...(game.pitchCounts || {}) };
            const num = parseInt(val, 10);
            if (Number.isFinite(num) && num >= 0) {
              next[playerId] = num;
            } else if (val === "") {
              delete next[playerId];
            }
            updateGame(game.id, { pitchCounts: next });
          };

          return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-800 mb-2 flex items-center gap-1.5">
                <Icons.Pitch className="w-3.5 h-3.5" />
                Pitchers
              </div>
              {usedPitcherList.length > 0 && (
                <div className="mb-2">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                    Used This Game
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {usedPitcherList.map(({ player, firstInning }) => (
                      <div
                        key={player.id}
                        className="flex items-center gap-2 bg-white border border-amber-200 rounded-md px-2 py-1.5"
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-800 truncate">
                            {player.name}
                          </span>
                          <span className="text-slate-400 text-[9px] font-medium shrink-0">
                            (I{firstInning})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={pitchCounts[player.id] ?? ""}
                            onChange={(e) =>
                              updatePitchCount(player.id, e.target.value)
                            }
                            placeholder="0"
                            className="w-14 p-1 text-xs font-black text-slate-900 text-center bg-amber-50 border border-amber-300 rounded outline-none focus:ring-1 focus:ring-amber-500 tabular-nums"
                          />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700">
                            P
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                  Available ({availablePitchers.length})
                </div>
                {availablePitchers.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic font-medium">
                    No eligible pitchers remaining
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {availablePitchers.map((player) => (
                      <span
                        key={player.id}
                        className="text-[11px] font-bold text-emerald-800 bg-white border border-emerald-200 rounded-md px-2 py-1"
                      >
                        {player.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* End Game + Share row */}
        <div className="flex gap-2">
          <button
            onClick={() =>
              shareLineupCard({
                game,
                team,
                formatDate: formatGameDateDisplay,
                toast,
              })
            }
            title="Share this lineup as a PNG image"
            className="shrink-0 py-3 px-4 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2 bg-white/90 text-slate-700 border border-slate-200"
          >
            <Icons.Link className="w-4 h-4" /> Share
          </button>
          <button
            onClick={() => setShowEndGameScore(true)}
            className="flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-transform hover:-translate-y-0.5 flex items-center justify-center gap-2"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            <Icons.FileText className="w-4 h-4" /> End Game / Enter Final Score
          </button>
        </div>
      </div>

      {/* Selection helper */}
      {inGameSelection && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 text-center">
          <span className="text-[11px] font-black uppercase tracking-widest text-blue-800">
            {inGameSelection.type === "position"
              ? `${inGameSelection.pos} selected`
              : "Bench player selected"}
            {" · tap another cell to swap"}
          </span>
        </div>
      )}

      {/* On-field positions */}
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-3 px-1">
          On Field
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          {presentPositions.map((pos) => {
            const player = inn[pos];
            const sel = { type: "position", pos };
            const selected = isCellSelected(sel);
            return (
              <button
                key={pos}
                onClick={() => handleTap(sel)}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  selected
                    ? "bg-white border-blue-500 ring-4 ring-blue-200 shadow-lg"
                    : "bg-white border-slate-200 hover:border-slate-400 active:scale-[0.97]"
                }`}
              >
                <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-500 bg-slate-100 rounded-lg py-1.5">
                  {pos}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-base font-black text-slate-900 truncate leading-tight">
                    {player?.name || "—"}
                  </div>
                  {player?.number && (
                    <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                      #{player.number}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Bench */}
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-3 px-1">
          Bench ({benchKids.length})
        </h3>
        {benchKids.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              No Bench This Inning
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {benchKids.map((player) => {
              const sel = { type: "bench", playerId: player.id };
              const selected = isCellSelected(sel);
              return (
                <button
                  key={player.id}
                  onClick={() => handleTap(sel)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    selected
                      ? "bg-white border-blue-500 ring-4 ring-blue-200 shadow-lg"
                      : "bg-slate-100 border-slate-200 hover:border-slate-400 active:scale-[0.97]"
                  }`}
                >
                  <div className="w-12 shrink-0 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-500 bg-white rounded-lg py-1.5 border border-slate-200">
                    BN
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-base font-black text-slate-900 truncate leading-tight">
                      {player.name}
                    </div>
                    {player.number && (
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                        #{player.number}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* End Game / Score modal — overlays the in-game view */}
      {showEndGameScore && (
        <div
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => setShowEndGameScore(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-0.5">
                  vs. {game.opponent}
                </div>
                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                  Final Score
                </h3>
              </div>
              <button
                onClick={() => setShowEndGameScore(false)}
                className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-xl transition-colors -mt-1 -mr-2"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <ScoreEditor
              game={game}
              primaryColor={primaryColor}
              tertiaryColor={tertiaryColor}
              onSave={(ts, os, inningsPlayed) => {
                finalizeGame(game.id, ts, os, inningsPlayed);
                setShowEndGameScore(false);
                close();
              }}
              onClear={() => {
                updateGame(game.id, {
                  teamScore: null,
                  opponentScore: null,
                  status: "scheduled",
                });
                setShowEndGameScore(false);
              }}
              onCancel={() => setShowEndGameScore(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
});

/* ============================================================================
   SECTION 19 · Main App layout (consumes both contexts)
============================================================================ */
const MainShell = () => {
  const {
    team,
    user,
    authReady,
    loading,
    genError,
    setGenError,
  } = useTeam();
  const { viewingPlayerId, activeTab, setActiveTab } = useUI();

  if (!authReady || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 font-black uppercase tracking-widest text-sm flex items-center gap-3">
          <Icons.Refresh className="w-5 h-5 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        logoUrl={team.logoUrl}
        primaryColor={team.primaryColor}
        tertiaryColor={team.tertiaryColor}
        onSignIn={async () => {
          try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
          } catch (e) {
            setGenError(e.message);
          }
        }}
      />
    );
  }

  const navButtons = [
    { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
    { id: "roster", icon: Icons.Users, label: "Roster" },
    { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
    { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
    { id: "settings", icon: Icons.Settings, label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <AppHeader />
      <TabBarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        navButtons={navButtons}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 print:p-0 print:max-w-none">
        {activeTab === "home" && <HomeTab />}
        {activeTab === "roster" && <RosterTab />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "evaluation" && <EvaluationTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
      <SharedModals />
      {viewingPlayerId && <PlayerProfileModal />}
      <AddPlayerModal />
      <PastSeasonImportModal />
      <InGameView />
      {genError && (
        <div className="fixed bottom-4 left-4 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg max-w-sm text-xs font-bold print:hidden">
          {genError}
        </div>
      )}
    </div>
  );
};

const App = () => {
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
