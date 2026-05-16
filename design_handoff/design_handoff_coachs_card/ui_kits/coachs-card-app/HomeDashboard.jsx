/* global React, CCApp */
const { memo, useMemo } = React;
const { Lucide, BaseballIcon } = window.CCApp;

const formatStat = (v) => {
  if (v == null) return "—";
  return v.toFixed(3).replace(/^0/, "");
};

// ───────────────────────────────────────────────────────────── UpcomingGameCard
const UpcomingGameCard = memo(({ team, game }) => {
  if (!game) return null;
  return (
    <div className="rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 overflow-hidden bg-white/40">
      <div className="h-1.5" style={{ backgroundColor: team.primaryColor }} />
      <div className="p-6 flex items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner"
            style={{ backgroundColor: `${team.primaryColor}15` }}
          >
            <Lucide.Calendar width="28" height="28" style={{ color: team.primaryColor }} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md"
                style={{ backgroundColor: team.primaryColor, color: team.tertiaryColor }}
              >
                Today
              </span>
              <span className="bg-green-50 text-green-700 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border border-green-200">
                Lineup Ready
              </span>
            </div>
            <h3 className="font-black text-2xl text-slate-900 uppercase tracking-tight leading-tight">
              {game.isBigGame && <span className="text-yellow-500 mr-1.5">⚡</span>}
              VS. {game.opponent}
            </h3>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1 flex items-center gap-2">
              <Lucide.Clock width="14" height="14" /> Sat · May 11 · 10:30 AM
              <span className="text-slate-300">|</span>
              <span>{game.leagueRuleSet || team.leagueRuleSet} {game.pitchingFormat || team.pitchingFormat}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center gap-2 rounded-xl shadow-lg bg-green-600 text-white hover:bg-green-700">
            <Lucide.Refresh width="16" height="16" /> In-Game
          </button>
          <button
            className="text-xs px-6 py-3 font-black uppercase tracking-widest flex items-center gap-2 rounded-xl shadow-md text-white"
            style={{ backgroundColor: team.primaryColor }}
          >
            <Lucide.Edit width="16" height="16" /> Edit Lineup
          </button>
        </div>
      </div>
    </div>
  );
});

// ───────────────────────────────────────────────────────────── TeamSummary
const TeamSummary = memo(({ team, players, games, coaches }) => {
  const headCoaches = coaches.filter((c) => c.role === "Head Coach");
  const assistantCoaches = coaches.filter((c) => c.role === "Assistant Coach");
  return (
    <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl p-8 flex justify-between items-start gap-8">
      <div>
        <h2 className="font-black text-4xl uppercase tracking-tight text-slate-900 mb-3">
          {team.name}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs font-black text-slate-600 uppercase tracking-widest mb-4">
          {[team.currentSeason, team.teamAge, team.leagueRuleSet, team.pitchingFormat].map((t) => (
            <span key={t} className="bg-white/80 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              {t}
            </span>
          ))}
        </div>
        <div className="inline-flex items-center gap-3 bg-white/80 px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm mb-6">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Record</span>
          <span className="text-base font-black tabular-nums text-slate-900">
            {team.record.wins}-{team.record.losses}
          </span>
          <span className="h-4 w-px bg-slate-300" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">RS</span>
          <span className="text-sm font-black tabular-nums text-slate-900">{team.record.runsScored}</span>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">RA</span>
          <span className="text-sm font-black tabular-nums text-slate-900">{team.record.runsAllowed}</span>
        </div>
        <div className="space-y-3 bg-white/60 p-5 rounded-xl border border-slate-200 shadow-sm inline-block min-w-[320px]">
          <div className="flex items-start gap-3">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400 w-32 shrink-0 pt-0.5">Head Coach:</span>
            <span className="text-sm font-bold text-slate-800">{headCoaches.map((c) => c.name).join(", ")}</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400 w-32 shrink-0 pt-0.5">Assistant Coaches:</span>
            <span className="text-sm font-bold text-slate-800">{assistantCoaches.map((c) => c.name).join(", ")}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-4">
        <div className="bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
          <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Roster Size</span>
          <span className="block text-3xl font-black text-slate-900">{players.length}</span>
        </div>
        <div className="bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl">
          <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Games</span>
          <span className="block text-3xl font-black text-slate-900">{games.length}</span>
        </div>
      </div>
    </div>
  );
});

