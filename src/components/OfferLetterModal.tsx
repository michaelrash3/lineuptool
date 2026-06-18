import React, { memo, useMemo, useState } from "react";
import { Modal } from "./shared";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import { buildMailtoUrl } from "../integrations/gmailSend";
import {
  buildOfferLetter,
  OFFER_LETTER_LABELS,
  type OfferLetterKind,
  type OfferLetterContext,
} from "../constants/offerLetters";

interface OfferLetterModalProps {
  open: boolean;
  onClose: () => void;
  kind: OfferLetterKind;
  ctx: OfferLetterContext;
  // Family email for the optional "Open in email" link (mailto:). When absent
  // only the Copy action is offered.
  recipientEmail?: string;
  // Called after the coach copies or opens the draft — the parent uses this to
  // mark the signup offered/declined.
  onDelivered?: () => void;
  onSaveNextSeasonMoney?: (patch: {
    nextDepositAmount?: number;
    nextDepositDueDate?: string;
  }) => void;
}

// Read-only draft of a recruiting letter the coach copies (or opens pre-filled
// in their own mail app). The app deliberately does NOT send it.
export const OfferLetterModal = memo(
  ({
    open,
    onClose,
    kind,
    ctx,
    recipientEmail,
    onDelivered,
    onSaveNextSeasonMoney,
  }: OfferLetterModalProps) => {
    const [depositInput, setDepositInput] = useState("");
    const [dueDateInput, setDueDateInput] = useState("");
    const toast = useToast();
    const draft = useMemo(() => buildOfferLetter(kind, ctx), [kind, ctx]);
    // Offer letters quote money; warn if next season's fee/deposit aren't set.
    // Rejection and interest drafts don't mention money, so no warning.
    const missingMoney =
      kind !== "rejection" &&
      kind !== "interest" &&
      (!ctx.teamFees || !ctx.deposit || !ctx.depositDueDate);

    const saveNextSeasonMoney = () => {
      const n = Number(String(depositInput).replace(/[$,\s]/g, ""));
      const patch: { nextDepositAmount?: number; nextDepositDueDate?: string } = {};
      if (Number.isFinite(n) && n > 0) {
        patch.nextDepositAmount = Math.round(n * 100) / 100;
      }
      if (dueDateInput) patch.nextDepositDueDate = dueDateInput;
      if (Object.keys(patch).length === 0) {
        toast.push({ kind: "error", title: "Enter a deposit amount or due date first" });
        return;
      }
      onSaveNextSeasonMoney?.(patch);
      toast.push({ kind: "success", title: "Next-season deposit saved" });
    };

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(draft.body);
        toast.push({ kind: "success", title: "Draft copied" });
        onDelivered?.();
      } catch {
        toast.push({ kind: "error", title: "Couldn't copy — select & copy manually" });
      }
    };

    const openEmail = () => {
      if (!recipientEmail) return;
      window.open(
        buildMailtoUrl(recipientEmail, draft.subject, draft.body),
        "_blank"
      );
      onDelivered?.();
    };

    return (
      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Recruiting draft"
        title={OFFER_LETTER_LABELS[kind]}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            {recipientEmail && (
              <button
                type="button"
                onClick={openEmail}
                className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-line rounded-lg text-ink hover:bg-surface-2 transition-colors inline-flex items-center gap-1.5"
              >
                <Icons.Forward className="w-4 h-4" /> Open in email
              </button>
            )}
            <button
              type="button"
              onClick={copy}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md inline-flex items-center gap-1.5"
              style={{ backgroundColor: "var(--team-primary)" }}
            >
              <Icons.Clipboard className="w-4 h-4" /> Copy draft
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {missingMoney && (
            <div className="space-y-2 text-xs font-bold text-warnfg bg-warn-bg border border-line rounded-lg px-3 py-2">
              <p>
                Set next season&apos;s team fee, deposit, and deposit due date in
                the Budget Planner so the offer fills in automatically.
              </p>
              {onSaveNextSeasonMoney && (!ctx.deposit || !ctx.depositDueDate) && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  {!ctx.deposit && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest">Deposit</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={depositInput}
                        onChange={(e) => setDepositInput(e.target.value)}
                        aria-label="Next season deposit amount"
                        className="px-3 py-2 rounded-lg border border-line bg-surface text-ink outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                      />
                    </label>
                  )}
                  {!ctx.depositDueDate && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest">Due date</span>
                      <input
                        type="date"
                        value={dueDateInput}
                        onChange={(e) => setDueDateInput(e.target.value)}
                        aria-label="Next season deposit due date"
                        className="px-3 py-2 rounded-lg border border-line bg-surface text-ink outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={saveNextSeasonMoney}
                    className="px-3 py-2 rounded-lg text-white bg-ink font-black uppercase tracking-widest text-[10px]"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1">
              Subject
            </div>
            <div className="text-sm font-bold text-ink bg-surface-2 border border-line rounded-lg px-3 py-2">
              {draft.subject}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1">
              Message
            </div>
            <textarea
              readOnly
              value={draft.body}
              rows={16}
              aria-label="Offer letter draft"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full p-3 text-sm bg-surface text-ink border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] resize-y leading-relaxed"
            />
          </div>
        </div>
      </Modal>
    );
  }
);
