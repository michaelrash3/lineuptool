import { formatCurrency } from "../../../utils/helpers";
import type { SeasonOutlook } from "../../../utils/helpers";

interface SeasonOutlookCardProps {
  outlook: SeasonOutlook | null;
}

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss";
}) => (
  <div className="min-w-[7rem]">
    <div className="t-eyebrow text-ink-3">{label}</div>
    <div
      className={`text-sm font-black tabular-nums ${
        tone === "loss"
          ? "text-loss"
          : tone === "win"
            ? "text-win-ink"
            : "text-ink"
      }`}
    >
      {value}
    </div>
  </div>
);

// Forward-looking projection for next season, derived from the plan (roster
// size, sponsorships, budget) and the set/suggested fee. Read-only — nothing is
// persisted. Renders nothing until there's a budget, payers, and a fee.
export const SeasonOutlookCard = ({ outlook }: SeasonOutlookCardProps) => {
  if (!outlook) return null;
  const short = outlook.projectedEndBalance < 0;
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="t-eyebrow text-ink-3">Season outlook</div>
        <div className="t-meta text-ink-3">
          at {outlook.feeSource === "set" ? "the set" : "the suggested"} fee{" "}
          <span className="font-black tabular-nums text-ink-2">
            {formatCurrency(outlook.feeUsed)}
          </span>{" "}
          × {outlook.plannedPayers}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat
          label="Break-even fee"
          value={formatCurrency(outlook.breakEvenFee)}
        />
        <Stat
          label="Cushion / family"
          value={formatCurrency(outlook.bufferPerPlayer)}
        />
        <Stat
          label="Projected end balance"
          value={formatCurrency(outlook.projectedEndBalance)}
          tone={short ? "loss" : "win"}
        />
        <Stat
          label="With carryover"
          value={formatCurrency(outlook.projectedWithCarryover)}
          tone={outlook.projectedWithCarryover < 0 ? "loss" : undefined}
        />
      </div>
      <p className="t-meta text-ink-3">
        {short ? (
          <>
            Projected short by{" "}
            <span className="font-black text-loss">
              {formatCurrency(Math.abs(outlook.projectedEndBalance))}
            </span>{" "}
            at this fee — raise the fee or trim the budget.
          </>
        ) : (
          <>
            Every family pays{" "}
            <span className="font-black text-win-ink">
              {formatCurrency(outlook.bufferPerPlayer)}
            </span>{" "}
            over break-even, building a{" "}
            <span className="font-black tabular-nums">
              {formatCurrency(outlook.projectedEndBalance)}
            </span>{" "}
            cushion by season end.
          </>
        )}
      </p>
    </div>
  );
};
