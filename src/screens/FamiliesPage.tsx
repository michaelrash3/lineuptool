import React, { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useTeam } from "../contexts";
import { PageShell } from "../components/PageShell";
import { Icons } from "../icons";
import { featureEnabled } from "../constants/features";
import { useBackOrFallback } from "../hooks/usePageNav";
import { dedupePlayerInfoSubmissions } from "../utils/helpers";

// /families — one menu entry for everything parents send in through the
// public forms (it used to be three separate tabs in a 12-item menu). Each
// card opens the existing inbox; turned-off modules don't show. Tryouts stays
// its own tab: it's a season workflow with grading, not just an inbox.
export const FAMILY_INBOXES = [
  {
    id: "interest",
    path: "/interest",
    title: "Interest",
    blurb: "Families asking about the team year-round.",
    icon: Icons.Clipboard,
    count: (team: any) => (team?.interestSignups || []).length,
    unit: (n: number) => (n === 1 ? "signup" : "signups"),
  },
  {
    id: "playerInfo",
    path: "/player-info",
    title: "Player Info",
    blurb: "Uniform sizes, contacts and logistics parents sent in.",
    icon: Icons.Users,
    // Same de-dupe the inbox uses: a parent re-sending the form replaces
    // their earlier copy, so the card must not count it twice.
    count: (team: any) =>
      dedupePlayerInfoSubmissions(team?.playerInfoSubmissions).length,
    unit: (n: number) => (n === 1 ? "player" : "players"),
  },
  {
    id: "availability",
    path: "/availability",
    title: "Availability",
    blurb: "Dates families say their player will miss.",
    icon: Icons.Calendar,
    // Applied submissions are done; what's waiting is the ones not yet
    // matched to a player on the roster.
    count: (team: any) =>
      (team?.availabilitySubmissions || []).filter(
        (s: any) => !s?.appliedToPlayerId,
      ).length,
    unit: () => "to match",
  },
] as const;

export const FamiliesPage = memo(() => {
  const { team } = useTeam();
  const navigate = useNavigate();
  const back = useBackOrFallback("/");
  const inboxes = FAMILY_INBOXES.filter((i) => featureEnabled(team, i.id));
  return (
    <PageShell eyebrow="Families" title="From your families" onBack={back}>
      <p className="t-body text-sm text-ink-3 mb-4 max-w-xl">
        Everything parents send through your public forms. Open one to review
        it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {inboxes.map((i) => {
          const n = i.count(team);
          const Icon = i.icon;
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => navigate(i.path)}
              className="cc-card p-5 text-left hover:bg-surface-2 transition-colors min-h-[44px]"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-5 h-5 text-team-primary" />
                <span className="t-card-title">{i.title}</span>
              </div>
              <div className="t-stat-num tabular-nums">{n}</div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3">
                {i.unit(n)}
              </div>
              <p className="t-body text-xs text-ink-3 mt-2">{i.blurb}</p>
            </button>
          );
        })}
      </div>
    </PageShell>
  );
});
