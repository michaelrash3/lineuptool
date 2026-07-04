import { useCallback } from "react";
import { normalizeDateToIso, genId } from "../utils/helpers";
import { DEFAULT_DRILL_LIBRARY } from "../constants/ui";
import type {
  ConfirmContextValue,
  DrillDefinition,
  Practice,
  ToastContextValue,
} from "../types";
import type { TeamArrayUpdate } from "../utils/teamArrayUpdates";

// Practice CRUD, mirroring useGameCrud's shape. Practice writes go through the
// injected updateTeamArrays (narrow per-op Firestore writes so concurrent
// edits by two coaches can't clobber each other); the drill library — team
// config, not one of the concurrency-safe arrays — stays on updateTeam. No
// coupling to the lineup engine.
interface UsePracticeCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  updateTeamArrays: (input: TeamArrayUpdate | TeamArrayUpdate[]) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

// Older teams have no stored drillLibrary; fall back to the seed so the first
// edit persists the seed + the change rather than dropping the starters.
const libraryOf = (data: any): DrillDefinition[] =>
  Array.isArray(data?.drillLibrary) && data.drillLibrary.length > 0
    ? data.drillLibrary
    : DEFAULT_DRILL_LIBRARY;

export const usePracticeCrud = ({
  teamData,
  updateTeam,
  updateTeamArrays,
  toast,
  confirm,
}: UsePracticeCrudArgs) => {
  const addPractice = useCallback(
    (form: any) => {
      const iso = normalizeDateToIso(form?.date);
      if (!iso) {
        toast.push({
          kind: "warn",
          title: "Missing info",
          message: "A practice date is required.",
        });
        return;
      }
      const newPractice: Practice = {
        id: genId("p"),
        date: iso,
        startUtc: form?.startUtc ?? null,
        endUtc: form?.endUtc ?? null,
        location: (form?.location || "").trim(),
        environment: form?.environment || "outdoor",
        attendance: {},
        drills: [],
        planNotes: form?.planNotes || "",
        source: "manual",
        status: "scheduled",
      };
      updateTeamArrays({
        op: "append",
        key: "practices",
        entries: [newPractice],
      });
    },
    [updateTeamArrays, toast],
  );

  const updatePractice = useCallback(
    (id: any, patch: any) => {
      // Mirror useGameCrud.updateGame: never persist an empty/unparseable date,
      // which would break the date-string sort comparators downstream.
      let safePatch = patch;
      if (patch && "date" in patch) {
        const iso = normalizeDateToIso(patch.date);
        if (!iso) {
          const { date: _drop, ...rest } = patch;
          safePatch = rest;
        } else if (iso !== patch.date) {
          safePatch = { ...patch, date: iso };
        }
      }
      if (!safePatch || Object.keys(safePatch).length === 0) return;
      const finalPatch = safePatch;
      updateTeamArrays({
        op: "mapEntries",
        key: "practices",
        map: (items: Practice[]) =>
          items.map((p) => (p.id === id ? { ...p, ...finalPatch } : p)),
      });
    },
    [updateTeamArrays],
  );

  const removePractice = useCallback(
    async (id: any) => {
      const ok = await confirm({
        title: "Delete this practice?",
        message:
          "Its attendance and drill log go with it. You can undo right after.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const prev = teamData.practices || [];
      updateTeamArrays({ op: "removeById", key: "practices", id });
      toast.push({
        kind: "success",
        title: "Practice deleted",
        message: "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          // Undo deliberately restores the captured snapshot wholesale —
          // reverting to the pre-delete state IS its semantics.
          onClick: () =>
            updateTeamArrays({
              op: "mapEntries",
              key: "practices",
              map: () => prev as Practice[],
            }),
        },
      } as any);
    },
    [teamData.practices, updateTeamArrays, toast, confirm],
  );

  const savePracticeAttendance = useCallback(
    (id: any, attendanceMap: Record<string, any>) => {
      updateTeamArrays({
        op: "mapEntries",
        key: "practices",
        map: (items: Practice[]) =>
          items.map((p) =>
            p.id === id ? { ...p, attendance: { ...attendanceMap } } : p,
          ),
      });
    },
    [updateTeamArrays],
  );

  // ----- Drill library (reusable, team-level) -----
  const addDrillToLibrary = useCallback(
    (def: Omit<DrillDefinition, "id">) => {
      const name = (def?.name || "").trim();
      if (!name) {
        toast.push({
          kind: "warn",
          title: "Missing info",
          message: "A drill needs a name.",
        });
        return;
      }
      const entry: DrillDefinition = {
        ...def,
        name,
        id: genId("drill"),
      };
      updateTeam({ drillLibrary: [...libraryOf(teamData), entry] });
    },
    [teamData, updateTeam, toast],
  );

  const updateDrillInLibrary = useCallback(
    (id: string, patch: Partial<DrillDefinition>) => {
      const next = libraryOf(teamData).map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      );
      updateTeam({ drillLibrary: next });
    },
    [teamData, updateTeam],
  );

  const removeDrillFromLibrary = useCallback(
    (id: string) => {
      updateTeam({
        drillLibrary: libraryOf(teamData).filter((d) => d.id !== id),
      });
    },
    [teamData, updateTeam],
  );

  return {
    addPractice,
    updatePractice,
    removePractice,
    savePracticeAttendance,
    addDrillToLibrary,
    updateDrillInLibrary,
    removeDrillFromLibrary,
  };
};
