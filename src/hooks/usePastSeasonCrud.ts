import { useCallback } from "react";
import { blankStats } from "../utils/helpers";

// Past-season entry CRUD extracted from App.tsx's TeamProvider. Pure
// persistence over the per-player `pastSeasons` array (add/update/remove/bulk),
// no engine or UI coupling — mirrors useGameCrud / usePlayerCrud.
interface UsePastSeasonCrudArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
}

export const usePastSeasonCrud = ({
  teamData,
  updateTeam,
}: UsePastSeasonCrudArgs) => {
  // Add a past-season entry to a single player.
  const addPastSeason = useCallback(
    (playerId: any, entry: any) => {
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        const past = Array.isArray(p.pastSeasons) ? [...p.pastSeasons] : [];
        const newEntry = {
          id: "ps-" + Math.random().toString(36).substring(2, 10),
          season: entry.season || "",
          ageGroup: entry.ageGroup || "",
          pitchingFormat: entry.pitchingFormat || "Kid Pitch",
          record: entry.record || {
            wins: 0,
            losses: 0,
            ties: 0,
            runsScored: 0,
            runsAllowed: 0,
          },
          stats: { ...blankStats(), ...(entry.stats || {}) },
        };
        past.push(newEntry);
        return { ...p, pastSeasons: past };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const updatePastSeason = useCallback(
    (playerId: any, entryId: any, patch: any) => {
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        const past = (p.pastSeasons || []).map((e: any) => {
          if (e.id !== entryId) return e;
          // Stats merge field-by-field; everything else replaces
          return {
            ...e,
            ...patch,
            stats: patch.stats
              ? { ...(e.stats || blankStats()), ...patch.stats }
              : e.stats,
          };
        });
        return { ...p, pastSeasons: past };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const removePastSeason = useCallback(
    (playerId: any, entryId: any) => {
      if (
        !window.confirm("Remove this past season entry? This cannot be undone.")
      )
        return;
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        return {
          ...p,
          pastSeasons: (p.pastSeasons || []).filter((e: any) => e.id !== entryId),
        };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  // Bulk add past-season entries from a CSV import. `assignments` is an array of
  // { playerId, season, ageGroup, pitchingFormat, stats }. Adds one entry per
  // assignment to the matching player.
  const bulkAddPastSeasons = useCallback(
    (assignments: any) => {
      if (!assignments || assignments.length === 0) return;
      const byPlayer = new Map();
      for (const a of assignments) {
        if (!a.playerId) continue;
        const list = byPlayer.get(a.playerId) || [];
        list.push({
          id: "ps-" + Math.random().toString(36).substring(2, 10),
          season: a.season || "",
          ageGroup: a.ageGroup || "",
          pitchingFormat: a.pitchingFormat || "Kid Pitch",
          record: a.record || {
            wins: 0,
            losses: 0,
            ties: 0,
            runsScored: 0,
            runsAllowed: 0,
          },
          stats: { ...blankStats(), ...(a.stats || {}) },
        });
        byPlayer.set(a.playerId, list);
      }
      const next = teamData.players.map((p: any) => {
        const adds = byPlayer.get(p.id);
        if (!adds) return p;
        return { ...p, pastSeasons: [...(p.pastSeasons || []), ...adds] };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  return { addPastSeason, updatePastSeason, removePastSeason, bulkAddPastSeasons };
};
