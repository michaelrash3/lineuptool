import React, { memo, useMemo } from "react";
import { Modal } from "./shared";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import { getEvalCategoriesForTeam } from "../constants/ui";
import { currentEvaluationScore100 } from "../utils/evaluationScore";

// Per-player development one-pager: this season's stat line, evaluation
// (latest grade per category + within-season trend), season-over-season stat
// growth (from archived pastSeasons), attendance, and coach notes. Read-only;
// shareable via Copy and printable. Doubles as the banquet per-kid card.

type Kind = "int" | "dec2" | "dec3" | "pct" | "ip";

const num = (v: any): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const read = (stats: any, ...keys: string[]): number | undefined => {
  for (const k of keys) {
    const n = num(stats?.[k]);
    if (n !== undefined) return n;
  }
  return undefined;
};

const fmt = (n: number | undefined, kind: Kind): string => {
  if (n === undefined) return "—";
  switch (kind) {
    case "int":
      return Math.round(n).toString();
    case "dec2":
      return n.toFixed(2);
    case "dec3":
      return n > 0 && n < 1 ? n.toFixed(3).replace(/^0/, "") : n.toFixed(3);
    case "pct":
      return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
    case "ip":
      return n.toFixed(1);
  }
};

interface Def {
  key: string;
  label: string;
  kind: Kind;
  alts?: string[];
  hi: boolean; // higher is better (for growth delta coloring)
}

const BATTING: Def[] = [
  { key: "avg", label: "AVG", kind: "dec3", hi: true },
  { key: "obp", label: "OBP", kind: "dec3", hi: true },
  { key: "ops", label: "OPS", kind: "dec3", hi: true },
  { key: "h", label: "H", kind: "int", hi: true },
  { key: "hr", label: "HR", kind: "int", hi: true },
  { key: "rbi", label: "RBI", kind: "int", hi: true },
  { key: "sb", label: "SB", kind: "int", hi: true },
  { key: "ab", label: "AB", kind: "int", hi: true },
];

const PITCHING: Def[] = [
  { key: "ip", label: "IP", kind: "ip", alts: ["pIp"], hi: true },
  { key: "era", label: "ERA", kind: "dec2", alts: ["pEra"], hi: false },
  { key: "whip", label: "WHIP", kind: "dec2", alts: ["pWhip"], hi: false },
  { key: "kbb", label: "K/BB", kind: "dec2", alts: ["pKbb"], hi: true },
];

const FIELDING: Def[] = [
  { key: "fpct", label: "FPCT", kind: "dec3", alts: ["fFpct"], hi: true },
  { key: "po", label: "PO", kind: "int", alts: ["fPutouts"], hi: true },
  { key: "a", label: "A", kind: "int", alts: ["fAssists"], hi: true },
  { key: "e", label: "E", kind: "int", alts: ["fErrors"], hi: false },
];

const getStat = (stats: any, d: Def) => read(stats, d.key, ...(d.alts || []));

