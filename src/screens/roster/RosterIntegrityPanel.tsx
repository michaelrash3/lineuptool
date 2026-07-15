import React, { memo } from "react";
import { useTeam } from "../../contexts";
import { Icons } from "../../icons";
import {
  jerseyConflicts,
  ageIneligiblePlayers,
  activeRosterCount as countActive,
} from "../../utils/rosterIntegrity";

// Coach-facing roster-health strip on the Roster tab: active count vs cap, a
// finalize/unlock control, and non-blocking warnings for duplicate jersey
// numbers and age-ineligible players. Head/assistant only; hidden for an empty
// roster. Deliberately advisory — it flags, it never edits players.
export const RosterIntegrityPanel = memo(() => {
  const { team, currentRole, updateTeam } = useTeam();
  const canEdit = currentRole !== "assistant";
  const players = team.players || [];
  if (!canEdit || players.length === 0) return null;

  const cap =
    typeof team.rosterCap === "number" && team.rosterCap > 0
      ? team.rosterCap
      : null;
  const count = countActive(players);
  const locked = team.rosterLocked === true;
  const conflicts = jerseyConflicts(players);
  const overAge = ageIneligiblePlayers(
    players,
    team.teamAge,
    team.currentSeason,
  );
  const overCap = cap != null && count > cap;
  const capNote = overCap
    ? " · over cap"
    : cap != null && count === cap
      ? " · full"
      : "";

  return (
    <div className="cc-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="t-eyebrow flex items-center gap-2">
          <Icons.Users className="w-4 h-4" /> Roster Integrity
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`t-chip px-2 py-1 rounded-md border ${
              overCap
                ? "bg-loss-bg border-loss text-loss"
                : "bg-surface-2 border-line text-ink"
            }`}
          >
            {count}
            {cap != null ? ` / ${cap}` : ""} players{capNote}
          </span>
          <button
            type="button"
            onClick={() => updateTeam({ rosterLocked: !locked })}
            className="t-chip px-2.5 py-1 rounded-md border border-line-strong hover:bg-surface-2 flex items-center gap-1.5"
          >
            <Icons.Lock className="w-3.5 h-3.5" />
            {locked ? "Unlock roster" : "Finalize roster"}
          </button>
        </div>
      </div>

      {(conflicts.length > 0 || overAge.length > 0) && (
        <div className="mt-3 space-y-1.5">
          {conflicts.map((c) => (
            <p
              key={`num-${c.number}`}
              className="text-[11px] font-bold text-loss flex items-center gap-1.5"
            >
              <Icons.Alert className="w-3.5 h-3.5 shrink-0" />#{c.number} worn
              by {c.players.map((p) => p.name).join(" & ")}
            </p>
          ))}
          {overAge.map((p) => (
            <p
              key={`age-${p.id}`}
              className="text-[11px] font-bold text-loss flex items-center gap-1.5"
            >
              <Icons.Alert className="w-3.5 h-3.5 shrink-0" />
              {p.name} is {p.age} — over the {p.cap}U division
            </p>
          ))}
        </div>
      )}

      {locked && (
        <p className="mt-3 text-[11px] font-medium text-ink-3">
          Roster is finalized — the Add Player form is blocked until you unlock.
        </p>
      )}
    </div>
  );
});