// ───────────────────────────────────────────────────────────── LeaderboardCard
const LeaderboardCard = memo(({ title, iconName, statKey, formatStr, asc, players, team }) => {
  const sorted = useMemo(() => {
    return [...players]
      .filter((p) => (asc ? p.stats?.[statKey] : (p.stats?.[statKey] || 0) > 0))
      .sort((a, b) => {
        const va = a.stats?.[statKey] || 0;
        const vb = b.stats?.[statKey] || 0;
        return asc ? va - vb : vb - va;
      })
      .slice(0, 3);
  }, [players, statKey, asc]);

  return (
    <div className="bg-white/30 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 overflow-hidden hover:-translate-y-1 transition-transform duration-300">
      <div className="p-5 border-b border-white/40 flex items-center gap-4 bg-white/20">
        <div className="p-2.5 rounded-full" style={{ backgroundColor: `${team.primaryColor}15` }}>
          <BaseballIcon name={iconName} style={{ width: 20, height: 20, color: team.primaryColor, filter: `none` }} />
        </div>
        <h4 className="font-extrabold text-[11px] uppercase tracking-widest text-slate-700">{title}</h4>
      </div>
      <div className="p-5 space-y-4">
        {sorted.length > 0 ? sorted.map((p, i) => (
          <div key={p.id} className="flex justify-between items-center">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-black text-slate-500 w-4 shrink-0">{i + 1}.</span>
              <span className="text-sm font-extrabold text-slate-800 truncate">{p.name}</span>
            </div>
            <span
              className="text-sm font-black tabular-nums px-3 py-1 rounded-lg shadow-sm border border-white/50 shrink-0 ml-2 text-white"
              style={{ backgroundColor: team.primaryColor }}
            >
              {formatStr ? formatStat(p.stats[statKey]) : (p.stats[statKey] || 0).toString()}
            </span>
          </div>
        )) : (
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center py-6">Data Void</div>
        )}
      </div>
    </div>
  );
});

const HITTING = [
  { title: "Batting Average", statKey: "avg", formatStr: true },
  { title: "On Base Pct", statKey: "obp", formatStr: true },
  { title: "OPS Rating", statKey: "ops", formatStr: true },
  { title: "Total Hits", statKey: "h", formatStr: false },
];

const HomeDashboard = ({ team, players, games, coaches }) => {
  const upcoming = games.find((g) => g.status === "scheduled" && g.lineup);
  return (
    <div className="space-y-8">
      <UpcomingGameCard team={team} game={upcoming} />
      <TeamSummary team={team} players={players} games={games} coaches={coaches} />
      <div>
        <div className="flex items-center gap-3 mb-6 px-2">
          <div className="p-2 rounded-full bg-white/40 shadow-sm border border-white/50">
            <BaseballIcon name="bat" style={{ width: 20, height: 20, color: "#475569" }} />
          </div>
          <h3 className="text-lg font-black uppercase tracking-widest text-slate-800">Hitting Leaders</h3>
        </div>
        <div className="grid grid-cols-4 gap-6">
          {HITTING.map((s) => (
            <LeaderboardCard key={s.statKey} {...s} iconName="bat" players={players} team={team} />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-3 mb-6 px-2 mt-10">
          <div className="p-2 rounded-full bg-white/40 shadow-sm border border-white/50">
            <BaseballIcon name="glove" style={{ width: 20, height: 20, color: "#475569" }} />
          </div>
          <h3 className="text-lg font-black uppercase tracking-widest text-slate-800">Fielding Leaders</h3>
        </div>
        <div className="grid grid-cols-4 gap-6">
          <LeaderboardCard title="Fielding Pct" iconName="glove" statKey="fpct" formatStr players={players} team={team} />
          <LeaderboardCard title="Total Chances" iconName="glove" statKey="tc" players={players} team={team} />
          <LeaderboardCard title="Putouts" iconName="glove" statKey="po" players={players} team={team} />
          <LeaderboardCard title="Assists" iconName="glove" statKey="a" players={players} team={team} />
        </div>
      </div>
    </div>
  );
};

window.CCApp.HomeDashboard = HomeDashboard;
