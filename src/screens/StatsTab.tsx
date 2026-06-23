import React, {
  ComponentType,
  CSSProperties,
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import type {
  EvaluationEvent,
  Game,
  Player,
  PlayerStats,
  Team,
} from "../types";
import { PositionVarietyPanel } from "../components/PositionVarietyPanel";
import { ArmCarePanel } from "../components/ArmCarePanel";
import { ImportCsvButton } from "../components/ImportCsvButton";
import {
  getCombinedGrades,
  calculateTotalScore,
  analyzePitchingWorkload,
  resolvePitchRuleSet,
} from "../lineupEngine";
import {
  buildSeasonBenchImbalance,
  recentGameLines,
  aggregateGameLines,
  isDepartedPlayer,
} from "../utils/helpers";
import type { BenchImbalanceEntry } from "../utils/helpers";
import { isKidPitchFormat } from "../constants/ui";
import { Sparkline } from "../components/charts/Sparkline";

// Stats & Dashboard — one place that pulls together everything already imported
// (GameChanger batting/pitching/fielding) plus eval data:
//   • a sortable per-player table across Batting / Pitching / Fielding, each row
//     also showing the eval Total Score, tap-through to the full profile
//   • bench equity & attendance (who's sitting more than their share)
//   • position variety
// Read-only and additive — nothing here writes. All numbers come from data the
// coach already imported, so there's no new manual entry.

type Kind = "int" | "dec1" | "dec3" | "dec2" | "pct" | "ip";

const numOf = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

// Format a stat the way the rest of the app does: drop the leading 0 on sub-1
// rate stats (.345), percents from 0–1 fractions, IP as 5.2 = 5⅔.
const fmt = (n: number | undefined, kind: Kind): string => {
  if (n === undefined) return "—";
  switch (kind) {
    case "int":
      return Math.round(n).toString();
    case "dec1":
      return n.toFixed(1);
    case "dec3":
      return n > 0 && n < 1 ? n.toFixed(3).replace(/^0/, "") : n.toFixed(3);
    case "dec2":
      return n.toFixed(2);
    case "pct":
      return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
    case "ip":
      return n.toFixed(1);
  }
};

interface StatRow {
  id: string;
  name: string;
  number?: string | number;
  primaryPosition?: string;
  stats: PlayerStats;
  total: number; // eval Total Score (0–100)
}

interface Col {
  key: string;
  label: string;
  kind: Kind;
  hi: boolean; // higher is better → default descending + green-tints not used, just sort dir
  get: (r: StatRow) => number | undefined;
}

// Read a stat field; some columns prefer the section-namespaced advanced field
// (two-row GameChanger export) and fall back to the basic single-section key.
const f = (field: string) => (r: StatRow) => numOf(r.stats?.[field]);
const fb = (adv: string, basic: string) => (r: StatRow) =>
  numOf(r.stats?.[adv]) ?? numOf(r.stats?.[basic]);

const BATTING_COLS: Col[] = [
  { key: "ab", label: "AB", kind: "int", hi: true, get: f("ab") },
  { key: "avg", label: "AVG", kind: "dec3", hi: true, get: f("avg") },
  { key: "obp", label: "OBP", kind: "dec3", hi: true, get: f("obp") },
  { key: "ops", label: "OPS", kind: "dec3", hi: true, get: f("ops") },
  { key: "h", label: "H", kind: "int", hi: true, get: f("h") },
  { key: "doubles", label: "2B", kind: "int", hi: true, get: f("doubles") },
  { key: "triples", label: "3B", kind: "int", hi: true, get: f("triples") },
  { key: "hr", label: "HR", kind: "int", hi: true, get: f("hr") },
  { key: "rbi", label: "RBI", kind: "int", hi: true, get: f("rbi") },
  { key: "sb", label: "SB", kind: "int", hi: true, get: f("sb") },
  { key: "k", label: "K", kind: "int", hi: false, get: f("k") },
  { key: "qab", label: "QAB%", kind: "pct", hi: true, get: f("qab") },
];

const PITCHING_COLS: Col[] = [
  { key: "ip", label: "IP", kind: "ip", hi: true, get: fb("pIp", "ip") },
  { key: "era", label: "ERA", kind: "dec2", hi: false, get: fb("pEra", "era") },
  { key: "whip", label: "WHIP", kind: "dec2", hi: false, get: f("pWhip") },
  { key: "spct", label: "S%", kind: "pct", hi: true, get: f("pStrikePct") },
  { key: "fps", label: "FPS%", kind: "pct", hi: true, get: f("pFps") },
  { key: "kbb", label: "K/BB", kind: "dec2", hi: true, get: f("pKbb") },
  { key: "sm", label: "SM%", kind: "pct", hi: true, get: f("pSwingMiss") },
  { key: "weak", label: "WEAK%", kind: "pct", hi: true, get: f("pWeak") },
  { key: "hhb", label: "HHB%", kind: "pct", hi: false, get: f("pHardPct") },
  { key: "goao", label: "GO/AO", kind: "dec2", hi: true, get: f("pGoAo") },
  { key: "baa", label: "BAA", kind: "dec3", hi: false, get: f("pBaa") },
  { key: "top", label: "Top", kind: "dec1", hi: true, get: f("pTopMph") },
  { key: "bf", label: "BF", kind: "int", hi: true, get: f("pBf") },
  { key: "tp", label: "TP", kind: "int", hi: true, get: f("totalPitches") },
];

const FIELDING_COLS: Col[] = [
  {
    key: "fpct",
    label: "FPCT",
    kind: "dec3",
    hi: true,
    get: fb("fFpct", "fpct"),
  },
  { key: "tc", label: "TC", kind: "int", hi: true, get: fb("fTc", "tc") },
  { key: "po", label: "PO", kind: "int", hi: true, get: fb("fPutouts", "po") },
  { key: "a", label: "A", kind: "int", hi: true, get: fb("fAssists", "a") },
  { key: "e", label: "E", kind: "int", hi: false, get: f("fErrors") },
  { key: "cspct", label: "CS%", kind: "pct", hi: true, get: f("fCsPct") },
  { key: "pb", label: "PB", kind: "int", hi: false, get: f("fPb") },
];

// The eval Total Score column, shared across all three category views.
const OVERALL_COL: Col = {
  key: "total",
  label: "Overall",
  kind: "int",
  hi: true,
  get: (r) => r.total,
};

const CATEGORIES = [
  { id: "batting", label: "Batting", cols: BATTING_COLS, defaultKey: "ops" },
  { id: "pitching", label: "Pitching", cols: PITCHING_COLS, defaultKey: "era" },
  {
    id: "fielding",
    label: "Fielding",
    cols: FIELDING_COLS,
    defaultKey: "fpct",
  },
] as const;

// Tiny eval-trend sparkline: a player's average grade across their eval rounds,
// drawn on a fixed 1–5 scale so rows are comparable. Trends up → team color,
// down → red, flat → neutral gray. Renders nothing with fewer than two rounds
// of data.
const EvalSparkline = memo(({ values }: { values?: number[] }) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const color =
    last > first
      ? "var(--team-primary)"
      : last < first
        ? "var(--loss)"
        : "var(--ink-3)";
  return (
    <Sparkline
      values={values.map((v: number) => Math.max(1, Math.min(5, v)))}
      domain={[1, 5]}
      stroke={color}
      strokeWidth={1.5}
      fill={color}
    />
  );
});

