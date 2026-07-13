import { Icons } from "../../icons";
import { Button } from "../../components/shared";
import { formatCurrency } from "../../utils/helpers";
import type { ReconciliationRow } from "../../utils/helpers";
import { monthLabel } from "./financeHelpers";
import { SectionCard } from "./SectionCard";

interface ReconciliationSectionProps {
  rows: ReconciliationRow[];
  reconcileMonth: (month: string, ledgerBalanceNow: number) => void;
}

// Month-end reconciliation: check each month's ledger balance against the real
// bank/cash figure, flag any variance, and warn when a reconciled month has
// since drifted. Coach-internal. Renders nothing until there are dated months.
export const ReconciliationSection = ({
  rows,
  reconcileMonth,
}: ReconciliationSectionProps) => {
  if (rows.length === 0) return null;
  // Newest month first — that's the one a coach reconciles most often.
  const ordered = rows.slice().reverse();
  return (
    <SectionCard icon={Icons.Check} title="Reconciliation">
      <div className="pt-4 space-y-2">
        <ul className="divide-y divide-line">
          {ordered.map((r) => (
            <li key={r.month} className="py-2 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="t-body-bold text-ink">
                  {monthLabel(r.month)}
                </div>
                <div className="t-meta text-ink-3">
                  Ledger {formatCurrency(r.ledgerBalanceNow)}
                  {r.reconciled && r.bankBalance != null
                    ? ` · bank ${formatCurrency(r.bankBalance)}`
                    : ""}
                </div>
              </div>
              {r.reconciled && r.variance != null && (
                <span
                  className={`tabular-nums font-black whitespace-nowrap ${
                    r.variance === 0 ? "text-win-ink" : "text-loss"
                  }`}
                >
                  {r.variance === 0
                    ? "matches"
                    : `${r.variance > 0 ? "+" : ""}${formatCurrency(r.variance)}`}
                </span>
              )}
              {r.drifted && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-surface-2 text-warnfg align-middle"
                  title="The ledger changed after this month was reconciled — re-check it"
                >
                  drifted
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Reconcile ${monthLabel(r.month)}`}
                onClick={() => reconcileMonth(r.month, r.ledgerBalanceNow)}
              >
                {r.reconciled ? "Re-check" : "Reconcile"}
              </Button>
            </li>
          ))}
        </ul>
        <p className="t-meta text-ink-3">
          Enter the real bank/cash balance for a month to check it against the
          ledger. Variance = bank − ledger.
        </p>
      </div>
    </SectionCard>
  );
};
