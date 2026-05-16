import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { formatGameDateDisplay } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";
import { LeaderboardCard, RecordBadge } from "../components/shared.jsx";

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

  let whenLabel;
  if (dayDiff === 0) whenLabel = "Today";
  else if (dayDiff === 1) whenLabel = "Tomorrow";
  else {
    const [y, m, d] = game.date.split("-");
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    whenLabel = dateObj.toLocaleDateString(undefined, { weekday: "long" });
  }

  const fullDate = formatGameDateDisplay(game.date);

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
                  ⭐
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

export const HomeTab = memo(() => {
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
