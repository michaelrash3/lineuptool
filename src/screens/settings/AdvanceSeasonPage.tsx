import React, { memo, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Icons } from "../../icons";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { Button } from "../../components/shared";
import { OfferLetterView } from "../../components/OfferLetterView";
import { makeOfferLetterContext } from "../../utils/offerContext";
import { OFFER_LETTER_LABELS } from "../../constants/offerLetters";
import { computeNextSeason } from "../../constants/ui";

// /settings/advance-season — the two-step "Advance to next season" wizard as
// a routed page per the app-wide modals→pages rule. The head marks every
// player Returning / Released in one
// pass (with bulk affordances), checks which tryout signups ride onto the new
// roster, and confirms to kick off the actual advanceSeason() write.
//
// The Returning Y/N answers persist to the team doc as they're toggled, but
// the tryout promote/deposit checkboxes are local wizard state — so the
// returning-player offer letter renders as an INLINE sub-view on this same
// page rather than navigating away, which would drop those checkboxes.
//
// Tryout "accepted" players show as a locked-in badge — they're already
// committed to the new roster by accepting their tryout offer, so they
// can't be toggled here.

const STATUS_RETURNING = "returning";
const STATUS_RELEASED = "released";
const STATUS_ACCEPTED = "accepted";

const isAccepted = (p: any) => p?.playerStatus === STATUS_ACCEPTED;

// Resolve the player's Returning Y/N answer with the same fallback
// logic as isReturning() in helpers — the explicit `returning` boolean
// wins, then legacy playerStatus. Yields STATUS_RETURNING /
// STATUS_RELEASED / STATUS_ACCEPTED for downstream bucket counting.
const effectiveStatus = (p: any) => {
  if (isAccepted(p)) return STATUS_ACCEPTED;
  if (p?.returning === false) return STATUS_RELEASED;
  if (p?.returning === true) return STATUS_RETURNING;
  return p?.playerStatus === STATUS_RELEASED
    ? STATUS_RELEASED
    : STATUS_RETURNING;
};

