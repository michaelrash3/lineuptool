import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { formatStat, calculateBaseballAge } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";

export const RosterTab = memo(() => {
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
