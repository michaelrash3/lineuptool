import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { formatStat, calculateBaseballAge } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";
import { PlayerAvatar } from "../components/shared.jsx";
import { PitcherRankingPanel } from "../components/PitcherRankingPanel.jsx";

const INFIELD_POSITIONS = new Set(["1B", "2B", "3B", "SS"]);
const OUTFIELD_POSITIONS = new Set(["LF", "CF", "RF", "LCF", "RCF"]);

const FILTER_CHIPS = [
  { id: "present", label: "Present" },
  { id: "absent", label: "Absent" },
  { id: "pitchers", label: "Pitchers" },
  { id: "catchers", label: "Catchers" },
  { id: "infield", label: "Infield" },
  { id: "outfield", label: "Outfield" },
  { id: "leftyBats", label: "Lefty Bats" },
];

// Returns true if the player matches the given filter id. Unknown ids match.
// Position filters consult the position model — `comfortablePositions`,
// where catcher is just "C" in the list — with legacy `primaryPosition`
// kept as a last-resort fallback so teams that haven't been migrated
// still see something useful in the filter.
const playerComfortable = (player, pos) => {
  const list = Array.isArray(player.comfortablePositions)
    ? player.comfortablePositions
    : null;
  if (list && list.length > 0) return list.includes(pos);
  // Legacy fallback: not in restrictions → "comfortable"
  const restr = Array.isArray(player.restrictions) ? player.restrictions : [];
  if (restr.length > 0) return !restr.includes(pos);
  return player.primaryPosition === pos;
};

const playerMatchesFilter = (player, filterId) => {
  switch (filterId) {
    case "present":
      return player.present !== false;
    case "absent":
      return player.present === false;
    case "pitchers":
      return playerComfortable(player, "P");
    case "catchers":
      // Catcher is opt-in: strictly "C" present in the comfortable list
      // (no legacy "empty = anywhere" fallback for catcher).
      return (
        Array.isArray(player.comfortablePositions) &&
        player.comfortablePositions.includes("C")
      );
    case "infield":
      return [...INFIELD_POSITIONS].some((p) => playerComfortable(player, p));
    case "outfield":
      return [...OUTFIELD_POSITIONS].some((p) => playerComfortable(player, p));
    case "leftyBats":
      return player.bats === "L" || player.bats === "S";
    default:
      return true;
  }
};