export const AdvanceSeasonPage = memo(() => {
  const {
    team,
    user,
    currentRole,
    advanceSeason,
    updateFinances,
    setPlayerReturning,
  } = useTeam();
  const navigate = useNavigate();
  const back = useBackOrFallback("/settings");

  const players = useMemo(() => team.players || [], [team.players]);
  const tryoutSignups = useMemo(
    () => team.tryoutSignups || [],
    [team.tryoutSignups],
  );

  const [busy, setBusy] = useState(false);
  // Tryout signups to bring forward. Defaults to the ones already marked
  // "accepted" (the HC accepted them for next season on the Tryouts tab) —
  // they're pre-checked here so the accept decision carries through. Other
  // signups stay opt-in. Seeded on mount; arriving on the page = opening
  // the old modal.
  const [promoteIds, setPromoteIds] = useState<Set<string>>(
    () =>
      new Set(
        (team.tryoutSignups || [])
          .filter((s: any) => s.status === "accepted")
          .map((s: any) => String(s.id)),
      ),
  );
  const [depositPaid, setDepositPaid] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      (team.tryoutSignups || [])
        .filter((s: any) => s.status === "accepted")
        .map((s: any) => [s.id, s.depositPaid === true]),
    ),
  );
  const [depositPaidAt, setDepositPaidAt] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        (team.tryoutSignups || [])
          .filter((s: any) => s.status === "accepted" && s.depositPaidAt)
          .map((s: any) => [s.id, String(s.depositPaidAt).slice(0, 10)]),
      ),
  );
  // Returning-player offer letter draft (copyable), opened from a row.
  // Rendered inline (same mounted page) so the checkboxes above survive.
  const [offerPlayer, setOfferPlayer] = useState<any | null>(null);

  // Pre-compute the next-season label for the header. computeNextSeason
  // returns null when the current label can't be parsed (e.g. blank),
  // which renders as "Next Season".
  const nextSeasonLabel = useMemo(() => {
    const next = computeNextSeason(team?.currentSeason);
    return next?.nextSeason || "Next Season";
  }, [team?.currentSeason]);

  const partition = useMemo(() => {
    const accepted = [];
    const returning = [];
    const released = [];
    for (const p of players) {
      const s = effectiveStatus(p);
      if (s === STATUS_ACCEPTED) accepted.push(p);
      else if (s === STATUS_RELEASED) released.push(p);
      else returning.push(p);
    }
    return { accepted, returning, released };
  }, [players]);

  const togglablePlayers = useMemo(
    () => players.filter((p: any) => !isAccepted(p)),
    [players],
  );

  // Sort signups by tryout number (if assigned), then by name.
  const sortedSignups = useMemo(() => {
    return [...tryoutSignups].sort((a: any, b: any) => {
      const numA = parseInt(a.tryoutNumber, 10);
      const numB = parseInt(b.tryoutNumber, 10);
      const aValid = Number.isFinite(numA);
      const bValid = Number.isFinite(numB);
      if (aValid && bValid) {
        if (numA !== numB) return numA - numB;
      } else if (aValid) return -1;
      else if (bValid) return 1;
      return `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
      );
    });
  }, [tryoutSignups]);

  if (currentRole === "assistant") {
    return <Navigate to="/" replace />;
  }

  // Bulk-set the Returning Y/N answer via the explicit boolean writer;
  // isReturning() handles legacy playerStatus reads at read-time.
  const setAll = (status: string) => {
    for (const p of togglablePlayers) {
      if (effectiveStatus(p) !== status) {
        setPlayerReturning(p.id, status === STATUS_RETURNING);
      }
    }
  };
  const setOne = (id: string, status: string) => {
    setPlayerReturning(id, status === STATUS_RETURNING);
  };

  const toggleSignup = (id: string) => {
    setPromoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAllSignups = (on: boolean) => {
    setPromoteIds(
      on ? new Set(sortedSignups.map((s: any) => String(s.id))) : new Set(),
    );
  };

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await advanceSeason({
        skipConfirm: true,
        tryoutsToPromote: Array.from(promoteIds),
        tryoutDepositPayments: Object.fromEntries(
          Array.from(promoteIds)
            .filter((id) => depositPaid[id] === true)
            .map((id) => [id, depositPaidAt[id] || ""]),
        ),
      });
      navigate("/settings", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  // Inline sub-view: the returning-player offer letter. Same mounted page,
  // so promoteIds / deposit checkboxes above are untouched while drafting.
  if (offerPlayer) {
    return (
      <PageShell
        eyebrow="Recruiting draft"
        title={OFFER_LETTER_LABELS.returning}
        onBack={() => setOfferPlayer(null)}
        backLabel="Advance Season"
      >
        <div className="cc-card p-5">
          <OfferLetterView
            kind="returning"
            recipientEmail={offerPlayer.email}
            ctx={makeOfferLetterContext(team, user, offerPlayer.name)}
            onSaveNextSeasonMoney={(patch) =>
              updateFinances?.({ op: "set", fields: patch })
            }
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Advance Season"
      title={`${team.currentSeason || "Current Season"} → ${nextSeasonLabel}`}
      onBack={back}
    >
      <div className="cc-card overflow-hidden">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 sm:p-6 pb-3 flex items-start gap-3">
          <div
            className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--team-primary-15)" }}
          >
            <Icons.Forward
              className="w-6 h-6"
              style={{ color: "var(--team-ink)" }}
            />
          </div>
          <p className="t-body leading-relaxed min-w-0 flex-1">
            Mark each player as Returning or Released for the next season.
            Released players are dropped from the roster (their stats stay in
            season history). Use <strong>Offer</strong> on a returning player to
            copy their offer letter (next season&apos;s dues + deposit).
            Accepted tryouts are pre-checked below and ride into the new roster.
            The schedule, tournament pitch plans, and injury statuses reset with
            the season; achieved goals are archived to each player&apos;s
            history, focus areas plus any still-active goals carry forward, and
            this season&apos;s results are archived per opponent for
            head-to-head history.
          </p>
        </div>

        <div className="px-5 sm:px-6 flex flex-wrap items-center gap-2 pb-3">
          <span className="t-meta text-ink-3 mr-1">Returning?</span>
          <button
            type="button"
            onClick={() => setAll(STATUS_RETURNING)}
            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-line bg-win-bg text-win hover:bg-win-bg"
          >
            All Yes
          </button>
          <button
            type="button"
            onClick={() => setAll(STATUS_RELEASED)}
            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-line-strong bg-surface text-ink hover:bg-surface-2"
          >
            All No
          </button>
          <span
            className="ml-auto text-[10px] font-black uppercase tracking-widest text-ink-3 tabular-nums whitespace-nowrap"
            aria-live="polite"
          >
            {partition.returning.length} yes · {partition.released.length} no ·{" "}
            {partition.accepted.length} tryout
          </span>
        </div>

        <div className="px-5 sm:px-6 pb-4 space-y-5">
          {togglablePlayers.length === 0 && partition.accepted.length === 0 ? (
            <p className="t-body text-center py-6 italic text-ink-3">
              No players on the roster yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {players.map((p: any) => {
                const status = effectiveStatus(p);
                const accepted = status === STATUS_ACCEPTED;
                const returning = status === STATUS_RETURNING;
                const released = status === STATUS_RELEASED;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 bg-surface border border-line rounded-xl px-3 py-2.5 shadow-sm"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-xs font-extrabold text-ink uppercase tracking-tight truncate">
                        {p.name}
                      </span>
                      {p.number && (
                        <span className="text-[10px] font-bold text-ink-3 tabular-nums shrink-0">
                          #{p.number}
                        </span>
                      )}
                    </div>
                    {accepted ? (
                      <span
                        className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border shrink-0"
                        style={{
                          backgroundColor: "var(--team-primary-15)",
                          borderColor: "var(--team-primary)",
                          color: "var(--team-ink)",
                        }}
                      >
                        Tryout Accept
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {returning && (
                          <button
                            type="button"
                            onClick={() => setOfferPlayer(p)}
                            title="Copy a returning-player offer letter"
                            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-line bg-surface text-ink-3 hover:bg-surface-2 transition-colors inline-flex items-center gap-1"
                          >
                            <Icons.FileText className="w-3 h-3" /> Offer
                          </button>
                        )}
                        <div
                          className="flex items-center gap-1"
                          role="group"
                          aria-label={`${p.name} returning next season`}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-widest text-ink-3 mr-1">
                            Returning?
                          </span>
                          <button
                            type="button"
                            onClick={() => setOne(p.id, STATUS_RETURNING)}
                            aria-pressed={returning}
                            className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                              returning
                                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                : "bg-surface border-line text-ink-3 hover:bg-surface-2"
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setOne(p.id, STATUS_RELEASED)}
                            aria-pressed={released}
                            className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                              released
                                ? "bg-line border-line-strong text-ink"
                                : "bg-surface border-line text-ink-3 hover:bg-surface-2"
                            }`}
                          >
                            No
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {sortedSignups.length > 0 && (
            <div className="border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <div>
                  <h3 className="t-h3 flex items-center gap-2">
                    <Icons.Plus className="w-4 h-4" /> Tryout Signups
                  </h3>
                  <p className="text-[11px] text-ink-3 font-medium mt-0.5">
                    Check the kids you're bringing onto the new roster.
                    Unchecked signups (and all signups not promoted) are cleared
                    when the season advances.
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAllSignups(true)}
                    className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-line bg-win-bg text-win hover:bg-win-bg"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllSignups(false)}
                    className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-line-strong bg-surface text-ink hover:bg-surface-2"
                  >
                    None
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {sortedSignups.map((s: any) => {
                  const checked = promoteIds.has(s.id);
                  return (
                    <li
                      key={s.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${
                        checked
                          ? "bg-emerald-50/40 border-emerald-300"
                          : "bg-surface border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSignup(s.id)}
                        className="shrink-0 w-4 h-4 accent-emerald-600 cursor-pointer"
                        aria-label={`Promote ${s.firstName} ${s.lastName} to next season`}
                      />
                      <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                        {s.tryoutNumber && (
                          <span className="text-[10px] font-bold text-ink-3 tabular-nums shrink-0">
                            #{s.tryoutNumber}
                          </span>
                        )}
                        <span className="text-xs font-extrabold text-ink uppercase tracking-tight truncate">
                          {s.firstName} {s.lastName}
                        </span>
                        {s.status && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-ink-3 shrink-0">
                            {s.status}
                          </span>
                        )}
                      </div>
                      {checked && (
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-ink-3">
                            <input
                              type="checkbox"
                              checked={depositPaid[s.id] === true}
                              onChange={(e) =>
                                setDepositPaid((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.checked,
                                }))
                              }
                              className="w-3.5 h-3.5 accent-emerald-600"
                              aria-label={`${s.firstName} ${s.lastName} paid deposit`}
                            />
                            Deposit paid
                          </label>
                          {depositPaid[s.id] === true && (
                            <input
                              type="date"
                              value={depositPaidAt[s.id] || ""}
                              onChange={(e) =>
                                setDepositPaidAt((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.value,
                                }))
                              }
                              aria-label={`${s.firstName} ${s.lastName} deposit paid date`}
                              className="px-2 py-1 rounded-lg border border-line bg-surface text-[11px] font-bold text-ink"
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3 tabular-nums mt-2 text-right">
                {promoteIds.size} of {sortedSignups.length} selected
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-line px-5 sm:px-6 py-4 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end bg-surface">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={back}
            disabled={busy}
            style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleConfirm}
            disabled={busy}
            style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            {busy ? (
              <>
                <Icons.Refresh className="w-4 h-4 animate-spin" /> Advancing…
              </>
            ) : (
              <>
                <Icons.Forward className="w-4 h-4" /> Confirm Advance Season
              </>
            )}
          </Button>
        </div>
      </div>
    </PageShell>
  );
});
