import { Icons } from "../../icons";
import { SectionCard } from "./SectionCard";
import { CashflowChart, SpendingDonut } from "../../components/financeViz";
import {
  formatCurrency,
  monthlyCashflow,
  incomeByCategory,
  spendingByCategory,
} from "../../utils/helpers";
import type { LedgerRow } from "../../utils/helpers";
import type { TeamFinances } from "../../types";

interface CashFlowSectionProps {
  ledger: LedgerRow[];
  months: ReturnType<typeof monthlyCashflow>;
  finances: TeamFinances;
  revenueRows: ReturnType<typeof incomeByCategory>;
}

// The right-column "Cash Flow" card: cashflow chart, spending donut, and the
// money-in-by-source list. Read-only — every input is derived (memoized)
// upstream and threaded in as a prop.
export const CashFlowSection = ({
  ledger,
  months,
  finances,
  revenueRows,
}: CashFlowSectionProps) => (
  <div className="lg:col-span-5 space-y-6">
    {ledger.length > 0 && (
      <SectionCard icon={Icons.Clipboard} title="Cash Flow">
        <div className="pt-4 space-y-6">
          <CashflowChart months={months} />
          <SpendingDonut slices={spendingByCategory(finances)} />
          {/* Money in by source — the revenue half of the accounting
              picture. Dues flow in from the payment tracker (net of
              refunds); ledger income uses its tagged source, else the
              label-inferred one. */}
          {revenueRows.length > 0 && (
            <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="t-eyebrow text-ink-3">Money in by source</div>
                <div className="t-meta text-ink-3 tabular-nums">
                  {formatCurrency(
                    revenueRows.reduce((sum, r) => sum + r.amount, 0),
                  )}
                </div>
              </div>
              <ul className="space-y-1.5">
                {revenueRows.map((r) => (
                  <li
                    key={r.category}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="font-bold text-ink truncate">
                      {r.label}
                    </span>
                    <span
                      className={`tabular-nums whitespace-nowrap font-bold ${
                        r.amount < 0 ? "text-loss" : "text-ink-2"
                      }`}
                    >
                      {formatCurrency(r.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>
    )}
  </div>
);
