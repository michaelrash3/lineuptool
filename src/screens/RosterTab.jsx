import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { formatStat, calculateBaseballAge } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";

const getInitials = (name) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const PlayerRow = memo(({ player, currentSeason, onOpenProfile }) => {
  const absent = player.present === false;
  const hasStats = player.stats?.ab > 0 || player.stats?.ip > 0;
  const initials = getInitials(player.name);
  const positionTag = player.primaryPosition || "—";

  return (
    <div
      className={`grid grid-cols-[100px_1fr] sm:grid-cols-[100px_1fr_auto] items-stretch rounded-2xl border border-slate-200 overflow-hidden shadow-card transition-all hover:shadow-md ${
        absent
          ? "bg-gradient-to-b from-slate-50 to-slate-100 opacity-85"
          : "bg-gradient-to-b from-white to-slate-50"
      }`}
    >
      <div
        className={`relative grid place-items-center overflow-hidden ${
          absent ? "" : ""
        }`}
        style={{
          background: absent
            ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(135deg, #64748b 0%, #475569 60%, #1e293b 100%)"
            : `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 60%), linear-gradient(135deg, var(--team-primary) 0%, color-mix(in srgb, var(--team-primary) 70%, #0f172a) 60%, #0f172a 100%)`,
        }}
      >
        <span
          className="absolute top-1.5 left-2 t-chip px-1.5 py-0.5 rounded text-white/80"
          style={{
            backgroundColor: "rgba(0,0,0,0.3)",
            fontSize: "8px",
            letterSpacing: "0.18em",
          }}
        >
          {positionTag}
        </span>
        <span
          className="relative w-[54px] h-[54px] rounded-full grid place-items-center font-black text-lg shadow-inner"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(241,245,249,0.85))",
            color: absent ? "#475569" : "var(--team-primary)",
          }}
        >
          {initials}
        </span>
        <span
          className="absolute bottom-1.5 right-2 font-black text-2xl text-white/95 tabular-nums"
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
              className="font-black text-base sm:text-lg uppercase tracking-tight text-slate-900 leading-none hover:text-team-primary transition-colors text-left truncate"
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
            <span className="t-chip px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700">
              B/T · {player.bats || "R"}/{player.throws || "R"}
            </span>
            {player.dob && (
              <span className="t-chip px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700">
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
        <div className="flex sm:hidden">
          <button
            type="button"
            onClick={() => onOpenProfile(player.id)}
            className="t-button text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
          >
            <Icons.FileText className="w-3.5 h-3.5" /> Profile
          </button>
        </div>
      </div>

      <div className="hidden sm:grid col-span-2 sm:col-span-1 grid-cols-4 sm:w-[260px] border-t sm:border-t-0 sm:border-l border-slate-200 bg-gradient-to-b from-slate-50 to-blue-50/50">
        {hasStats ? (
          <>
            <div className="text-center px-2 py-2.5 border-r border-slate-900/5 bg-blue-100/60 relative">
              <div className="t-eyebrow text-blue-700 mb-1" style={{ fontSize: "8px" }}>
                AVG
              </div>
              <div className="font-black text-base text-blue-700 tabular-nums">
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
              <div className="font-black text-base text-slate-900 tabular-nums">
                {formatStat(player.stats?.ops)}
              </div>
            </div>
            <div className="text-center px-2 py-2.5 border-r border-slate-900/5">
              <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                H
              </div>
              <div className="font-black text-base text-slate-900 tabular-nums">
                {player.stats?.h || 0}
              </div>
            </div>
            <div className="text-center px-2 py-2.5">
              <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                RBI
              </div>
              <div className="font-black text-base text-slate-900 tabular-nums">
                {player.stats?.rbi || 0}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-4 grid place-items-center py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
            No Stats Logged
          </div>
        )}
      </div>

      <div className="hidden sm:flex col-span-3 sm:col-auto items-center justify-end pr-3">
        <button
          type="button"
          onClick={() => onOpenProfile(player.id)}
          className="px-3 py-2 t-button text-slate-500 hover:text-slate-800 hover:bg-white/60 rounded-lg flex items-center gap-1.5"
          aria-label={`Open ${player.name}'s profile`}
        >
          <Icons.FileText className="w-3.5 h-3.5" /> Profile
        </button>
      </div>
    </div>
  );
});

export const RosterTab = memo(() => {
  const { team } = useTeam();
  const { setIsAddingPlayer, openPlayerProfile } = useUI();
  const { players, logoUrl, currentSeason } = team;

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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/20 border-b border-white/40">
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
        </div>
        <div className="p-4 sm:p-6">
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
              <h3 className="t-h3 mb-2 text-slate-500">No Roster Found</h3>
              <p className="t-body max-w-sm mx-auto">
                Manually add players to build your team, or head to Settings to
                import your stats file.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedRosterPlayers.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  currentSeason={currentSeason}
                  onOpenProfile={openPlayerProfile}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
