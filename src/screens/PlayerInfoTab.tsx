import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam } from "../contexts";

// Parent-submitted Player Info inbox (uniform/equipment sizing + logistics).
// Head-only. Each row shows what a parent sent via the public Player Info
// Portal; the coach matches it to a roster player and applies the sizing onto
// that player's record. Two-tap-confirmed delete. Schema: PlayerInfoSubmission
// in types.ts.
export const PlayerInfoTab = memo(() => {
  const {
    team,
    currentRole,
    applyPlayerInfoToPlayer,
    deletePlayerInfoSubmission,
  } = useTeam();
  const isHead = currentRole !== "assistant";

  const players = useMemo(
    () => (Array.isArray(team?.players) ? team.players : []),
    [team?.players],
  );

  const submissions = useMemo(() => {
    return [...(team?.playerInfoSubmissions || [])].sort(
      (a: any, b: any) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }, [team?.playerInfoSubmissions]);

  // Per-submission chosen roster player id (for the "apply" action). Defaults
  // lazily to the best name match the first time a row renders its dropdown.
  const [matchById, setMatchById] = useState<Record<string, string>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const guessMatch = (sub: any): string => {
    const full = `${sub.firstName || ""} ${sub.lastName || ""}`
      .trim()
      .toLowerCase();
    const dob = String(sub.dob || "").trim();
    // DOB is the strongest signal — a unique birthdate match wins outright,
    // which also disambiguates two same-named kids.
    if (dob) {
      const byDob = players.filter(
        (p: any) => String(p.dob || "").trim() === dob,
      );
      if (byDob.length === 1) return byDob[0].id;
      // Multiple kids share the birthdate → fall back to name within that set.
      if (byDob.length > 1 && full) {
        const hit = byDob.find(
          (p: any) =>
            String(p.name || "")
              .trim()
              .toLowerCase() === full,
        );
        if (hit) return hit.id;
      }
    }
    if (!full) return "";
    const hit = players.find(
      (p: any) =>
        String(p.name || "")
          .trim()
          .toLowerCase() === full,
    );
    return hit?.id || "";
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return submissions;
    return submissions.filter((s: any) => {
      const blob = [s.firstName, s.lastName, s.email, s.school, s.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [submissions, search]);

  if (!isHead) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-ink-3 italic">
        Player info submissions are only visible to the head coach.
      </div>
    );
  }

  const Chip = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-surface-2 text-ink">
        {label}: {value}
      </span>
    ) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="border-b border-line pb-5">
          <h2 className="t-h2 flex items-center gap-3">
            <Icons.Users className="w-6 h-6" /> Player Info
          </h2>
          <p className="text-xs text-ink-2 font-medium mt-1.5">
            Uniform/equipment sizing and logistics parents submitted on your
            team's Player Info form. Match each one to a roster player and tap
            Apply to save the sizing onto that player.
          </p>
        </div>
        <div className="pt-5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, school…"
              className="flex-1 px-3 py-2 text-sm bg-surface border border-line rounded-lg outline-none focus:ring-2"
              style={
                {
                  "--tw-ring-color": "var(--team-primary)",
                } as React.CSSProperties
              }
            />
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3 tabular-nums shrink-0">
              {visible.length} / {submissions.length}
            </span>
          </div>

          {submissions.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-line rounded-xl">
              {team?.logoUrl ? (
                <img
                  src={team.logoUrl}
                  alt="Team Logo"
                  className="w-24 h-24 mx-auto mb-6 opacity-40 grayscale"
                />
              ) : (
                <div
                  className="text-5xl leading-none mb-3 opacity-80"
                  aria-hidden
                >
                  🧢
                </div>
              )}
              <p className="text-sm font-bold text-ink-3 mb-1">
                No player info submitted yet
              </p>
              <p className="text-xs text-ink-3 font-medium max-w-sm mx-auto">
                Share your team's Player Info link or QR code (found on the
                Roster page). Submissions will appear here as parents fill it
                out.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="text-sm font-bold text-ink-3 italic text-center py-8">
              No submissions match the current search.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((sub: any) => {
                const armed = pendingDeleteId === sub.id;
                const matchId =
                  sub.id in matchById ? matchById[sub.id] : guessMatch(sub);
                const applied = !!sub.appliedToPlayerId;
                const appliedPlayer = applied
                  ? players.find((p: any) => p.id === sub.appliedToPlayerId)
                  : null;
                return (
                  <div
                    key={sub.id}
                    className="bg-surface border border-line rounded-xl p-3 flex flex-col gap-3 shadow-sm sm:flex-row sm:items-start"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-black uppercase tracking-tight text-ink truncate">
                          {sub.firstName} {sub.lastName}
                        </span>
                        {sub.number && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
                            #{sub.number}
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-ink-3">
                          {new Date(sub.submittedAt).toLocaleDateString()}
                        </span>
                        {applied && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-win-bg text-win inline-flex items-center gap-1">
                            <Icons.Check className="w-3 h-3" /> Applied
                            {appliedPlayer ? ` → ${appliedPlayer.name}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-2 font-medium mt-0.5 break-all">
                        {sub.parentName ? `${sub.parentName} · ` : ""}
                        {sub.email} · {sub.phone}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <Chip label="DOB" value={sub.dob} />
                        <Chip label="Hat" value={sub.hatSize} />
                        <Chip label="Shirt" value={sub.shirtSize} />
                        <Chip label="Pants" value={sub.pantsSize} />
                        <Chip label="Ht" value={sub.height} />
                        <Chip label="Wt" value={sub.weight} />
                        <Chip label="School" value={sub.school} />
                        <Chip label="Grade" value={sub.grade} />
                      </div>
                      {(sub.emergencyName || sub.emergencyPhone) && (
                        <div className="text-[10px] text-ink-3 font-medium mt-1.5">
                          Emergency: {sub.emergencyName}
                          {sub.emergencyName && sub.emergencyPhone ? " · " : ""}
                          {sub.emergencyPhone}
                        </div>
                      )}
                      {sub.notes && (
                        <div className="text-[11px] text-ink-2 font-medium mt-1.5 italic line-clamp-2">
                          "{sub.notes}"
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 shrink-0 sm:w-44">
                      <select
                        value={matchId}
                        onChange={(e) =>
                          setMatchById((m) => ({
                            ...m,
                            [sub.id]: e.target.value,
                          }))
                        }
                        className="px-2 py-1.5 text-[11px] font-bold bg-surface border border-line rounded-md outline-none focus:ring-2"
                        style={
                          {
                            "--tw-ring-color": "var(--team-primary)",
                          } as React.CSSProperties
                        }
                        aria-label="Match to roster player"
                      >
                        <option value="">Match to player…</option>
                        {players.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!matchId}
                        onClick={() =>
                          applyPlayerInfoToPlayer?.(sub.id, matchId)
                        }
                        className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white rounded-md hover:opacity-90 transition-opacity whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: "var(--team-primary)" }}
                        title="Save this sizing onto the selected roster player"
                      >
                        {applied ? "Re-apply" : "Apply to Player"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (armed) {
                            deletePlayerInfoSubmission?.(sub.id);
                            setPendingDeleteId(null);
                          } else {
                            setPendingDeleteId(sub.id);
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
                        title={armed ? "Tap again to delete" : "Delete"}
                        aria-label={
                          armed ? "Confirm delete" : "Delete submission"
                        }
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
