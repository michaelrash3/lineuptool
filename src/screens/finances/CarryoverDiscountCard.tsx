import type { Dispatch, SetStateAction } from "react";
import { Icons } from "../../icons";
import { Button } from "../../components/shared";
import { formatCurrency } from "../../utils/helpers";

type CarryoverChoice = null | "apply" | "skip";

interface CarryoverDiscountCardProps {
  carryoverPendingTotal: number;
  payerCount: number;
  carryoverChoice: CarryoverChoice;
  setCarryoverChoice: Dispatch<SetStateAction<CarryoverChoice>>;
  applyCarryoverDiscount: () => void;
  dismissCarryoverDiscount: () => void;
  carryoverAppliedTotal: number;
  reverseCarryoverDiscount: () => void;
}

// Last-season surplus → team-fee discount prompts: a pending offer (apply / skip
// with confirm sub-steps) and, once applied, a reverse control. Presentational —
// the carryover state + handlers live in FinancesTab and are threaded in.
export const CarryoverDiscountCard = ({
  carryoverPendingTotal,
  payerCount,
  carryoverChoice,
  setCarryoverChoice,
  applyCarryoverDiscount,
  dismissCarryoverDiscount,
  carryoverAppliedTotal,
  reverseCarryoverDiscount,
}: CarryoverDiscountCardProps) => (
  <>
    {carryoverPendingTotal > 0 && payerCount > 0 && (
      <div className="flex flex-wrap items-center gap-3 py-2 pl-3 border-l-2 border-line-strong">
        {carryoverChoice === null ? (
          <>
            <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
              Last season left{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(carryoverPendingTotal)}
              </span>{" "}
              in the bank. Apply it as a team-fee discount — about{" "}
              <span className="font-black text-win-ink tabular-nums">
                {formatCurrency(carryoverPendingTotal / payerCount)} off per
                family
              </span>
              ?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Apply carryover as team-fee discount"
                onClick={() => setCarryoverChoice("apply")}
              >
                <Icons.Check className="w-4 h-4" /> Yes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Skip carryover discount"
                onClick={() => setCarryoverChoice("skip")}
              >
                No
              </Button>
            </div>
          </>
        ) : carryoverChoice === "apply" ? (
          <>
            <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
              Apply{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(carryoverPendingTotal)}
              </span>{" "}
              as a team-fee discount? This lowers every family&apos;s fee — you
              can reverse it later.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Confirm apply carryover discount"
                onClick={applyCarryoverDiscount}
              >
                <Icons.Check className="w-4 h-4" /> Yes, apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Cancel carryover choice"
                onClick={() => setCarryoverChoice(null)}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
              Keep{" "}
              <span className="font-black text-ink tabular-nums">
                {formatCurrency(carryoverPendingTotal)}
              </span>{" "}
              in the bank and stop asking?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Confirm skip carryover discount"
                onClick={dismissCarryoverDiscount}
              >
                No, skip
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Cancel carryover choice"
                onClick={() => setCarryoverChoice(null)}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    )}
    {carryoverAppliedTotal > 0 && (
      <div className="flex flex-wrap items-center gap-3 py-2 pl-3 border-l-2 border-line-strong">
        <p className="t-body text-ink-2 flex-1 min-w-[14rem]">
          Last season&apos;s{" "}
          <span className="font-black text-ink tabular-nums">
            {formatCurrency(carryoverAppliedTotal)}
          </span>{" "}
          surplus is applied as a team-fee discount. Reverse it if that was a
          mistake.
        </p>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Reverse carryover team-fee discount"
          onClick={reverseCarryoverDiscount}
        >
          <Icons.Refresh className="w-4 h-4" /> Reverse discount
        </Button>
      </div>
    )}
  </>
);
