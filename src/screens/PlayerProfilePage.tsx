import React, { memo, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import { PlayerAvatar } from "../components/shared";
import { calculateBaseballAge, formatStat } from "../utils/helpers";

const Field = ({ label, value }: { label: string; value?: any }) => (
  <div className="rounded-xl border border-line bg-surface p-3">
    <div className="text-[10px] font-black uppercase tracking-widest text-ink-3">
      {label}
    </div>
    <div className="mt-1 text-sm font-black text-ink break-words">
      {value || "—"}
    </div>
  </div>
);

export const PlayerProfilePage = memo(() => {
  const { playerId } = useParams();
  const { team, currentRole } = useTeam();
  const canViewPrivate = currentRole !== "assistant";
  const player = useMemo(
    () => (team?.players || []).find((p: any) => p.id === playerId),
    [team?.players, playerId],
  );

  if (!player) {
    return (
      <div className="max-w-3xl mx-auto cc-card p-6 text-center">
        <h2 className="t-h2 mb-2">Player not found</h2>
        <p className="t-body mb-4">
          That roster profile is no longer available.
        </p>
        <Link to="/roster" className="t-button text-team-primary">
          Back to roster
        </Link>
      </div>
    );
  }

  const stats = player.stats || {};
  const positions = Array.isArray(player.comfortablePositions)
    ? player.comfortablePositions.join(", ")
    : "";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link
        to="/roster"
        className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink"
      >
        <Icons.ChevronDown className="w-4 h-4 rotate-90" /> Back to roster
      </Link>

      <section className="cc-card overflow-hidden">
        <div
          className="h-1.5"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 sm:p-7 flex flex-col sm:flex-row gap-5 sm:items-center">
          <PlayerAvatar player={player} size={112} showNumber showPosition />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-ink truncate">
              {player.name || "Unnamed Player"}
            </h1>
            <p className="mt-1 text-xs font-black uppercase tracking-widest text-ink-3">
              Roster Profile
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="t-chip px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-ink">
                #{player.number || "—"}
              </span>
              <span className="t-chip px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-ink">
                B/T · {player.bats || "R"}/{player.throws || "R"}
              </span>
              <span className="t-chip px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-ink">
                Primary · {player.primaryPosition || "—"}
              </span>
              {player.playerInfoSubmittedAt && (
                <span className="t-chip px-3 py-1.5 rounded-lg bg-win-bg border border-win/40 text-win">
                  Player info complete
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="AVG" value={formatStat(stats.avg)} />
        <Field label="OPS" value={formatStat(stats.ops)} />
        <Field label="Hits" value={stats.h || 0} />
        <Field label="RBI" value={stats.rbi || 0} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="cc-card p-5">
          <h2 className="t-h3 mb-4">Baseball</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Comfortable positions" value={positions} />
            <Field
              label="Secondary position"
              value={player.secondaryPosition}
            />
            <Field
              label="Baseball age"
              value={calculateBaseballAge(player.dob, team.currentSeason)}
            />
            <Field
              label="Status"
              value={player.rosterStatus === "departed" ? "Departed" : "Active"}
            />
          </div>
        </div>

        <div className="cc-card p-5">
          <h2 className="t-h3 mb-4">Player Info</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hat" value={player.hatSize} />
            <Field label="Shirt" value={player.shirtSize} />
            <Field label="Pants" value={player.pantsSize} />
            <Field label="School" value={player.school} />
            <Field label="Grade" value={player.grade} />
            <Field
              label="Submitted"
              value={
                player.playerInfoSubmittedAt
                  ? new Date(player.playerInfoSubmittedAt).toLocaleDateString()
                  : "Missing"
              }
            />
          </div>
        </div>
      </section>

      {canViewPrivate && (
        <section className="cc-card p-5">
          <h2 className="t-h3 mb-4">Contact</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Parent" value={player.parentName} />
            <Field label="Email" value={player.email} />
            <Field label="Phone" value={player.phone} />
            <Field label="Emergency contact" value={player.emergencyName} />
            <Field label="Emergency phone" value={player.emergencyPhone} />
          </div>
        </section>
      )}
    </div>
  );
});
