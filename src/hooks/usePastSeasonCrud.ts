import { useCallback } from "react";
import { blankStats, genId } from "../utils/helpers";
import type { ConfirmContextValue } from "../types";

// Past-season entry CRUD extracted from App.tsx's TeamProvider. Pure
// persistence over the per-player `pastSeasons` array (add/update/remove/bulk),
// no engine or UI coupling — mirrors useGameCrud / usePlayerCrud.
interface UsePastSeasonCrudArgs {
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  confirm: ConfirmContextValue["confirm"];
}

export const usePastSeasonCrud = ({
  teamData,
  updateTeam,
  confirm,
}: UsePastSeasonCrudArgs) => {
  // Add a past-season entry to a single player.
  const addPastSeason = useCallback(
    (playerId: any, entry: any) => {
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        const past = Array.isArray(p.pastSeasons) ? [...p.pastSeasons] : [];
        const newEntry = {
          id: genId("ps"),
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
    [teamData.players, updateTeam],
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
    [teamData.players, updateTeam],
  );

  const removePastSeason = useCallback(
    async (playerId: any, entryId: any) => {
      const ok = await confirm({
        title: "Remove past season entry?",
        message: "This cannot be undone.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      const next = teamData.players.map((p: any) => {
        if (p.id !== playerId) return p;
        return {
          ...p,
          pastSeasons: (p.pastSeasons || []).filter(
            (e: any) => e.id !== entryId,
          ),
        };
      });
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam, confirm],
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
          id: genId("ps"),
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
    [teamData.players, updateTeam],
  );

  return {
    addPastSeason,
    updatePastSeason,
    removePastSeason,
    bulkAddPastSeasons,
  };
};
