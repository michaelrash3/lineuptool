import React, { memo, useEffect, useState } from "react";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import {
  DEFAULT_TIEBREAKERS,
  TIEBREAKER_OPTIONS,
  describeStructure,
  normalizeTiebreakers,
  poolPlayLedger,
  summarizeStructure,
  tiebreakerGuidance,
} from "../../utils/tournamentStakes";
import { formatRecord } from "../../utils/opponentHistory";
import type {
  Game,
  TiebreakerId,
  TiebreakerRule,
  Tournament,
  TournamentStructure,
} from "../../types";

// "Format & Stakes" card on the tournament detail page: how the field is
// structured (teams / pools / advancement), the ordered tiebreaker ladder,
// and what both mean for how to coach pool play. Heads edit inline on the
// page (per the app-wide modals→pages rule); assistants read everything.
// The app never computes standings — this card is about the currency.

// Committed-on-blur number input: typing doesn't hammer Firestore, leaving
// the field (or Enter) persists. Blank clears the value.
const StructureNumberInput = ({
  id,
  label,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onCommit: (next: number | undefined) => void;
  disabled: boolean;
}) => {
  const [draft, setDraft] = useState<string>(
    value != null ? String(value) : "",
  );
  // Follow external updates (another coach editing concurrently).
  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [value]);
  const commit = () => {
    const n = parseInt(draft, 10);
    onCommit(Number.isFinite(n) && n >= 1 ? n : undefined);
  };
  return (
    <div className="w-full">
      <label
        htmlFor={id}
        className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="—"
        className="w-full p-2.5 bg-surface border border-line rounded-lg text-sm font-bold tabular-nums outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-sm disabled:opacity-50"
      />
    </div>
  );
};

