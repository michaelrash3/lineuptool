import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import { formatCurrency, feeAdjustmentAmount } from "../../utils/helpers";
import { SectionCard } from "./SectionCard";
import type { FeeAdjustment, Player } from "../../types";

type AdjKind = "scholarship" | "sibling" | "override";
type AdjMode = "amount" | "pct";

interface FeeAdjustmentsCardProps {
  players: Player[];
  adjustments: FeeAdjustment[];
  clubFee: number;
  effectiveFeeByPlayer: Record<string, number>;
  addFeeAdjustment: (e?: FormEvent) => void;
  removeFeeAdjustment: (id: string) => void;
  adjPlayerId: string;
  setAdjPlayerId: Dispatch<SetStateAction<string>>;
  adjKind: AdjKind;
  setAdjKind: Dispatch<SetStateAction<AdjKind>>;
  adjMode: AdjMode;
  setAdjMode: Dispatch<SetStateAction<AdjMode>>;
  adjValue: string;
  setAdjValue: Dispatch<SetStateAction<string>>;
  adjNote: string;
  setAdjNote: Dispatch<SetStateAction<string>>;
}

const KIND_LABEL: Record<AdjKind, string> = {
  scholarship: "Scholarship",
  sibling: "Sibling discount",
  override: "Custom override",
};

// Per-player fee adjustments beyond the all-or-nothing fee waiver: partial
// scholarships, sibling/multi-child discounts, custom overrides. The adjusted
// player still owes a (reduced) fee. Coach-internal; all state/handlers thread
// in from FinancesTab. Renders nothing until there's a fee to adjust.
export const FeeAdjustmentsCard = ({
  players,
  adjustments,
  clubFee,
  effectiveFeeByPlayer,
  addFeeAdjustment,
  removeFeeAdjustment,
  adjPlayerId,
  setAdjPlayerId,
  adjKind,
  setAdjKind,
  adjMode,
  setAdjMode,
  adjValue,
  setAdjValue,
  adjNote,
  setAdjNote,
}: FeeAdjustmentsCardProps) => {
  if (clubFee <= 0 && adjustments.length === 0) return null;
  const nameOf = (pid: string) =>
    players.find((p) => p.id === pid)?.name || "Player";
  return (
    <SectionCard icon={Icons.Sparkles} title="Scholarships & discounts">
      <div className="pt-4 space-y-3">
        {adjustments.length > 0 && (
          <ul className="divide-y divide-line">
            {adjustments.map((adj) => {
              const off = feeAdjustmentAmount(adj, clubFee);
              const eff = effectiveFeeByPlayer[adj.playerId];
              return (
                <li
                  key={adj.id}
                  className="py-2 flex items-center gap-3 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="t-body-bold text-ink truncate">
                      {nameOf(adj.playerId)}
                    </div>
                    <div className="t-meta text-ink-3">
                      {KIND_LABEL[adj.kind]}
                      {adj.pct != null ? ` · ${adj.pct}% off` : ""}
                      {adj.note ? ` · ${adj.note}` : ""}
                    </div>
                  </div>
                  <span className="tabular-nums font-black text-win-ink whitespace-nowrap">
                    −{formatCurrency(off)}
                  </span>
                  {eff != null && (
                    <span className="tabular-nums font-bold text-ink-2 whitespace-nowrap">
                      → {formatCurrency(eff)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove adjustment for ${nameOf(adj.playerId)}`}
                    onClick={() => removeFeeAdjustment(adj.id)}
                    className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-loss transition-colors"
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          onSubmit={addFeeAdjustment}
          className="flex flex-col sm:flex-row sm:flex-wrap gap-2"
        >
          <select
            value={adjPlayerId}
            onChange={(e) => setAdjPlayerId(e.target.value)}
            aria-label="Player to adjust"
            className={`${FORM_INPUT_CLASS} sm:w-40`}
            style={FORM_INPUT_RING_STYLE}
          >
            <option value="">Player…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={adjKind}
            onChange={(e) => setAdjKind(e.target.value as AdjKind)}
            aria-label="Adjustment kind"
            className={`${FORM_INPUT_CLASS} sm:w-40`}
            style={FORM_INPUT_RING_STYLE}
          >
            <option value="scholarship">Scholarship</option>
            <option value="sibling">Sibling discount</option>
            <option value="override">Custom override</option>
          </select>
          <div className="flex rounded-xl overflow-hidden border border-line self-start">
            {(["amount", "pct"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAdjMode(m)}
                aria-pressed={adjMode === m}
                className={`px-3 py-2 text-xs font-black transition-colors ${
                  adjMode === m
                    ? "bg-team-primary/15 text-team-primary"
                    : "bg-surface-2 text-ink-3 hover:bg-line"
                }`}
                style={
                  adjMode === m
                    ? {
                        backgroundColor: "var(--team-primary-15)",
                        color: "var(--team-ink)",
                      }
                    : undefined
                }
              >
                {m === "amount" ? "$ off" : "% off"}
              </button>
            ))}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={adjValue}
            onChange={(e) => setAdjValue(e.target.value)}
            placeholder={adjMode === "pct" ? "% off" : "$ off"}
            aria-label="Adjustment amount"
            className={`${FORM_INPUT_CLASS} sm:w-24 tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
          <input
            type="text"
            value={adjNote}
            onChange={(e) => setAdjNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Adjustment note"
            className={`${FORM_INPUT_CLASS} flex-1 sm:min-w-[8rem]`}
            style={FORM_INPUT_RING_STYLE}
          />
          <Button type="submit" variant="secondary" size="md">
            <Icons.Plus className="w-4 h-4" /> Add
          </Button>
        </form>
        <p className="t-meta text-ink-3">
          An adjusted player still owes a reduced fee (unlike a full waiver).
          Adjustments apply after any fundraising credit and clear when the
          season advances.
        </p>
      </div>
    </SectionCard>
  );
};
