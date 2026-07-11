import { useCallback } from "react";
import { clampText, genId } from "../utils/helpers";
import {
  DEV_GOALS_CAP,
  capCheckIns,
  FOCUS_AREAS_CAP,
} from "../utils/developmentPlan";
import { getLocalDateString } from "../constants/ui";
import type {
  DevGoal,
  Player,
  PlayerDevPlan,
  PlayerHealth,
  ToastContextValue,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Development-plan + health mutations, following the usePlayerCrud slice
// pattern: pure persistence through the injected updateTeamArrays (narrow
// per-op writes on the players array). The suggestion/derivation math lives
// in utils/developmentPlan.ts; the availability gate in utils/availability.ts.

const HEALTH_NOTE_MAX = 200;
const GOAL_TEXT_MAX = 200;
const CHECKIN_NOTE_MAX = 500;

interface UseDevelopmentCrudArgs {
  teamData: any;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
}

export const useDevelopmentCrud = ({
  teamData,
  updateTeamArrays,
  toast,
}: UseDevelopmentCrudArgs) => {
  // One player's row rewritten via a pure mapper; everything below rides this.
  const mapPlayer = useCallback(
    (playerId: string, fn: (p: Player) => Player) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "players",
        map: (items: Player[]) =>
          items.map((p) => (p.id === playerId ? fn(p) : p)),
      });
    },
    [updateTeamArrays],
  );

  // Set or clear (null) a player's health status. Clearing writes undefined,
  // which the players sanitizer scrubs so no `health` key lingers on the doc.
  const setPlayerHealth = useCallback(
    (playerId: string, health: PlayerHealth | null) => {
      mapPlayer(playerId, (p) => {
        if (!health || health.status === "healthy") {
          const { health: _drop, ...rest } = p;
          return rest as Player;
        }
        const next: PlayerHealth = {
          status: health.status,
          updatedAt: new Date().toISOString(),
        };
        const note = clampText(health.note, HEALTH_NOTE_MAX);
        if (note) next.note = note;
        if (health.expectedReturn) next.expectedReturn = health.expectedReturn;
        return { ...p, health: next };
      });
    },
    [mapPlayer],
  );

  // Merge a partial dev-plan patch (focus areas, drill list rewrites, …).
  const updateDevPlan = useCallback(
    (playerId: string, patch: Partial<PlayerDevPlan>) => {
      const safe = { ...patch };
      if (safe.focusAreas)
        safe.focusAreas = safe.focusAreas.slice(0, FOCUS_AREAS_CAP);
      mapPlayer(playerId, (p) => ({
        ...p,
        devPlan: {
          ...(p.devPlan || {}),
          ...safe,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [mapPlayer],
  );

  const addGoal = useCallback(
    (playerId: string, text: string, targetDate?: string) => {
      const clean = clampText(text, GOAL_TEXT_MAX);
      if (!clean) return;
      const existing: Player | undefined = (teamData.players || []).find(
        (p: Player) => p.id === playerId,
      );
      if ((existing?.devPlan?.goals || []).length >= DEV_GOALS_CAP) {
        toast.push({
          kind: "warn",
          title: "Goal limit",
          message: `Keep it focused — ${DEV_GOALS_CAP} goals max per player. Mark one achieved or dropped first.`,
        });
        return;
      }
      const goal: DevGoal = {
        id: genId("goal"),
        text: clean,
        status: "active",
        createdAt: getLocalDateString(),
      };
      if (targetDate) goal.targetDate = targetDate;
      mapPlayer(playerId, (p) => ({
        ...p,
        devPlan: {
          ...(p.devPlan || {}),
          goals: [...(p.devPlan?.goals || []), goal],
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [mapPlayer, teamData.players, toast],
  );

  const setGoalStatus = useCallback(
    (playerId: string, goalId: string, status: DevGoal["status"]) => {
      mapPlayer(playerId, (p) => ({
        ...p,
        devPlan: {
          ...(p.devPlan || {}),
          goals: (p.devPlan?.goals || []).map((g) =>
            g.id === goalId ? { ...g, status } : g,
          ),
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [mapPlayer],
  );

  const removeGoal = useCallback(
    (playerId: string, goalId: string) => {
      mapPlayer(playerId, (p) => ({
        ...p,
        devPlan: {
          ...(p.devPlan || {}),
          goals: (p.devPlan?.goals || []).filter((g) => g.id !== goalId),
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [mapPlayer],
  );

  const addCheckIn = useCallback(
    (playerId: string, note: string, date?: string) => {
      const clean = clampText(note, CHECKIN_NOTE_MAX);
      if (!clean) return;
      const entry = {
        id: genId("ci"),
        date: date || getLocalDateString(),
        note: clean,
      };
      mapPlayer(playerId, (p) => ({
        ...p,
        devPlan: {
          ...(p.devPlan || {}),
          checkIns: capCheckIns([...(p.devPlan?.checkIns || []), entry]),
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [mapPlayer],
  );

  const toggleAssignedDrill = useCallback(
    (playerId: string, drillId: string) => {
      mapPlayer(playerId, (p) => {
        const cur = p.devPlan?.drillIds || [];
        const drillIds = cur.includes(drillId)
          ? cur.filter((d) => d !== drillId)
          : [...cur, drillId];
        return {
          ...p,
          devPlan: {
            ...(p.devPlan || {}),
            drillIds,
            updatedAt: new Date().toISOString(),
          },
        };
      });
    },
    [mapPlayer],
  );

  return {
    setPlayerHealth,
    updateDevPlan,
    addGoal,
    setGoalStatus,
    removeGoal,
    addCheckIn,
    toggleAssignedDrill,
  };
};
