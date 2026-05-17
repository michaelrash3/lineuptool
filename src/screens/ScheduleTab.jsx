import React, { memo, useState, useMemo } from "react";
import { Icons } from "../icons";
import {
  formatStat,
  normalizeDateToIso,
  formatGameDateDisplay,
  buildSeasonBenchImbalance,
} from "../utils/helpers";
import { shareLineupCard, downloadLineupPdf } from "../lineup/lineupCard";
import { getPositionsForInning } from "../lineupEngine";
import { useTeam, useUI, useToast } from "../contexts.js";
import { RecordBadge } from "../components/shared.jsx";
import { LineupGrid } from "./LineupGrid.jsx";

export const ScoreEditor = memo(
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


export const ScheduleTab = memo(() => {
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
    regenerateBatting,
    regenerateDefense,
    record,
    saveLineupTemplate,
    applyLineupTemplate,
    deleteLineupTemplate,
    currentRole,
  } = useTeam();
  const canEdit = currentRole !== "assistant";
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
    // Tournament classification. Drives engine pitcher pool size for
    // 9U+ Kid Pitch — Pool spreads across the staff (top 5); Bracket
    // narrows to your aces (top 3); League is the regular-season default.
    const gameType = currentGame.gameType || "league";

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
              {presentCount >= 7 && canEdit && (
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
                      onClick={regenerateBatting}
                      title="Re-roll just the batting order — defense stays the same"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700"
                    >
                      <Icons.Bat className="w-4 h-4" /> Re-roll Batting
                    </button>
                  )}
                  {lineup && (
                    <button
                      onClick={regenerateDefense}
                      title="Re-roll just the defensive schedule — batting order stays the same"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700"
                    >
                      <Icons.Glove className="w-4 h-4" /> Re-roll Defense
                    </button>
                  )}
                  {lineup && (
                    <button
                      onClick={() => {
                        const defaultName = currentGame?.opponent
                          ? `vs ${currentGame.opponent} · ${
                              currentGame.date || "—"
                            }`
                          : "Lineup Template";
                        const name = window.prompt(
                          "Save lineup as template — name?",
                          defaultName
                        );
                        if (name === null) return;
                        saveLineupTemplate?.(name);
                      }}
                      title="Save the current lineup + batting order as a reusable template"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700"
                    >
                      <Icons.Save className="w-4 h-4" /> Save as Template
                    </button>
                  )}
                  {(team.lineupTemplates || []).length > 0 && (
                    <div className="shrink-0 inline-flex">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          e.target.value = "";
                          if (!val) return;
                          if (val.startsWith("apply:")) {
                            applyLineupTemplate?.(val.slice(6));
                          } else if (val.startsWith("delete:")) {
                            const id = val.slice(7);
                            const tpl = (team.lineupTemplates || []).find(
                              (t) => t.id === id
                            );
                            if (
                              window.confirm(
                                `Delete template "${tpl?.name || id}"?`
                              )
                            ) {
                              deleteLineupTemplate?.(id);
                            }
                          }
                        }}
                        title="Apply or delete a saved lineup template"
                        aria-label="Lineup templates"
                        className="py-3 px-4 font-black uppercase tracking-widest rounded-xl shadow-sm text-xs bg-white/80 border border-slate-200 hover:bg-white text-slate-700 cursor-pointer"
                      >
                        <option value="">Templates…</option>
                        <optgroup label="Apply">
                          {(team.lineupTemplates || []).map((tpl) => (
                            <option key={`a-${tpl.id}`} value={`apply:${tpl.id}`}>
                              {tpl.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Delete">
                          {(team.lineupTemplates || []).map((tpl) => (
                            <option key={`d-${tpl.id}`} value={`delete:${tpl.id}`}>
                              ✕ {tpl.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
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

            {canEdit && (
            <>
            {/* Game type dropdown — League / Pool / Bracket. Drives
                engine pitcher pool sizes for 9U+ Kid Pitch (D4). */}
            <div className="bg-white/80 border border-slate-200 rounded-xl p-3 mt-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-800">
                  Game Type
                </div>
                <div className="text-[10px] text-slate-600 font-medium leading-tight mt-0.5">
                  Pool = spread pitchers across the staff. Bracket = your aces.
                </div>
              </div>
              <select
                value={gameType}
                onChange={(e) =>
                  updateGame(selectedGameId, { gameType: e.target.value })
                }
                className="shrink-0 p-2 text-[11px] font-black uppercase tracking-widest bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="league">League</option>
                <option value="pool">Pool</option>
                <option value="bracket">Bracket</option>
              </select>
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
                  <span aria-hidden>⭐</span>
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
            </>
            )}

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
          {canEdit && currentGame.status === "final" &&
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

          
            <div className={`grid grid-cols-1 ${canEdit ? "lg:grid-cols-2" : ""} divide-y lg:divide-y-0 lg:divide-x divide-white/40 bg-transparent`}>
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
              {canEdit && (
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
              )}
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
                {canEdit && (
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
                )}
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
                {canEdit && (
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
                )}
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

            <LineupGrid
              lineup={lineup}
              positions={getPositionsForInning(presentCount, gameDefenseSize)}
              swapSelection={canEdit ? swapSelection : null}
              onCellClick={canEdit ? handleCellClick : undefined}
            />

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
          {canEdit && (
            <button
              onClick={() => setIsAddingGame(true)}
              className="flex-1 sm:flex-none py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              <Icons.Plus className="w-4 h-4" /> Add Game
            </button>
          )}
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
                    className={`glass-card bg-white/40 hover:bg-white/60 transition-all ${
                      isPostponed ? "opacity-60" : ""
                    }`}
                  >
                    <div
                      className="h-1.5"
                      style={{
                        backgroundColor: isToday
                          ? "var(--team-primary)"
                          : "transparent",
                      }}
                    />
                    <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div className="flex items-start gap-4 sm:gap-5 min-w-0">
                        <div
                          className="hidden sm:grid place-items-center shrink-0 w-14 h-14 rounded-2xl shadow-inner"
                          style={{
                            backgroundColor: "var(--team-primary-15)",
                          }}
                        >
                          <Icons.Calendar
                            className="w-7 h-7"
                            style={{ color: "var(--team-primary)" }}
                          />
                        </div>
                        <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          {isToday && !isFinal && !isPostponed && (
                            <span
                              className="t-chip px-2 py-1 rounded-md text-white"
                              style={{
                                backgroundColor: "var(--team-primary)",
                                color: "var(--team-tertiary)",
                              }}
                            >
                              Today
                            </span>
                          )}
                          <h3 className="t-card-title leading-tight">
                            {game.isBigGame && (
                              <span
                                className="inline-block mr-1.5 text-yellow-500"
                                title="Big Game"
                                aria-label="Big Game"
                              >
                                ⭐
                              </span>
                            )}
                            VS. {game.opponent}
                          </h3>
                          {isFinal ? (
                            <span
                              className={`t-chip px-2.5 py-1 rounded-md border tabular-nums ${
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
                            <span className="t-chip bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-300">
                              Postponed
                            </span>
                          ) : game.lineup ? (
                            <>
                              <span className="t-chip bg-green-50 text-green-700 px-2 py-1 rounded-md border border-green-200">
                                Lineup Ready
                              </span>
                              {typeof game.qualityPenalty === "number" && (
                                <span
                                  className="t-chip px-2 py-1 rounded-md border"
                                  style={(() => {
                                    const q = Math.max(
                                      0,
                                      100 - Math.min(100, game.qualityPenalty)
                                    );
                                    const tone =
                                      q >= 90
                                        ? {
                                            bg: "#ecfdf5",
                                            fg: "#047857",
                                            border: "#a7f3d0",
                                          }
                                        : q >= 70
                                        ? {
                                            bg: "#fefce8",
                                            fg: "#854d0e",
                                            border: "#fde68a",
                                          }
                                        : {
                                            bg: "#fef2f2",
                                            fg: "#b91c1c",
                                            border: "#fecaca",
                                          };
                                    return {
                                      backgroundColor: tone.bg,
                                      color: tone.fg,
                                      borderColor: tone.border,
                                    };
                                  })()}
                                  title={`Lineup quality: ${Math.max(
                                    0,
                                    100 - Math.min(100, game.qualityPenalty)
                                  )}/100. Lower penalty = fewer rotation conflicts + better fairness.`}
                                >
                                  Quality{" "}
                                  {Math.max(
                                    0,
                                    100 - Math.min(100, game.qualityPenalty)
                                  )}
                                  /100
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="t-chip bg-amber-50 text-amber-700 px-2 py-1 rounded-md border border-amber-200">
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
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto flex-wrap justify-end">
                        {(canEdit || game.lineup) && (
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
                            {!canEdit ? (
                              <Icons.Clipboard className="w-4 h-4" />
                            ) : game.lineup ? (
                              <Icons.Edit className="w-4 h-4" />
                            ) : (
                              <Icons.Clipboard className="w-4 h-4" />
                            )}{" "}
                            {!canEdit
                              ? "Gameplan"
                              : game.lineup
                              ? "Edit Game"
                              : "Plan Game"}
                          </button>
                        )}
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
                        {!isPostponed && canEdit && (
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
                        {canEdit && (
                          <button
                            onClick={() => deleteSavedGame(game.id)}
                            className="text-slate-400 hover:text-red-600 bg-white/80 border border-slate-200 hover:border-red-200 hover:bg-red-50 p-3 transition-colors rounded-xl shadow-sm"
                          >
                            <Icons.Trash className="w-4 h-4" />
                          </button>
                        )}
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
