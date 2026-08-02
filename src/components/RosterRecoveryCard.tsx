import React, { useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts";
import { planRosterRebuild } from "../utils/rosterRebuild";

// Shown ONLY inside the Roster tab's players-empty state, for editors. If the
// season's other data (games, practices, depth chart, eval rounds, applied
// availability / player-info submissions) still references player ids, the
// roster can be rebuilt from those references — history is keyed by player id
// and reattaches the moment the ids come back. This exists because the roster
// is one array field on the team doc: lose that one field and every other
// trace of the season survives around it.
export const RosterRecoveryCard = () => {
  const { team, updateTeamArrays } = useTeam();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);
  const [armed, setArmed] = useState(false);

  const plan = useMemo(() => planRosterRebuild(team), [team]);

  if (plan.players.length === 0) return null;

  const unnamed = plan.players.length - plan.namedCount;
  const sourceLabels = [
    ...new Set([...plan.evidence.values()].flatMap((e) => e.sources)),
  ];

  const restore = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setRestoring(true);
    // Append (arrayUnion), never a whole-array write: additive, concurrency-
    // safe, and it passes the roster-wipe guard trivially.
    updateTeamArrays({ op: "append", key: "players", entries: plan.players });
    toast.push({
      kind: "success",
      title: "Roster restored",
      message: `${plan.players.length} player${
        plan.players.length === 1 ? "" : "s"
      } rebuilt from season data. Review names, numbers, and positions.`,
    });
  };

  return (
    <div className="mb-4 bg-surface border-2 rounded-2xl p-5 shadow-card border-line">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--team-primary-15)" }}
        >
          <Icons.Refresh
            className="w-5 h-5"
            style={{ color: "var(--team-primary)" }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="t-card-title mb-1">Recover roster from season data</h3>
          <p className="t-body mb-3">
            Your roster list is empty, but this season still references{" "}
            <strong>{plan.players.length}</strong> player
            {plan.players.length === 1 ? "" : "s"} ({sourceLabels.join(", ")}).
            Restoring re-links every game, practice, evaluation, and stat line —
            they were never deleted, they key on each player&apos;s id.
            {unnamed > 0 && (
              <>
                {" "}
                {unnamed} {unnamed === 1 ? "has" : "have"} no recoverable name
                and will be added as &ldquo;Recovered player&rdquo; to rename.
              </>
            )}
          </p>
          <ul className="t-body mb-4 flex flex-wrap gap-x-4 gap-y-1">
            {plan.players.slice(0, 12).map((p) => (
              <li key={p.id} className="whitespace-nowrap">
                {p.name}
                {p.number ? ` #${p.number}` : ""}
              </li>
            ))}
            {plan.players.length > 12 && (
              <li className="text-ink-3">+{plan.players.length - 12} more</li>
            )}
          </ul>
          <button
            type="button"
            onClick={restore}
            disabled={restoring}
            className="t-button px-4 py-2.5 min-h-[44px] rounded-xl inline-flex items-center gap-2 disabled:opacity-60"
            style={{
              backgroundColor: "var(--team-primary)",
              color: "var(--team-primary-contrast, #fff)",
            }}
          >
            {restoring
              ? "Restoring…"
              : armed
                ? `Tap again to restore ${plan.players.length} player${
                    plan.players.length === 1 ? "" : "s"
                  }`
                : "Rebuild roster"}
          </button>
          <p className="t-label text-ink-3 mt-2">
            Field positions default to &ldquo;anywhere&rdquo;; Pitcher and
            Catcher are only kept where your depth chart listed them — mark the
            rest from each player&apos;s profile. Imported stat lines stay on
            each game and roll back up automatically.
          </p>
        </div>
      </div>
    </div>
  );
};
