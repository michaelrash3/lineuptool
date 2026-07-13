import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Icons } from "../../icons";
import {
  Button,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "../../components/shared";
import { formatCurrency } from "../../utils/helpers";
import type { TeamFinances } from "../../types";

interface CurrentSponsor {
  id: string;
  label: string;
  amount: number;
  fundraising?: boolean;
}

interface SponsorshipSectionProps {
  finances: TeamFinances;
  sponsorWhen: "this" | "next";
  setSponsorWhen: Dispatch<SetStateAction<"this" | "next">>;
  currentSponsors: CurrentSponsor[];
  currentSponsorTotal: number;
  sponsored: number;
  toggleCurrentSponsorReduces: (id: string) => void;
  removeCurrentSponsor: (id: string) => void;
  togglePledgeReduces: (id: string) => void;
  removeSponsorship: (id: string) => void;
  addSponsorship: (e?: FormEvent) => void;
  sponsorName: string;
  setSponsorName: Dispatch<SetStateAction<string>>;
  sponsorAmount: string;
  setSponsorAmount: Dispatch<SetStateAction<string>>;
  sponsorReduces: boolean;
  setSponsorReduces: Dispatch<SetStateAction<boolean>>;
}

// Sponsorships block: the this-season / next-season toggle, the two sponsor
// lists (current + pledged), and the add-sponsor form. Presentational — all
// sponsorship state + handlers live in FinancesTab and are threaded in.
export const SponsorshipSection = ({
  finances,
  sponsorWhen,
  setSponsorWhen,
  currentSponsors,
  currentSponsorTotal,
  sponsored,
  toggleCurrentSponsorReduces,
  removeCurrentSponsor,
  togglePledgeReduces,
  removeSponsorship,
  addSponsorship,
  sponsorName,
  setSponsorName,
  sponsorAmount,
  setSponsorAmount,
  sponsorReduces,
  setSponsorReduces,
}: SponsorshipSectionProps) => (
  <div className="pt-2 border-t border-line space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="t-eyebrow text-ink-3">Sponsorships</div>
      <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
        {(
          [
            ["this", "This season"],
            ["next", "Next season"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            aria-label={`Sponsor applies to ${label.toLowerCase()}`}
            aria-pressed={sponsorWhen === val}
            onClick={() => setSponsorWhen(val)}
            className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${
              sponsorWhen === val
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
    <p className="t-meta text-ink-3">
      {sponsorWhen === "this"
        ? "Posts to this season's ledger. Each sponsor has its own switch for whether the money lowers what families owe."
        : "Pledged toward next season's budget; becomes income when the season advances. Each pledge has its own switch for whether it offsets the planned fee."}
    </p>
    {currentSponsors.length > 0 && (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="t-eyebrow text-ink-3">This season</span>
          <span className="t-eyebrow tabular-nums text-win">
            {formatCurrency(currentSponsorTotal)} total
          </span>
        </div>
        <ul className="divide-y divide-line">
          {currentSponsors.map((sp) => (
            <li key={sp.id} className="py-2 flex items-center gap-3">
              <span className="t-body-bold text-ink flex-1 truncate">
                {sp.label}
              </span>
              <button
                type="button"
                aria-pressed={!!sp.fundraising}
                aria-label={`${sp.label}: ${sp.fundraising ? "reduces team fees — tap to hold as club income" : "held as club income — tap to reduce team fees"}`}
                title={
                  sp.fundraising
                    ? "Credits this season's dues. Tap to hold as plain club income instead."
                    : "Plain club income — fees unchanged. Tap to credit this season's dues."
                }
                onClick={() => toggleCurrentSponsorReduces(sp.id)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                  sp.fundraising
                    ? "bg-win/10 text-win"
                    : "bg-surface-2 text-ink-3 hover:text-ink"
                }`}
              >
                {sp.fundraising ? "reduces fees" : "club income"}
              </button>
              <span className="tabular-nums font-black text-win">
                {formatCurrency(sp.amount)}
              </span>
              <button
                type="button"
                aria-label={`Remove this-season sponsor ${sp.label}`}
                onClick={() => removeCurrentSponsor(sp.id)}
                className="text-ink-3 hover:text-loss transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}
    {(finances.sponsorships || []).length > 0 && (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="t-eyebrow text-ink-3">Next season</span>
          <span className="t-eyebrow tabular-nums text-win">
            {formatCurrency(sponsored)} total
          </span>
        </div>
        <ul className="divide-y divide-line">
          {(finances.sponsorships || []).map((sp) => (
            <li key={sp.id} className="py-2 flex items-center gap-3">
              <span className="t-body-bold text-ink flex-1 truncate">
                {sp.sponsor}
              </span>
              <button
                type="button"
                aria-pressed={sp.reducesFees !== false}
                aria-label={`${sp.sponsor}: ${sp.reducesFees !== false ? "offsets the planned fee — tap to hold as club income" : "held as club income — tap to offset the planned fee"}`}
                title={
                  sp.reducesFees !== false
                    ? "Offsets next season's suggested fee. Tap to plan as plain club income instead."
                    : "Planned as club income — the suggested fee ignores it. Tap to offset the fee."
                }
                onClick={() => togglePledgeReduces(sp.id)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                  sp.reducesFees !== false
                    ? "bg-win/10 text-win"
                    : "bg-surface-2 text-ink-3 hover:text-ink"
                }`}
              >
                {sp.reducesFees !== false ? "reduces fees" : "club income"}
              </button>
              <span className="tabular-nums font-black text-win">
                {formatCurrency(sp.amount)}
              </span>
              <button
                type="button"
                aria-label={`Remove sponsorship from ${sp.sponsor}`}
                onClick={() => removeSponsorship(sp.id)}
                className="text-ink-3 hover:text-loss transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}
    <form onSubmit={addSponsorship} className="flex flex-col sm:flex-row gap-2">
      <input
        type="text"
        value={sponsorName}
        onChange={(e) => setSponsorName(e.target.value)}
        placeholder="Sponsor name (business, family…)"
        aria-label="Sponsor name"
        className={`${FORM_INPUT_CLASS} flex-1`}
        style={FORM_INPUT_RING_STYLE}
      />
      <input
        type="text"
        inputMode="decimal"
        value={sponsorAmount}
        onChange={(e) => setSponsorAmount(e.target.value)}
        placeholder="$ amount"
        aria-label="Sponsorship amount"
        className={`${FORM_INPUT_CLASS} sm:w-40 tabular-nums`}
        style={FORM_INPUT_RING_STYLE}
      />
      <label
        className="flex items-center gap-1.5 self-center text-xs font-bold text-ink-2 whitespace-nowrap cursor-pointer"
        title={
          sponsorWhen === "this"
            ? "Checked: credits this season's dues. Unchecked: plain club income — fees unchanged."
            : "Checked: offsets next season's suggested fee. Unchecked: planned as plain club income."
        }
      >
        <input
          type="checkbox"
          checked={sponsorReduces}
          onChange={(e) => setSponsorReduces(e.target.checked)}
          aria-label="This sponsor reduces team fees"
          className="accent-[var(--team-primary)]"
        />
        Reduces team fees
      </label>
      <Button type="submit" variant="secondary" size="md">
        <Icons.Plus className="w-4 h-4" /> Add Sponsor
      </Button>
    </form>
  </div>
);