export const TournamentFormatCard = memo(
  ({ tournament }: { tournament: Tournament }) => {
    const { team, currentRole, updateTournament } = useTeam();
    const canEdit = currentRole !== "assistant";
    const games: Game[] = team.games || [];

    const structure: TournamentStructure = tournament.structure || {};
    const ladder = normalizeTiebreakers(tournament.tiebreakers);
    const guidance = tiebreakerGuidance(ladder);
    const summary = summarizeStructure(structure);
    const structureLine = describeStructure(structure);
    const ledger = poolPlayLedger(tournament, games, ladder);
    const isDefaultLadder =
      JSON.stringify(ladder) === JSON.stringify(DEFAULT_TIEBREAKERS);

    const patchStructure = (patch: Partial<TournamentStructure>) => {
      const next: TournamentStructure = { ...structure, ...patch };
      // Cleared fields drop out entirely so an untouched card stays absent.
      (Object.keys(next) as Array<keyof TournamentStructure>).forEach((k) => {
        if (next[k] == null || next[k] === false) delete next[k];
      });
      updateTournament(tournament.id, { structure: next });
    };

    const setLadder = (next: TiebreakerRule[]) =>
      updateTournament(tournament.id, { tiebreakers: next });

    const move = (index: number, delta: -1 | 1) => {
      const next = [...ladder];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      setLadder(next);
    };

    const removeRung = (index: number) =>
      setLadder(ladder.filter((_, i) => i !== index));

    const addRung = (id: TiebreakerId) =>
      setLadder([
        ...ladder,
        id === "runDiff" ? { id, cap: 8 } : ({ id } as TiebreakerRule),
      ]);

    const setCap = (index: number, raw: string) => {
      const n = parseInt(raw, 10);
      const next = ladder.map((r, i) =>
        i === index
          ? Number.isFinite(n) && n >= 1
            ? { id: r.id, cap: n }
            : { id: r.id }
          : r,
      );
      setLadder(next);
    };

    const missing = TIEBREAKER_OPTIONS.filter(
      (o) => !ladder.some((r) => r.id === o.id),
    );

    return (
      <div className="cc-card overflow-hidden mb-4">
        <div className="p-4 flex items-center justify-between gap-3 border-b border-line">
          <h3 className="t-eyebrow text-ink-2">Format &amp; Stakes</h3>
          {canEdit && !isDefaultLadder && (
            <button
              type="button"
              onClick={() =>
                setLadder(DEFAULT_TIEBREAKERS.map((r) => ({ ...r })))
              }
              className="t-chip px-2.5 py-1 rounded-md border border-line text-ink-2 hover:bg-surface-2 transition-colors"
              title="Restore the standard USSSA tiebreaker order"
            >
              Reset to USSSA
            </button>
          )}
        </div>

        <div className="p-4 border-b border-line">
          <div className="grid grid-cols-3 gap-3">
            <StructureNumberInput
              id="structure-teams"
              label="Teams"
              value={structure.teamCount}
              disabled={!canEdit}
              onCommit={(n) => patchStructure({ teamCount: n })}
            />
            <StructureNumberInput
              id="structure-pools"
              label="Pools"
              value={structure.poolCount}
              disabled={!canEdit}
              onCommit={(n) => patchStructure({ poolCount: n })}
            />
            <StructureNumberInput
              id="structure-advance"
              label="Advance"
              value={structure.advanceCount}
              disabled={!canEdit}
              onCommit={(n) => patchStructure({ advanceCount: n })}
            />
          </div>
          <label className="mt-3 flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={structure.poolWinnersAdvance === true}
              disabled={!canEdit}
              onChange={(e) =>
                patchStructure({
                  poolWinnersAdvance: e.target.checked || undefined,
                })
              }
              className="w-4 h-4 accent-[var(--team-primary)]"
            />
            <span className="text-xs font-bold text-ink-2">
              Pool winners advance automatically
            </span>
          </label>

          {structureLine && (
            <p className="mt-3 text-sm font-bold text-ink">{structureLine}</p>
          )}
          {summary?.wildcards != null && summary.wildcards > 0 && (
            <p className="mt-1 text-[11px] font-bold text-ink-2 leading-snug">
              Win the pool and you&apos;re in on the automatic bid; anything
              less is the wildcard scramble for {summary.wildcards} spot
              {summary.wildcards === 1 ? "" : "s"}, decided on the tiebreakers
              below.
            </p>
          )}
          {summary?.wildcards === 0 && (
            <p className="mt-1 text-[11px] font-bold text-ink-2 leading-snug">
              Only pool winners advance — the pool is win-or-done, and
              tiebreakers only matter inside a tied pool.
            </p>
          )}

          {(ledger.played > 0 || ledger.remaining > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 tabular-nums">
                Pool so far{" "}
                {formatRecord({
                  games: ledger.played,
                  wins: ledger.wins,
                  losses: ledger.losses,
                  ties: ledger.ties,
                  runsFor: ledger.runsScored,
                  runsAgainst: ledger.runsAllowed,
                })}
              </span>
              <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums">
                RA {ledger.runsAllowed}
              </span>
              <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums">
                Diff {ledger.runDiff >= 0 ? "+" : ""}
                {ledger.runDiff}
              </span>
              {ledger.runDiffLostToCap > 0 && (
                <span
                  className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums"
                  title="Margin beyond the per-game cap that didn't count"
                >
                  cap ate {ledger.runDiffLostToCap}
                </span>
              )}
              {ledger.remaining > 0 && (
                <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface text-ink-3 tabular-nums">
                  {ledger.remaining} pool game
                  {ledger.remaining === 1 ? "" : "s"} left
                </span>
              )}
            </div>
          )}
        </div>

        {/* Tiebreaker ladder — ordered; ties break top-down after record. */}
        <div className="p-4">
          <p className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
            Tiebreakers (after record, in order)
          </p>
          <div className="flex flex-col divide-y divide-line border border-line rounded-xl overflow-hidden">
            {ladder.map((rule, i) => {
              const line = guidance[i];
              return (
                <div key={rule.id} className="px-3 py-2.5 bg-surface">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-center font-black tabular-nums text-ink-3 shrink-0">
                      {i + 1}
                    </span>
                    <span className="font-bold text-ink text-sm flex-1 min-w-0 truncate">
                      {line.label}
                    </span>
                    {rule.id === "runDiff" && canEdit && (
                      <label className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
                          Cap +
                        </span>
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          aria-label="Run differential cap"
                          defaultValue={
                            rule.cap != null ? String(rule.cap) : ""
                          }
                          key={`cap-${rule.cap ?? "none"}`}
                          onBlur={(e) => setCap(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="—"
                          className="w-14 p-1.5 bg-surface border border-line rounded-lg text-xs font-bold tabular-nums outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                        />
                      </label>
                    )}
                    {canEdit && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          className="p-1.5 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={`Move ${line.label} up`}
                        >
                          <Icons.ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, 1)}
                          disabled={i === ladder.length - 1}
                          className="p-1.5 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={`Move ${line.label} down`}
                        >
                          <Icons.ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRung(i)}
                          className="p-1.5 text-ink-3 hover:text-loss hover:bg-loss-bg rounded-md transition-colors"
                          aria-label={`Remove ${line.label}`}
                        >
                          <Icons.X className="w-4 h-4" />
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 ml-7 text-[11px] font-medium text-ink-2 leading-snug">
                    {line.detail}
                  </p>
                </div>
              );
            })}
          </div>
          {canEdit && missing.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {missing.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => addRung(o.id)}
                  className="t-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-line-strong text-ink-2 hover:bg-surface-2 transition-colors"
                >
                  <Icons.Plus className="w-3 h-3" /> {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
);
