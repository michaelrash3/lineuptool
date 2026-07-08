import React, { memo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts";
import { QRCodeImg } from "./QRCodeImg";

// Tryout operations, IN the Tryouts tab (moved out of Settings so running a
// tryout never detours through configuration): the public share link, tryout
// dates, the intake open/close toggle, lifecycle actions, roster cap, and the
// public-mirror sync status. Head-only — the tab renders this for the head
// coach; assistants see the signup content below it. Coach identity fields
// (phone / Venmo / public contact) stay in Settings, where account-level
// configuration lives.

const TryoutDatesPanel = memo(({ team, updateTeam, toast }: any) => {
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const dates: string[] = Array.isArray(team.tryoutDates)
    ? Array.from(
        new Set<string>(
          team.tryoutDates
            .map((d: any) => String(d || "").trim())
            .filter(Boolean),
        ),
      ).sort()
    : [];
  const futureDates = dates.filter((d) => d >= today);

  const saveDates = (nextDates: string[]) => {
    const cleaned = Array.from(
      new Set<string>(
        nextDates.map((d) => String(d || "").trim()).filter(Boolean),
      ),
    ).sort();
    updateTeam?.({ tryoutDates: cleaned });
  };

  return (
    <div className="cc-card p-3 space-y-3">
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
          Tryout dates
        </div>
        <p className="text-[10px] font-medium text-ink-3 leading-snug mt-1">
          Add one or more dates. Future dates appear in the Player Interest form
          dropdown; past dates are hidden from families automatically.
        </p>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
            Tryout Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-line rounded-lg"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!date) {
              toast.push({ kind: "warn", title: "Enter a tryout date first" });
              return;
            }
            saveDates([...dates, date]);
            setDate("");
            toast.push({ kind: "success", title: "Tryout date added" });
          }}
          className="px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-md"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-on-primary)",
          }}
        >
          Add Date
        </button>
      </div>
      {dates.length > 0 ? (
        <div className="space-y-1.5">
          {dates.map((d: any) => {
            const isPast = String(d) < today;
            return (
              <div
                key={d}
                className="flex items-center gap-2 bg-app border border-line rounded-lg px-3 py-2"
              >
                <span className="text-xs font-black text-ink tabular-nums flex-1">
                  {d}
                </span>
                <span
                  className={`text-[9px] font-black uppercase tracking-widest ${isPast ? "text-ink-3" : "text-ok"}`}
                >
                  {isPast ? "Hidden" : "Visible"}
                </span>
                <button
                  type="button"
                  onClick={() => saveDates(dates.filter((x: any) => x !== d))}
                  className="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-loss hover:bg-loss-bg rounded-md"
                >
                  Remove
                </button>
              </div>
            );
          })}
          <p className="text-[10px] text-ink-3 font-medium">
            {futureDates.length} future date
            {futureDates.length === 1 ? "" : "s"} will show on the public form.
          </p>
        </div>
      ) : (
        <div className="text-[11px] text-ink-3 font-medium bg-app border border-line rounded-lg p-3">
          No tryout dates set. The Player Interest link still accepts general
          interest submissions.
        </div>
      )}
    </div>
  );
});

