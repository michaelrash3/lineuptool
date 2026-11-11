import React, { memo, useEffect, useMemo, useState } from "react";
import { isSafeVenmoUrl } from "../utils/venmo";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import { buildMailtoUrl } from "../utils/reminderDraft";
import { parseMoneyInput } from "../utils/helpers";
import {
  buildOfferLetter,
  type LetterTemplate,
  type OfferLetterKind,
  type OfferLetterContext,
} from "../constants/offerLetters";

export interface OfferLetterViewProps {
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
  // The head coach's saved wording for this letter (team.letterTemplates),
  // when they've reworded it in Settings › Letters.
  template?: LetterTemplate | null;
  // Opens Settings › Letters. Left out where leaving would lose work (the
  // Advance Season wizard hosts this view inline).
  onEditWording?: () => void;
}

// Draft of a recruiting letter the coach copies (or opens pre-filled in their
// own mail app). The app deliberately does NOT send it. The draft starts from
// the team's saved wording (or the built-in letter) filled in for this family,
// and the coach can tweak it for this one family before copying; the standard
// wording itself is edited in Settings › Letters. Chrome-
// agnostic: the routed offer pages (screens/OfferLetterPages) wrap this in
// PageShell, and the Advance Season page hosts it inline as a sub-view so the
// wizard's own marking state survives writing an offer mid-flow.
export const OfferLetterView = memo(
  ({
    kind,
    ctx,
    recipientEmail,
    onDelivered,
    onSaveNextSeasonMoney,
    template,
    onEditWording,
  }: OfferLetterViewProps) => {
    const [depositInput, setDepositInput] = useState("");
    const [dueDateInput, setDueDateInput] = useState("");
    const toast = useToast();
    const draft = useMemo(
      () => buildOfferLetter(kind, ctx, template),
      [kind, ctx, template],
    );
    // This family's copy — editable, and reset whenever the underlying draft
    // changes (another family, new wording, a deposit just saved).
    const [subject, setSubject] = useState(draft.subject);
    const [body, setBody] = useState(draft.body);
    useEffect(() => {
      setSubject(draft.subject);
      setBody(draft.body);
    }, [draft.subject, draft.body]);
    const edited = subject !== draft.subject || body !== draft.body;
    // Offer letters quote money; warn if next season's fee/deposit aren't set.
    // Rejection and interest drafts don't mention money, so no warning.
    const missingMoney =
      kind !== "rejection" &&
      kind !== "notReturning" &&
      kind !== "interest" &&
      (!ctx.teamFees || !ctx.deposit || !ctx.depositDueDate);

    const saveNextSeasonMoney = () => {
      const n = parseMoneyInput(depositInput);
      const patch: { nextDepositAmount?: number; nextDepositDueDate?: string } =
        {};
      if (n != null) {
        patch.nextDepositAmount = n;
      }
      if (dueDateInput) patch.nextDepositDueDate = dueDateInput;
      if (Object.keys(patch).length === 0) {
        toast.push({
          kind: "error",
          title: "Enter a deposit amount or due date first",
        });
        return;
      }
      onSaveNextSeasonMoney?.(patch);
      toast.push({ kind: "success", title: "Next-season deposit saved" });
    };

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(body);
        toast.push({ kind: "success", title: "Draft copied" });
        onDelivered?.();
      } catch {
        toast.push({
          kind: "error",
          title: "Couldn't copy — select & copy manually",
        });
      }
    };

    const openEmail = () => {
      if (!recipientEmail) return;
      window.open(buildMailtoUrl(recipientEmail, subject, body), "_blank");
      onDelivered?.();
    };

    return (
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
                    <span className="text-[10px] uppercase tracking-widest">
                      Deposit
                    </span>
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
                    <span className="text-[10px] uppercase tracking-widest">
                      Due date
                    </span>
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
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Letter subject"
            className="w-full text-sm font-bold text-ink bg-surface border border-line rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          />
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1">
            Message
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            aria-label="Offer letter draft"
            className="w-full p-3 text-sm bg-surface text-ink border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] resize-y leading-relaxed"
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3 font-medium">
            <span>
              {edited
                ? "Edited for this family only."
                : "You can change this letter before you send it."}{" "}
              {onEditWording ? (
                <button
                  type="button"
                  onClick={onEditWording}
                  className="font-bold text-team-primary underline underline-offset-2"
                >
                  Change the wording for every letter
                </button>
              ) : (
                "Change the wording for every letter in Settings › Letters."
              )}
            </span>
            {edited && (
              <button
                type="button"
                onClick={() => {
                  setSubject(draft.subject);
                  setBody(draft.body);
                }}
                className="font-black uppercase tracking-widest text-[10px] text-ink-2 hover:text-ink"
              >
                Undo my changes
              </button>
            )}
          </div>
          {ctx.venmoLink && body.includes(ctx.venmoLink) && (
            <div className="mt-2 text-xs font-bold text-ink-2 bg-surface-2 border border-line rounded-lg px-3 py-2">
              Venmo link:{" "}
              {isSafeVenmoUrl(ctx.venmoLink) ? (
                <a
                  href={ctx.venmoLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-team-primary underline underline-offset-2"
                >
                  {ctx.venmoLink}
                </a>
              ) : (
                // Never an <a href> for anything but a real Venmo address.
                <span>{ctx.venmoLink}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
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
      </div>
    );
  },
);
