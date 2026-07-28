import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import {
  analyzePitchingWorkload,
  buildPitchingPlan,
  resolvePitchRuleSet,
  type PitcherAvailability,
} from "../lineupEngine";
import { getLocalDateString, isKidPitchFormat } from "../constants/ui";
import { Sparkline } from "./charts/Sparkline";
import { pitchOutingSeries } from "../utils/pitchingWorkload";
import {
  addPitchingOutingEntry,
  removePitchingOutingEntry,
  updatePitchingOutingEntry,
  type PitchingOuting,
} from "../utils/helpers";

// Current rest standing for a pitcher, as a small color-coded chip.
const availabilityChip = (avail: PitcherAvailability) => {
  if (avail.status === "ready") {
    return (
      <span className="t-chip px-1.5 py-0.5 rounded-md border bg-win-bg border-line text-win text-[10px] font-black">
        Ready
      </span>
    );
  }
  if (avail.status === "maxed") {
    return (
      <span className="t-chip px-1.5 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black">
        At limit
      </span>
    );
  }
  return (
    <span className="t-chip px-1.5 py-0.5 rounded-md border bg-warn-bg border-line text-warnfg text-[10px] font-black tabular-nums">
      Rest {avail.daysUntilReady ?? "?"}d
    </span>
  );
};

// One editable row of a pitcher's outing log: date + pitch count inputs with
// an explicit Save (enabled once dirty) and Delete. Local draft state so
// typing doesn't write to Firestore keystroke-by-keystroke; commits go
// through the pure updatePitchingOutingEntry/removePitchingOutingEntry
// helpers (never ad-hoc log surgery) so the recency mirror fields stay
// consistent with what the rest rules read.
const OutingEditRow = ({
  outing,
  onSave,
  onDelete,
}: {
  outing: PitchingOuting;
  onSave: (patch: { date: string; pitches: number }) => void;
  onDelete: () => void;
}) => {
  const [date, setDate] = useState(outing.date);
  const [pitches, setPitches] = useState(String(outing.pitches));
  const parsed = Number(pitches);
  const valid = !!date && Number.isFinite(parsed) && parsed > 0;
  const dirty = date !== outing.date || parsed !== outing.pitches;
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Outing date"
        className="cc-input text-[11px] font-bold py-1 px-1.5 rounded-md border border-line bg-surface text-ink"
      />
      <input
        type="number"
        min={1}
        value={pitches}
        onChange={(e) => setPitches(e.target.value)}
        aria-label="Pitches thrown"
        className="cc-input w-16 text-[11px] font-bold py-1 px-1.5 rounded-md border border-line bg-surface text-ink tabular-nums"
      />
      {outing.gameId ? (
        <span
          className="t-chip px-1.5 py-0.5 rounded-md border border-line bg-surface-2 text-ink-3 text-[9px] font-black"
          title="Imported from a game's box score — a CSV re-import for that game and date updates this entry"
        >
          Game
        </span>
      ) : (
        <span
          className="t-chip px-1.5 py-0.5 rounded-md border border-line bg-surface-2 text-ink-3 text-[9px] font-black"
          title="Entered by hand"
        >
          Manual
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        disabled={!dirty || !valid}
        onClick={() => valid && onSave({ date, pitches: parsed })}
        className="text-[10px] font-black uppercase tracking-widest text-win disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete outing"
        className="text-[10px] font-black uppercase tracking-widest text-loss"
      >
        Delete
      </button>
    </div>
  );
};

// Add-an-outing form for the log editor — e.g. the back half of a suspended
// game's split, or an outing that never came through a CSV. Appends via the
// pure addPitchingOutingEntry helper (no dedupe: an explicit add never
// replaces an existing entry).
const OutingAddRow = ({
  onAdd,
}: {
  onAdd: (date: string, pitches: number) => void;
}) => {
  const [date, setDate] = useState(getLocalDateString());
  const [pitches, setPitches] = useState("");
  const parsed = Number(pitches);
  const valid = !!date && Number.isFinite(parsed) && parsed > 0;
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="New outing date"
        className="cc-input text-[11px] font-bold py-1 px-1.5 rounded-md border border-line bg-surface text-ink"
      />
      <input
        type="number"
        min={1}
        placeholder="Pitches"
        value={pitches}
        onChange={(e) => setPitches(e.target.value)}
        aria-label="New outing pitches"
        className="cc-input w-16 text-[11px] font-bold py-1 px-1.5 rounded-md border border-line bg-surface text-ink tabular-nums"
      />
      <div className="flex-1" />
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          if (!valid) return;
          onAdd(date, parsed);
          setPitches("");
        }}
        className="text-[10px] font-black uppercase tracking-widest text-win disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Add outing
      </button>
    </div>
  );
};

