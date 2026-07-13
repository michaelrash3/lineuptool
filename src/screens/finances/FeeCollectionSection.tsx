import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../icons";
import { HelpTip } from "../../components/help/HelpTip";
import {
  Button,
  EmptyState,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
  PlayerAvatar,
} from "../../components/shared";
import { MoneyMeter } from "../../components/financeViz";
import {
  financeSummary,
  formatCurrency,
  owesReminderText,
} from "../../utils/helpers";
import { parseAmount } from "./financeHelpers";
import { SectionCard } from "./SectionCard";
import { CarryoverDiscountCard } from "./CarryoverDiscountCard";
import type {
  Player,
  Team,
  TeamFinances,
  ToastContextValue,
} from "../../types";
import type { FinanceSetFields } from "../../utils/financeUpdates";

type CarryoverChoice = null | "apply" | "skip";

interface FeeCollectionSectionProps {
  finances: TeamFinances;
  players: Player[];
  team: Team;
  summary: ReturnType<typeof financeSummary>;
  clubFee: number;
  effectiveFee: number;
  totalEffectiveFees: number;
  payerCount: number;
  exemptIds: Set<string>;
  feeFor: (pid: string) => number;
  recordPayment: (playerId: string, amount: number) => void;
  recordRefund: (playerId: string, name: string, paid: number) => void;
  toggleFeeWaiver: (playerId: string) => void;
  openPlayerProfile: (id: string) => void;
  feeInput: string | null;
  setFeeInput: Dispatch<SetStateAction<string | null>>;
  depositInput: string | null;
  setDepositInput: Dispatch<SetStateAction<string | null>>;
  commitClubFee: () => void;
  commitDeposit: () => void;
  payInputs: Record<string, string>;
  setPayInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setFinanceFields: (fields: FinanceSetFields) => void;
  toast: ToastContextValue;
  carryoverPendingTotal: number;
  carryoverChoice: CarryoverChoice;
  setCarryoverChoice: Dispatch<SetStateAction<CarryoverChoice>>;
  applyCarryoverDiscount: () => void;
  dismissCarryoverDiscount: () => void;
  carryoverAppliedTotal: number;
  reverseCarryoverDiscount: () => void;
}