const PlayerRow = memo(({ player, currentSeason, onOpenProfile, showPositionTag }) => {
  const absent = player.present === false;
  const hasStats = player.stats?.ab > 0 || player.stats?.ip > 0;
  const positionTag = player.primaryPosition || "—";

  return (
    <div
      className={`grid grid-cols-[100px_1fr] sm:grid-cols-[100px_1fr_auto] items-stretch rounded-2xl border border-line overflow-hidden shadow-card transition-all hover:shadow-md ${
        absent
          ? "bg-gradient-to-b from-slate-50 to-slate-100 opacity-85"
          : "bg-gradient-to-b from-white to-slate-50"
      }`}
    >
      <div
        className="relative grid place-items-center overflow-hidden"
        style={{
          background: absent
            ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(135deg, #64748b 0%, #475569 60%, #1e293b 100%)"
            : `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 60%), linear-gradient(135deg, var(--team-primary) 0%, color-mix(in srgb, var(--team-primary) 70%, #0f172a) 60%, #0f172a 100%)`,
        }}
      >
        {showPositionTag && (
          <span
            className="absolute top-1.5 left-2 t-chip px-1.5 py-0.5 rounded text-white/80 z-10"
            style={{
              backgroundColor: "rgba(0,0,0,0.3)",
              fontSize: "8px",
              letterSpacing: "0.18em",
            }}
          >
            {positionTag}
          </span>
        )}
        <PlayerAvatar player={player} size={54} className="shadow-inner" />
        <span
          className="absolute bottom-1.5 right-2 font-black text-2xl text-white/95 tabular-nums z-10"
          style={{
            letterSpacing: "-0.03em",
            textShadow: "0 2px 4px rgba(0,0,0,0.5)",
          }}
        >
          {player.number || ""}
        </span>
      </div>

      <div className="px-3.5 py-3 min-w-0 flex flex-col justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onOpenProfile(player.id)}
              className="font-black text-base sm:text-lg uppercase tracking-tight text-ink leading-none hover:text-team-primary transition-colors text-left truncate"
            >
              {player.name}
            </button>
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                absent
                  ? "bg-slate-300"
                  : "bg-emerald-500"
              }`}
              style={{
                boxShadow: absent
                  ? "0 0 0 3px rgba(148,163,184,0.18)"
                  : "0 0 0 3px rgba(16,185,129,0.18)",
              }}
              title={absent ? "Absent" : "Present"}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink">
              B/T · {player.bats || "R"}/{player.throws || "R"}
            </span>
            {player.dob && (
              <span className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink">
                Age {calculateBaseballAge(player.dob, currentSeason) || "?"}
              </span>
            )}
            {absent && (
              <span className="t-chip px-2 py-1 rounded-md bg-rose-50 border border-rose-200 text-rose-700">
                Out
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className="hidden sm:grid col-span-2 sm:col-span-1 grid-cols-4 sm:w-[260px] border-t sm:border-t-0 sm:border-l border-line bg-gradient-to-b from-slate-50"
        style={{ backgroundImage: "linear-gradient(to bottom, var(--slate-50), var(--team-primary-soft))" }}
      >
        {hasStats ? (
          <>
            <div
              className="text-center px-2 py-2.5 border-r border-slate-900/5 relative"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <div
                className="t-eyebrow mb-1"
                style={{ fontSize: "8px", color: "var(--team-primary)" }}
              >
                AVG
              </div>
              <div
                className="font-black text-base tabular-nums"
                style={{ color: "var(--team-primary)" }}
              >
                {formatStat(player.stats?.avg)}
              </div>
              <span
                className="absolute left-0 right-0 bottom-0 h-[3px]"
                style={{
                  background:
                    "linear-gradient(90deg, var(--team-primary), color-mix(in srgb, var(--team-primary) 70%, #0f172a))",
                }}
              />
            </div>
            <div className="text-center px-2 py-2.5 border-r border-slate-900/5">
              <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                OPS
              </div>
              <div className="font-black text-base text-ink tabular-nums">
                {formatStat(player.stats?.ops)}
              </div>
            </div>
            <div className="text-center px-2 py-2.5 border-r border-slate-900/5">
              <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                H
              </div>
              <div className="font-black text-base text-ink tabular-nums">
                {player.stats?.h || 0}
              </div>
            </div>
            <div className="text-center px-2 py-2.5">
              <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                RBI
              </div>
              <div className="font-black text-base text-ink tabular-nums">
                {player.stats?.rbi || 0}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-4 grid place-items-center py-4 text-[10px] font-black text-ink-3 uppercase tracking-widest italic">
            No Stats Logged
          </div>
        )}
      </div>

    </div>
  );
});

export const RosterTab = memo(() => {
  const { team, currentRole } = useTeam();
  const canEdit = currentRole !== "assistant";
  const { setIsAddingPlayer, openPlayerProfile } = useUI();
  const { players, logoUrl, currentSeason } = team;

  // Gameday filter state — per-session, intentionally not persisted.
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState(() => new Set());

  const toggleFilter = (id) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearAll = () => {
    setActiveFilters(new Set());
    setSearchQuery("");
  };

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

  // AND-combine: a player must match the search and every active filter chip.
  const visiblePlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedRosterPlayers.filter((p) => {
      if (q && !(p.name || "").toLowerCase().includes(q)) return false;
      for (const filterId of activeFilters) {
        if (!playerMatchesFilter(p, filterId)) return false;
      }
      return true;
    });
  }, [sortedRosterPlayers, searchQuery, activeFilters]);

  const filtersActive = activeFilters.size > 0 || searchQuery.trim().length > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PitcherRankingPanel />
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface border-b border-line">
          <div className="flex items-center gap-4">
            <div
              className="p-2.5 rounded-full"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Jersey
                className="w-6 h-6"
                style={{ color: "var(--team-primary)" }}
              />
            </div>
            <h2 className="t-h2 flex items-center gap-3">
              Team Roster
              <span
                className="t-chip px-2.5 py-1 rounded-lg"
                style={{
                  backgroundColor: "var(--team-secondary)",
                  color: "var(--team-primary)",
                }}
              >
                {players.length} Active
              </span>
            </h2>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={() => setIsAddingPlayer(true)}
              className="flex-1 sm:flex-none py-2.5 px-5 flex items-center justify-center gap-2 t-button rounded-xl shadow-md hover:-translate-y-0.5 transition-transform"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-tertiary)",
              }}
            >
              <Icons.UserPlus className="w-4 h-4" /> Add Player
            </button>
          )}
        </div>
        {players.length > 0 && (
          <div className="px-4 sm:px-6 pt-4 pb-3 bg-surface border-b border-line space-y-3">
            <div className="relative">
              <Icons.User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search players by name…"
                aria-label="Search roster"
                className="w-full pl-9 pr-9 py-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:border-transparent text-sm font-bold text-ink shadow-sm transition-shadow"
                style={{ "--tw-ring-color": "var(--team-primary)" }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-3 hover:text-ink rounded-md"
                >
                  <Icons.X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTER_CHIPS.map((chip) => {
                const isActive = activeFilters.has(chip.id);
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => toggleFilter(chip.id)}
                    aria-pressed={isActive}
                    className="t-button px-3 py-1.5 rounded-full border transition-all"
                    style={
                      isActive
                        ? {
                            backgroundColor: "var(--team-secondary)",
                            color: "var(--team-primary)",
                            borderColor: "var(--team-primary)",
                          }
                        : {
                            backgroundColor: "rgba(255,255,255,0.7)",
                            color: "#475569",
                            borderColor: "#e2e8f0",
                          }
                    }
                  >
                    {chip.label}
                  </button>
                );
              })}
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="t-button px-3 py-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface"
                >
                  Clear All
                </button>
              )}
              <span className="ml-auto t-eyebrow text-ink-3 tabular-nums">
                {visiblePlayers.length} / {players.length}
              </span>
            </div>
          </div>
        )}
        <div className="p-4 sm:p-6">
          {players.length === 0 ? (
            <div className="text-center py-20 bg-surface border border-line shadow-sm rounded-2xl">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Team Logo"
                  className="w-24 h-24 mx-auto mb-6 opacity-40 grayscale"
                />
              ) : (
                <Icons.Jersey className="w-16 h-16 text-ink-3 mx-auto mb-4" />
              )}
              <h3 className="t-h3 mb-2 text-ink-3">No Roster Found</h3>
              <p className="t-body max-w-sm mx-auto">
                Manually add players to build your team, or head to Settings to
                import your stats file.
              </p>
            </div>
          ) : visiblePlayers.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-line shadow-sm rounded-2xl">
              <Icons.Jersey className="w-10 h-10 text-ink-3 mx-auto mb-3" />
              <p className="t-body max-w-sm mx-auto">
                No players match the current filter — clear to see the full
                roster.
              </p>
              <button
                type="button"
                onClick={clearAll}
                className="mt-3 t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visiblePlayers.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  currentSeason={currentSeason}
                  onOpenProfile={openPlayerProfile}
                  showPositionTag={canEdit}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