// Sortable per-player stats table for one category. Remounted (via key) when the
// category changes so the sort resets to that category's marquee stat.
const StatsTable = memo(
  ({
    rows,
    cols,
    defaultKey,
    onOpen,
    seriesById,
  }: {
    rows: StatRow[];
    cols: Col[];
    defaultKey: string;
    onOpen?: (id: string) => void;
    seriesById?: Map<string, number[]> | null;
  }) => {
    const allCols: Col[] = useMemo(() => [OVERALL_COL, ...cols], [cols]);
    const initial = useMemo(
      () => allCols.find((c) => c.key === defaultKey) || allCols[0],
      [allCols, defaultKey],
    );
    const [sortKey, setSortKey] = useState<string>(initial.key);
    const [asc, setAsc] = useState<boolean>(!initial.hi);

    const sorted = useMemo(() => {
      const col = allCols.find((c) => c.key === sortKey) || initial;
      const dir = asc ? 1 : -1;
      return [...rows].sort((a, b) => {
        const av = col.get(a);
        const bv = col.get(b);
        // Players with no value for this column always sink to the bottom.
        if (av === undefined && bv === undefined)
          return String(a.name).localeCompare(String(b.name));
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        if (av === bv) return String(a.name).localeCompare(String(b.name));
        return (av - bv) * dir;
      });
    }, [rows, allCols, sortKey, asc, initial]);

    const clickHeader = (col: Col) => {
      if (col.key === sortKey) setAsc((p) => !p);
      else {
        setSortKey(col.key);
        setAsc(!col.hi); // higher-is-better starts descending
      }
    };

    return (
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead className="bg-surface-2 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 t-eyebrow text-ink-2 text-left sticky left-0 bg-surface-2 z-20 border-r border-line">
                Player
              </th>
              {allCols.map((col) => {
                const active = col.key === sortKey;
                return (
                  <th key={col.key} className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => clickHeader(col)}
                      className={`t-eyebrow inline-flex items-center gap-0.5 hover:text-ink ${
                        active ? "text-ink" : "text-ink-3"
                      }`}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      {active &&
                        (asc ? (
                          <Icons.ChevronUp className="w-3 h-3" />
                        ) : (
                          <Icons.ChevronDown className="w-3 h-3" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r: StatRow) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <td className="px-4 py-3 sticky left-0 bg-surface z-10 border-r border-line">
                  <button
                    type="button"
                    onClick={() => onOpen?.(r.id)}
                    className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate flex items-baseline gap-1.5"
                  >
                    {r.name}
                    {r.number != null && r.number !== "" && (
                      <span className="text-[10px] text-ink-3 font-bold tabular-nums">
                        #{r.number}
                      </span>
                    )}
                  </button>
                  {seriesById?.get(r.id) && (
                    <span
                      className="block mt-0.5"
                      title="Eval grade trend across rounds"
                    >
                      <EvalSparkline values={seriesById.get(r.id)} />
                    </span>
                  )}
                </td>
                {allCols.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-center tabular-nums ${
                      col.key === sortKey
                        ? "font-black text-ink"
                        : "font-bold text-ink-2"
                    }`}
                  >
                    {col.key === "total"
                      ? r.total > 0
                        ? r.total
                        : "—"
                      : fmt(col.get(r), col.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
);

// Bench equity & attendance — who's sitting more (or less) than their fair share
// across finalized games. extraSits > 0 means benched beyond the even split.
interface BenchEquityRow {
  p: Player;
  e: BenchImbalanceEntry;
}

const BenchEquityTable = memo(
  ({
    rows,
    onOpen,
  }: {
    rows: BenchEquityRow[];
    onOpen?: (id: string) => void;
  }) => {
    if (rows.length === 0) return null;
    return (
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead className="bg-surface-2 text-ink-2">
            <tr>
              <th className="p-2.5 t-eyebrow text-left">Player</th>
              <th className="p-2.5 t-eyebrow text-center">GP</th>
              <th className="p-2.5 t-eyebrow text-center">Def Inn</th>
              <th className="p-2.5 t-eyebrow text-center">Bench Inn</th>
              <th className="p-2.5 t-eyebrow text-center">Sits +/−</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ p, e }) => {
              const over = e.extraSits > 0.5;
              const under = e.extraSits < -0.5;
              return (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => onOpen?.(p.id)}
                      className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate"
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                    {e.gamesAttended}
                  </td>
                  <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                    {Math.round(e.totalDefense)}
                  </td>
                  <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                    {Math.round(e.totalBench)}
                  </td>
                  <td
                    className={`p-2 text-center tabular-nums font-black ${
                      over ? "text-loss" : under ? "text-win" : "text-ink-3"
                    }`}
                  >
                    {e.extraSits > 0 ? "+" : ""}
                    {e.extraSits.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
);

const SectionCard = ({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) => (
  <div className="border-b border-line pb-6">
    <div className="px-1 py-4 flex items-center gap-3">
      <div
        className="p-2 rounded-full shrink-0"
        style={{ backgroundColor: "var(--team-primary-15)" }}
      >
        <Icon className="w-5 h-5" style={{ color: "var(--team-primary)" }} />
      </div>
      <div className="min-w-0">
        <h2 className="t-h2">{title}</h2>
        {subtitle && <p className="t-eyebrow text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

export const StatsTab = memo(() => {
  const { team: teamRaw, currentRole, uploadStatsCsv } = useTeam();
  const { openPlayerProfile } = useUI();
  const canEdit = currentRole !== "assistant";
  // TeamContextValue.team is intentionally `any` (see types.ts); narrow it to
  // the known Team shape for this screen.
  const team = teamRaw as Team;
  const stripped = team.statDisplay === "stripped";
  // Departed players are excluded everywhere but the Roster tab.
  const players: Player[] = useMemo(
    () => (team.players || []).filter((p: Player) => !isDepartedPlayer(p)),
    [team],
  );
  const games: Game[] = useMemo(() => team.games || [], [team]);
  const evaluationEvents: EvaluationEvent[] = useMemo(
    () => team.evaluationEvents || [],
    [team],
  );

  const [category, setCategory] = useState<string>("batting");
  const [statFormat, setStatFormat] = useState<"all" | "machine" | "kid">(
    "all",
  );
  const activeCat = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];

  const filteredGames = useMemo(() => {
    if (statFormat === "all") return games;
    return games.filter((g) => {
      const fmt = String(g.pitchingFormat || team.pitchingFormat || "");
      const kid = isKidPitchFormat(fmt);
      return statFormat === "kid" ? kid : !kid;
    });
  }, [games, statFormat, team]);

  const statScopeLabel =
    statFormat === "kid"
      ? "Kid Pitch"
      : statFormat === "machine"
        ? "Machine/Coach Pitch"
        : "All Formats";

  const scopedStatsForPlayer = useCallback(
    (p: Player): PlayerStats => {
      if (statFormat === "all") return p.stats || {};
      const lines = filteredGames
        .map((g) => g?.playerStats?.[p.id])
        .filter(
          (line): line is PlayerStats => !!line && typeof line === "object",
        );
      return lines.length > 0 ? aggregateGameLines(lines) : {};
    },
    [filteredGames, statFormat],
  );

  // Eval Total Score per player, surfaced as the "Overall" column.
  const rows: StatRow[] = useMemo(() => {
    const grades = getCombinedGrades(evaluationEvents, players, {
      teamAge: team.teamAge,
      games,
    });
    return players.map((p) => {
      const scopedStats = scopedStatsForPlayer(p);
      return {
        id: p.id,
        name: p.name,
        number: p.number,
        primaryPosition: p.primaryPosition,
        stats: scopedStats,
        total: calculateTotalScore(grades[p.id], scopedStats),
      };
    });
  }, [players, evaluationEvents, team, games, scopedStatsForPlayer]);

  const benchRows = useMemo(() => {
    const m = buildSeasonBenchImbalance(games, "", players);
    return players
      .map((p) => ({ p, e: m.get(p.id) }))
      .filter((x): x is BenchEquityRow => !!x.e && x.e.gamesAttended > 0)
      .sort((a, b) => b.e.extraSits - a.e.extraSits);
  }, [games, players]);

  // Recent form — from per-game imported stat lines (Schedule → Import Stats
  // on a finalized game). Aggregates each player's last 3 game lines and
  // compares recent AVG (or QAB% when AVG is absent) against their season
  // number: hot ↑, cold ↓. Players without per-game lines don't appear.
  const recentForm = useMemo(() => {
    type RecentFormRow = {
      p: Player;
      agg: Record<string, number>;
      games: number;
      delta: number | null;
      basis: "avg" | "qab" | null;
    };
    return players
      .map((p): RecentFormRow | null => {
        const lines = recentGameLines(filteredGames, p.id, 3);
        if (lines.length === 0) return null;
        const agg = aggregateGameLines(lines.map((l) => l.line));
        const scopedStats = scopedStatsForPlayer(p);
        const seasonAvg = Number(scopedStats?.avg);
        const seasonQab = Number(scopedStats?.qab);
        let delta: number | null = null;
        let basis: "avg" | "qab" | null = null;
        if (
          Number.isFinite(agg.avg) &&
          Number.isFinite(seasonAvg) &&
          seasonAvg > 0
        ) {
          delta = agg.avg - seasonAvg;
          basis = "avg";
        } else if (
          Number.isFinite(agg.qab) &&
          Number.isFinite(seasonQab) &&
          seasonQab > 0
        ) {
          delta = agg.qab - seasonQab;
          basis = "qab";
        }
        return { p, agg, games: lines.length, delta, basis };
      })
      .filter((r): r is RecentFormRow => r !== null)
      .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  }, [filteredGames, players, scopedStatsForPlayer]);

  // Per-player eval-grade trend (avg grade per Head round, chronological) for
  // the inline sparkline. Only players with ≥2 rounds get a line.
  const seriesById = useMemo(() => {
    const heads = (evaluationEvents || [])
      .filter((e) => e.coachRole === "Head")
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const map = new Map<string, number[]>();
    for (const p of players) {
      const series: number[] = [];
      for (const ev of heads) {
        const g = ev.grades?.[p.id];
        if (!g) continue;
        const vals = Object.values(g).filter(
          (v) => typeof v === "number" && Number.isFinite(v),
        ) as number[];
        if (vals.length)
          series.push(vals.reduce((s, v) => s + v, 0) / vals.length);
      }
      if (series.length >= 2) map.set(p.id, series);
    }
    return map;
  }, [evaluationEvents, players]);

  // Arm-care overuse flags (Kid-Pitch head coaches only), surfaced as a banner.
  const armAlerts = useMemo(() => {
    if (!(currentRole === "head" && isKidPitchFormat(team.pitchingFormat)))
      return [];
    const ruleSet = resolvePitchRuleSet(team);
    const out: Array<{ id: string; name: string; messages: string[] }> = [];
    for (const p of players) {
      const w = analyzePitchingWorkload(p.pitching, ruleSet);
      if (w.alerts && w.alerts.length)
        out.push({
          id: p.id,
          name: p.name,
          messages: w.alerts.map((a) => a.message),
        });
    }
    return out;
  }, [players, team, currentRole]);

  if (players.length === 0) {
    return (
      <div className="space-y-6">
        <div className="py-8 text-center text-ink-3 font-medium">
          <div className="text-4xl leading-none mb-3 opacity-80" aria-hidden>
            📊
          </div>
          Add players and import stats to see your team&apos;s numbers here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Arm-care overuse banner — full width, always first. */}
      {armAlerts.length > 0 && (
        <div className="border-l-4 border-l-warnfg">
          <div className="p-4 sm:p-5 bg-warn-bg flex items-start gap-3">
            <Icons.Alert className="w-5 h-5 text-warnfg shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-widest text-warnfg">
                Arm Care — {armAlerts.length} pitcher
                {armAlerts.length === 1 ? "" : "s"} need attention
              </h2>
              <ul className="mt-1.5 space-y-1">
                {armAlerts.map((a) => (
                  <li key={a.id} className="text-[12px] text-ink leading-snug">
                    <button
                      type="button"
                      onClick={() => openPlayerProfile(a.id)}
                      className="font-black uppercase tracking-tight hover:text-team-primary"
                    >
                      {a.name}
                    </button>
                    <span className="text-ink-2 font-medium">
                      {" "}
                      — {a.messages.join("; ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Desktop control-panel: two-column layout.
          Left col (8/12): Recent Form + Player Stats — the dense data tables.
          Right col (4/12): Bench Equity + Position/Arm-Care panels — context rail.
          Mobile/tablet: single-column stack, unchanged. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-6 lg:space-y-0">
        <div className="lg:col-span-8 space-y-6">
          {/* Recent form — who's hot / cold over their last imported game lines. */}
          {recentForm.length > 0 && (
            <SectionCard icon={Icons.Chart} title="Recent Form">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                  <thead className="bg-surface-2 text-ink-2">
                    <tr>
                      <th className="p-2.5 t-eyebrow text-left">Player</th>
                      <th className="p-2.5 t-eyebrow text-center">Games</th>
                      <th className="p-2.5 t-eyebrow text-center">AB</th>
                      <th className="p-2.5 t-eyebrow text-center">H</th>
                      <th className="p-2.5 t-eyebrow text-center">AVG</th>
                      <th className="p-2.5 t-eyebrow text-center">QAB%</th>
                      <th className="p-2.5 t-eyebrow text-center">Hard%</th>
                      <th className="p-2.5 t-eyebrow text-center">Form</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recentForm.map(({ p, agg, games: n, delta, basis }) => (
                      <tr key={p.id} className="hover:bg-surface-2">
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => openPlayerProfile(p.id)}
                            className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate"
                          >
                            {p.name}
                          </button>
                        </td>
                        <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                          {n}
                        </td>
                        <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                          {fmt(numOf(agg.ab), "int")}
                        </td>
                        <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                          {fmt(numOf(agg.h), "int")}
                        </td>
                        <td className="p-2 text-center tabular-nums font-black text-ink">
                          {fmt(numOf(agg.avg), "dec3")}
                        </td>
                        <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                          {fmt(numOf(agg.qab), "pct")}
                        </td>
                        <td className="p-2 text-center tabular-nums font-bold text-ink-2">
                          {fmt(numOf(agg.hard), "pct")}
                        </td>
                        <td className="p-2 text-center">
                          {delta == null ? (
                            <span className="text-ink-3 font-bold">—</span>
                          ) : delta > 0.02 ? (
                            <span
                              className="text-xs font-black uppercase tracking-widest text-win"
                              title={`Recent ${basis === "qab" ? "QAB%" : "AVG"} above season`}
                            >
                              Hot ↑
                            </span>
                          ) : delta < -0.02 ? (
                            <span
                              className="text-xs font-black uppercase tracking-widest text-loss"
                              title={`Recent ${basis === "qab" ? "QAB%" : "AVG"} below season`}
                            >
                              Cold ↓
                            </span>
                          ) : (
                            <span className="text-xs font-black uppercase tracking-widest text-ink-3">
                              Steady
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Per-player stats table with category toggle */}
          <SectionCard
            icon={Icons.Bat}
            title="Player Stats"
            subtitle={`Showing ${statScopeLabel} stats${statFormat === "all" ? "" : " from per-game imports"}`}
          >
            <div className="px-1 py-3 border-b border-line flex flex-wrap gap-2 items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const on = c.id === category;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border transition-colors"
                      style={
                        on
                          ? {
                              backgroundColor: "var(--team-primary)",
                              color: "var(--team-tertiary)",
                              borderColor: "var(--team-primary)",
                            }
                          : undefined
                      }
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "All Formats"],
                  ["machine", "Machine/Coach"],
                  ["kid", "Kid Pitch"],
                ].map(([id, label]) => {
                  const on = statFormat === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setStatFormat(id as "all" | "machine" | "kid")
                      }
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border transition-colors ${
                        on
                          ? "border-team-primary text-team-primary"
                          : "border-line text-ink-2"
                      }`}
                      title="Filter stat lines by game pitching format"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <StatsTable
              key={activeCat.id}
              rows={rows}
              cols={activeCat.cols}
              defaultKey={activeCat.defaultKey}
              onOpen={openPlayerProfile}
              seriesById={stripped ? null : seriesById}
            />
          </SectionCard>
        </div>
        {/* end left col */}

        {/* Right rail: Bench Equity + Position/Arm-Care panels */}
        <div className="lg:col-span-4 space-y-6">
          {benchRows.length > 0 && (
            <SectionCard icon={Icons.Clock} title="Bench Equity & Attendance">
              <BenchEquityTable rows={benchRows} onOpen={openPlayerProfile} />
            </SectionCard>
          )}
          <PositionVarietyPanel />
          <ArmCarePanel />
        </div>
        {/* end right col */}
      </div>
      {/* end desktop grid */}
      {canEdit && (
        <ImportCsvButton
          id="stats-import-csv"
          label="Import Stats"
          onChange={uploadStatsCsv}
          hint="GameChanger season stats CSV"
        />
      )}
    </div>
  );
});