// Collections card: the club-fee + deposit inputs, the carryover-discount
// prompt (delegated to CarryoverDiscountCard), and the per-player fee /
// payment breakdown. Presentational — all state + handlers live in
// FinancesTab and are threaded in.
export const FeeCollectionSection = ({
  finances,
  players,
  team,
  summary,
  clubFee,
  effectiveFee,
  totalEffectiveFees,
  payerCount,
  exemptIds,
  feeFor,
  recordPayment,
  recordRefund,
  toggleFeeWaiver,
  openPlayerProfile,
  feeInput,
  setFeeInput,
  depositInput,
  setDepositInput,
  commitClubFee,
  commitDeposit,
  payInputs,
  setPayInputs,
  setFinanceFields,
  toast,
  carryoverPendingTotal,
  carryoverChoice,
  setCarryoverChoice,
  applyCarryoverDiscount,
  dismissCarryoverDiscount,
  carryoverAppliedTotal,
  reverseCarryoverDiscount,
}: FeeCollectionSectionProps) => (
  <SectionCard
    icon={Icons.Users}
    title={
      <>
        Collections — this season{" "}
        <HelpTip topicId="budget-fees" label="About finances" />
      </>
    }
  >
    <div className="py-3 border-b border-line space-y-2">
      <CarryoverDiscountCard
        carryoverPendingTotal={carryoverPendingTotal}
        payerCount={payerCount}
        carryoverChoice={carryoverChoice}
        setCarryoverChoice={setCarryoverChoice}
        applyCarryoverDiscount={applyCarryoverDiscount}
        dismissCarryoverDiscount={dismissCarryoverDiscount}
        carryoverAppliedTotal={carryoverAppliedTotal}
        reverseCarryoverDiscount={reverseCarryoverDiscount}
      />
      {clubFee > 0 && payerCount > 0 && (
        <div className="flex items-center gap-3">
          <MoneyMeter
            value={summary.collected}
            max={totalEffectiveFees}
            className="flex-1 max-w-xs"
          />
          <span className="t-meta text-ink-3 tabular-nums">
            {formatCurrency(summary.collected)} of{" "}
            {formatCurrency(totalEffectiveFees)} ·{" "}
            {
              players.filter(
                (p) =>
                  !exemptIds.has(p.id) &&
                  feeFor(p.id) - (summary.paidByPlayer[p.id] || 0) <= 0,
              ).length
            }{" "}
            of {payerCount} paid
          </span>
          {summary.stillOwed > 0 && (
            <Button
              variant="secondary"
              size="sm"
              aria-label="Copy team-fees reminder"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    owesReminderText(finances, players, team.currentSeason),
                  );
                  toast.push({
                    kind: "success",
                    title: "Reminder copied",
                    message: "Paste it into your team chat or email.",
                  });
                } catch {
                  toast.push({
                    kind: "warn",
                    title: "Couldn't access clipboard",
                  });
                }
              }}
            >
              Copy reminder
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="t-eyebrow text-ink-3">Team fee per player</span>
        {feeInput == null ? (
          <button
            type="button"
            onClick={() => setFeeInput(String(clubFee || ""))}
            className="font-black tabular-nums text-ink hover:text-team-primary"
            aria-label="Edit team fee"
          >
            {formatCurrency(clubFee)}
          </button>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={feeInput}
            onChange={(e) => setFeeInput(e.target.value)}
            onBlur={commitClubFee}
            onKeyDown={(e) => e.key === "Enter" && commitClubFee()}
            aria-label="Team fee per player"
            className={`${FORM_INPUT_CLASS} w-28 tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
        )}
        {summary.duesCreditPerPlayer > 0 && (
          <span className="t-meta text-ink-3 tabular-nums">
            − {formatCurrency(summary.duesCreditPerPlayer)} fundraising credit →{" "}
            <span className="font-black text-win">
              {formatCurrency(effectiveFee)} each
            </span>
          </span>
        )}
      </div>
      {summary.duesCreditPerPlayer > 0 && (
        <p className="t-meta text-ink-3">
          Fundraising entries split evenly across the {payerCount} paying famil
          {payerCount === 1 ? "y" : "ies"} and come off each one&apos;s team
          fees — unless an entry is credited to a specific child, in which case
          it comes off that child&apos;s fees first.
        </p>
      )}

      {/* Team Fee schedule — optional up-front deposit + due dates. The
              deposit is the first slice a family is expected to cover by its
              date; payments still count toward the single fee total. */}
      <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-eyebrow text-ink-3">Deposit per player</span>
          {depositInput == null ? (
            <button
              type="button"
              onClick={() =>
                setDepositInput(String(finances.depositAmount || ""))
              }
              className="text-left font-black tabular-nums text-ink hover:text-team-primary"
              aria-label="Edit deposit amount"
            >
              {finances.depositAmount
                ? formatCurrency(finances.depositAmount)
                : "—"}
            </button>
          ) : (
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              onBlur={commitDeposit}
              onKeyDown={(e) => e.key === "Enter" && commitDeposit()}
              aria-label="Deposit per player"
              className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
              style={FORM_INPUT_RING_STYLE}
            />
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-eyebrow text-ink-3">Deposit due</span>
          <input
            type="date"
            value={finances.depositDueDate || ""}
            onChange={(e) =>
              setFinanceFields({ depositDueDate: e.target.value })
            }
            aria-label="Deposit due date"
            className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-eyebrow text-ink-3">All fees due</span>
          <input
            type="date"
            value={finances.feeDueDate || ""}
            onChange={(e) => setFinanceFields({ feeDueDate: e.target.value })}
            aria-label="All fees due date"
            className={`${FORM_INPUT_CLASS} w-full tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
        </label>
      </div>
    </div>
    {players.length === 0 ? (
      <EmptyState
        glyph="📊"
        title="No Players Yet"
        body="Add players on the Roster tab to track who owes the team fee."
      />
    ) : (
      <ul className="divide-y divide-line">
        {players.map((p) => {
          const waived = exemptIds.has(p.id);
          const paid = summary.paidByPlayer[p.id] || 0;
          // Per-child effective fee (fundraising credited to this kid lowers
          // it); waived families owe nothing.
          const playerFee = waived ? 0 : feeFor(p.id);
          const owed = Math.max(0, playerFee - paid);
          const settled = playerFee > 0 && owed === 0;
          return (
            <li key={p.id} className="py-2.5 flex flex-wrap items-center gap-2">
              <PlayerAvatar player={p} size={32} />
              <button
                type="button"
                onClick={() => openPlayerProfile(p.id)}
                className="t-body-bold text-ink hover:text-team-primary uppercase tracking-tight text-left truncate flex-1 min-w-[8rem]"
              >
                {p.name}
                {!waived && playerFee > 0 && (
                  <MoneyMeter
                    value={paid}
                    max={playerFee}
                    className="mt-1 max-w-[10rem]"
                  />
                )}
              </button>
              <span className="tabular-nums text-sm font-bold text-ink-2">
                {formatCurrency(paid)} paid
              </span>
              {waived ? (
                <>
                  <span className="text-xs font-black uppercase tracking-widest text-ink-3">
                    Fee waived
                  </span>
                  <button
                    type="button"
                    aria-label={`Reinstate fee for ${p.name}`}
                    onClick={() => toggleFeeWaiver(p.id)}
                    className="text-xs font-bold underline text-ink-3 hover:text-ink"
                  >
                    Undo
                  </button>
                </>
              ) : settled ? (
                <>
                  <span className="text-xs font-black uppercase tracking-widest text-win">
                    Paid full ✓
                  </span>
                  <button
                    type="button"
                    aria-label={`Refund ${p.name}`}
                    onClick={() => void recordRefund(p.id, p.name, paid)}
                    className="text-xs font-bold underline text-ink-3 hover:text-ink"
                  >
                    Refund
                  </button>
                </>
              ) : (
                <>
                  <span className="tabular-nums text-sm font-bold text-loss">
                    {formatCurrency(owed)} owed
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={payInputs[p.id] || ""}
                    onChange={(e) =>
                      setPayInputs((cur) => ({
                        ...cur,
                        [p.id]: e.target.value,
                      }))
                    }
                    placeholder="$"
                    aria-label={`Payment amount for ${p.name}`}
                    className={`${FORM_INPUT_CLASS} w-20 tabular-nums !py-1.5`}
                    style={FORM_INPUT_RING_STYLE}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Record payment for ${p.name}`}
                    onClick={() => {
                      const amt = parseAmount(payInputs[p.id] || "");
                      if (amt != null) recordPayment(p.id, amt);
                    }}
                  >
                    <Icons.Plus className="w-3.5 h-3.5" /> Payment
                  </Button>
                  {owed > 0 && (
                    <Button
                      variant="primary"
                      size="sm"
                      aria-label={`Mark ${p.name} paid in full`}
                      onClick={() => recordPayment(p.id, owed)}
                    >
                      Paid full
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-label={`Waive fee for ${p.name}`}
                    onClick={() => toggleFeeWaiver(p.id)}
                    className="text-xs font-bold underline text-ink-3 hover:text-ink"
                  >
                    Waive
                  </button>
                  {paid > 0 && (
                    <button
                      type="button"
                      aria-label={`Refund ${p.name}`}
                      onClick={() => void recordRefund(p.id, p.name, paid)}
                      className="text-xs font-bold underline text-ink-3 hover:text-ink"
                    >
                      Refund
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    )}
  </SectionCard>
);
