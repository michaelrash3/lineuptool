import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import { formatCurrency } from "../../utils/helpers";
import { SectionCard } from "./SectionCard";
import type { Reimbursement } from "../../types";

interface ReimbursementQueueSectionProps {
  reimbursements: Reimbursement[];
  outstanding: number;
  addReimbursement: (e?: FormEvent) => void;
  markReimbursementPaid: (id: string) => void;
  removeReimbursement: (id: string) => void;
  reimbTo: string;
  setReimbTo: Dispatch<SetStateAction<string>>;
  reimbAmount: string;
  setReimbAmount: Dispatch<SetStateAction<string>>;
  reimbNote: string;
  setReimbNote: Dispatch<SetStateAction<string>>;
}

// Coach-internal queue of money owed back to volunteers who fronted expenses.
// An unpaid entry is a liability (not in the club balance); Mark paid posts a
// single expense so the cash leaves exactly once. All state/handlers thread in.
export const ReimbursementQueueSection = ({
  reimbursements,
  outstanding,
  addReimbursement,
  markReimbursementPaid,
  removeReimbursement,
  reimbTo,
  setReimbTo,
  reimbAmount,
  setReimbAmount,
  reimbNote,
  setReimbNote,
}: ReimbursementQueueSectionProps) => {
  const unpaid = reimbursements.filter((r) => r.status !== "paid");
  const paid = reimbursements.filter((r) => r.status === "paid");
  return (
    <SectionCard icon={Icons.Wallet} title="Volunteer reimbursements">
      <div className="pt-4 space-y-3">
        {outstanding > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 p-3">
            <span className="t-eyebrow text-ink-3">Owed to volunteers</span>
            <span className="text-lg font-black tabular-nums text-loss">
              {formatCurrency(outstanding)}
            </span>
          </div>
        )}
        {unpaid.length > 0 && (
          <ul className="divide-y divide-line">
            {unpaid.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="t-body-bold text-ink truncate">{r.to}</div>
                  {r.note && <div className="t-meta text-ink-3">{r.note}</div>}
                </div>
                <span className="tabular-nums font-black text-ink whitespace-nowrap">
                  {formatCurrency(r.amount)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Mark ${r.to} reimbursed`}
                  onClick={() => markReimbursementPaid(r.id)}
                >
                  <Icons.Check className="w-3.5 h-3.5" /> Mark paid
                </Button>
                <button
                  type="button"
                  aria-label={`Remove reimbursement for ${r.to}`}
                  onClick={() => removeReimbursement(r.id)}
                  className="inline-flex items-center justify-center min-w-[24px] min-h-[24px] text-ink-3 hover:text-loss transition-colors"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={addReimbursement}
          className="flex flex-col sm:flex-row sm:flex-wrap gap-2"
        >
          <input
            type="text"
            value={reimbTo}
            onChange={(e) => setReimbTo(e.target.value)}
            placeholder="Who fronted it?"
            aria-label="Reimburse to"
            className={`${FORM_INPUT_CLASS} sm:w-40`}
            style={FORM_INPUT_RING_STYLE}
          />
          <input
            type="text"
            inputMode="decimal"
            value={reimbAmount}
            onChange={(e) => setReimbAmount(e.target.value)}
            placeholder="$ amount"
            aria-label="Reimbursement amount"
            className={`${FORM_INPUT_CLASS} sm:w-32 tabular-nums`}
            style={FORM_INPUT_RING_STYLE}
          />
          <input
            type="text"
            value={reimbNote}
            onChange={(e) => setReimbNote(e.target.value)}
            placeholder="What for? (optional)"
            aria-label="Reimbursement note"
            className={`${FORM_INPUT_CLASS} flex-1 sm:min-w-[8rem]`}
            style={FORM_INPUT_RING_STYLE}
          />
          <Button type="submit" variant="secondary" size="md">
            <Icons.Plus className="w-4 h-4" /> Add
          </Button>
        </form>
        {paid.length > 0 && (
          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer select-none font-bold">
              {paid.length} reimbursed this season
            </summary>
            <ul className="mt-1 space-y-0.5">
              {paid.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.to}
                    {r.paidDate ? ` · ${r.paidDate}` : ""}
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="t-meta text-ink-3">
          Unpaid reimbursements are money the club still owes back — they don't
          reduce the balance until you mark them paid, which logs one expense.
        </p>
      </div>
    </SectionCard>
  );
};
