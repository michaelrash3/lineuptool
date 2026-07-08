import React, { memo, useState, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import { calculateBaseballAge } from "../utils/helpers";
import { OfferLetterModal } from "../components/OfferLetterModal";
import { makeOfferLetterContext } from "../utils/offerContext";
import { EmptyState } from "../components/shared";
import { PortalShareCard } from "../components/PortalShareCard";

// Player Interest Survey leads (year-round). Head-only screen.
// Each row carries the parent's contact info, the kid's positions
// they say they can play, and an inline two-tap-confirmed delete.
// "Move to tryouts" promotes a lead into team.tryoutSignups for the
// active tryout cycle. Schema: see InterestSignup in types.ts.
export const InterestTab = memo(() => {
  const {
    team,
    user,
    currentRole,
    deleteInterestSignup,
    convertInterestToTryout,
  } = useTeam();
  const isHead = currentRole !== "assistant";
  // Copyable "interest / tryout invite" draft for a selected lead.
  const [msgLead, setMsgLead] = useState<any | null>(null);
  const leads = useMemo(() => {
    return [...(team?.interestSignups || [])].sort(
      (a: any, b: any) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }, [team?.interestSignups]);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const blob = [l.firstName, l.lastName, l.email, l.currentTeam, l.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [leads, search]);

  if (!isHead) {
    // Assistants don't need the standing interest list; the head-coach
    // owns outreach to interested players.
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-ink-3 italic">
        Interest survey leads are only visible to the head coach.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="border-b border-line pb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="t-h2 flex items-center gap-3">
              <Icons.Users className="w-6 h-6" /> Player Interest
            </h1>
            <p className="text-xs text-ink-2 font-medium mt-1.5">
              Parents who submitted the year-round interest survey on your team
              page. When tryouts open, "Move to Tryouts" promotes a lead into
              the active tryout list.
            </p>
          </div>
          <PortalShareCard
            team={team}
            path="tryouts-portal"
            eyebrow="Interest"
            title="Player Interest Form"
            buttonLabel="Interest Form"
            description="Send to families year-round — general interest any time, plus a tryout-date dropdown whenever future dates are set."
            filenameSuffix="player-interest"
          />
        </div>
        <div className="pt-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, current team…"
              className="flex-1 px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2"
              style={
                {
                  "--tw-ring-color": "var(--team-primary)",
                } as React.CSSProperties
              }
            />
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3 tabular-nums shrink-0">
              {visible.length} / {leads.length}
            </span>
          </div>
          {leads.length === 0 ? (
            <EmptyState
              glyph="🧢"
              title="No interest signups yet"
              body="Share your team's standing link or QR code. Parents will appear here as they submit."
            />
          ) : visible.length === 0 ? (
            <div className="text-sm font-bold text-ink-3 italic text-center py-8">
              No leads match the current search.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((lead) => {
                const armed = pendingDeleteId === lead.id;
                const age = calculateBaseballAge(lead.dob, team?.currentSeason);
                return (
                  <div
                    key={lead.id}
                    className="cc-card p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-black uppercase tracking-tight text-ink truncate">
                          {lead.firstName} {lead.lastName}
                        </span>
                        {age != null && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
                            {age} y/o
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-ink-3">
                          {new Date(lead.submittedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-2 font-medium mt-0.5 break-all">
                        {lead.parentName ? `${lead.parentName} · ` : ""}
                        {lead.email} · {lead.phone}
                      </div>
                      {lead.currentTeam && (
                        <div className="text-[10px] text-ink-3 font-medium mt-0.5">
                          Currently with: {lead.currentTeam}
                        </div>
                      )}
                      {lead.tryoutDate && (
                        <div className="text-[10px] text-ink-3 font-medium mt-0.5">
                          Tryout date: {lead.tryoutDate}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {lead.primaryPosition && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink">
                            Primary: {lead.primaryPosition}
                          </span>
                        )}
                        {lead.secondaryPosition && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink">
                            Secondary: {lead.secondaryPosition}
                          </span>
                        )}
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink">
                          Pitches: {lead.canPitch ? "Yes" : "No"}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink">
                          Catches:{" "}
                          {lead.canCatch || lead.isCatcher ? "Yes" : "No"}
                        </span>
                      </div>
                      {Array.isArray(lead.comfortablePositions) &&
                        lead.comfortablePositions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {lead.comfortablePositions.map((p: any) => (
                              <span
                                key={p}
                                className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      {lead.notes && (
                        <div className="text-[11px] text-ink-2 font-medium mt-1.5 italic line-clamp-2">
                          "{lead.notes}"
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => convertInterestToTryout?.(lead.id)}
                        className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white rounded-md hover:opacity-90 transition-opacity whitespace-nowrap"
                        style={{ backgroundColor: "var(--team-primary)" }}
                        title="Promote this lead into the tryout signups list"
                      >
                        Move to Tryouts
                      </button>
                      <button
                        type="button"
                        onClick={() => setMsgLead(lead)}
                        className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-ink border border-line bg-surface rounded-md hover:bg-surface-2 transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1"
                        title="Copy a tryout-invite message for this lead"
                      >
                        <Icons.FileText className="w-3 h-3" /> Message
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (armed) {
                            deleteInterestSignup?.(lead.id);
                            setPendingDeleteId(null);
                          } else {
                            setPendingDeleteId(lead.id);
                          }
                        }}
                        onBlur={() => {
                          if (armed) setPendingDeleteId(null);
                        }}
                        className={`flex items-center justify-center gap-1 rounded-md transition-colors ${
                          armed
                            ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-loss"
                            : "px-2 py-1 text-ink-3 hover:text-loss hover:bg-loss-bg border border-line"
                        }`}
                        title={
                          armed ? "Tap again to delete" : "Delete this lead"
                        }
                        aria-label={armed ? "Confirm delete" : "Delete lead"}
                      >
                        <Icons.Trash className="w-3.5 h-3.5" />
                        {armed && (
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Confirm
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {msgLead && (
        <OfferLetterModal
          open
          onClose={() => setMsgLead(null)}
          kind="interest"
          recipientEmail={msgLead.email}
          ctx={makeOfferLetterContext(
            team,
            user,
            [msgLead.firstName, msgLead.lastName].filter(Boolean).join(" "),
          )}
        />
      )}
    </div>
  );
});
