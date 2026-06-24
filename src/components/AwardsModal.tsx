import React, { memo, useMemo, useState } from "react";
import { Modal } from "./shared";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import { getEvalCategoriesForTeam } from "../constants/ui";
import { currentEvaluationScore100 } from "../utils/evaluationScore";

// Auto season awards / superlatives. Each award nominates a winner straight
// from the team's data; the coach can override per award (persisted on the team
// as seasonAwards: { [awardId]: playerId | "__none__" }) and print certificates.

type Kind = "int" | "dec2" | "dec3" | "pct";

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
  if (n === undefined) return "";
  switch (kind) {
    case "int":
      return Math.round(n).toString();
    case "dec2":
      return n.toFixed(2);
    case "dec3":
      return n > 0 && n < 1 ? n.toFixed(3).replace(/^0/, "") : n.toFixed(3);
    case "pct":
      return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
  }
};

const attIsPresent = (v: any) => v === true || v === "present";
const attIsAbsent = (v: any) => v === false || v === "absent";

const NONE = "__none__";

export const AwardsModal = memo(({ open, onClose, team }: any) => {
  const { updateTeam } = useTeam();
  const players: any[] = useMemo(() => team?.players || [], [team?.players]);
  const games: any[] = useMemo(() => team?.games || [], [team?.games]);
  const practices: any[] = useMemo(
    () => team?.practices || [],
    [team?.practices],
  );
  const evaluationEvents: any[] = useMemo(
    () => team?.evaluationEvents || [],
    [team?.evaluationEvents],
  );
  const isKidPitch =
    typeof team?.pitchingFormat === "string" &&
    team.pitchingFormat.toLowerCase().includes("kid");
  const overrides: Record<string, string> = team?.seasonAwards || {};
  const [showCerts, setShowCerts] = useState(false);

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of players) m[p.id] = p.name;
    return m;
  }, [players]);

  // Pre-compute the two non-stat awards (eval growth + attendance).
  const improver = useMemo(() => {
    const categories = getEvalCategoriesForTeam(team?.pitchingFormat);
    const overallOf = (g: any, p: any) =>
      currentEvaluationScore100(g, p, team?.teamAge) ?? undefined;
    let best: any = null;
    let bestDelta = 0;
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
      const f = overallOf(rounds[0].grades[p.id], p);
      const l = overallOf(rounds[rounds.length - 1].grades[p.id], p);
      if (f === undefined || l === undefined) continue;
      const d = l - f;
      if (d > bestDelta) {
        bestDelta = d;
        best = p;
      }
    }
    return best
      ? { playerId: best.id, value: `+${bestDelta.toFixed(1)}` }
      : null;
  }, [players, evaluationEvents, team?.pitchingFormat]);

  const ironman = useMemo(() => {
    const maps = [
      ...games.filter((g) => g.attendance).map((g) => g.attendance),
      ...practices.filter((p) => p.attendance).map((p) => p.attendance),
    ];
    if (maps.length === 0) return null;
    const by: Record<string, { present: number; marked: number }> = {};
    for (const m of maps) {
      for (const [pid, v] of Object.entries(m)) {
        if (!by[pid]) by[pid] = { present: 0, marked: 0 };
        if (attIsPresent(v)) {
          by[pid].present++;
          by[pid].marked++;
        } else if (attIsAbsent(v)) by[pid].marked++;
      }
    }
    // Winner: most events attended among those who never missed.
    let best: string | null = null;
    let bestMarked = 0;
    for (const [pid, c] of Object.entries(by)) {
      if (
        c.marked >= Math.min(3, maps.length) &&
        c.present === c.marked &&
        c.marked > bestMarked
      ) {
        best = pid;
        bestMarked = c.marked;
      }
    }
    return best
      ? { playerId: best, value: `${bestMarked}/${bestMarked}` }
      : null;
  }, [games, practices]);

  interface Award {
    id: string;
    label: string;
    auto: { playerId: string; value: string } | null;
  }

  const leaderBy = (
    get: (s: any) => number | undefined,
    hi: boolean,
    kind: Kind,
    needsIp?: boolean,
  ) => {
    let best: any = null;
    let bestVal: number | undefined;
    for (const p of players) {
      const v = get(p.stats);
      if (v === undefined) continue;
      if (needsIp && !(read(p.stats, "pIp", "ip") || 0)) continue;
      if (bestVal === undefined || (hi ? v > bestVal : v < bestVal)) {
        bestVal = v;
        best = p;
      }
    }
    return best ? { playerId: best.id, value: fmt(bestVal, kind) } : null;
  };

  const awards: Award[] = useMemo(() => {
    const list: Award[] = [
      {
        id: "topHitter",
        label: "Top Hitter (OPS)",
        auto: leaderBy((s) => read(s, "ops"), true, "dec3"),
      },
      {
        id: "rbiLeader",
        label: "RBI Leader",
        auto: leaderBy((s) => read(s, "rbi"), true, "int"),
      },
      {
        id: "speedster",
        label: "Speedster (SB)",
        auto: leaderBy((s) => read(s, "sb"), true, "int"),
      },
      {
        id: "hustle",
        label: "Hustle (QAB%)",
        auto: leaderBy((s) => read(s, "qab"), true, "pct"),
      },
      {
        id: "ironGlove",
        label: "Iron Glove (FPCT)",
        auto: leaderBy((s) => read(s, "fFpct", "fpct"), true, "dec3"),
      },
      { id: "mostImproved", label: "Most Improved", auto: improver },
      { id: "ironman", label: "Iron Man (Attendance)", auto: ironman },
    ];
    if (isKidPitch) {
      list.splice(5, 0, {
        id: "ace",
        label: "Ace (ERA)",
        auto: leaderBy((s) => read(s, "pEra", "era"), false, "dec2", true),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, improver, ironman, isKidPitch]);

  // Resolve each award's winner: coach override wins, else the auto nominee.
  const resolved = awards.map((a) => {
    const ov = overrides[a.id];
    let winnerId: string | null;
    if (ov === NONE) winnerId = null;
    else if (ov) winnerId = ov;
    else winnerId = a.auto?.playerId || null;
    return { ...a, winnerId, isOverridden: ov !== undefined };
  });

  const setOverride = (awardId: string, value: string) => {
    const next = { ...(team?.seasonAwards || {}) };
    if (value === "")
      delete next[awardId]; // back to auto
    else next[awardId] = value;
    updateTeam?.({ seasonAwards: next });
  };

  const winners = resolved.filter((r) => r.winnerId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={showCerts ? "Certificates" : "Season Awards"}
      title={`${team?.currentSeason || "Season"} Awards`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          {showCerts ? (
            <>
              <button
                type="button"
                onClick={() => setShowCerts(false)}
                className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-line rounded-lg text-ink hover:bg-surface-2 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md inline-flex items-center gap-1.5"
                style={{ backgroundColor: "var(--team-primary)" }}
              >
                <Icons.Printer className="w-4 h-4" /> Print
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowCerts(true)}
              disabled={winners.length === 0}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: "var(--team-primary)" }}
            >
              <Icons.FileText className="w-4 h-4" /> Certificates
            </button>
          )}
        </div>
      }
    >
      {showCerts ? (
        <div className="space-y-3">
          {winners.length === 0 ? (
            <p className="t-body text-ink-3 italic">No award winners yet.</p>
          ) : (
            winners.map((w) => (
              <div
                key={w.id}
                className="border-2 rounded-xl p-5 text-center"
                style={{ borderColor: "var(--team-primary)" }}
              >
                <div className="t-eyebrow text-ink-3">
                  Certificate of Achievement
                </div>
                <div
                  className="text-lg font-black uppercase tracking-tight mt-1"
                  style={{ color: "var(--team-primary)" }}
                >
                  {w.label}
                </div>
                <div className="text-2xl font-black text-ink mt-2">
                  {nameById[w.winnerId as string] || "—"}
                </div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3 mt-2">
                  {team?.name || "Team"} · {team?.currentSeason || ""}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="t-meta text-ink-3 mb-1">
            Winners are auto-picked from your season data. Override any award
            with the dropdown — your picks are saved.
          </p>
          {resolved.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
                  {a.label}
                  {a.auto?.value ? (
                    <span className="ml-1 text-ink-3 normal-case tracking-normal">
                      · {a.auto.value}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm font-bold text-ink truncate">
                  {a.winnerId ? nameById[a.winnerId] || "—" : "No winner"}
                  {a.isOverridden && (
                    <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-ink-3">
                      (override)
                    </span>
                  )}
                </div>
              </div>
              <select
                value={overrides[a.id] ?? ""}
                onChange={(e) => setOverride(a.id, e.target.value)}
                className="shrink-0 text-xs font-bold bg-surface border border-line rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-[var(--team-primary)] max-w-[45%]"
                aria-label={`Winner for ${a.label}`}
              >
                <option value="">
                  Auto
                  {a.auto
                    ? ` (${nameById[a.auto.playerId] || "—"})`
                    : " (none)"}
                </option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={NONE}>No winner</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
});