export const TryoutControlsPanel = memo(() => {
  const {
    team,
    updateTeam,
    generateTryoutShareId,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    mirrorStale,
    resyncPublicMirror,
  } = useTeam();
  const toast = useToast();
  // Collapsed by default once configured, so the operational content (signups,
  // rankings) stays above the fold on tryout day.
  const [expanded, setExpanded] = useState(false);

  if (!team) return null;
  const shareId = team.tryoutShareId;
  const open = team.tryoutsOpen === true;
  const phase = team.tryoutsPhase || (open ? "open" : "intake_closed");
  const cap = team.rosterCap || 12;
  const shareUrl =
    shareId && typeof window !== "undefined"
      ? `${window.location.origin}/tryouts-portal/${shareId}`
      : null;

  return (
    <div className="cc-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-2 transition-colors"
      >
        <Icons.Settings className="w-4 h-4 text-ink-3 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-black uppercase tracking-widest text-ink">
            Tryout setup — dates, link &amp; intake
          </div>
          <div className="text-[11px] text-ink-3 font-medium">
            {open
              ? "Signups open"
              : phase === "completed"
                ? "Tryouts completed"
                : "Signups closed"}
            {" · "}
            {
              (team.tryoutDates || []).filter(
                (d: any) =>
                  String(d || "") >= new Date().toISOString().slice(0, 10),
              ).length
            }{" "}
            upcoming date(s)
            {shareUrl ? " · link ready" : " · no link yet"}
          </div>
        </div>
        <Icons.ChevronDown
          className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="p-4 pt-0 space-y-3">
          {shareId ? (
            <div className="cc-card p-3 space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                Player Interest &amp; Tryout Link
              </div>
              <code className="block text-[11px] text-ink break-all font-mono bg-app border border-line rounded-md p-2">
                {shareUrl}
              </code>
              <div className="flex items-start gap-3 flex-wrap">
                <QRCodeImg
                  value={shareUrl || ""}
                  size={120}
                  downloadable
                  filename={`${team.name || "team"}-player-interest-qr`}
                />
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard && shareUrl) {
                          navigator.clipboard.writeText(shareUrl);
                          toast.push({ kind: "success", title: "Link copied" });
                        }
                      }}
                      className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => generateTryoutShareId?.()}
                      className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                    >
                      Regenerate
                    </button>
                  </div>
                  <p className="text-[10px] font-medium text-ink-3 leading-snug">
                    Always opens the year-round Interest Survey — works whether
                    tryouts are open or not.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => generateTryoutShareId?.()}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg shadow-md"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-on-primary)",
              }}
            >
              Generate Player Interest Link
            </button>
          )}

          <TryoutDatesPanel team={team} updateTeam={updateTeam} toast={toast} />

          {/* Public-page sync status + manual repair. The portal parents see is
              a sanitized mirror written client-side; if that write fails the
              coach's links/branding can go stale silently. Surface it and offer
              a one-tap resync. */}
          <div
            className={`bg-surface border rounded-xl p-3 flex items-start gap-3 ${
              mirrorStale ? "border-warnfg" : "border-line"
            }`}
          >
            <Icons.Alert
              className={`w-4 h-4 mt-0.5 shrink-0 ${
                mirrorStale ? "text-warnfg" : "text-ink-3"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-black uppercase tracking-widest text-ink">
                Public page sync
              </div>
              <p className="text-[10px] font-medium text-ink-3 leading-snug">
                {mirrorStale
                  ? "The public tryout/interest page may be out of date. Resync to push your latest branding and dates."
                  : "Parents see a sanitized copy of your branding + future tryout dates. Resync if a link, logo, or date looks stale."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => resyncPublicMirror?.()}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2 shrink-0"
            >
              Resync
            </button>
          </div>

          <label className="flex items-center justify-between bg-surface border border-line rounded-xl p-3 cursor-pointer">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-ink">
                Tryouts Open
              </div>
              <div className="text-[11px] text-ink-3 font-medium">
                {open
                  ? "Public form is accepting signups."
                  : "Public form is closed. Existing signups stay visible."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTryoutsOpen?.(!open)}
              className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                open ? "" : "bg-line-strong"
              }`}
              style={
                open ? { backgroundColor: "var(--team-primary)" } : undefined
              }
              aria-label="Toggle tryouts open"
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                  open ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </label>

          <div className="cc-card p-3 space-y-2">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
              Tryout lifecycle
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setTryoutsOpen?.(false)}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
              >
                Close Signups
              </button>
              <button
                type="button"
                onClick={() => completeTryouts?.()}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md"
                style={{
                  backgroundColor: "var(--team-primary)",
                  color: "var(--team-on-primary)",
                }}
              >
                Complete Tryouts
              </button>
            </div>
            <div className="text-[11px] text-ink-3 font-medium">
              Current phase: <strong>{phase}</strong>
            </div>
          </div>

          <label className="cc-card flex items-center justify-between p-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-black uppercase tracking-widest text-ink">
                Roster Cap
              </div>
              <div className="text-[11px] text-ink-3 font-medium">
                Used by Impact Analysis to compute the cutoff returner.
              </div>
            </div>
            <input
              type="number"
              min={5}
              max={30}
              value={cap}
              onChange={(e) => setRosterCap?.(e.target.value)}
              className="shrink-0 w-16 text-center px-2 py-1 text-sm font-black bg-surface border border-line rounded-md"
            />
          </label>
        </div>
      )}
    </div>
  );
});
