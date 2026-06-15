import { useCallback } from "react";
import { normalizeDateToIso } from "../utils/helpers";
import type { ConfirmContextValue, ToastContextValue } from "../types";

// Practice CRUD, mirroring useGameCrud's shape. Pure persistence (add / update /
// delete a practice + save its attendance) writing through the injected
// updateTeam. No coupling to the lineup engine.
interface UsePracticeCrudArgs {
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively to mirror the App.tsx provider.
  teamData: any;
  updateTeam: (patch: Record<string, unknown>) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const usePracticeCrud = ({
  teamData,
  updateTeam,
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
      const newPractice = {
        id: "p-" + Math.random().toString(36).substring(2, 10),
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
      updateTeam({ practices: [...(teamData.practices || []), newPractice] });
    },
    [teamData.practices, updateTeam, toast]
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
      const next = (teamData.practices || []).map((p: any) =>
        p.id === id ? { ...p, ...safePatch } : p
      );
      updateTeam({ practices: next });
    },
    [teamData.practices, updateTeam]
  );

  const removePractice = useCallback(
    async (id: any) => {
      const ok = await confirm({
        title: "Delete this practice?",
        message: "Its attendance and drill log go with it. You can undo right after.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const prev = teamData.practices || [];
      updateTeam({ practices: prev.filter((p: any) => p.id !== id) });
      toast.push({
        kind: "success",
        title: "Practice deleted",
        message: "Tap Undo to restore.",
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => updateTeam({ practices: prev }),
        },
      } as any);
    },
    [teamData.practices, updateTeam, toast, confirm]
  );

  const savePracticeAttendance = useCallback(
    (id: any, attendanceMap: Record<string, any>) => {
      const next = (teamData.practices || []).map((p: any) =>
        p.id === id ? { ...p, attendance: { ...attendanceMap } } : p
      );
      updateTeam({ practices: next });
    },
    [teamData.practices, updateTeam]
  );

  return { addPractice, updatePractice, removePractice, savePracticeAttendance };
};