const StatGrid = memo(
  ({ title, defs, stats }: { title: string; defs: Def[]; stats: any }) => (
    <div>
      <div className="t-eyebrow text-ink-3 mb-1.5">{title}</div>
      <div className="grid grid-cols-4 gap-1.5">
        {defs.map((d) => (
          <div
            key={d.key}
            className="bg-surface-2 border border-line rounded-lg px-1.5 py-1.5 text-center"
          >
            <div className="text-[9px] font-black uppercase tracking-widest text-ink-3">
              {d.label}
            </div>
            <div className="text-sm font-black tabular-nums text-ink mt-0.5">
              {fmt(getStat(stats, d), d.kind)}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
);

// Per-category latest grade (newest round that graded it) + overall within-season
// trend (first round's overall average vs the latest round's).
const useEvalTrend = (
  evaluationEvents: any[],
  player: any,
  playerId: string,
  categories: any[],
  teamAge?: string,
) =>
  useMemo(() => {
    const rounds = (evaluationEvents || [])
      .filter((e: any) => !e?.tryoutSignupId && e?.grades?.[playerId])
      .slice()
      .sort(
        (a: any, b: any) =>
          (a.date || "").localeCompare(b.date || "") ||
          (a.createdAt || 0) - (b.createdAt || 0),
      );
    if (rounds.length === 0) return null;
    const overallOf = (g: any) => {
      return currentEvaluationScore100(g, player, teamAge) ?? undefined;
    };
    const first = overallOf(rounds[0].grades[playerId]);
    const last = overallOf(rounds[rounds.length - 1].grades[playerId]);
    // Latest value per category, walking newest-first.
    const latestByCat: Record<string, number> = {};
    for (let i = rounds.length - 1; i >= 0; i--) {
      const g = rounds[i].grades[playerId] || {};
      for (const c of categories) {
        if (latestByCat[c.id] === undefined) {
          const v = num(g[c.id]);
          if (v !== undefined) latestByCat[c.id] = v;
        }
      }
    }
    return {
      rounds: rounds.length,
      overallFirst: first,
      overallLast: last,
      delta:
        first !== undefined && last !== undefined ? last - first : undefined,
      latestByCat,
    };
  }, [evaluationEvents, player, playerId, categories, teamAge]);

const attIsPresent = (v: any) => v === true || v === "present";
const attIsAbsent = (v: any) => v === false || v === "absent";

export const PlayerDevelopmentReport = memo(
  ({
    open,
    onClose,
    player,
    team,
    evaluationEvents = [],
    games = [],
    practices = [],
  }: any) => {
    const toast = useToast();
    const categories = useMemo(
      () => getEvalCategoriesForTeam(team?.pitchingFormat),
      [team?.pitchingFormat],
    );
    const evalTrend = useEvalTrend(evaluationEvents, player, player?.id, categories, team?.teamAge);

    const pitched = (read(player?.stats, "ip", "pIp") || 0) > 0;

    const attendance = useMemo(() => {
      const maps = [
        ...(games || [])
          .filter((g: any) => g.attendance)
          .map((g: any) => g.attendance),
        ...(practices || [])
          .filter((p: any) => p.attendance)
          .map((p: any) => p.attendance),
      ];
      let present = 0;
      let marked = 0;
      for (const m of maps) {
        const v = m[player?.id];
        if (attIsPresent(v)) {
          present++;
          marked++;
        } else if (attIsAbsent(v)) {
          marked++;
        }
      }
      return marked > 0 ? { rate: present / marked, present, marked } : null;
    }, [games, practices, player?.id]);

    // Season-over-season: archived past seasons + the current line as columns.
    const growth = useMemo(() => {
      const past = Array.isArray(player?.pastSeasons) ? player.pastSeasons : [];
      const columns = [
        ...past.map((s: any) => ({
          label: s.season || "Past",
          stats: s.stats || {},
        })),
        {
          label: team?.currentSeason || "Now",
          stats: player?.stats || {},
          current: true,
        },
      ];
      const rows = [
        ...BATTING.slice(0, 3),
        ...(pitched ? PITCHING.slice(1, 3) : []),
      ];
      const prev = past.length ? past[past.length - 1].stats || {} : null;
      return { columns, rows, prev };
    }, [player, team?.currentSeason, pitched]);

    const reportText = useMemo(() => {
      if (!player) return "";
      const lines = [`${player.name} — Development Report`];
      lines.push(
        `${team?.currentSeason || ""} · ${team?.teamAge || ""}`.trim(),
      );
      lines.push("");
      lines.push(
        `Batting: AVG ${fmt(read(player.stats, "avg"), "dec3")} · OPS ${fmt(
          read(player.stats, "ops"),
          "dec3",
        )} · HR ${fmt(read(player.stats, "hr"), "int")} · RBI ${fmt(
          read(player.stats, "rbi"),
          "int",
        )}`,
      );
      if (pitched) {
        lines.push(
          `Pitching: IP ${fmt(read(player.stats, "ip", "pIp"), "ip")} · ERA ${fmt(
            read(player.stats, "era", "pEra"),
            "dec2",
          )} · WHIP ${fmt(read(player.stats, "whip", "pWhip"), "dec2")}`,
        );
      }
      if (evalTrend?.overallLast !== undefined) {
        const arrow =
          evalTrend.delta === undefined
            ? ""
            : evalTrend.delta > 0
              ? ` (▲ +${evalTrend.delta.toFixed(1)})`
              : evalTrend.delta < 0
                ? ` (▼ ${evalTrend.delta.toFixed(1)})`
                : " (→)";
        lines.push(`Eval: ${evalTrend.overallLast.toFixed(0)}/100${arrow}`);
      }
      if (growth.prev) {
        const dAvg =
          (read(player.stats, "avg") || 0) - (read(growth.prev, "avg") || 0);
        const dOps =
          (read(player.stats, "ops") || 0) - (read(growth.prev, "ops") || 0);
        lines.push(
          `Growth vs last season: AVG ${dAvg >= 0 ? "+" : ""}${dAvg.toFixed(
            3,
          )} · OPS ${dOps >= 0 ? "+" : ""}${dOps.toFixed(3)}`,
        );
      }
      if (attendance) {
        lines.push(`Attendance: ${Math.round(attendance.rate * 100)}%`);
      }
      if (player.notes) {
        lines.push("", `Notes: ${player.notes}`);
      }
      return lines.join("\n");
    }, [player, team, pitched, evalTrend, growth, attendance]);

    if (!player) return null;

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(reportText);
        toast.push({ kind: "success", title: "Report copied" });
      } catch {
        toast.push({ kind: "error", title: "Couldn't copy" });
      }
    };

    const deltaCell = (
      cur: number | undefined,
      prev: number | undefined,
      hi: boolean,
    ) => {
      if (cur === undefined || prev === undefined) return null;
      const d = cur - prev;
      if (Math.abs(d) < 1e-9) return <span className="text-ink-3"> →</span>;
      const good = hi ? d > 0 : d < 0;
      return (
        <span className={good ? "text-win" : "text-loss"}>
          {" "}
          {d > 0 ? "▲" : "▼"}
        </span>
      );
    };

    return (
      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Development Report"
        title={player.name}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-line rounded-lg text-ink hover:bg-surface-2 transition-colors inline-flex items-center gap-1.5"
            >
              <Icons.Printer className="w-4 h-4" /> Print
            </button>
            <button
              type="button"
              onClick={copy}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md inline-flex items-center gap-1.5"
              style={{ backgroundColor: "var(--team-primary)" }}
            >
              <Icons.Clipboard className="w-4 h-4" /> Copy
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Header meta */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-ink-3">
            {player.number ? (
              <span className="tabular-nums">#{player.number}</span>
            ) : null}
            {player.primaryPosition && <span>{player.primaryPosition}</span>}
            <span>
              {team?.currentSeason || ""} · {team?.teamAge || ""}
            </span>
            <span>
              B/T {player.bats || "R"}/{player.throws || "R"}
            </span>
          </div>

          <StatGrid title="Batting" defs={BATTING} stats={player.stats} />
          {pitched && (
            <StatGrid title="Pitching" defs={PITCHING} stats={player.stats} />
          )}
          <StatGrid title="Fielding" defs={FIELDING} stats={player.stats} />

          {/* Evaluation */}
          <div>
            <div className="t-eyebrow text-ink-3 mb-1.5">Evaluation</div>
            {!evalTrend ? (
              <p className="t-body text-ink-3 italic">
                No evaluations on file.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-black tabular-nums text-ink">
                    {evalTrend.overallLast?.toFixed(0) ?? "—"}
                    <span className="text-sm text-ink-3">/100</span>
                  </div>
                  {evalTrend.delta !== undefined && (
                    <span
                      className={`text-xs font-black ${
                        evalTrend.delta > 0
                          ? "text-win"
                          : evalTrend.delta < 0
                            ? "text-loss"
                            : "text-ink-3"
                      }`}
                    >
                      {evalTrend.delta > 0
                        ? "▲ +"
                        : evalTrend.delta < 0
                          ? "▼ "
                          : "→ "}
                      {evalTrend.delta !== 0 ? evalTrend.delta.toFixed(1) : ""}
                      <span className="text-ink-3 font-bold">
                        {" "}
                        over {evalTrend.rounds} rounds
                      </span>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {categories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between bg-surface-2 border border-line rounded-lg px-2 py-1.5"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-3 truncate">
                        {c.label}
                      </span>
                      <span className="text-sm font-black tabular-nums text-ink shrink-0">
                        {evalTrend.latestByCat[c.id] !== undefined
                          ? evalTrend.latestByCat[c.id].toFixed(1)
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Season-over-season growth */}
          {growth.columns.length > 1 && (
            <div>
              <div className="t-eyebrow text-ink-3 mb-1.5">
                Season-over-Season
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                      <th className="text-left p-1.5">Stat</th>
                      {growth.columns.map((col: any, i: number) => (
                        <th
                          key={i}
                          className="text-right p-1.5 whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {growth.rows.map((d) => (
                      <tr key={d.key} className="border-t border-line">
                        <td className="p-1.5 font-bold text-ink-3">
                          {d.label}
                        </td>
                        {growth.columns.map((col: any, i: number) => {
                          const v = getStat(col.stats, d);
                          return (
                            <td
                              key={i}
                              className="p-1.5 text-right tabular-nums font-bold text-ink whitespace-nowrap"
                            >
                              {fmt(v, d.kind)}
                              {col.current &&
                                deltaCell(v, getStat(growth.prev, d), d.hi)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Attendance + notes */}
          <div className="flex flex-wrap gap-4">
            {attendance && (
              <div>
                <div className="t-eyebrow text-ink-3 mb-1">Attendance</div>
                <div className="text-lg font-black tabular-nums text-ink">
                  {Math.round(attendance.rate * 100)}%
                  <span className="text-[11px] font-bold text-ink-3">
                    {" "}
                    ({attendance.present}/{attendance.marked})
                  </span>
                </div>
              </div>
            )}
          </div>
          {player.notes && (
            <div>
              <div className="t-eyebrow text-ink-3 mb-1">Coach Notes</div>
              <p className="t-body text-ink-2 whitespace-pre-wrap">
                {player.notes}
              </p>
            </div>
          )}
        </div>
      </Modal>
    );
  },
);
