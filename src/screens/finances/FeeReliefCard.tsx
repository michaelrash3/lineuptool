import { useState } from "react";
import { Icons } from "../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import { formatCurrency, round2, splitEvenly } from "../../utils/helpers";
import type { PassThroughSummary } from "../../utils/helpers";
import { parseAmount } from "./financeHelpers";
import { SectionCard } from "./SectionCard";

// A family the payout editor can address: a current paying (non-exempt)
// roster member.
interface Payer {
  id: string;
  name: string;
}

interface FeeReliefCardProps {
  passThrough: PassThroughSummary;
  payers: Payer[];
  // Creates the unpaid feeRelief payout rows. Returns false when refused
  // (over-distribution) so the editor stays open for correction.
  distribute: (
    incomeId: string,
    rows: Array<{ playerId: string; name: string; amount: number }>,
  ) => boolean;
  // Name of the outside org whose fee the payouts help cover (display-only
  // externalOrgFee context) — enriches the footer copy when set.
  externalOrgLabel?: string;
}

// Pass-through fee-relief fundraisers: money raised to be paid back OUT to
// families (their outside org fee), never club revenue. Shows raised /
// disbursed / remaining per earmarked fundraiser and hosts the "distribute"
// action: an even split across the current paying roster, editable per
// family before confirm, refused if it exceeds the fundraiser's remaining
// balance. Invisible when no earmarked fundraiser exists.
export const FeeReliefCard = ({
  passThrough,
  payers,
  distribute,
  externalOrgLabel,
}: FeeReliefCardProps) => {
  // Which fundraiser's payout editor is open, and the per-family draft
  // amounts (strings — committed only on confirm).
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({});

  if (passThrough.fundraisers.length === 0) return null;

  const openEditor = (incomeId: string, remaining: number) => {
    const split = splitEvenly(remaining, payers.length);
    setDraftAmounts(
      Object.fromEntries(payers.map((p, i) => [p.id, String(split[i] ?? "")])),
    );
    setEditorFor(incomeId);
  };

  const confirmDistribute = (incomeId: string) => {
    const rows: Array<{ playerId: string; name: string; amount: number }> = [];
    for (const p of payers) {
      const raw = (draftAmounts[p.id] || "").trim();
      if (!raw) continue; // blank = leave this family out
      const amount = parseAmount(raw);
      if (amount == null) return; // keep editing until every amount is valid
      if (amount <= 0) continue;
      rows.push({ playerId: p.id, name: p.name, amount });
    }
    if (rows.length === 0) return;
    if (distribute(incomeId, rows)) {
      setEditorFor(null);
      setDraftAmounts({});
    }
  };

  return (
    <SectionCard
      icon={Icons.Users}
      title="Fee-relief fundraisers"
      subtitle="Held for families — paid back out, never club money"
    >
      <div className="pt-4 space-y-3">
        <ul className="divide-y divide-line">
          {passThrough.fundraisers.map((f) => (
            <li key={f.id} className="py-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div className="flex-1 min-w-[10rem]">
                  <div className="t-body-bold text-ink truncate">{f.label}</div>
                  <div className="t-meta text-ink-3 tabular-nums">
                    raised {formatCurrency(f.amount)} · disbursed{" "}
                    {formatCurrency(f.disbursed)} · remaining{" "}
                    {formatCurrency(f.remaining)}
                  </div>
                </div>
                {editorFor !== f.id && f.remaining > 0 && payers.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Distribute ${f.label} to families`}
                    onClick={() => openEditor(f.id, f.remaining)}
                  >
                    <Icons.Users className="w-3.5 h-3.5" /> Distribute to
                    families
                  </Button>
                )}
              </div>
              {editorFor === f.id && (
                <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-2">
                  <p className="t-meta text-ink-3">
                    Split evenly across {payers.length} paying{" "}
                    {payers.length === 1 ? "family" : "families"} — edit any
                    amount before confirming. Total can&apos;t exceed the{" "}
                    {formatCurrency(f.remaining)} remaining.
                  </p>
                  <ul className="space-y-1.5">
                    {payers.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="t-body-bold text-ink flex-1 min-w-0 truncate">
                          {p.name}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draftAmounts[p.id] ?? ""}
                          onChange={(e) =>
                            setDraftAmounts((cur) => ({
                              ...cur,
                              [p.id]: e.target.value,
                            }))
                          }
                          aria-label={`Payout amount for ${p.name}`}
                          className={`${FORM_INPUT_CLASS} w-28 !py-1 tabular-nums text-right`}
                          style={FORM_INPUT_RING_STYLE}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      aria-label={`Confirm fee-relief payouts for ${f.label}`}
                      onClick={() => confirmDistribute(f.id)}
                    >
                      <Icons.Check className="w-3.5 h-3.5" /> Create payouts
                    </Button>
                    <button
                      type="button"
                      aria-label="Cancel fee-relief distribution"
                      onClick={() => setEditorFor(null)}
                      className="text-ink-3 hover:text-ink text-xs font-bold underline"
                    >
                      Cancel
                    </button>
                    <span className="ml-auto t-meta text-ink-3 tabular-nums">
                      Total{" "}
                      {formatCurrency(
                        round2(
                          payers.reduce(
                            (sum, p) =>
                              sum +
                              (parseAmount((draftAmounts[p.id] || "").trim()) ||
                                0),
                            0,
                          ),
                        ),
                      )}
                    </span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {passThrough.undisbursed > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 p-3">
            <span className="t-eyebrow text-ink-3">
              Still held for families
            </span>
            <span className="text-lg font-black tabular-nums text-ink">
              {formatCurrency(passThrough.undisbursed)}
            </span>
          </div>
        )}
        <p className="t-meta text-ink-3">
          This money sits in the club balance but belongs to families —
          distributing creates unpaid payouts in the queue below; marking one
          paid logs a &quot;Fee relief&quot; expense as the cash goes back out.
          Team fees never change.
          {externalOrgLabel && (
            <>
              {" "}
              Payouts go toward the {externalOrgLabel} fee families pay
              directly.
            </>
          )}
        </p>
      </div>
    </SectionCard>
  );
};
