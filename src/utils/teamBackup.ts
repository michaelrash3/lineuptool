// Client-side full-team JSON backup download.
//
// Reused by the manual "Export backup" button and, more importantly, as an
// AUTOMATIC pre-wipe snapshot before the three irreversible actions —
// advance-season, restore-backup, and delete-team — so an operation the UI
// itself labels "cannot be undone" always leaves the coach a file to restore
// from. Spark-plan constraint: there is no server/Cloud Storage, so the
// snapshot is a local file download rather than a stored version history.
import { getLocalDateString } from "../constants/ui";

// `label` distinguishes an on-demand export ("backup") from an automatic
// pre-action safety copy ("snapshot") in the downloaded filename.
export const downloadTeamBackup = (
  teamData: unknown,
  teamId: string | null | undefined,
  label: "backup" | "snapshot" = "backup",
): void => {
  // Best-effort and non-throwing: outside a real browser (SSR, jsdom tests)
  // Blob-URL creation isn't available, and a failed safety snapshot must never
  // abort the destructive action the caller already confirmed.
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const blob = new Blob([JSON.stringify(teamData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lineup-${label}-${teamId ?? "team"}-${getLocalDateString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
