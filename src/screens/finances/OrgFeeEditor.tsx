import type { Dispatch, SetStateAction } from "react";
import {
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import type { ExternalOrgFee } from "../../types";

interface OrgFeeEditorProps {
  // Row heading, e.g. "Outside org fee" / "Outside org fee next season".
  eyebrow: string;
  // Aria prefix, e.g. "Outside org" → "Outside org name" / "Outside org fee
  // per player". The two instances (current-year in Collections, staged
  // next-year in the draft planner) must differ so labels stay unique.
  ariaPrefix: string;
  // The stored value this editor edits (externalOrgFee or nextExternalOrgFee).
  stored: ExternalOrgFee | undefined;
  labelInput: string | null;
  setLabelInput: Dispatch<SetStateAction<string | null>>;
  amountInput: string | null;
  setAmountInput: Dispatch<SetStateAction<string | null>>;
  commit: () => void;
  // Trailing helper copy, e.g. "per player, paid directly by families…".
  hint: string;
}

// Inline editor for an outside organization's per-player fee ({label, amount}
// — display-only burden context, provably inert in the money engine). One
// shared component so the current-year editor (beside the team fee in
// Collections) and the staged next-year editor (in the draft planner) can
// never drift. Commits on blur/Enter; both fields empty clears the value.
export const OrgFeeEditor = ({
  eyebrow,
  ariaPrefix,
  stored,
  labelInput,
  setLabelInput,
  amountInput,
  setAmountInput,
  commit,
  hint,
}: OrgFeeEditorProps) => (
  <div className="flex flex-wrap items-center gap-2 t-eyebrow text-ink-3">
    {eyebrow}
    <input
      type="text"
      value={labelInput ?? stored?.label ?? ""}
      onChange={(e) => setLabelInput(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      placeholder="Org name"
      aria-label={`${ariaPrefix} name`}
      className={`${FORM_INPUT_CLASS} w-36 !py-1`}
      style={FORM_INPUT_RING_STYLE}
    />
    <input
      type="text"
      inputMode="decimal"
      value={amountInput ?? (stored?.amount ? String(stored.amount) : "")}
      onChange={(e) => setAmountInput(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      placeholder="$"
      aria-label={`${ariaPrefix} fee per player`}
      className={`${FORM_INPUT_CLASS} w-20 tabular-nums !py-1`}
      style={FORM_INPUT_RING_STYLE}
    />
    <span className="normal-case font-bold">{hint}</span>
  </div>
);
