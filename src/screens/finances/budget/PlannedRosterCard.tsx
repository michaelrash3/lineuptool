import type { Dispatch, SetStateAction } from "react";
import { Icons } from "../../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../../components/shared";
import { formatCurrency } from "../../../utils/helpers";
import { DEPOSIT_QUICK_PICKS } from "../../../constants/financeCategories";
import type { TeamFinances } from "../../../types";
import type { FinanceSetFields } from "../../../utils/financeUpdates";

interface PlannedRosterCardProps {
  finances: TeamFinances;
  setFinanceFields: (fields: FinanceSetFields) => void;
  bufferInc: number;
  payerCount: number;
  plannedCount: number;
  budget: number;
  sponsoredOffset: number;
  suggested: number | null;
  nextFee: number | null;
  taxInput: string | null;
  setTaxInput: Dispatch<SetStateAction<string | null>>;
  commitSalesTax: () => void;
  plannedInput: string | null;
  setPlannedInput: Dispatch<SetStateAction<string | null>>;
  commitPlannedPlayers: () => void;
  nextDepositInput: string | null;
  setNextDepositInput: Dispatch<SetStateAction<string | null>>;
  commitNextDeposit: () => void;
}

// The tail of the Budget Planner card: planner settings (sales tax + fee
// buffer + anticipated roster), the next-season deposit slice, and the budget
// total → suggested-fee summary. Presentational — every value and handler is
// threaded from FinancesTab; the SectionCard chrome stays in the parent so
// this renders as a Fragment of direct siblings (DOM identical).
export const PlannedRosterCard = ({
  finances,
  setFinanceFields,
  bufferInc,
  payerCount,
  plannedCount,
  budget,
  sponsoredOffset,
  suggested,
  nextFee,
  taxInput,
  setTaxInput,
  commitSalesTax,
  plannedInput,
  setPlannedInput,
  commitPlannedPlayers,
  nextDepositInput,
  setNextDepositInput,
  commitNextDeposit,
}: PlannedRosterCardProps) => (
  <>
    {/* Planner settings: sales tax on flagged items + fee round-up buffer */}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-line">
      <label className="flex items-center gap-2 t-eyebrow text-ink-3">
        Sales tax
        <input
          type="text"
          inputMode="decimal"
          value={taxInput ?? String(finances.salesTaxPct ?? "")}
          onChange={(e) => setTaxInput(e.target.value)}
          onBlur={commitSalesTax}
          onKeyDown={(e) => e.key === "Enter" && commitSalesTax()}
          placeholder="0"
          aria-label="Sales tax percent"
          className={`${FORM_INPUT_CLASS} w-16 tabular-nums !py-1`}
          style={FORM_INPUT_RING_STYLE}
        />
        <span className="normal-case font-bold">% on “+tax” items</span>
      </label>
      <div className="flex items-center gap-1.5">
        <span className="t-eyebrow text-ink-3">Fee buffer</span>
        {[
          { inc: 0, label: "None" },
          { inc: 25, label: "$25" },
          { inc: 50, label: "$50" },
        ].map((opt) => (
          <button
            key={opt.inc}
            type="button"
            aria-label={`Fee buffer ${opt.label}`}
            aria-pressed={bufferInc === opt.inc}
            onClick={() => setFinanceFields({ feeBufferIncrement: opt.inc })}
            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors ${
              bufferInc === opt.inc
                ? "text-win bg-win/10"
                : "text-ink-3 bg-surface-2 hover:bg-line"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="t-meta text-ink-3 hidden sm:inline">
          rounds the fee up to cover incidentals
        </span>
      </div>
      <label className="flex items-center gap-2 t-eyebrow text-ink-3">
        Players next season
        <input
          type="text"
          inputMode="numeric"
          value={
            plannedInput ??
            (finances.plannedPlayerCount
              ? String(finances.plannedPlayerCount)
              : "")
          }
          onChange={(e) => setPlannedInput(e.target.value)}
          onBlur={commitPlannedPlayers}
          onKeyDown={(e) => e.key === "Enter" && commitPlannedPlayers()}
          placeholder={String(payerCount || "")}
          aria-label="Anticipated players next season"
          className={`${FORM_INPUT_CLASS} w-16 tabular-nums !py-1`}
          style={FORM_INPUT_RING_STYLE}
        />
        <span className="normal-case font-bold">
          splits the fee (blank = current roster)
        </span>
      </label>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex flex-col gap-1">
        <span className="t-eyebrow text-ink-3">Next season deposit</span>
        {nextDepositInput == null ? (
          <button
            type="button"
            onClick={() =>
              setNextDepositInput(String(finances.nextDepositAmount || ""))
            }
            className="text-left font-black tabular-nums text-ink hover:text-team-primary"
            aria-label="Edit next season deposit amount"
          >
            {finances.nextDepositAmount
              ? formatCurrency(finances.nextDepositAmount)
              : "Add amount"}
          </button>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={nextDepositInput}
            onChange={(e) => setNextDepositInput(e.target.value)}
            onBlur={commitNextDeposit}
            onKeyDown={(e) => e.key === "Enter" && commitNextDeposit()}
            aria-label="Next season deposit"
            className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
        )}
        {/* One-tap common deposit slices — sets the amount immediately. */}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {DEPOSIT_QUICK_PICKS.map((amt) => (
            <button
              key={amt}
              type="button"
              aria-label={`Set next season deposit to ${formatCurrency(amt)}`}
              aria-pressed={finances.nextDepositAmount === amt}
              onClick={() => {
                setNextDepositInput(null);
                setFinanceFields({ nextDepositAmount: amt });
              }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-black tabular-nums transition-colors ${
                finances.nextDepositAmount === amt
                  ? "bg-win/10 text-win"
                  : "bg-surface-2 hover:bg-line text-ink-3"
              }`}
            >
              {formatCurrency(amt)}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="t-eyebrow text-ink-3">Next season deposit due</span>
        <input
          type="date"
          value={finances.nextDepositDueDate || ""}
          onChange={(e) =>
            setFinanceFields({ nextDepositDueDate: e.target.value })
          }
          aria-label="Next season deposit due date"
          className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
          style={FORM_INPUT_RING_STYLE}
        />
      </label>
      <p className="sm:col-span-2 t-meta text-ink-3">
        Offer letters use these next-season deposit values. They promote into
        the current collection schedule when you advance seasons.
      </p>
    </div>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line">
      <div className="t-body text-ink-2">
        Budget total:{" "}
        <span className="font-black text-ink tabular-nums">
          {formatCurrency(budget)}
        </span>
        {sponsoredOffset > 0 && (
          <> − sponsorships {formatCurrency(sponsoredOffset)}</>
        )}
        {suggested != null && (
          <>
            {" "}
            → suggested fee{" "}
            <span className="font-black text-ink tabular-nums">
              {formatCurrency(suggested)}
            </span>{" "}
            × {plannedCount}{" "}
            {Number(finances.plannedPlayerCount) > 0 ? "anticipated" : "paying"}{" "}
            player{plannedCount === 1 ? "" : "s"}
            {bufferInc > 0 && (
              <span className="t-meta text-ink-3">
                {" "}
                (rounded up to the next ${bufferInc} as buffer)
              </span>
            )}
          </>
        )}
        {nextFee != null && (
          <div className="t-meta text-ink-3 mt-1">
            Next season's fee is set to{" "}
            <span className="font-black tabular-nums">
              {formatCurrency(nextFee)}
            </span>{" "}
            — it becomes the team fee when the new season starts in the Fall.
          </div>
        )}
        {finances.nextDepositAmount != null &&
          finances.nextDepositAmount > 0 && (
            <div className="t-meta text-ink-3 mt-1">
              Next season's deposit is set to{" "}
              <span className="font-black tabular-nums">
                {formatCurrency(finances.nextDepositAmount)}
              </span>
              {finances.nextDepositDueDate && (
                <> due {finances.nextDepositDueDate}</>
              )}
              .
            </div>
          )}
      </div>
      {suggested != null && suggested !== nextFee && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setFinanceFields({ nextClubFee: suggested })}
        >
          <Icons.Check className="w-4 h-4" /> Set as next season's fee
        </Button>
      )}
    </div>
  </>
);
