import React, { memo, useMemo } from "react";
import { Icons } from "../../icons";
import { useTeam, useToast } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { buildSeasonSummary } from "../../utils/helpers";
import { getEvalCategoriesForTeam } from "../../constants/ui";
import { currentEvaluationScore100 } from "../../utils/evaluationScore";

// /season-report — End-of-Season team report: record + run diff + streak, top
// performers, attendance leaders, and biggest eval improvers. Read-only;
// shareable via Copy and printable. Built entirely from data already on the
// team. A routed page per the app-wide modals→pages rule.

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

interface LeaderDef {
  label: string;
  kind: Kind;
  hi: boolean;
  needsIp?: boolean;
  get: (s: any) => number | undefined;
}

const attIsPresent = (v: any) => v === true || v === "present";
const attIsAbsent = (v: any) => v === false || v === "absent";

export const SeasonReportPage = memo(() => {
  const { team } = useTeam();
  const toast = useToast();
  const back = useBackOrFallback("/");
  const players = useMemo(() => team?.players || [], [team?.players]);
  const games = useMemo(() => team?.games || [], [team?.games]);
  const practices = useMemo(() => team?.practices || [], [team?.practices]);
  const evaluationEvents = useMemo(
    () => team?.evaluationEvents || [],
    [team?.evaluationEvents],
  );
  const isKidPitch =
    typeof team?.pitchingFormat === "string" &&
    team.pitchingFormat.toLowerCase().includes("kid");

  const summary = useMemo(() => buildSeasonSummary(games), [games]);

  const leaders = useMemo(() => {
    const defs: LeaderDef[] = [
      {
        label: "Top Hitter (OPS)",
        kind: "dec3",
        hi: true,
        get: (s) => read(s, "ops"),
      },
      {
        label: "Top Average",
        kind: "dec3",
        hi: true,
        get: (s) => read(s, "avg"),
      },
      { label: "Most HR", kind: "int", hi: true, get: (s) => read(s, "hr") },
      { label: "Most RBI", kind: "int", hi: true, get: (s) => read(s, "rbi") },
      { label: "Most SB", kind: "int", hi: true, get: (s) => read(s, "sb") },
      {
        label: "Iron Glove (FPCT)",
        kind: "dec3",
        hi: true,
        get: (s) => read(s, "fFpct", "fpct"),
      },
    ];
    if (isKidPitch) {
      defs.push(
        {
          label: "Ace (ERA)",
          kind: "dec2",
          hi: false,
          needsIp: true,
          get: (s) => read(s, "pEra", "era"),
        },
        {
          label: "Best WHIP",
          kind: "dec2",
          hi: false,
          needsIp: true,
          get: (s) => read(s, "pWhip"),
        },
      );
    }
    return defs
      .map((d) => {
        let best: any = null;
        let bestVal: number | undefined;
        for (const p of players) {
          const v = d.get(p.stats);
          if (v === undefined) continue;
          if (d.needsIp && !(read(p.stats, "pIp", "ip") || 0)) continue;
          if (bestVal === undefined || (d.hi ? v > bestVal : v < bestVal)) {
            bestVal = v;
            best = p;
          }
        }
        return best
          ? { label: d.label, player: best, value: fmt(bestVal, d.kind) }
          : null;
      })
      .filter(Boolean) as Array<{ label: string; player: any; value: string }>;
  }, [players, isKidPitch]);

  const attendance = useMemo(() => {
    const maps = [
      ...games.filter((g: any) => g.attendance).map((g: any) => g.attendance),
      ...practices
        .filter((p: any) => p.attendance)
        .map((p: any) => p.attendance),
    ];
    if (maps.length === 0) return null;
    let teamPresent = 0;
    let teamMarked = 0;
    const byPlayer: Record<string, { present: number; marked: number }> = {};
    for (const m of maps) {
      for (const [pid, v] of Object.entries(m)) {
        if (!byPlayer[pid]) byPlayer[pid] = { present: 0, marked: 0 };
        if (attIsPresent(v)) {
          byPlayer[pid].present++;
          byPlayer[pid].marked++;
          teamPresent++;
          teamMarked++;
        } else if (attIsAbsent(v)) {
          byPlayer[pid].marked++;
          teamMarked++;
        }
      }
    }
    const perfect = Object.entries(byPlayer)
      .filter(
        ([, c]) =>
          c.marked >= Math.min(3, maps.length) && c.present === c.marked,
      )
      .map(([pid]) => players.find((p: any) => p.id === pid))
      .filter(Boolean)
      .slice(0, 6);
    return {
      teamRate: teamMarked > 0 ? teamPresent / teamMarked : null,
      events: maps.length,
      perfect,
    };
  }, [games, practices, players]);

  const improvers = useMemo(() => {
    const categories = getEvalCategoriesForTeam(team?.pitchingFormat);
    const overallOf = (g: any, p: any) =>
      currentEvaluationScore100(g, p, team?.teamAge) ?? undefined;
    const out: Array<{ player: any; delta: number }> = [];
    for (const p of players) {
      const rounds = evaluationEvents
        .filter((e: any) => !e?.tryoutSignupId && e?.grades?.[p.id])
        .slice()
        .sort(
          (a: any, b: any) =>
            (a.date || "").localeCompare(b.date || "") ||
            (a.createdAt || 0) - (b.createdAt || 0),
        );
      if (rounds.length < 2) continue;
      const first = overallOf(rounds[0].grades[p.id], p);
      const last = overallOf(rounds[rounds.length - 1].grades[p.id], p);
      if (first === undefined || last === undefined) continue;
      const delta = last - first;
      if (delta > 0) out.push({ player: p, delta });
    }
    return out.sort((a, b) => b.delta - a.delta).slice(0, 3);
  }, [players, evaluationEvents, team?.pitchingFormat, team?.teamAge]);

  const reportText = useMemo(() => {
    const lines = [
      `${team?.name || "Team"} — ${team?.currentSeason || ""} Season Report`.trim(),
    ];
    lines.push(
      `Record: ${summary.wins}-${summary.losses}${summary.ties ? `-${summary.ties}` : ""} · Run diff ${
        summary.runDiff >= 0 ? "+" : ""
      }${summary.runDiff} · ${summary.streakType ? `${summary.streakType}${summary.streakCount} streak` : "no streak"}`,
    );
    if (leaders.length) {
      lines.push("", "Top performers:");
      for (const l of leaders)
        lines.push(`• ${l.label}: ${l.player.name} (${l.value})`);
    }
    if (attendance?.teamRate != null) {
      lines.push(
        "",
        `Team attendance: ${Math.round(attendance.teamRate * 100)}%`,
      );
      if (attendance.perfect.length)
        lines.push(
          `Perfect attendance: ${attendance.perfect.map((p: any) => p.name).join(", ")}`,
        );
    }
    if (improvers.length) {
      lines.push("", "Most improved (eval):");
      for (const im of improvers)
        lines.push(`• ${im.player.name} (+${im.delta.toFixed(1)})`);
    }
    return lines.join("\n");
  }, [team, summary, leaders, attendance, improvers]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      toast.push({ kind: "success", title: "Report copied" });
    } catch {
      toast.push({ kind: "error", title: "Couldn't copy" });
    }
  };

  return (
    <PageShell
      eyebrow="Season Report"
      title={`${team?.currentSeason || "Season"} — ${team?.name || "Team"}`}
      onBack={back}
      actions={
        <div className="flex items-center gap-2">
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
      <div className="cc-card p-5 space-y-4">
        {/* Record / run diff / streak */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-surface-2 border border-line rounded-lg p-3 text-center">
            <div className="t-eyebrow text-ink-3">Record</div>
            <div className="text-xl font-black tabular-nums text-ink mt-0.5">
              {summary.wins}-{summary.losses}
              {summary.ties ? `-${summary.ties}` : ""}
            </div>
          </div>
          <div className="bg-surface-2 border border-line rounded-lg p-3 text-center">
            <div className="t-eyebrow text-ink-3">Run Diff</div>
            <div
              className={`text-xl font-black tabular-nums mt-0.5 ${
                summary.runDiff >= 0 ? "text-win" : "text-loss"
              }`}
            >
              {summary.runDiff >= 0 ? `+${summary.runDiff}` : summary.runDiff}
            </div>
          </div>
          <div className="bg-surface-2 border border-line rounded-lg p-3 text-center">
            <div className="t-eyebrow text-ink-3">Streak</div>
            <div className="text-xl font-black tabular-nums text-ink mt-0.5">
              {summary.streakType
                ? `${summary.streakType}${summary.streakCount}`
                : "—"}
            </div>
          </div>
        </div>

        {/* Top performers */}
        <div>
          <div className="t-eyebrow text-ink-3 mb-1.5">Top Performers</div>
          {leaders.length === 0 ? (
            <p className="t-body text-ink-3 italic">No stats imported yet.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {leaders.map((l) => (
                <li
                  key={l.label}
                  className="flex items-center justify-between gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-black uppercase tracking-widest text-ink-3">
                      {l.label}
                    </span>
                    <span className="block text-xs font-bold text-ink truncate">
                      {l.player.name}
                    </span>
                  </span>
                  <span className="text-sm font-black tabular-nums text-ink shrink-0">
                    {l.value}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Attendance */}
        {attendance && (
          <div>
            <div className="t-eyebrow text-ink-3 mb-1.5">Attendance</div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-ink">
                {attendance.teamRate == null
                  ? "—"
                  : `${Math.round(attendance.teamRate * 100)}%`}
              </span>
              <span className="t-meta text-ink-3">
                team · {attendance.events} event
                {attendance.events === 1 ? "" : "s"}
              </span>
            </div>
            {attendance.perfect.length > 0 && (
              <div className="mt-1.5 text-[11px] font-bold text-ink-2">
                <span className="text-ink-3">Perfect: </span>
                {attendance.perfect.map((p: any) => p.name).join(" · ")}
              </div>
            )}
          </div>
        )}

        {/* Most improved */}
        {improvers.length > 0 && (
          <div>
            <div className="t-eyebrow text-ink-3 mb-1.5">
              Most Improved (Eval)
            </div>
            <ul className="space-y-1">
              {improvers.map((im) => (
                <li
                  key={im.player.id}
                  className="flex items-center justify-between gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2"
                >
                  <span className="text-xs font-bold text-ink truncate">
                    {im.player.name}
                  </span>
                  <span className="text-sm font-black tabular-nums text-win shrink-0">
                    ▲ +{im.delta.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageShell>
  );
});
