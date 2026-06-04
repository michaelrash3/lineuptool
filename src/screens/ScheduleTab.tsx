import React, { memo, useState, useMemo, useEffect } from "react";
import { Icons } from "../icons";
import {
  formatStat,
  normalizeDateToIso,
  formatGameDateDisplay,
  buildSeasonBenchImbalance,
  isGameFinalized,
} from "../utils/helpers";
import { shareLineupCard, downloadLineupPdf } from "../lineup/lineupCard";
import { getPositionsForInning } from "../lineupEngine";
import { useTeam, useUI, useToast } from "../contexts";
import { RecordBadge } from "../components/shared";
import { GameChangerImportModal } from "../components/GameChangerImportModal";
import { fetchGcEvents, mergeGcEventsIntoGames } from "../utils/gcSync";
import { LineupGrid } from "./LineupGrid";

export const ScoreEditor = memo(
  ({ game, primaryColor, tertiaryColor, onSave, onClear, onCancel }: any) => {
    const [ts, setTs] = useState(game.teamScore ?? "");
    const [os, setOs] = useState(game.opponentScore ?? "");
    // Innings played defaults to the current lineup length (or 6 if there's no
    // lineup yet). User can dial this down if the game ended early.
    const lineupMaxInnings = (game.originalLineup?.length || game.lineup?.length || 6);
    const initialInningsPlayed = game.lineup?.length || lineupMaxInnings;
    const [inningsPlayed, setInningsPlayed] = useState(initialInningsPlayed);

    const tsNum = ts === "" ? NaN : parseInt(ts, 10);
    const osNum = os === "" ? NaN : parseInt(os, 10);
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
      <div className="px-5 pb-5 pt-1 border-t border-line">
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
            <div className="w-full sm:w-28">
              <label
                htmlFor={`score-ours-${game.id}`}
                className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
              >
                Our Score
              </label>
              <input
                id={`score-ours-${game.id}`}
                type="number"
                min="0"
                inputMode="numeric"
                autoFocus
                value={ts}
                onChange={(e) => setTs(e.target.value)}
                className="w-full p-2.5 bg-surface border border-line text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner tabular-nums text-center"
              />
            </div>
            <div className="w-full sm:w-28">
              <label
                htmlFor={`score-opp-${game.id}`}
                className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
              >
                Opp. Score
              </label>
              <input
                id={`score-opp-${game.id}`}
                type="number"
                min="0"
                inputMode="numeric"
                value={os}
                onChange={(e) => setOs(e.target.value)}
                className="w-full p-2.5 bg-surface border border-line text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner tabular-nums text-center"
              />
            </div>
            {game.lineup?.length > 0 && (
              <div className="w-full sm:w-32">
                <label
                  htmlFor={`score-innings-${game.id}`}
                  className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
                >
                  Innings Played
                </label>
                <select
                  id={`score-innings-${game.id}`}
                  value={inningsPlayed}
                  onChange={(e) => setInningsPlayed(parseInt(e.target.value, 10))}
                  className="w-full p-2.5 bg-surface border border-line text-base font-black rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-sm tabular-nums text-center cursor-pointer"
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
                role="status"
                aria-live="polite"
                aria-label={`Result: ${
                  result === "win" ? "Win" : result === "loss" ? "Loss" : "Tie"
                }`}
                className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-sm self-end mb-0.5 ${
                  result === "win"
                    ? "bg-win-bg text-win border border-line"
                    : result === "loss"
                    ? "bg-loss-bg text-loss border border-line"
                    : "bg-warn-bg text-warnfg border border-line"
                }`}
              >
                {result === "win" ? "Win" : result === "loss" ? "Loss" : "Tie"}
              </div>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                className="text-[10px] font-black uppercase tracking-widest px-4 py-2.5 bg-surface border border-line text-ink rounded-lg hover:bg-surface-2 transition-colors shadow-sm"
              >
                Cancel
              </button>
              {hadScore && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-[10px] font-black uppercase tracking-widest px-4 py-2.5 bg-surface border border-line text-loss rounded-lg hover:bg-loss-bg transition-colors shadow-sm"
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
          <p className="text-[10px] text-ink-3 mt-3 font-medium">
            Saving marks this game Final — its innings will count toward future lineup fairness. Trimmed innings are saved separately and can be restored from the game editor.
          </p>
        </div>
      </div>
    );
  }
);


// Per-session, per-team throttle for the auto-sync-on-open: opening the
// Schedule tab repeatedly within this window won't refetch the feed. Module
// scope so it survives the tab's mount/unmount (routes mount fresh each visit).
const gcAutoSyncedAt = new Map<string, number>();
const GC_AUTOSYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const ScheduleTab = memo(() => {
  const {
    team,
    activeTeamId,
    addGame,
    updateGame,
    updateTeam,
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

  // In-app replacements for window.prompt (save template name) and
  // window.confirm (delete template). Modal handles the save flow with
  // an editable default name; the delete flow shows an inline confirm
  // banner anchored under the templates dropdown.
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState<string | null>(null);
  const [gcImportOpen, setGcImportOpen] = useState(false);

  // Auto-sync the GameChanger schedule when the Schedule tab opens. Runs only
  // when a feed URL is saved and the user can edit, throttled per team so
  // re-opening the tab doesn't refetch constantly. Writes ONLY when something
  // actually changed (mergeGcEventsIntoGames returns the same array otherwise),
  // toasts only on a real change, and stays silent on errors so it never nags —
  // the manual "Import from GameChanger" button still surfaces problems.
  const gcFeedUrl = team?.gcCalendarUrl;
  useEffect(() => {
    if (!canEdit || !gcFeedUrl || !activeTeamId) return;
    const now = Date.now();
    if (now - (gcAutoSyncedAt.get(activeTeamId) || 0) < GC_AUTOSYNC_INTERVAL_MS) return;
    gcAutoSyncedAt.set(activeTeamId, now);
    let cancelled = false;
    (async () => {
      try {
        const events = await fetchGcEvents(gcFeedUrl);
        if (cancelled || events.length === 0) return;
        const current = team?.games || [];
        const { games, added, updated } = mergeGcEventsIntoGames(current, events, {
          leagueRuleSet: team.leagueRuleSet,
          pitchingFormat: team.pitchingFormat,
          defenseSize: team.defenseSize,
          battingSize: team.battingSize,
          positionLock: team.positionLock,
        });
        if (cancelled || (added === 0 && updated === 0)) return;
        updateTeam({ games });
        toast.push({
          kind: "success",
          title: "Schedule synced",
          message: `GameChanger: ${added} new, ${updated} updated.`,
        });
      } catch {
        // Silent — don't nag on every open; manual import surfaces errors. On a
        // failure, clear the throttle so the next open retries.
        gcAutoSyncedAt.delete(activeTeamId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed on team/feed identity, not the whole team object, so
    // the post-sync games write doesn't re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId, canEdit, gcFeedUrl]);

  // Sort games by ISO date string once per games-array change instead of on
  // every keystroke into newGameForm (which triggers a ScheduleTab re-render).
  // ISO YYYY-MM-DD is lexicographically equivalent to chronological, so
  // string compare beats new Date(...) - new Date(...) on cost.
  // Finalized games sink to the bottom — the coach's working set is the
  // upcoming/unplayed games, so keep those up top and park completed ones
  // below them (still date-sorted within each group).
  const sortedGames = useMemo(
    () =>
      [...games].sort((a, b) => {
        const aFinal = isGameFinalized(a) ? 1 : 0;
        const bFinal = isGameFinalized(b) ? 1 : 0;
        if (aFinal !== bFinal) return aFinal - bFinal;
        return (a.date || "").localeCompare(b.date || "");
      }),
    [games]
  );

  const currentGame = games.find((g: any) => g.id === selectedGameId);

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
      (p: any) => currentGameAttendance[p.id] !== false
    );
    const presentCount = presentPlayers.length;

    return (
      <div className="space-y-6">
        <div className="bg-surface shadow-sm border border-line print:hidden rounded-2xl overflow-hidden">
          <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5 border-b border-line bg-surface">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedGameId(null)}
                className="p-2 hover:bg-surface text-ink-3 hover:text-ink rounded-full transition-colors"
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
              <h2 className="text-xl font-black text-ink uppercase tracking-wider">
                Game Command Center
              </h2>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
              <div className="bg-surface border border-line px-4 py-2.5 rounded-xl shrink-0 shadow-sm">
                <span className="block text-[9px] text-ink-3 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Opponent
                </span>
                <span className="block text-sm text-ink font-black uppercase leading-none">
                  {currentGame.opponent}
                </span>
              </div>
              <div className="bg-surface border border-line px-4 py-2.5 rounded-xl shrink-0 hidden sm:block shadow-sm">
                <span className="block text-[9px] text-ink-3 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Rotation
                </span>
                <span className="block text-sm text-ink font-black uppercase leading-none">
                  {gamePositionLock === "full"
                    ? "Full Game"
                    : `${gamePositionLock} Inn`}
                </span>
              </div>
              <div className="bg-surface border border-line px-4 py-2.5 rounded-xl shrink-0 hidden sm:block shadow-sm">
                <span className="block text-[9px] text-ink-3 font-extrabold uppercase tracking-widest leading-none mb-1.5">
                  Batters
                </span>
                <span className="block text-sm text-ink font-black uppercase leading-none">
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
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink"
                    >
                      <Icons.Refresh className="w-4 h-4" /> Re-roll
                    </button>
                  )}
                  {lineup && (
                    <button
                      onClick={regenerateBatting}
                      title="Re-roll just the batting order — defense stays the same"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink"
                    >
                      <Icons.Bat className="w-4 h-4" /> Re-roll Batting
                    </button>
                  )}
                  {lineup && (
                    <button
                      onClick={regenerateDefense}
                      title="Re-roll just the defensive schedule — batting order stays the same"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink"
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
                        setSaveTemplateName(defaultName);
                        setSaveTemplateOpen(true);
                      }}
                      title="Save the current lineup + batting order as a reusable template"
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink"
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
                            setPendingDeleteTemplateId(val.slice(7));
                          }
                        }}
                        title="Apply or delete a saved lineup template"
                        aria-label="Lineup templates"
                        className="py-3 px-4 font-black uppercase tracking-widest rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink cursor-pointer"
                      >
                        <option value="">Templates…</option>
                        <optgroup label="Apply">
                          {(team.lineupTemplates || []).map((tpl: any) => (
                            <option key={`a-${tpl.id}`} value={`apply:${tpl.id}`}>
                              {tpl.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Delete">
                          {(team.lineupTemplates || []).map((tpl: any) => (
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
                      className="shrink-0 py-3 px-4 flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink"
                    >
                      <Icons.Link className="w-4 h-4" /> Share
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 p-6 bg-transparent border-b border-line">
              <div className="w-full col-span-2 md:col-span-1">
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={normalizeDateToIso(currentGame.date) || ""}
                  onChange={(e) =>
                    updateGame(selectedGameId, { date: e.target.value })
                  }
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-sm"
                />
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
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
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
                >
                  <option value="USSSA">USSSA Baseball</option>
                  <option value="NKB">Northern Kentucky Baseball (NKB)</option>
                </select>
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                  Pitching
                </label>
                <select
                  value={gamePitching}
                  onChange={(e) =>
                    updateGame(selectedGameId, {
                      pitchingFormat: e.target.value,
                    })
                  }
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
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
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                  Fielders
                </label>
                <select
                  value={gameDefenseSize}
                  onChange={(e) =>
                    updateGame(selectedGameId, { defenseSize: e.target.value })
                  }
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
                >
                  <option value="9">9 Fielders</option>
                  <option value="10">10 Fielders</option>
                </select>
              </div>
              <div className="w-full">
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                  Rotation
                </label>
                <select
                  value={gamePositionLock}
                  onChange={(e) =>
                    updateGame(selectedGameId, { positionLock: e.target.value })
                  }
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
                >
                  <option value="1">1 Inn</option>
                  <option value="2">2 Inn</option>
                  <option value="3">3 Inn</option>
                  <option value="full">Full Game</option>
                </select>
              </div>
              <div className="w-full col-span-2 md:col-span-1">
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                  Batters
                </label>
                <select
                  value={gameBattingSize}
                  onChange={(e) =>
                    updateGame(selectedGameId, { battingSize: e.target.value })
                  }
                  className="w-full p-2.5 bg-surface border border-line text-xs font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
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
            <div className="bg-surface border border-line rounded-xl p-3 mt-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black uppercase tracking-widest text-ink">
                  Game Type
                </div>
                <div className="text-[10px] text-ink-2 font-medium leading-tight mt-0.5">
                  Pool = spread pitchers across the staff. Bracket = your aces.
                </div>
              </div>
              <select
                value={gameType}
                onChange={(e) =>
                  updateGame(selectedGameId, { gameType: e.target.value })
                }
                className="shrink-0 p-2 text-[11px] font-black uppercase tracking-widest bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
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
                  className={`absolute top-0.5 w-5 h-5 bg-surface rounded-full shadow-sm transition-all ${
                    isBigGame ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black uppercase tracking-widest text-ink flex items-center gap-1.5">
                  <span aria-hidden>⭐</span>
                  Big Game {isBigGame ? "ON" : "OFF"}
                </div>
                <div className="text-[10px] text-ink-2 font-medium leading-tight mt-0.5">
                  {isBigGame
                    ? "Strongest defense possible. Past games don't factor in."
                    : "Off — engine builds a normal lineup."}
                </div>
              </div>
            </div>

            {/* Seasonal fairness toggle — controls whether the engine applies
                cumulative bench debt when generating this game's lineup. Default ON. */}
            <div className="bg-warn-bg border border-line rounded-xl p-3 mt-3 flex items-center gap-3">
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
                    ? "bg-line cursor-not-allowed"
                    : applySeasonalFairness
                    ? "bg-win-bg0"
                    : "bg-slate-300"
                }`}
                aria-label="Toggle even out playing time"
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-surface rounded-full shadow-sm transition-all ${
                    isBigGame || !applySeasonalFairness ? "left-0.5" : "left-5"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[11px] font-black uppercase tracking-widest ${
                    isBigGame ? "text-ink-3" : "text-ink"
                  }`}
                >
                  Even Out Playing Time{" "}
                  {isBigGame ? "(off — Big Game)" : applySeasonalFairness ? "ON" : "OFF"}
                </div>
                <div
                  className={`text-[10px] font-medium leading-tight mt-0.5 ${
                    isBigGame ? "text-ink-3" : "text-ink-3"
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
              const imbalance = buildSeasonBenchImbalance(games, currentGame.id, players);
              const rows = presentPlayers
                .map((p: any) => {
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
                .sort((a: any, b: any) => b.delta - a.delta);
              // Hide if everyone is within 1 inning of their fair share
              const anyImbalance = rows.some((r: any) => Math.abs(r.delta) >= 1);
              if (!anyImbalance) return null;
              return (
                <div className="bg-surface border border-line rounded-xl p-3 mt-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink-2 mb-2 flex items-center gap-2">
                    <Icons.Users className="w-3.5 h-3.5" />
                    Innings Played This Season
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {rows.map((r: any) => {
                      const rounded = Math.round(r.delta);
                      const isOver = rounded > 0;
                      const isUnder = rounded < 0;
                      return (
                        <div
                          key={r.player.id}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] border ${
                            isOver
                              ? "bg-loss-bg border-line"
                              : isUnder
                              ? "bg-win-bg border-line"
                              : "bg-surface border-line"
                          }`}
                        >
                          <span className="font-bold text-ink truncate">
                            {r.player.name.split(" ")[0]}
                          </span>
                          <span
                            className={`font-black tabular-nums shrink-0 ${
                              isOver
                                ? "text-loss"
                                : isUnder
                                ? "text-win"
                                : "text-ink-3"
                            }`}
                          >
                            {isOver ? `+${rounded}` : rounded === 0 ? "0" : rounded}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-ink-3 italic font-medium mt-2">
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
                <div className="px-6 py-4 bg-warn-bg border-b border-warn-bg flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Icons.Clock className="w-4 h-4 text-warnfg" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-warnfg">
                      Final Game Adjustments
                    </span>
                  </div>
                  <label className="inline-flex items-center gap-2 select-none">
                    <span className="text-[10px] font-black uppercase tracking-widest text-ink">
                      Innings Played:
                    </span>
                    <select
                      value={currentInningsPlayed}
                      onChange={(e) => {
                        const target = parseInt(e.target.value, 10);
                        if (!Number.isFinite(target) || target < 1) return;
                        if (target === currentInningsPlayed) return;
                        const updates: Record<string, any> = {};
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
                      className="text-[11px] font-bold p-1.5 bg-surface border border-amber-300 rounded-md outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer tabular-nums"
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
                      <span className="text-[10px] font-bold text-warnfg uppercase tracking-widest">
                        ({currentGame.originalLineup.length - currentGame.lineup.length} inning{currentGame.originalLineup.length - currentGame.lineup.length === 1 ? "" : "s"} trimmed — restorable)
                      </span>
                    )}
                </div>
              );
            })()}

          
            <div className={`grid grid-cols-1 ${canEdit ? "lg:grid-cols-2" : ""} divide-y lg:divide-y-0 lg:divide-x divide-white/40 bg-transparent`}>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-1.5 rounded bg-surface border border-line shadow-sm">
                    <Icons.Users className="w-4 h-4 text-team-primary" />
                  </div>
                  <h3 className="font-black text-ink uppercase tracking-widest text-sm">
                    Game Day Attendance
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {players.map((p: any) => (
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
                          ? "bg-surface border-line text-ink shadow-sm hover:bg-surface-2"
                          : "bg-surface border-line/50 text-ink-3 grayscale opacity-60"
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
                    <div className="p-1.5 rounded bg-surface border border-line shadow-sm">
                      <Icons.MapPin className="w-4 h-4 text-amber-600" />
                    </div>
                    <h3 className="font-black text-ink uppercase tracking-widest text-sm">
                      First Inning Setup
                    </h3>
                  </div>
                  <button
                    onClick={() => setFirstInningLineup({})}
                    className="text-[10px] font-black uppercase tracking-widest text-ink-2 hover:text-ink transition-colors bg-surface px-3 py-1.5 rounded-lg border border-line shadow-sm"
                  >
                    Clear All
                  </button>
                </div>
                {presentCount < 7 ? (
                  <div className="p-5 bg-loss-bg text-loss text-xs font-bold uppercase tracking-wide border border-line rounded-xl flex items-center gap-3 shadow-sm">
                    <Icons.Alert className="w-6 h-6 shrink-0" /> Set at least 7
                    players to 'Present' to configure positions.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 max-w-sm gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {getPositionsForInning(presentCount, gameDefenseSize).map(
                      (pos) => (
                        <div
                          key={pos}
                          className="flex items-center gap-3 bg-surface border border-line rounded-xl p-2 shadow-sm"
                        >
                          <span className="font-black text-[11px] w-8 text-center text-ink shrink-0 uppercase tracking-widest">
                            {pos}
                          </span>
                          <div className="h-6 w-px bg-line shrink-0" />
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
                                : "bg-transparent text-ink-2 hover:bg-surface-2"
                            }`}
                          >
                            <option value="">Auto Assign</option>
                            {presentPlayers.map((p: any) => {
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
          <div className="bg-surface shadow-sm border border-line print:border-none print:shadow-none rounded-2xl overflow-hidden mb-12">
            <div className="p-5 flex flex-col lg:flex-row justify-between items-center gap-4 print:hidden bg-surface border-b border-line">
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
                <h2 className="text-xl font-black text-ink uppercase tracking-wider">
                  Active Lineup Grid
                </h2>
              </div>
              <div className="flex flex-wrap justify-center gap-3 items-center w-full lg:w-auto">
                {canEdit && (
                  <div className="flex items-center bg-surface border border-line rounded-xl overflow-hidden shadow-sm">
                    <button
                      onClick={removeInning}
                      disabled={lineup.length <= 1}
                      aria-label="Remove inning"
                      className="px-4 py-2.5 hover:bg-surface-2 disabled:opacity-50 transition-colors text-ink-2"
                    >
                      <Icons.Minus className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-black px-4 text-ink tracking-widest border-x border-line bg-app/50 py-2.5">
                      {lineup.length} INN
                    </span>
                    <button
                      onClick={addInning}
                      aria-label="Add inning"
                      className="px-4 py-2.5 hover:bg-surface-2 transition-colors text-ink-2"
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
                  className="text-xs bg-surface border border-line text-ink py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
                >
                  <Icons.FileText className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={() => window.print()}
                  className="text-xs bg-surface border border-line text-ink py-2.5 px-5 flex items-center gap-2 font-extrabold uppercase tracking-wider hover:bg-surface-2 transition-colors rounded-xl shadow-sm"
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

            <div className="hidden print:flex p-6 border-b border-line items-center justify-center gap-4 bg-surface">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Team Logo"
                  className="w-24 h-24 object-contain drop-shadow-md"
                />
              )}
              <h2 className="text-3xl font-black uppercase tracking-tighter text-ink">
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
              <div className="p-6 border-t border-line/80 print:hidden bg-transparent">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-line/50">
                  <div className="p-2 rounded-full bg-surface border border-line shadow-sm">
                    <Icons.Bat className="w-5 h-5 text-ink-2" />
                  </div>
                  <h3 className="text-lg font-black text-ink uppercase tracking-widest">
                    Batting Order
                  </h3>
                </div>
                <div className="flex flex-col gap-3 max-w-2xl">
                  {battingLineup.map((p: any, idx: any) => (
                    <div
                      key={`batter_${idx}`}
                      className="bg-surface border border-line p-2.5 shadow-sm rounded-xl transition-all hover:shadow-md hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-4">
                      
                        <div className="flex flex-col items-center gap-1 text-ink-3 border-r border-line/50 pr-3 mr-1">
                          <button
                            onClick={() => moveBatter(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 hover:bg-surface-2 hover:text-team-primary rounded disabled:opacity-30 transition-colors"
                          >
                            <Icons.ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => moveBatter(idx, 1)}
                            disabled={idx === battingLineup.length - 1}
                            className="p-1 hover:bg-surface-2 hover:text-team-primary rounded disabled:opacity-30 transition-colors"
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
                          className="flex-1 text-sm font-black text-ink text-left hover:text-team-primary transition-colors cursor-pointer truncate"
                        >
                          {p.name}
                        </button>
                        {(p.stats?.ab > 0 ||
                          p.stats?.ops > 0 ||
                          p.stats?.avg > 0 ||
                          p.stats?.contact > 0) && (
                          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest flex items-center gap-3 bg-surface px-3 py-1.5 border border-line rounded-lg">
                            <span>
                              {p.stats.h || 0}/{p.stats.ab || 0}
                            </span>
                            <span className="text-ink-3">|</span>
                            <span>
                              AVG:{" "}
                              <span className="text-ink">
                                {formatStat(p.stats.avg)}
                              </span>
                            </span>
                            <span className="text-ink-3">|</span>
                            <span>
                              OPS:{" "}
                              <span className="text-ink">
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
    <div className="bg-surface shadow-sm border border-line rounded-2xl overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface border-b border-line">
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
          <h2 className="text-xl font-black text-ink uppercase tracking-wider flex items-center gap-3">
            Schedule & Lineups
          </h2>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
          {(record.wins > 0 || record.losses > 0 || record.ties > 0) && (
            <RecordBadge record={record} variant="full" />
          )}
          {canEdit && (
            <button
              onClick={() => setGcImportOpen(true)}
              className="w-full sm:w-auto py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-sm whitespace-nowrap bg-surface border border-line-strong text-ink hover:bg-surface-2"
            >
              <Icons.Calendar className="w-4 h-4" /> Import from GameChanger
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setIsAddingGame(true)}
              className="w-full sm:w-auto py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-md whitespace-nowrap"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              <Icons.Plus className="w-4 h-4" /> Add Game
            </button>
          )}
        </div>
      </div>
      <GameChangerImportModal
        open={gcImportOpen}
        onClose={() => setGcImportOpen(false)}
        team={team}
        updateTeam={updateTeam}
        toast={toast}
      />
      {isAddingGame && (
        <div className="p-5 bg-surface border-b border-white/30 flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={newGameForm.date}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, date: e.target.value })
            }
            className="p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 shadow-inner"
          />
          <input
            type="text"
            value={newGameForm.opponent}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, opponent: e.target.value })
            }
            placeholder="Opponent Name"
            className="p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] flex-1 uppercase shadow-inner"
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
            className="p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
          >
            <option value="USSSA">USSSA</option>
            <option value="NKB">NKB</option>
          </select>
          <select
            value={newGameForm.pitchingFormat}
            onChange={(e) =>
              setNewGameForm({ ...newGameForm, pitchingFormat: e.target.value })
            }
            className="p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
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
            className="font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-md transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
            style={{
              backgroundColor: "var(--team-primary)",
              color: "var(--team-tertiary)",
            }}
          >
            <Icons.Save className="w-4 h-4" /> Save
          </button>
          <button
            onClick={() => setIsAddingGame(false)}
            className="bg-surface hover:bg-surface-2 text-ink font-bold uppercase tracking-widest text-xs px-6 py-2.5 rounded-lg shadow-sm border border-line transition-colors flex items-center justify-center"
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
              <Icons.Calendar className="w-16 h-16 text-ink-3 mx-auto mb-4" />
            )}
            <h3 className="font-black uppercase tracking-widest text-ink-3 text-lg mb-2">
              No Games Scheduled
            </h3>
            <p className="text-ink-3 text-sm font-semibold max-w-sm mx-auto">
              Add a game manually or head to Settings to import your schedule.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-4 sm:p-6 bg-transparent">
            {sortedGames.map((game) => {
                const status = game.status || "scheduled";
                const isFinal = isGameFinalized(game);
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
                const [gy, gm, gd] = (game.date || "").split("-");
                const moDate = gy
                  ? new Date(Number(gy), Number(gm) - 1, Number(gd))
                  : null;
                const mo = moDate
                  ? moDate
                      .toLocaleDateString(undefined, { month: "short" })
                      .toUpperCase()
                  : "";
                const dnum = gd ? String(Number(gd)) : "";

                return (
                  <div
                    key={game.id}
                    className={`glass-card relative bg-surface transition-all ${
                      isPostponed ? "opacity-60" : ""
                    }`}
                  >
                    {/* Left accent edge highlights today's game. */}
                    <div
                      className="absolute inset-y-0 left-0 w-1.5"
                      style={{
                        backgroundColor: isToday
                          ? "var(--team-primary)"
                          : "transparent",
                      }}
                    />
                    <div className="p-5 pl-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div className="flex items-start gap-4 sm:gap-5 min-w-0">
                        {/* Scoreboard-style date block */}
                        <div className="shrink-0 w-14 text-center rounded-xl border border-line overflow-hidden shadow-sm">
                          <div
                            className="text-[9px] font-black uppercase tracking-widest py-1"
                            style={{
                              backgroundColor: "var(--team-primary)",
                              color: "var(--team-tertiary)",
                            }}
                          >
                            {mo}
                          </div>
                          <div className="text-2xl font-black tabular-nums text-ink py-1 bg-surface">
                            {dnum}
                          </div>
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
                          <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-tight text-ink">
                            VS. {game.opponent}
                          </h3>
                          {isFinal ? (
                            <span
                              className={`t-chip px-2.5 py-1 rounded-md border tabular-nums ${
                                result === "win"
                                  ? "bg-win-bg text-win border-line"
                                  : result === "loss"
                                  ? "bg-loss-bg text-loss border-line"
                                  : "bg-warn-bg text-warnfg border-line"
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
                            <span className="t-chip bg-surface-2 text-ink px-2.5 py-1 rounded-md border border-line-strong">
                              Postponed
                            </span>
                          ) : game.lineup ? (
                            <>
                              <span className="t-chip bg-win-bg text-win px-2 py-1 rounded-md border border-line">
                                Lineup Ready
                              </span>
                            </>
                          ) : (
                            <span className="t-chip bg-warn-bg text-warnfg px-2 py-1 rounded-md border border-line">
                              Lineup Needed
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-ink-3 uppercase tracking-widest flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Icons.Clock className="w-3.5 h-3.5 shrink-0" />{" "}
                          <span className="whitespace-nowrap">
                            {formatGameDateDisplay(game.date)}
                          </span>{" "}
                          <span className="text-ink-3">|</span>{" "}
                          <span className="whitespace-nowrap">
                            {game.leagueRuleSet || leagueRuleSet}{" "}
                            {game.pitchingFormat || pitchingFormat}
                          </span>
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
                                className="w-4 h-4 rounded border-line-strong cursor-pointer"
                              />
                              <span className="text-[10px] font-black uppercase tracking-widest text-ink-2">
                                Postponed
                              </span>
                            </label>
                            {isPostponed && (
                              <label className="inline-flex items-center gap-2 select-none">
                                <span className="text-[10px] font-black uppercase tracking-widest text-ink-2">
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
                                  className="text-[11px] font-bold p-1.5 bg-surface border border-line-strong rounded-md outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-sm cursor-pointer"
                                />
                              </label>
                            )}
                          </div>

                        </div>
                      </div>
                      <div className="flex items-stretch gap-2 sm:gap-3 w-full sm:w-auto flex-wrap justify-end">
                        {(canEdit || game.lineup) && (
                          <button
                            onClick={() => {
                              setSelectedGameId(game.id);
                              setOpponentName(game.opponent);
                              setLineup(game.lineup || null);
                              setBattingLineup(game.battingLineup || null);
                              setCurrentGameAttendance(game.attendance || {});
                            }}
                            className="flex-1 sm:flex-none min-w-[7rem] text-xs px-3 sm:px-5 py-3 bg-surface text-ink border border-line font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-surface-2 transition-colors rounded-xl shadow-sm whitespace-nowrap"
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
                            className="flex-1 sm:flex-none min-w-[7rem] text-xs px-3 sm:px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 rounded-xl shadow-md whitespace-nowrap"
                          >
                            <Icons.Refresh className="w-4 h-4" /> In-Game
                          </button>
                        )}
                        {!isPostponed && canEdit && (
                          <button
                            onClick={() =>
                              setScoringGameId(isEnteringScore ? null : game.id)
                            }
                            className={`flex-1 sm:flex-none min-w-[7rem] text-xs px-3 sm:px-5 py-3 font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors rounded-xl shadow-sm border whitespace-nowrap ${
                              isFinal
                                ? "bg-surface text-ink border-line hover:bg-surface-2"
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
                            aria-label="Delete game"
                            className="shrink-0 flex items-center justify-center text-ink-3 hover:text-red-600 bg-surface border border-line hover:border-line hover:bg-loss-bg p-3 transition-colors rounded-xl shadow-sm"
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
                        onSave={(ts: any, os: any, inningsPlayed: any) => {
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

      {saveTemplateOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSaveTemplateOpen(false)}
        >
          <div
            className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6">
              <h3 className="text-lg font-black uppercase tracking-tight text-ink mb-1">
                Save Lineup Template
              </h3>
              <p className="text-xs text-ink-3 font-medium mb-4">
                Reusable batting order + defensive plan. Apply it to any
                future game.
              </p>
              <label className="block text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1.5">
                Name
              </label>
              <input
                type="text"
                autoFocus
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveTemplateName.trim()) {
                    saveLineupTemplate?.(saveTemplateName.trim());
                    setSaveTemplateOpen(false);
                  }
                  if (e.key === "Escape") setSaveTemplateOpen(false);
                }}
                className="w-full px-3 py-2.5 bg-surface border border-line text-sm font-bold rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-sm"
              />
              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setSaveTemplateOpen(false)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!saveTemplateName.trim()}
                  onClick={() => {
                    saveLineupTemplate?.(saveTemplateName.trim());
                    setSaveTemplateOpen(false);
                  }}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: primaryColor,
                    color: tertiaryColor,
                  }}
                >
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteTemplateId && (() => {
        const tpl = (team.lineupTemplates || []).find(
          (t: any) => t.id === pendingDeleteTemplateId
        );
        const name = tpl?.name || "this template";
        return (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setPendingDeleteTemplateId(null)}
          >
            <div
              className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-1.5 bg-loss-bg0" />
              <div className="p-5 sm:p-6">
                <h3 className="text-lg font-black uppercase tracking-tight text-ink mb-1">
                  Delete Template?
                </h3>
                <p className="text-sm text-ink font-medium mb-5">
                  "{name}" will be removed from your saved templates.
                  Games using this template aren't affected.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteTemplateId(null)}
                    className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      deleteLineupTemplate?.(pendingDeleteTemplateId);
                      setPendingDeleteTemplateId(null);
                    }}
                    className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
});
