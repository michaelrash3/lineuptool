import { useCallback } from "react";
import {
  blankStats,
  buildCsvHeaderIndex,
  buildStatsPatchFromCsvRow,
  deriveSeasonFromGameLines,
  normalizeDateToIso,
  parseCsvRecords,
  parseGameChangerStatsCsv,
  stripPitchingStatsForFormat,
} from "../utils/helpers";
import { getLocalDateString } from "../constants/ui";
import type { ConfirmContextValue, ToastContextValue } from "../types";

export const csvEscape = (val: unknown): string => {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

// teamData carries more fields at runtime than the strict Team interface
// models (coachContacts, lastCsvImportDate, etc.). Typed permissively for now
// and meant to tighten as the data model is fully modeled in TS.
interface UseImportExportFlowsArgs {
  teamData: any;
  updateTeam: (
    patch: Record<string, unknown>,
    opts?: { allowEmptyPlayers?: boolean }
  ) => void;
  activeTeamId: string;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

const fileText = (ev: ProgressEvent<FileReader>): string =>
  String(ev.target?.result ?? "");

export const useImportExportFlows = ({
  teamData,
  updateTeam,
  activeTeamId,
  toast,
  confirm,
}: UseImportExportFlowsArgs) => {
  const uploadScheduleCsv = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        try {
          const text = fileText(ev);
          const rows = parseCsvRecords(text);
          if (rows.length < 2) throw new Error("File appears to be empty.");
          const headers = rows[0].map((h) =>
            h.toLowerCase().trim()
          );
          const dateIdx = headers.findIndex((h) => h.includes("date"));
          const oppIdx = headers.findIndex(
            (h) => h.includes("opponent") || h.includes("home/away")
          );
          if (dateIdx === -1) throw new Error("Could not find a date column.");
          const newGames: any[] = [];
          // Rows that carried a date value we couldn't parse. Blank rows
          // (trailing newlines, empty cells) are ignored silently; a row with
          // a real-but-unrecognized date is surfaced so the coach knows some
          // games didn't import instead of the drop being invisible.
          let skipped = 0;
          for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            const rawDate = (cols[dateIdx] || "").trim();
            if (!rawDate) continue;
            const isoDate = normalizeDateToIso(rawDate);
            if (!isoDate) {
              skipped++;
              continue;
            }
            const opp = oppIdx !== -1 ? cols[oppIdx] : "TBD";
            newGames.push({
              id: "g-" + Math.random().toString(36).substring(2, 10),
              date: isoDate,
              opponent: opp || "TBD",
              leagueRuleSet: teamData.leagueRuleSet,
              pitchingFormat: teamData.pitchingFormat,
              defenseSize: teamData.defenseSize,
              battingSize: teamData.battingSize,
              positionLock: teamData.positionLock,
              lineup: null,
              battingLineup: null,
              attendance: {},
              status: "scheduled",
              teamScore: null,
              opponentScore: null,
            });
          }
          updateTeam({ games: [...teamData.games, ...newGames] });
          toast.push({
            kind: "success",
            title: `Imported ${newGames.length} game${
              newGames.length === 1 ? "" : "s"
            }`,
            message:
              skipped > 0
                ? `Skipped ${skipped} row${
                    skipped === 1 ? "" : "s"
                  } with an unrecognized date.`
                : undefined,
          });
        } catch (err: any) {
          toast.push({
            kind: "error",
            title: "Schedule import failed",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [teamData, updateTeam, toast]
  );

  const uploadStatsCsv = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        try {
          // Strip UTF-8 BOM if present (GameChanger exports include one)
          const text = fileText(ev).replace(/^\uFEFF/, "");
          const rows = parseCsvRecords(text);
          if (rows.length < 2) throw new Error("Empty file.");

          // Detect GameChanger's two-row header layout. The first row is just
          // "Batting", "Pitching", "Fielding" section labels with most cells empty.
          // The second row has the real column names.
          let headerRowIndex = 0;
          const firstRow = rows[0].map((h) =>
            h.toLowerCase().trim()
          );
          const filledFirstRow = firstRow.filter(Boolean).length;
          const hasSectionLabels = firstRow.some((h) =>
            ["batting", "pitching", "fielding"].includes(h)
          );
          if (hasSectionLabels && filledFirstRow < firstRow.length / 3) {
            headerRowIndex = 1;
          }
          const rawHeaders = rows[headerRowIndex].map((h) =>
            h.toLowerCase().trim()
          );
          // Label row (when present) bounds the Batting/Pitching/Fielding
          // sections for the advanced-stat extractor (see extractAdvancedStats).
          const labelRow = headerRowIndex === 1 ? firstRow : undefined;
          const idx = buildCsvHeaderIndex(rawHeaders);
          if (idx.fn === -1 && idx.ln === -1)
            throw new Error("Could not find name columns.");

          // Auto-detect file type by header signatures.
          // TeamSnap members export has "Contact 1 Name" / "Jersey Number" / "Position" with role values.
          // GameChanger stats export has "OPS" / "AVG" / "AB" with no contact columns.
          const isTeamSnap =
            idx.isTeamSnap || idx.parent !== -1 || idx.dob !== -1;
          const isGameChanger =
            !isTeamSnap && (idx.ops !== -1 || idx.avg !== -1 || idx.ab !== -1);

          if (!isTeamSnap && !isGameChanger) {
            throw new Error(
              "Unrecognized CSV format. Expected TeamSnap members export or GameChanger stats export."
            );
          }

          const next: any[] = [...teamData.players];
          // Coach rows from TeamSnap are skipped from the roster but
          // captured here so the head coach has real coach contact
          // info (not parent emails) on file. Deduped by email.
          const nextCoachContacts: any[] = [...(teamData.coachContacts || [])];
          let updated = 0,
            added = 0,
            skipped = 0,
            coachesCaptured = 0;
          const dataStartIndex = headerRowIndex + 1;

          for (let i = dataStartIndex; i < rows.length; i++) {
            const cols = rows[i];
            const fn = (idx.fn !== -1 ? cols[idx.fn] : "").trim();
            const ln = (idx.ln !== -1 ? cols[idx.ln] : "").trim();
            const name = `${fn} ${ln}`.trim();
            if (!name) continue;

            // Skip GameChanger summary/footer rows
            if (isGameChanger) {
              const lcFn = fn.toLowerCase();
              const lcLn = ln.toLowerCase();
              if (
                lcFn === "totals" ||
                lcLn === "totals" ||
                lcFn === "glossary" ||
                lcLn === "glossary" ||
                !ln /* GC always has Last */
              ) {
                continue;
              }
            }

            // TeamSnap coach rows: skipped from the roster (they aren't
            // players), but captured into team.coachContacts so the
            // invite panel can use their real coach email instead of a
            // parent's. Dedupe by email so re-imports are idempotent.
            if (isTeamSnap && idx.position !== -1) {
              const role = (cols[idx.position] || "").toLowerCase();
              if (role.includes("coach") || role.includes("manager")) {
                const coachEmail =
                  idx.email !== -1 ? (cols[idx.email] || "").trim() : "";
                if (coachEmail) {
                  const lower = coachEmail.toLowerCase();
                  const exists = nextCoachContacts.some(
                    (c) => (c.email || "").toLowerCase() === lower
                  );
                  if (!exists) {
                    nextCoachContacts.push({
                      id:
                        "cc-" + Math.random().toString(36).substring(2, 10),
                      name,
                      email: coachEmail,
                      sourceRole: cols[idx.position],
                    });
                    coachesCaptured++;
                  }
                }
                skipped++;
                continue;
              }
            }

            const existingIndex = next.findIndex(
              (p) => p.name.toLowerCase() === name.toLowerCase()
            );

            if (isTeamSnap) {
              // Roster info only — never touch stats or pitching
              const rosterFields: Record<string, string> = {};
              if (idx.num !== -1 && cols[idx.num])
                rosterFields.number = cols[idx.num];
              if (idx.dob !== -1 && cols[idx.dob])
                rosterFields.dob = cols[idx.dob];
              if (idx.phone !== -1 && cols[idx.phone])
                rosterFields.phone = cols[idx.phone];
              if (idx.email !== -1 && cols[idx.email])
                rosterFields.email = cols[idx.email];
              if (idx.parent !== -1 && cols[idx.parent])
                rosterFields.parentName = cols[idx.parent];

              if (existingIndex >= 0) {
                next[existingIndex] = {
                  ...next[existingIndex],
                  ...rosterFields,
                };
                updated++;
              } else {
                next.push({
                  id: "p-" + Math.random().toString(36).substring(2, 10),
                  name,
                  number: rosterFields.number || "",
                  dob: rosterFields.dob || "",
                  phone: rosterFields.phone || "",
                  email: rosterFields.email || "",
                  parentName: rosterFields.parentName || "",
                  bats: "R",
                  throws: "R",
                  present: true,
                  restrictions: [],
                  stats: blankStats(),
                  pitching: { recentPitches: 0, lastPitchDate: null },
                });
                added++;
              }
              continue;
            }

            // GameChanger path — stats only. The shared row→patch builder
            // includes ONLY fields actually present in this CSV (plus the
            // section-namespaced advanced pitching/fielding stats).
            const statsPatch = buildStatsPatchFromCsvRow(
              idx,
              labelRow,
              rawHeaders,
              cols
            );

            if (Object.keys(statsPatch).length === 0) continue;

            if (existingIndex >= 0) {
              // Snapshot the PRIOR stats into statsHistory before merging.
              // Skip the snapshot if every field in the incoming patch already
              // matches the existing stats — same CSV re-uploaded, no movement
              // to record. Cap history at 20 entries to stay under Firestore's
              // 1 MB doc limit (~50 numeric stats × 8 bytes × 20 = ~8 KB).
              const priorStats =
                next[existingIndex].stats || blankStats();
              const changedFields = Object.keys(statsPatch).filter(
                (k) => Number(priorStats[k]) !== Number(statsPatch[k])
              );
              let nextHistory = next[existingIndex].statsHistory || [];
              if (changedFields.length > 0) {
                nextHistory = [
                  ...nextHistory,
                  {
                    importedAt: new Date().toISOString(),
                    source: "csv",
                    stats: { ...priorStats },
                  },
                ].slice(-20);
              }
              // Merge stats over existing — preserves any field not in this CSV
              next[existingIndex] = {
                ...next[existingIndex],
                stats: {
                  ...priorStats,
                  ...statsPatch,
                },
                statsHistory: nextHistory,
                // pitching state (recentPitches / lastPitchDate) is intentionally untouched
              };
              updated++;
            } else {
              // New player from a stats CSV — minimal record
              next.push({
                id: "p-" + Math.random().toString(36).substring(2, 10),
                name,
                number: idx.num !== -1 ? cols[idx.num] || "" : "",
                dob: "",
                phone: "",
                email: "",
                parentName: "",
                bats: "R",
                throws: "R",
                present: true,
                restrictions: [],
                stats: { ...blankStats(), ...statsPatch },
                pitching: { recentPitches: 0, lastPitchDate: null },
              });
              added++;
            }
          }

          // ---- Pitch count sanity check (kid-pitch only) ----
          // For each pitcher whose CSV totalPitches changed since the last
          // import, compare the CSV delta against the sum of manual pitchCounts
          // entered for games played since that previous import. Mismatches
          // (>5 pitches off) raise a toast warning so the coach can investigate
          // and fix manually if needed. We do NOT auto-override anything.
          //
          // Skip entirely for machine-pitch teams: the totalPitches field is
          // still populated by GameChanger (scorers count pitches faced) but
          // no kid actually pitched, so there's nothing to validate.
          const teamFmt = (teamData.pitchingFormat || "").toLowerCase();
          const isMachinePitchTeam = teamFmt.includes("machine");
          const prevImportDate = teamData.lastCsvImportDate || "";
          const todayIso = new Date().toISOString().slice(0, 10);
          const sanityWarnings: Array<{
            name: string;
            csvDelta: number;
            manualDelta: number;
          }> = [];
          if (!isMachinePitchTeam) {
            for (let pi = 0; pi < next.length; pi++) {
              const newPlayer = next[pi];
              const newTp = newPlayer.stats?.totalPitches;
              if (!Number.isFinite(newTp)) continue;
              const prevTp = newPlayer.pitching?.csvTotalPitches ?? 0;
              const csvDelta = newTp - prevTp;
              if (csvDelta <= 0) {
                // No new pitches this import; just update the stored TP and skip
                next[pi] = {
                  ...newPlayer,
                  pitching: {
                    ...(newPlayer.pitching || { recentPitches: 0, lastPitchDate: null }),
                    csvTotalPitches: newTp,
                  },
                };
                continue;
              }
              // Sum manual pitchCounts across games on/after the previous import
              let manualDelta = 0;
              for (const g of teamData.games) {
                if (!g.date) continue;
                if (prevImportDate && g.date < prevImportDate) continue;
                const cnt = g.pitchCounts?.[newPlayer.id];
                if (Number.isFinite(cnt)) manualDelta += cnt;
              }
              const diff = Math.abs(csvDelta - manualDelta);
              if (diff > 5) {
                sanityWarnings.push({
                  name: newPlayer.name,
                  csvDelta,
                  manualDelta,
                });
              }
              // Update stored TP regardless of warning state
              next[pi] = {
                ...newPlayer,
                pitching: {
                  ...(newPlayer.pitching || { recentPitches: 0, lastPitchDate: null }),
                  csvTotalPitches: newTp,
                },
              };
            }
          }

          const patch: Record<string, any> = {
            players: next,
            lastCsvImportDate: todayIso,
          };
          if (coachesCaptured > 0) patch.coachContacts = nextCoachContacts;
          updateTeam(patch);
          const kind = isTeamSnap ? "Roster" : "Stats";
          let message = `${updated} updated, ${added} added.`;
          if (skipped > 0)
            message += ` (Skipped ${skipped} coach row${
              skipped === 1 ? "" : "s"
            }${
              coachesCaptured > 0
                ? `; captured ${coachesCaptured} coach email${
                    coachesCaptured === 1 ? "" : "s"
                  } for invites`
                : ""
            }.)`;
          toast.push({ kind: "success", title: `${kind} imported`, message });
          // Surface each pitch-count discrepancy as its own warning toast.
          // duration: 0 = persistent (won't auto-dismiss). Coach taps the X to clear.
          for (const w of sanityWarnings) {
            toast.push({
              kind: "warn",
              duration: 0,
              title: `Pitch count mismatch: ${w.name}`,
              message: `CSV shows +${w.csvDelta} pitches since last import; you entered ${w.manualDelta}. Off by ${Math.abs(w.csvDelta - w.manualDelta)}.`,
            });
          }
        } catch (err: any) {
          toast.push({
            kind: "error",
            title: "CSV import failed",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [teamData, updateTeam, toast]
  );

  // Per-game stat import: the coach exports the SAME GameChanger stats CSV
  // filtered to a single game and uploads it right on the finalized game.
  // The line is stored on the game (game.playerStats by player id), and each
  // affected player's SEASON stats are immediately re-derived by summing all
  // their game lines (counting stats sum; AVG recomputes from H/AB; other
  // rates sample-weighted). Pitching is stripped at import for Machine/Coach
  // pitch games, so summed season pitching is kid-pitch-only — the reason
  // per-game pitching won't match a full-season CSV on a mixed schedule.
  // The full-season import remains available; a per-game import simply takes
  // over the derived fields for players who have game lines.
  const uploadGameStatsCsv = useCallback(
    (gameId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        try {
          const game = (teamData.games || []).find(
            (g: any) => g.id === gameId
          );
          if (!game) throw new Error("Game not found.");
          const parsed = parseGameChangerStatsCsv(fileText(ev));
          if ("error" in parsed) throw new Error(parsed.error);

          const fmt = game.pitchingFormat || teamData.pitchingFormat || "";
          const byName = new Map(
            (teamData.players || []).map((p: any) => [
              String(p.name || "").trim().toLowerCase(),
              p.id,
            ])
          );
          const playerStats: Record<string, Record<string, number>> = {
            ...(game.playerStats || {}),
          };
          let matched = 0;
          let unmatched = 0;
          const touchedIds = new Set<string>();
          for (const { name, patch } of parsed.rows) {
            const pid = byName.get(name.trim().toLowerCase());
            if (!pid) {
              unmatched++;
              continue;
            }
            const line = stripPitchingStatsForFormat(patch, fmt);
            if (Object.keys(line).length === 0) continue;
            playerStats[pid as string] = line;
            touchedIds.add(pid as string);
            matched++;
          }
          if (matched === 0)
            throw new Error(
              "No rows matched your roster — check the player names in the CSV."
            );

          const nextGames = (teamData.games || []).map((g: any) =>
            g.id === gameId
              ? {
                  ...g,
                  playerStats,
                  statsImportedAt: new Date().toISOString(),
                }
              : g
          );
          // Re-derive season totals from ALL game lines for the players this
          // import touched. Derived fields overwrite; anything not derivable
          // from game lines (e.g. velocity hand-entered) is preserved.
          // Prior stats are snapshotted into statsHistory first (same as the
          // season-CSV import) so Recent Movement tracks per-game imports too;
          // capped at 20 entries to stay under Firestore's 1 MB doc limit.
          const nextPlayers = (teamData.players || []).map((p: any) => {
            if (!touchedIds.has(p.id)) return p;
            const derived = deriveSeasonFromGameLines(nextGames, p.id);
            if (!derived) return p;
            const priorStats = p.stats || blankStats();
            const changed = Object.keys(derived).some(
              (k) => Number(priorStats[k]) !== Number(derived[k])
            );
            const statsHistory = changed
              ? [
                  ...(p.statsHistory || []),
                  {
                    importedAt: new Date().toISOString(),
                    source: "game-csv",
                    stats: { ...priorStats },
                  },
                ].slice(-20)
              : p.statsHistory || [];
            return {
              ...p,
              stats: { ...priorStats, ...derived },
              statsHistory,
            };
          });
          updateTeam({ games: nextGames, players: nextPlayers });
          toast.push({
            kind: "success",
            title: "Game stats imported",
            message: `${matched} player line${matched === 1 ? "" : "s"} attached${
              game.opponent ? ` to vs ${game.opponent}` : ""
            }; season totals updated from game lines.${
              unmatched > 0
                ? ` ${unmatched} CSV row${unmatched === 1 ? "" : "s"} didn't match a roster name.`
                : ""
            }${
              /machine|coach/i.test(fmt)
                ? " Pitching ignored (machine/coach pitch game)."
                : ""
            }`,
          });
        } catch (err: any) {
          toast.push({
            kind: "error",
            title: "Game stats import failed",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [teamData, updateTeam, toast]
  );

  const exportBackup = useCallback(() => {
    const blob = new Blob([JSON.stringify(teamData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lineup-backup-${activeTeamId}-${getLocalDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [teamData, activeTeamId]);

  // Roster CSV — TeamSnap-import-template column order so the file can
  // be uploaded straight back into LineupTool or into a league portal.
  // Column choices mirror buildCsvHeaderIndex's TeamSnap detection
  // (Contact 1 Name / Jersey Number / Email / etc).
  const csvEscape = (val: unknown): string => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const playersToCsv = useCallback((players: any[]) => {
    const headers = [
      "First",
      "Last",
      "Jersey Number",
      "Birthdate",
      "Bats",
      "Throws",
      "Contact 1 Name",
      "Contact 1 Phone",
      "Contact 1 Email",
      "Status",
    ];
    const rows = (players || []).map((p) => {
      const parts = (p.name || "").trim().split(/\s+/);
      const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "";
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      return [
        csvEscape(first),
        csvEscape(last),
        csvEscape(p.number),
        csvEscape(p.dob),
        csvEscape(p.bats || "R"),
        csvEscape(p.throws || "R"),
        csvEscape(p.parentName),
        csvEscape(p.phone),
        csvEscape(p.email),
        csvEscape(p.playerStatus || "returning"),
      ].join(",");
    });
    return [headers.map(csvEscape).join(","), ...rows].join("\r\n");
  }, []);

  const downloadCsv = (filename: string, csvText: string) => {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportRosterCsv = useCallback(() => {
    const csv = playersToCsv(teamData.players || []);
    downloadCsv(
      `roster-${activeTeamId}-${getLocalDateString()}.csv`,
      csv
    );
    toast.push({ kind: "success", title: "Roster CSV downloaded" });
  }, [teamData.players, activeTeamId, toast, playersToCsv]);

  const exportNewPlayersCsv = useCallback(() => {
    const incoming = (teamData.players || []).filter(
      (p: any) => p.playerStatus === "accepted"
    );
    if (incoming.length === 0) {
      toast.push({
        kind: "info",
        title: "No new players to export",
        message: "Players join via tryout accept; status === \"accepted\".",
      });
      return;
    }
    const csv = playersToCsv(incoming);
    downloadCsv(
      `new-players-${activeTeamId}-${getLocalDateString()}.csv`,
      csv
    );
    toast.push({
      kind: "success",
      title: `Downloaded ${incoming.length} new player${
        incoming.length === 1 ? "" : "s"
      }`,
    });
  }, [teamData.players, activeTeamId, toast, playersToCsv]);

  // Per-player status setter for the "Mark for Next Season" panel.
  // Kept for back-compat with tryout-flow callers (acceptTryout etc.);
  // the Returning Y/N toggle in AdvanceSeasonModal uses
  // setPlayerReturning below instead so it writes the explicit boolean.
  const setPlayerStatus = useCallback(
    (playerId: string, status: string) => {
      const next = (teamData.players || []).map((p: any) =>
        p.id === playerId ? { ...p, playerStatus: status } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  // Explicit Returning Y/N writer used by AdvanceSeasonModal. Writes
  // the player.returning boolean directly — isReturning() handles
  // legacy playerStatus reads at read-time so existing rosters work
  // unchanged.
  const setPlayerReturning = useCallback(
    (playerId: string, value: boolean) => {
      const next = (teamData.players || []).map((p: any) =>
        p.id === playerId ? { ...p, returning: value === true } : p
      );
      updateTeam({ players: next });
    },
    [teamData.players, updateTeam]
  );

  const importBackup = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      // Capture the input + file before awaiting — React may recycle the
      // synthetic event once the handler yields.
      const input = e.target;
      const file = input.files?.[0];
      if (!file) return;
      const ok = await confirm({
        title: "Restore backup?",
        message:
          "Replaces this team's roster, schedule, and settings with the backup file. This cannot be undone.",
        confirmLabel: "Restore",
        danger: true,
      });
      if (!ok) {
        input.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        try {
          const data = JSON.parse(fileText(ev));
          // JSON.parse succeeds for any valid JSON, but restore disables the
          // roster-wipe guard (allowEmptyPlayers) and does a full replace — so
          // a wrong file (some other app's export, a partial object) would
          // silently clobber the team. Require the parsed value to look like a
          // LineupTool backup (an object with a players array) before applying.
          const looksLikeBackup =
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            Array.isArray((data as any).players);
          if (!looksLikeBackup) {
            throw new Error(
              "This file doesn't look like a LineupTool backup."
            );
          }
          // allowEmptyPlayers: restoring a backup is an explicitly-confirmed
          // full replace, so the persistTeam roster-wipe guard must defer to
          // whatever the backup file says — even an empty roster.
          updateTeam(data, { allowEmptyPlayers: true });
          toast.push({ kind: "success", title: "Backup restored" });
        } catch (err: any) {
          toast.push({
            kind: "error",
            title: "Could not parse backup",
            message: err.message,
          });
        }
      };
      reader.readAsText(file);
      input.value = "";
    },
    [updateTeam, toast, confirm]
  );


  return {
    uploadScheduleCsv,
    uploadStatsCsv,
    uploadGameStatsCsv,
    exportBackup,
    exportRosterCsv,
    exportNewPlayersCsv,
    setPlayerStatus,
    setPlayerReturning,
    importBackup,
  };
};
