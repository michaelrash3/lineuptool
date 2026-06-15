import React, { memo, useMemo } from "react";
import { Icons } from "../icons";

// Roster-side stats panel. Sits beside the roster on desktop and stacks below
// it on mobile. Two modes:
//   • no player selected → team leaders (top performer per marquee stat)
//   • a player selected (tap their jersey, or a leader name) → that player's
//     batting / pitching / fielding line.
// Read-only; pulls straight from each player's imported `stats` bag.

type Kind = "int" | "dec2" | "dec3" | "pct" | "ip";

const num = (v: any): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

// First defined value across the given keys (advanced two-row export field, then
// the basic single-section fallback — same convention as the Stats tab).
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

interface StatDef {
  label: string;
  kind: Kind;
  get: (s: any) => number | undefined;
}

const BATTING: StatDef[] = [
  { label: "AVG", kind: "dec3", get: (s) => read(s, "avg") },
  { label: "OBP", kind: "dec3", get: (s) => read(s, "obp") },
  { label: "OPS", kind: "dec3", get: (s) => read(s, "ops") },
  { label: "H", kind: "int", get: (s) => read(s, "h") },
  { label: "HR", kind: "int", get: (s) => read(s, "hr") },
  { label: "RBI", kind: "int", get: (s) => read(s, "rbi") },
  { label: "SB", kind: "int", get: (s) => read(s, "sb") },
  { label: "AB", kind: "int", get: (s) => read(s, "ab") },
];

const PITCHING: StatDef[] = [
  { label: "IP", kind: "ip", get: (s) => read(s, "pIp", "ip") },
  { label: "ERA", kind: "dec2", get: (s) => read(s, "pEra", "era") },
  { label: "WHIP", kind: "dec2", get: (s) => read(s, "pWhip") },
  { label: "K/BB", kind: "dec2", get: (s) => read(s, "pKbb") },
  { label: "BF", kind: "int", get: (s) => read(s, "pBf") },
];

const FIELDING: StatDef[] = [
  { label: "FPCT", kind: "dec3", get: (s) => read(s, "fFpct", "fpct") },
  { label: "PO", kind: "int", get: (s) => read(s, "fPutouts", "po") },
  { label: "A", kind: "int", get: (s) => read(s, "fAssists", "a") },
  { label: "E", kind: "int", get: (s) => read(s, "fErrors") },
];

// Marquee leaders. `hi` = higher is better; pitching rate stats require innings
// so a 0-IP player can't "lead" ERA.
const LEADERS: Array<{ label: string; kind: Kind; hi: boolean; get: (s: any) => number | undefined; needsIp?: boolean }> = [
  { label: "OPS", kind: "dec3", hi: true, get: (s) => read(s, "ops") },
  { label: "AVG", kind: "dec3", hi: true, get: (s) => read(s, "avg") },
  { label: "HR", kind: "int", hi: true, get: (s) => read(s, "hr") },
  { label: "RBI", kind: "int", hi: true, get: (s) => read(s, "rbi") },
  { label: "SB", kind: "int", hi: true, get: (s) => read(s, "sb") },
  { label: "ERA", kind: "dec2", hi: false, needsIp: true, get: (s) => read(s, "pEra", "era") },
  { label: "WHIP", kind: "dec2", hi: false, needsIp: true, get: (s) => read(s, "pWhip") },
];

const StatGrid = memo(({ title, defs, stats }: { title: string; defs: StatDef[]; stats: any }) => (
  <div>
    <div className="t-eyebrow text-ink-3 mb-1.5">{title}</div>
    <div className="grid grid-cols-4 gap-1.5">
      {defs.map((d) => (
        <div
          key={d.label}
          className="bg-surface-2 border border-line rounded-lg px-1.5 py-1.5 text-center"
        >
          <div className="text-[9px] font-black uppercase tracking-widest text-ink-3">
            {d.label}
          </div>
          <div className="text-sm font-black tabular-nums text-ink mt-0.5">
            {fmt(d.get(stats), d.kind)}
          </div>
        </div>
      ))}
    </div>
  </div>
));

export const RosterStatsPanel = memo(
  ({
    players = [],
    selectedId,
    onSelect,
  }: {
    players: any[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
  }) => {
    const selected = useMemo(
      () => players.find((p) => p.id === selectedId) || null,
      [players, selectedId]
    );

    const leaders = useMemo(() => {
      return LEADERS.map((L) => {
        let best: any = null;
        let bestVal: number | undefined;
        for (const p of players) {
          const v = L.get(p.stats);
          if (v === undefined) continue;
          if (L.needsIp && !(read(p.stats, "pIp", "ip") || 0)) continue;
          if (
            bestVal === undefined ||
            (L.hi ? v > bestVal : v < bestVal)
          ) {
            bestVal = v;
            best = p;
          }
        }
        return best ? { ...L, player: best, value: bestVal } : null;
      }).filter(Boolean) as Array<{
        label: string;
        kind: Kind;
        player: any;
        value: number | undefined;
      }>;
    }, [players]);

    const pitched = selected && (read(selected.stats, "pIp", "ip") || 0) > 0;

    return (
      <aside className="bg-surface border border-line rounded-2xl shadow-sm overflow-hidden lg:sticky lg:top-4">
        <div
          className="h-1 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-4 space-y-4">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="t-eyebrow text-ink-3">Player stats</div>
                  <h3 className="t-card-title truncate">{selected.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="shrink-0 text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink border border-line rounded-lg px-2.5 py-1.5 hover:bg-surface-2 transition-colors"
                >
                  Leaders
                </button>
              </div>
              <StatGrid title="Batting" defs={BATTING} stats={selected.stats} />
              {pitched && (
                <StatGrid title="Pitching" defs={PITCHING} stats={selected.stats} />
              )}
              <StatGrid title="Fielding" defs={FIELDING} stats={selected.stats} />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Icons.Chart className="w-4 h-4 text-ink-3" />
                <h3 className="t-card-title">Team Leaders</h3>
              </div>
              {leaders.length === 0 ? (
                <p className="t-body text-ink-3 italic">
                  No stats yet. Tap a player&apos;s jersey to see their line.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {leaders.map((L) => (
                    <li
                      key={L.label}
                      className="flex items-center justify-between gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2"
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest text-ink-3 w-12 shrink-0">
                        {L.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelect(L.player.id)}
                        className="flex-1 min-w-0 text-left text-xs font-bold text-ink truncate hover:text-team-primary transition-colors"
                      >
                        {L.player.name}
                      </button>
                      <span className="text-sm font-black tabular-nums text-ink shrink-0">
                        {fmt(L.value, L.kind)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="t-meta text-ink-3">
                Tap a player&apos;s jersey on the roster to see their full line.
              </p>
            </>
          )}
        </div>
      </aside>
    );
  }
);
