import React, { memo, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { buildSeasonPositionVariety } from "../utils/helpers";

// Season position-variety report: how many innings each player has logged at
// each defensive position across finalized games, ordered so the kids who need
// rotation (fewest distinct positions) surface first. Helps coaches honor
// league rotation expectations and spot anyone stuck at one spot or never given
// an infield/outfield look. Renders nothing until there's finalized-game data.
export const PositionVarietyPanel = memo(() => {
  const { team } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, games } = team;

  const rows = useMemo(() => {
    const variety = buildSeasonPositionVariety(games || [], players || []);
    const byId = new Map<string, any>((players || []).map((p: any) => [p.id, p]));
    return Array.from(variety.entries())
      .map(([id, entry]) => ({ id, player: byId.get(id), entry }))
      // Drop history for players no longer on the roster.
      .filter((r) => r.player)
      .sort(
        (a, b) =>
          a.entry.distinctPositions - b.entry.distinctPositions ||
          b.entry.totalDefense - a.entry.totalDefense
      );
  }, [games, players]);

  if (rows.length === 0) return null;

  const flagFor = (e: any): { label: string; cls: string } | null => {
    if (e.distinctPositions <= 1)
      return { label: "1 position", cls: "bg-warn-bg border-warnfg text-warnfg" };
    if (e.infieldInnings === 0)
      return { label: "No infield", cls: "border-[color:var(--info-fg)] text-[color:var(--info-fg)] bg-[color:var(--info-bg)]" };
    if (e.outfieldInnings === 0)
      return { label: "No outfield", cls: "border-[color:var(--info-fg)] text-[color:var(--info-fg)] bg-[color:var(--info-bg)]" };
    return null;
  };

  return (
    <div className="glass-card mb-6">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
      <div className="p-5 border-b border-line bg-surface flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-full"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Glove
              className="w-5 h-5"
              style={{ color: "var(--team-primary)" }}
            />
          </div>
          <h2 className="t-h2">Position Variety</h2>
        </div>
        <span className="t-eyebrow text-ink-3 hidden sm:inline">
          Innings by position · finalized games
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface">
            <tr className="text-[10px] font-black uppercase tracking-widest text-ink-3">
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Positions played (innings)</th>
              <th className="px-3 py-2 text-center">Spots</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, player, entry }) => {
              const flag = flagFor(entry);
              const positions = Object.entries(entry.byPosition).sort(
                (a, b) => (b[1] as number) - (a[1] as number)
              );
              return (
                <tr key={id} className="border-t border-line/60">
                  <td className="px-3 py-2 font-bold text-ink whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openPlayerProfile(id)}
                      className="hover:text-team-primary transition-colors text-left"
                    >
                      {player.number ? `#${player.number} ` : ""}
                      {player.name}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {positions.map(([pos, n]) => (
                        <span
                          key={pos}
                          className="t-chip px-2 py-0.5 rounded-md bg-surface-2 border border-line text-ink tabular-nums"
                        >
                          {pos} {n as number}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center font-black tabular-nums text-ink">
                    {entry.distinctPositions}
                  </td>
                  <td className="px-3 py-2">
                    {flag && (
                      <span
                        className={`t-chip px-2 py-0.5 rounded-md border ${flag.cls} whitespace-nowrap`}
                      >
                        {flag.label}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
