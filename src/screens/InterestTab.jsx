import React, { memo, useState, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam } from "../contexts.js";
import { calculateBaseballAge } from "../utils/helpers";

// Player Interest Survey leads (year-round). Head-only screen.
// Each row carries the parent's contact info, the kid's positions
// they say they can play, and an inline two-tap-confirmed delete.
// "Move to tryouts" promotes a lead into team.tryoutSignups for the
// active tryout cycle. Schema: see InterestSignup in types.ts.
export const InterestTab = memo(() => {
  const { team, currentRole, deleteInterestSignup, convertInterestToTryout } =
    useTeam();
  const isHead = currentRole !== "assistant";
  const leads = useMemo(() => {
    return [...(team?.interestSignups || [])].sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
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
      <div className="max-w-3xl mx-auto py-12 text-center text-slate-400 italic">
        Interest survey leads are only visible to the head coach.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 border-b border-white/40 bg-white/20">
          <h2 className="t-h2 flex items-center gap-3">
            <Icons.Users className="w-6 h-6" /> Player Interest
          </h2>
          <p className="text-xs text-slate-600 font-medium mt-1.5">
            Parents who submitted the year-round interest survey on your
            team page. When tryouts open, "Move to Tryouts" promotes a
            lead into the active tryout list.
          </p>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, current team…"
              className="flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none focus:ring-2"
              style={{ "--tw-ring-color": "var(--team-primary)" }}
            />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 tabular-nums shrink-0">
              {visible.length} / {leads.length}
            </span>
          </div>
          {leads.length === 0 ? (
            <div className="text-center py-12 bg-white/60 border border-slate-200 rounded-xl">
              <Icons.Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500 mb-1">
                No interest signups yet
              </p>
              <p className="text-xs text-slate-400 font-medium max-w-sm mx-auto">
                Share your team's standing link or QR code. Parents will
                appear here as they submit.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="text-sm font-bold text-slate-400 italic text-center py-8">
              No leads match the current search.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((lead) => {
                const armed = pendingDeleteId === lead.id;
                const age = calculateBaseballAge(lead.dob);
                return (
                  <div
                    key={lead.id}
                    className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-3 shadow-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-black uppercase tracking-tight text-slate-900 truncate">
                          {lead.firstName} {lead.lastName}
                        </span>
                        {age != null && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {age} y/o
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-slate-400">
                          {new Date(lead.submittedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium mt-0.5 break-all">
                        {lead.parentName ? `${lead.parentName} · ` : ""}
                        {lead.email} · {lead.phone}
                      </div>
                      {lead.currentTeam && (
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">
                          Currently with: {lead.currentTeam}
                        </div>
                      )}
                      {Array.isArray(lead.comfortablePositions) &&
                        lead.comfortablePositions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {lead.comfortablePositions.map((p) => (
                              <span
                                key={p}
                                className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      {lead.notes && (
                        <div className="text-[11px] text-slate-600 font-medium mt-1.5 italic line-clamp-2">
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
                            ? "px-2 py-1 bg-red-100 text-red-800 ring-2 ring-red-300"
                            : "px-2 py-1 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200"
                        }`}
                        title={armed ? "Tap again to delete" : "Delete this lead"}
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
    </div>
  );
});