// Roster-tab arm-care dashboard: season workload per pitcher + overuse flags
// (pitched several days running, came back on short rest). Kid Pitch + head
// coach only; hidden until at least one pitcher has logged an outing. The
// numbers come straight from each player's pitching.log, rule-set aware.
export const ArmCarePanel = memo(() => {
  const { team, currentRole, updatePlayer } = useTeam();
  const { openPlayerProfile } = useUI();
  const { players, pitchingFormat, teamAge } = team as any;
  const eligible = currentRole === "head" && isKidPitchFormat(pitchingFormat);
  const ruleSet = useMemo(() => resolvePitchRuleSet(team), [team]);
  const today = getLocalDateString();
  // Which pitcher's outing log is open for editing (one at a time).
  const [editingId, setEditingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!eligible) return [];
    // Rest/eligibility standing as of today, joined onto each pitcher.
    const planById = new Map(
      buildPitchingPlan(players, today, teamAge, ruleSet).map((a) => [a.id, a]),
    );
    return ((players || []) as any[])
      .filter(
        (p) =>
          Array.isArray(p.comfortablePositions) &&
          p.comfortablePositions.includes("P"),
      )
      .map((p) => ({
        p,
        w: analyzePitchingWorkload(p.pitching, ruleSet),
        avail: planById.get(p.id),
        series: pitchOutingSeries(p.pitching),
      }))
      .filter((r) => r.w.outings > 0)
      .sort((a, b) => {
        const aFlag = a.w.alerts.length > 0 ? 1 : 0;
        const bFlag = b.w.alerts.length > 0 ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        return b.w.last7 - a.w.last7;
      });
  }, [eligible, players, ruleSet, teamAge, today]);

  if (!eligible || rows.length === 0) return null;

  const flagged = rows.filter((r) => r.w.alerts.length > 0).length;

  return (
    <div className="cc-card mb-6">
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
            <Icons.Pitch
              className="w-5 h-5"
              style={{ color: "var(--team-ink)" }}
            />
          </div>
          <div>
            <h2 className="t-h2">Arm Care</h2>
            <p className="t-eyebrow text-ink-3 mt-0.5">
              Workload, rest status &amp; overuse flags
            </p>
          </div>
        </div>
        {flagged > 0 && (
          <span className="t-chip px-2 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black whitespace-nowrap">
            {flagged} flagged
          </span>
        )}
      </div>

      <div className="divide-y divide-line">
        {rows.map(({ p, w, avail, series }) => (
          <div key={p.id} className="p-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => openPlayerProfile?.(p.id)}
                    className="font-extrabold text-ink hover:text-team-primary text-left"
                  >
                    {p.name}
                    {p.number != null && p.number !== "" && (
                      <span className="ml-1.5 text-ink-3 font-bold text-[10px] tabular-nums">
                        #{p.number}
                      </span>
                    )}
                  </button>
                  {avail && availabilityChip(avail)}
                </div>
                <div className="text-[11px] font-bold text-ink-2 mt-0.5 tabular-nums">
                  {w.totalPitches} pitches · {w.outings} outing
                  {w.outings === 1 ? "" : "s"} · high {w.maxDay} · last 7d{" "}
                  {w.last7}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {series.length >= 2 && (
                  <Sparkline
                    values={series}
                    width={72}
                    height={26}
                    fill="var(--team-primary)"
                    label={`${p.name} recent pitch counts: ${series.join(", ")}`}
                    className="shrink-0 mt-0.5"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                  aria-label={`Edit ${p.name}'s pitch log`}
                  className="t-chip px-1.5 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 text-[10px] font-black hover:border-line-strong"
                >
                  {editingId === p.id ? "Done" : "Edit log"}
                </button>
              </div>
            </div>
            {w.alerts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {w.alerts.map((a, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-md border bg-loss-bg border-loss text-loss text-[10px] font-black"
                  >
                    ⚠ {a.message}
                  </span>
                ))}
              </div>
            )}
            {editingId === p.id && (
              <div className="mt-2.5 rounded-lg border border-line bg-surface-2 p-2.5 flex flex-col gap-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-ink-3">
                  Outing log — fix a count or move pitches to the day they were
                  thrown (e.g. split a suspended game across its two dates)
                </div>
                {(Array.isArray(p.pitching?.log)
                  ? (p.pitching.log as PitchingOuting[])
                  : []
                ).map((o, i) => (
                  <OutingEditRow
                    // Re-key on the entry identity so drafts reset when the
                    // stored log re-sorts after a save/delete.
                    key={`${o.date}|${o.gameId || ""}|${i}`}
                    outing={o}
                    onSave={(patch) =>
                      updatePlayer(p.id, {
                        pitching: updatePitchingOutingEntry(
                          p.pitching,
                          i,
                          patch,
                        ),
                      })
                    }
                    onDelete={() =>
                      updatePlayer(p.id, {
                        pitching: removePitchingOutingEntry(p.pitching, i),
                      })
                    }
                  />
                ))}
                <OutingAddRow
                  onAdd={(date, pitches) =>
                    updatePlayer(p.id, {
                      pitching: addPitchingOutingEntry(
                        p.pitching,
                        date,
                        pitches,
                      ),
                    })
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
