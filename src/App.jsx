import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
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
  ToastContext,
  TeamContext,
  UIContext,
  useToast,
  useTeam,
  useUI,
} from "./contexts.js";
import { SharedModals } from "./components/shared.jsx";
import {
  OnboardingTutorial,
  onboardingHasBeenCompleted,
} from "./components/OnboardingTutorial.jsx";
import {
  useLocation,
  useNavigate,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette.jsx";
import {
  LoginScreen,
  AppHeader,
  TabBarNav,
} from "./components/Chrome.jsx";
import { HomeTab } from "./screens/HomeTab.jsx";
import { RosterTab } from "./screens/RosterTab.jsx";
import { ScheduleTab } from "./screens/ScheduleTab.jsx";
import { EvaluationTab } from "./screens/EvaluationTab.jsx";
import { SettingsTab } from "./screens/SettingsTab.jsx";
import {
  PlayerProfileModal,
  AddPlayerModal,
  PastSeasonImportModal,
} from "./components/modals.jsx";
import { AssistantEvalTab } from "./screens/AssistantEvalTab.jsx";
import { InGameView } from "./screens/InGameView.jsx";
import {
  normalizeDateToIso,
  slimGame,
  scrubUndefined,
  parseCsvLine,
  buildCsvHeaderIndex,
  parsePercent,
  blankStats,
} from "./utils/helpers";
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

const toastIcon = (kind) => {
  if (kind === "success") return Icons.Check;
  if (kind === "error") return Icons.Alert;
  if (kind === "warn") return Icons.Alert;
  return Icons.Cloud;
};

const ToastContainer = memo(({ toasts, dismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2.5 max-w-sm w-[min(92vw,360px)] print:hidden">
      {toasts.map((t) => {
        const tone = TOAST_TONES[t.kind] || TOAST_TONES.info;
        const Icon = toastIcon(t.kind);
        return (
          <div
            key={t.id}
            className="relative bg-white rounded-xl shadow-lg border border-slate-900/5 overflow-hidden flex items-center gap-3 pl-4 pr-3 py-3"
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
                <div className="t-button text-slate-900" style={{ fontSize: "12px" }}>
                  {t.title}
                </div>
              )}
              {t.message && (
                <div className="text-[11.5px] font-semibold text-slate-600 mt-0.5 leading-snug">
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
                className="shrink-0 t-button px-2.5 py-1.5 rounded-lg border bg-transparent hover:bg-slate-50"
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
              className="shrink-0 w-[22px] h-[22px] grid place-items-center text-slate-400 hover:text-slate-700 rounded-md"
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
   SECTION 6 · TeamContext   — see ./contexts.js
   SECTION 7 · UIContext     — see ./contexts.js
   The hooks (useToast / useTeam / useUI) live in ./contexts.js so screens
   can import them without dragging the providers.
============================================================================ */

/* ============================================================================
   SECTION 8 · Small reusable presentational components — see ./components/shared.jsx
============================================================================ */

/* ============================================================================
   SECTION 9 · LoginScreen, AppHeader, TabBarNav — see ./components/Chrome.jsx
============================================================================ */

/* ============================================================================
   SECTION 10 · HomeTab — see ./screens/HomeTab.jsx
============================================================================ */

/* ============================================================================
   SECTION 11 · RosterTab — see ./screens/RosterTab.jsx
============================================================================ */

/* ============================================================================
   SECTION 12 · ScheduleTab — see ./screens/ScheduleTab.jsx (also includes ScoreEditor)
============================================================================ */

/* ============================================================================
   SECTION 13 · EvaluationTab + RosterDecisionsPanel — see ./screens/EvaluationTab.jsx
============================================================================ */

/* ============================================================================
   SECTION 14 · SettingsTab — see ./screens/SettingsTab.jsx
============================================================================ */

/* ============================================================================
   SECTION 15 · PlayerProfileModal — see ./components/modals.jsx
   SECTION 16 · AddPlayerModal     — see ./components/modals.jsx
============================================================================ */

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
  const persistTeamRef = useRef(null);
  // Per-session set of team ids we've already attempted to auto-claim.
  // Prevents the legacy-owner migration effect from re-firing every time
  // Firestore emits a fresh snapshot before ownerId is reflected back.
  const migrationAttemptedRef = useRef(new Set());

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
              migratedEvents = migratedEvents.map((ev) => {
                if (!ev?.grades) return ev;
                const nextGrades = {};
                for (const [pid, grade] of Object.entries(ev.grades)) {
                  if (!grade || typeof grade !== "object") {
                    nextGrades[pid] = grade;
                    continue;
                  }
                  const out = {};
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
              migratedPlayers = migratedPlayers.map((p) => {
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
            persistTeamRef.current?.({
              evaluationEvents: migratedEvents,
              players: migratedPlayers,
              evalSchemaVersion: EVAL_SCHEMA_VERSION,
            });
            setTeamData({
              ...DEFAULT_TEAM_DATA,
              ...raw,
              evaluationEvents: migratedEvents,
              players: migratedPlayers,
              evalSchemaVersion: EVAL_SCHEMA_VERSION,
            });
          } else {
            setTeamData({ ...DEFAULT_TEAM_DATA, ...raw });
          }
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

  // Expose persistTeam to the onSnapshot above so the eval schema migration
  // can write the cleared evaluationEvents back to Firestore.
  useEffect(() => {
    persistTeamRef.current = persistTeam;
  }, [persistTeam]);

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
      const id =
        form.id || "p-" + Math.random().toString(36).substring(2, 10);
      const newPlayer = {
        id,
        name: form.name.trim(),
        number: form.number || "",
        bats: form.bats || "R",
        throws: form.throws || "R",
        primaryPosition: form.primaryPosition || "",
        photoUrl: form.photoUrl || "",
        present: true,
        restrictions: [],
        stats: blankStats(),
        pitching: { recentPitches: 0, lastPitchDate: null },
      };
      updateTeam({ players: [...teamData.players, newPlayer] });
      return id;
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

      // Snapshot the pre-delete shapes for Undo. A mistap here cascades
      // through games / batting orders / attendance / pitch counts / eval
      // grades — a partial restore (just the roster row) would still leave
      // the player absent from the rest, so Undo has to revert all of them.
      const prevPlayers = teamData.players;
      const prevGames = teamData.games || [];
      const prevEvents = teamData.evaluationEvents || [];
      const removedPlayer = prevPlayers.find((p) => p.id === id);

      // Strip the player out of every shape that holds player references.
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
        players: prevPlayers.filter((p) => p.id !== id),
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
      const prevGames = teamData.games;
      const removed = prevGames.find((g) => g.id === gameId);
      updateTeam({ games: prevGames.filter((g) => g.id !== gameId) });
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
      (p) => currentGameAttendance[p.id] !== false
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
    (name) => {
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
    (templateId) => {
      const tpl = (teamData.lineupTemplates || []).find(
        (t) => t.id === templateId
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
    (templateId) => {
      const next = (teamData.lineupTemplates || []).filter(
        (t) => t.id !== templateId
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
    (playerId, opts = {}) => {
      const { fromInning = 0, reason = "injury" } = opts;
      const inputs = uiBridge.current.getInputs?.() || {};
      const game =
        inputs.currentGame ||
        (teamData.games || []).find(
          (g) => g.id === (opts.gameId || teamData?.inGameId)
        );
      const gameId = game?.id || opts.gameId;
      if (!gameId) {
        toast.push({ kind: "error", title: "No game selected" });
        return;
      }
      // Re-read the game from teamData to make sure we have the latest
      // persisted lineup (InGameView passes its pendingLineup via opts).
      const persistedGame = (teamData.games || []).find((g) => g.id === gameId);
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
      const activePlayers = (teamData.players || []).filter((p) => {
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
        (p) => p && p.id !== playerId
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
        (p) => p.id === playerId
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
            setInt("sb", idx.sb);
            setInt("k", idx.k);
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
              // Snapshot the PRIOR stats into statsHistory before merging.
              // Skip the snapshot if every field in the incoming patch already
              // matches the existing stats — same CSV re-uploaded, no movement
              // to record. Cap history at 20 entries to stay under Firestore's
              // 1 MB doc limit (~50 numeric stats × 8 bytes × 20 = ~8 KB).
              const priorStats =
                next[existingIndex].stats || blankStats();
              const changedFields = Object.keys(statsPatch).filter(
                (k) => Number(priorStats[k]) !== Number(statsPatch[k])
              );
              let nextHistory = next[existingIndex].statsHistory || [];
              if (changedFields.length > 0) {
                nextHistory = [
                  ...nextHistory,
                  {
                    importedAt: new Date().toISOString(),
                    source: "csv",
                    stats: { ...priorStats },
                  },
                ].slice(-20);
              }
              // Merge stats over existing — preserves any field not in this CSV
              next[existingIndex] = {
                ...next[existingIndex],
                stats: {
                  ...priorStats,
                  ...statsPatch,
                },
                statsHistory: nextHistory,
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

  // Build an Assistant eval round and persist it. Mirrors saveTeamEvaluation's
  // upsert behavior — if this assistant already has a round on today's date
  // we update it in place; otherwise we append a new event.
  const saveAssistantEvaluation = useCallback(
    (grades) => {
      if (!user) return;
      const today = getLocalDateString();
      const existing = (teamData.evaluationEvents || []).find(
        (e) =>
          e.coachRole === "Assistant" &&
          e.evaluatorId === user.uid &&
          e.date === today
      );
      let nextEvents;
      if (existing) {
        nextEvents = teamData.evaluationEvents.map((e) =>
          e.id === existing.id ? { ...e, grades } : e
        );
      } else {
        const newEvent = {
          id: "ev-" + Math.random().toString(36).substring(2, 10),
          date: today,
          coachRole: "Assistant",
          evaluatorId: user.uid,
          label: `Assistant Eval · ${today}`,
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

  // Promote / demote a non-owner team member. Owner is implicitly head and
  // cannot be demoted from here.
  const setCoachRole = useCallback(
    (uid, role) => {
      if (!uid || uid === teamData.ownerId) return;
      if (role !== "head" && role !== "assistant") return;
      const next = { ...(teamData.coachRoles || {}), [uid]: role };
      updateTeam({ coachRoles: next });
    },
    [teamData.coachRoles, teamData.ownerId, updateTeam]
  );

  // Generate a one-time invite token. Head coach copies the resulting URL and
  // shares it with the invitee. Token survives reloads because it lives on
  // the team document.
  const createInviteToken = useCallback(
    (role) => {
      if (!user) return null;
      if (role !== "head" && role !== "assistant") role = "assistant";
      const token =
        Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 10);
      const entry = {
        token,
        role,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
      };
      const next = [...(teamData.invites || []), entry];
      updateTeam({ invites: next });
      return token;
    },
    [user, teamData.invites, updateTeam]
  );

  // Drop an invite (used or unused) from the team's invite list.
  const revokeInviteToken = useCallback(
    (token) => {
      const next = (teamData.invites || []).filter((i) => i.token !== token);
      updateTeam({ invites: next });
    },
    [teamData.invites, updateTeam]
  );

  // Consume an invite token: find the team that issued it, add the current
  // user to its members + coachRoles, mark the invite used, switch the
  // active team to it. Mirrors the legacy joinTeam flow but gated on the
  // token + carries the encoded role.
  const redeemInviteToken = useCallback(
    async (token) => {
      if (!user || !token) return false;
      // Search every team this user already belongs to first (covers the
      // case where they're already a member but want to re-trigger).
      // Otherwise we need to locate the team via the invite — since the
      // token is per-team, callers should pass the team id alongside; here
      // we scan known teams. For a fresh invitee who isn't a member yet,
      // the URL needs to embed the team id as well, so we accept either
      // "teamId.token" or a plain token (scanned against known teams).
      let teamId = null;
      let plainToken = token;
      if (token.includes(".")) {
        const [tId, t] = token.split(".");
        teamId = tId;
        plainToken = t;
      }
      try {
        if (!teamId) {
          // Plain-token path: scan the user's known teams (no read access
          // to other teams here without an explicit id, so plain tokens
          // only work if you're already a member).
          for (const t of teams) {
            const snap = await getDoc(
              doc(db, "artifacts", appId, "public", "data", "teams", t.id)
            );
            if (!snap.exists()) continue;
            const data = snap.data();
            if ((data.invites || []).some((i) => i.token === plainToken)) {
              teamId = t.id;
              break;
            }
          }
        }
        if (!teamId) {
          toast.push({ kind: "error", title: "Invite not recognized" });
          return false;
        }
        const teamRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          teamId
        );
        const snap = await getDoc(teamRef);
        if (!snap.exists()) {
          toast.push({ kind: "error", title: "Team not found" });
          return false;
        }
        const data = snap.data();
        const invites = Array.isArray(data.invites) ? data.invites : [];
        const invite = invites.find((i) => i.token === plainToken);
        if (!invite) {
          toast.push({ kind: "error", title: "Invite not recognized" });
          return false;
        }
        if (invite.usedBy) {
          toast.push({ kind: "error", title: "Invite already used" });
          return false;
        }
        const members = Array.isArray(data.members) ? data.members : [];
        const nextMembers = members.includes(user.uid)
          ? members
          : [...members, user.uid];
        const nextCoachRoles = {
          ...(data.coachRoles || {}),
          [user.uid]: invite.role,
        };
        const nextInvites = invites.map((i) =>
          i.token === plainToken
            ? { ...i, usedBy: user.uid, usedAt: new Date().toISOString() }
            : i
        );
        await setDoc(
          teamRef,
          {
            members: nextMembers,
            coachRoles: nextCoachRoles,
            invites: nextInvites,
          },
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
        const newEntry = { id: teamId, name: data.name || "Joined Team" };
        const exists = teams.some((t) => t.id === teamId);
        const nextTeams = exists ? teams : [...teams, newEntry];
        await setDoc(
          userRef,
          { teams: nextTeams, activeTeamId: teamId },
          { merge: true }
        );
        toast.push({
          kind: "success",
          title: "Joined team",
          message:
            invite.role === "head"
              ? "You're a head coach on this team."
              : "You're an assistant coach on this team.",
        });
        return true;
      } catch (e) {
        toast.push({
          kind: "error",
          title: "Could not redeem invite",
          message: e.message,
        });
        return false;
      }
    },
    [user, teams, toast]
  );

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
  const setViewAsRole = useCallback((next) => {
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
  // Owner is always head; coachRoles[uid] takes precedence otherwise; a
  // legacy team without an ownerId treats the current user as head (the
  // auto-claim effect below writes ownerId so this fallback is one-time).
  const realRole = useMemo(() => {
    if (!user) return "head";
    if (!teamData.ownerId) return "head";
    if (user.uid === teamData.ownerId) return "head";
    const explicit = teamData.coachRoles?.[user.uid];
    if (explicit === "head") return "head";
    if (explicit === "assistant") return "assistant";
    // Other legacy members fall through to assistant; the head coach can
    // promote them via Settings → Coach Roles.
    return "assistant";
  }, [user, teamData.ownerId, teamData.coachRoles]);

  // Visible role for the rest of the app. Only the head coach can flip
  // themselves to assistant; assistants can never escalate.
  const currentRole = useMemo(() => {
    if (realRole === "head" && viewAsRole === "assistant") return "assistant";
    return realRole;
  }, [realRole, viewAsRole]);

  // Auto-claim + persist legacy teams. Runs once per session per team
  // when ownerId is missing. After Firestore acknowledges the write,
  // subsequent loads see ownerId populated and this effect is a no-op.
  // The session-level ref guards against re-firing during the brief
  // window between the write and the next snapshot — the user shouldn't
  // see a toast about it on every page reload.
  useEffect(() => {
    if (!authReady || !user || !activeTeamId) return;
    if (loadingActive) return;
    if (teamData.ownerId) return;
    if (migrationAttemptedRef.current.has(activeTeamId)) return;
    migrationAttemptedRef.current.add(activeTeamId);
    const members = Array.isArray(teamData.members) ? teamData.members : [];
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
    loadingActive,
  ]);

  // Auto-redeem ?invite= URL params once auth + team list are ready.
  useEffect(() => {
    if (!authReady || !user || loadingTeams) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (!invite) return;
    // Stash the token in sessionStorage if we somehow don't have teams yet.
    sessionStorage.setItem("pendingInvite", invite);
    // Strip the query param so a refresh doesn't re-trigger.
    params.delete("invite");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? `?${newSearch}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);
    redeemInviteToken(invite).then((ok) => {
      if (ok) sessionStorage.removeItem("pendingInvite");
    });
  }, [authReady, user, loadingTeams, redeemInviteToken]);

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
      currentRole,
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
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      saveTeamEvaluation,
      saveAssistantEvaluation,
      saveLineupTemplate,
      applyLineupTemplate,
      deleteLineupTemplate,
      removePlayerMidGame,
      setCoachRole,
      createInviteToken,
      revokeInviteToken,
      redeemInviteToken,
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
      currentRole,
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
      undoLineup,
      saveCurrentGame,
      switchTeam,
      createTeam,
      advanceSeason,
      uploadLogo,
      uploadScheduleCsv,
      uploadStatsCsv,
      exportBackup,
      importBackup,
      deleteTeamCmd,
      leaveTeamCmd,
      saveTeamEvaluation,
      saveAssistantEvaluation,
      saveLineupTemplate,
      applyLineupTemplate,
      deleteLineupTemplate,
      removePlayerMidGame,
      setCoachRole,
      createInviteToken,
      revokeInviteToken,
      redeemInviteToken,
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
  const toast = useToast();

  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
    onConfirm: null,
  });

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
  // Penalty score emitted by the engine for the current in-editor lineup
  // (null when no generated lineup is in scope). Lower = better.
  const [lineupQualityPenalty, setLineupQualityPenalty] = useState(null);
  const [swapSelection, setSwapSelection] = useState(null);
  const [gameSaved, setGameSaved] = useState(false);
  const [opponentName, setOpponentName] = useState("");

  // Header state
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [inviteModal, setInviteModal] = useState(null); // { token, url, role } | null
  const [assistantEvalOpen, setAssistantEvalOpen] = useState(false);

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

  // Snapshot of the game data we last loaded into local editor state, used
  // by the conflict-detection effect below. We compare against this — not
  // against the live `team.team.games` reference — so we can tell whether
  // the *user* edited locally vs. whether a *remote* snapshot changed the
  // game underneath us.
  const loadedGameRef = useRef(null);

  useEffect(() => {
    if (!selectedGameId) {
      loadedGameRef.current = null;
      return;
    }
    const game = gamesRef.current.find((g) => g.id === selectedGameId);
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
    const game = team.team.games.find((g) => g.id === selectedGameId);
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

    if (!localUnsaved) {
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
          (g) => g.id === selectedGameId
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
          newRoundLabel,
        };
      },
      applyResult: ({
        lineup: newLineup,
        battingLineup: newBatting,
        qualityPenalty,
      }) => {
        setLineup(newLineup);
        setBattingLineup(newBatting);
        setLineupQualityPenalty(
          typeof qualityPenalty === "number" ? qualityPenalty : null
        );
        setSwapSelection(null);
        setGameSaved(false);
      },
      applyTemplate: (tpl) => {
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
      inviteModal,
      setInviteModal,
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
      newRoundLabel,
      setNewRoundLabel,
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
      inviteModal,
      assistantEvalOpen,
      isAddingPlayer,
      viewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      newCoachForm,
      teamEvalGrades,
      selectedRoundId,
      newRoundLabel,
      evalTrendPlayerId,
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

/* ============================================================================
   SECTION 18.5 · InGameView — see ./screens/InGameView.jsx
============================================================================ */

/* ============================================================================
   SECTION 19 · Main App layout (consumes both contexts)
============================================================================ */
const TAB_ORDER_HEAD = ["home", "roster", "schedule", "evaluation", "settings"];
const TAB_ORDER_ASSISTANT = ["home", "roster", "schedule", "evaluation"];

// Map activeTab id → URL path and back. "home" is the root path so the
// app feels right at https://host/ without an explicit /home segment.
// `evaluation` resolves to the head EvaluationTab for heads and the
// AssistantEvalTab for assistants; same URL, role-dispatched view.
const TAB_TO_PATH = {
  home: "/",
  roster: "/roster",
  schedule: "/schedule",
  evaluation: "/evaluation",
  settings: "/settings",
};
const pathToTab = (pathname) => {
  if (!pathname || pathname === "/") return "home";
  // Match leading segment so deeper routes (e.g. /schedule/:id) still map
  // back to the right tab.
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "in-game") return "schedule";
  return first || "home";
};

const MainShell = () => {
  const {
    team,
    user,
    authReady,
    loading,
    genError,
    setGenError,
    regenerateLineup,
    regenerateBatting,
    currentRole,
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
  const TAB_ORDER = isAssistant ? TAB_ORDER_ASSISTANT : TAB_ORDER_HEAD;
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (authReady && user && !onboardingHasBeenCompleted()) {
      setTutorialOpen(true);
    }
  }, [authReady, user]);

  // Global keyboard shortcuts. Disabled while typing in form fields. Active
  // anywhere in the app:
  //   1-5 → switch primary tab
  //   ?    → open the tutorial
  //   G    → regenerate lineup (only when a game is selected for editing)
  //   B    → regenerate batting order (same gate as G)
  //   Esc  → close tutorial / does not handle modals here (each owns its own)
  useEffect(() => {
    if (!authReady || !user) return undefined;
    const onKey = (e) => {
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
        if (TAB_ORDER[idx]) {
          e.preventDefault();
          setActiveTab(TAB_ORDER[idx]);
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
    TAB_ORDER,
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

  // Guard: assistants can't land on head-only tabs or open the in-game view.
  // Snap back to home if they somehow do.
  useEffect(() => {
    if (!isAssistant) return;
    if (activeTab === "evaluation" || activeTab === "settings") {
      setActiveTab("home");
    }
    if (inGameId) setInGameId(null);
  }, [isAssistant, activeTab, setActiveTab, inGameId, setInGameId]);

  // URL ↔ activeTab sync. The tab id stays the source of truth for legacy
  // code; the URL just mirrors it so browser back/forward, deep links, and
  // shared URLs work.
  useEffect(() => {
    const tabFromUrl = pathToTab(location.pathname);
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    // Don't push when In-Game is active — that route owns the URL.
    if (location.pathname.startsWith("/in-game/")) return;
    const target = TAB_TO_PATH[activeTab];
    if (target == null) return; // unknown tab — don't push
    const path = target || "/";
    // Only navigate if it's a top-level tab change (don't clobber deeper
    // routes like /schedule/:id).
    const currentTopLevel = "/" + (location.pathname.split("/")[1] || "");
    const targetTopLevel = "/" + (path.split("/")[1] || "");
    if (currentTopLevel !== targetTopLevel) {
      navigate(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Drive In-Game routing from the inGameId state — when set, push the URL
  // to /in-game/:id; when cleared, pop back to /schedule.
  useEffect(() => {
    if (inGameId) {
      if (!location.pathname.startsWith(`/in-game/${inGameId}`)) {
        navigate(`/in-game/${inGameId}`);
      }
    } else if (location.pathname.startsWith("/in-game/")) {
      navigate("/schedule");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inGameId]);

  // And the reverse — if the user lands on /in-game/:id directly (refresh,
  // back button, shared link), seed the inGameId state to match.
  useEffect(() => {
    const match = location.pathname.match(/^\/in-game\/([^/]+)/);
    if (match && match[1] !== inGameId) {
      setInGameId(match[1]);
    } else if (!match && inGameId) {
      // URL no longer pointing at in-game — clear the state.
      setInGameId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

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

  const navButtons = isAssistant
    ? [
        { id: "home", icon: Icons.HomePlate, label: "Dashboard" },
        { id: "roster", icon: Icons.Users, label: "Roster" },
        { id: "schedule", icon: Icons.Calendar, label: "Schedule" },
        { id: "evaluation", icon: Icons.Clipboard, label: "Evaluation" },
      ]
    : [
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
        <Routes>
          <Route path="/" element={<HomeTab />} />
          <Route path="/roster" element={<RosterTab />} />
          <Route path="/schedule" element={<ScheduleTab />} />
          <Route path="/schedule/*" element={<ScheduleTab />} />
          <Route
            path="/evaluation"
            element={isAssistant ? <AssistantEvalTab /> : <EvaluationTab />}
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
      </main>
      <SharedModals />
      {viewingPlayerId && <PlayerProfileModal />}
      <AddPlayerModal />
      <PastSeasonImportModal />
      {!isAssistant && <InGameView />}
      <OnboardingTutorial
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
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
