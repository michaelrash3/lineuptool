import React, { memo, useMemo, useState, useRef, useEffect } from "react";
import { Icons } from "../icons";
import {
  formatStat,
  formatGameDateDisplay,
  calculateBaseballAge,
  blankStats,
  lineupSlotMatchesPlayer,
  isGameFinalized,
  countsTowardStats,
  summarizePitchingWorkload,
  ROSTER_POSITIONS,
  canonicalizePositionList,
} from "../utils/helpers";
import { AGE_TIERS, isKidPitchFormat } from "../constants/ui";
import { getCombinedGrades, suggestPrimaryPosition } from "../lineupEngine";
import { useTeam, useUI, useToast } from "../contexts";
import { PlayerAvatar } from "./shared";
import {
  PROFILE_SECTIONS,
  STATS_TAB_KEYS,
  STAT_META,
  formatStatValue,
  StatTrendModal,
  RecentMovementPanel,
} from "./modals/statTrend";

// StatTrendModal + the stat helpers now live in ./modals/statTrend; re-export
// the public ones so the import surface of this module is unchanged.
export { StatTrendModal, formatStatValue } from "./modals/statTrend";

export const PastSeasonImportModal = memo(() => {
  const { team, bulkAddPastSeasons } = useTeam();
  const { pastSeasonImport, setPastSeasonImport } = useUI();
  const toast = useToast();

  if (!pastSeasonImport) return null;
  const { rows, season, ageGroup, pitchingFormat, assignments } =
    pastSeasonImport;
  const { players, primaryColor, tertiaryColor } = team;

  const setField = (patch: any) =>
    setPastSeasonImport({ ...pastSeasonImport, ...patch });
  const setAssignment = (csvName: any, value: any) =>
    setField({ assignments: { ...assignments, [csvName]: value } });

  const close = () => setPastSeasonImport(null);

  // Players already assigned, so we can de-duplicate dropdowns
  const usedPlayerIds = new Set();
  for (const v of Object.values(assignments)) {
    if (v && v !== "skip" && v !== "new") usedPlayerIds.add(v);
  }

  // Counts
  const assignedCount = Object.values(assignments).filter(
    (v) => v && v !== "skip"
  ).length;
  const skipCount = Object.values(assignments).filter(
    (v) => v === "skip"
  ).length;

  const canCommit =
    season.trim() && ageGroup && pitchingFormat && assignedCount > 0;

  const commit = () => {
    if (!canCommit) return;
    const toAdd = [];
    for (const row of rows) {
      const a = assignments[row.csvName];
      if (!a || a === "skip") continue;
      let playerId = a;
      if (a === "new") {
        // Add as a new player first (simple shape — user can edit later)
        // We can't directly call addPlayer here without making team the source of truth synchronously.
        // Skip "new" for now and surface a warning. (See note below.)
        toast.push({
          kind: "warn",
          title: `Skipped "${row.csvName}"`,
          message: "Add the player first via the Roster tab, then re-import.",
        });
        continue;
      }
      toAdd.push({
        playerId,
        season: season.trim(),
        ageGroup,
        pitchingFormat,
        stats: row.stats,
      });
    }
    if (toAdd.length === 0) {
      toast.push({
        kind: "warn",
        title: "Nothing to import",
        message: "No rows are matched to a player.",
      });
      return;
    }
    bulkAddPastSeasons(toAdd);
    toast.push({
      kind: "success",
      title: `Past season imported`,
      message: `${toAdd.length} player${
        toAdd.length === 1 ? "" : "s"
      } updated for ${season}.`,
    });
    close();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-sm">
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div
          className="p-1.5"
          style={{ backgroundColor: "var(--team-primary)" }}
        />

        <div className="p-6 sm:p-7 border-b border-line">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="t-card-title">Import Past Season Stats</h3>
              <p className="text-xs text-ink-3 font-medium mt-1">
                Review and confirm which player each row belongs to.
              </p>
            </div>
            <button
              onClick={close}
              className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Season *
              </label>
              <input
                type="text"
                value={season}
                onChange={(e) => setField({ season: e.target.value })}
                placeholder="e.g., Spring 2025"
                className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Age Group *
              </label>
              <select
                value={ageGroup}
                onChange={(e) => setField({ ageGroup: e.target.value })}
                className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
              >
                <option value="">Select…</option>
                {AGE_TIERS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Pitching Format *
              </label>
              <select
                value={pitchingFormat}
                onChange={(e) => setField({ pitchingFormat: e.target.value })}
                className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
              >
                <option value="Kid Pitch">Kid Pitch</option>
                <option value="Coach/Machine">Coach / Machine</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 bg-app/50">
          <div className="p-4 sm:p-6 space-y-2">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 grid grid-cols-12 gap-3 px-3 pb-2">
              <div className="col-span-5">From CSV</div>
              <div className="col-span-7">Assign To</div>
            </div>
            {rows.map((row: any) => {
              const value = assignments[row.csvName] || "skip";
              const isSkip = value === "skip";
              return (
                <div
                  key={row.csvName}
                  className={`grid grid-cols-12 gap-3 items-center bg-surface border rounded-xl p-3 shadow-sm ${
                    isSkip ? "opacity-60" : "border-line"
                  }`}
                >
                  <div className="col-span-5">
                    <div className="text-sm font-black text-ink truncate">
                      {row.csvName}
                    </div>
                    {row.number && (
                      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                        #{row.number}
                      </div>
                    )}
                  </div>
                  <div className="col-span-7">
                    <select
                      value={value}
                      onChange={(e) =>
                        setAssignment(row.csvName, e.target.value)
                      }
                      className="w-full p-2 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
                    >
                      <option value="skip">Skip this row</option>
                      <optgroup label="Match to existing player">
                        {players.map((p: any) => {
                          // Allow the current selection plus any unassigned player
                          const taken =
                            usedPlayerIds.has(p.id) && p.id !== value;
                          return (
                            <option key={p.id} value={p.id} disabled={taken}>
                              {p.name}
                              {p.number ? ` (#${p.number})` : ""}
                              {taken ? " (already matched)" : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-surface border-t border-line p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-ink-3 uppercase tracking-widest">
            {assignedCount} matched · {skipCount} skipped
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={close}
              className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 bg-surface border border-line text-ink rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canCommit}
              onClick={commit}
              className="text-[11px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* PastSeasonForm — used inline for Add and Edit of a single past-season entry. */
const PastSeasonForm = memo(
  ({ initial, primaryColor, tertiaryColor, onSave, onCancel, onDelete }: any) => {
    const [season, setSeason] = useState(initial?.season || "");
    const [ageGroup, setAgeGroup] = useState(initial?.ageGroup || "");
    const [pitchingFormat, setPitchingFormat] = useState(
      initial?.pitchingFormat || "Kid Pitch"
    );
    const [stats, setStats] = useState(() => ({
      ...blankStats(),
      ...(initial?.stats || {}),
    }));

    const setStat = (key: any, raw: any) => {
      const n = parseFloat(raw);
      setStats((s: any) => ({ ...s, [key]: Number.isNaN(n) ? 0 : n }));
    };
    const showPitching = pitchingFormat === "Kid Pitch";

    const handleSave = () => {
      if (!season.trim() || !ageGroup) return;
      onSave({ season: season.trim(), ageGroup, pitchingFormat, stats });
    };

    // Stats fields shown — hide pitching fields when format isn't Kid Pitch
    const fields = STATS_TAB_KEYS.filter((k) => {
      const isPitch = ["ip", "era", "totalPitches"].includes(k);
      return !isPitch || showPitching;
    });

    return (
      <div className="bg-surface border-2 border-blue-200 rounded-xl p-4 shadow-md mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Season *
            </label>
            <input
              type="text"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="e.g., Spring 2025"
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
            />
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Age Group *
            </label>
            <select
              value={ageGroup}
              onChange={(e) => setAgeGroup(e.target.value)}
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
            >
              <option value="">Select…</option>
              {AGE_TIERS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Pitching Format
            </label>
            <select
              value={pitchingFormat}
              onChange={(e) => setPitchingFormat(e.target.value)}
              className="w-full p-2.5 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer shadow-sm"
            >
              <option value="Kid Pitch">Kid Pitch</option>
              <option value="Coach/Machine">Coach / Machine</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          {fields.map((key) => (
            <div key={key}>
              <label className="block text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-1">
                {key.toUpperCase()}
              </label>
              <input
                type="number"
                step="0.001"
                value={stats[key] || 0}
                onChange={(e) => setStat(key, e.target.value)}
                className="w-full p-1.5 bg-surface border border-line rounded-md text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner tabular-nums"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-surface border border-red-200 text-red-700 rounded-lg hover:bg-red-50 transition-colors shadow-sm mr-auto"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-surface border border-line text-ink rounded-lg hover:bg-surface-2 transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!season.trim() || !ageGroup}
            onClick={handleSave}
            className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg shadow-md transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
            style={{ backgroundColor: primaryColor, color: tertiaryColor }}
          >
            {initial ? "Save Changes" : "Add Season"}
          </button>
        </div>
      </div>
    );
  }
);

/* StatTrendModal — overlays the player profile when a stat is tapped.
   Shows a hand-rolled SVG line chart of that stat across seasons (current +
   any past-season entries that have data for it). For pitching stats, only
   plots seasons whose pitchingFormat === "Kid Pitch". */
export const PlayerProfileModal = memo(() => {
  const {
    team,
    updatePlayer,
    updatePlayerNested,
    removePlayer,
    addPastSeason,
    updatePastSeason,
    removePastSeason,
    currentRole,
  } = useTeam();
  // Assistants only see this profile in view-only mode: edits, position
  // restrictions, and private contact info are head-only.
  const canEdit = currentRole !== "assistant";
  const { viewingPlayerId, setViewingPlayerId } = useUI();
  const toast = useToast();
  const {
    players,
    games,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    currentSeason,
    pitchingFormat,
    defenseSize,
    evaluationEvents,
    teamAge,
  } = team;
  const [activeSection, setActiveSection] = useState("general");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll-spy: as the user scrolls the modal body, highlight the section
  // nav chip for whichever section is currently nearest the top.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;
    const sections = Array.from(
      container.querySelectorAll("[data-profile-section]")
    );
    if (sections.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the container that's intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-profile-section");
          if (id) setActiveSection(id);
        }
      },
      {
        root: container,
        rootMargin: "0px 0px -65% 0px",
        threshold: [0, 0.25, 0.5],
      }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const [editingContact, setEditingContact] = useState(false);
  const [editingPlayerName, setEditingPlayerName] = useState(false);
  const [tempPlayerName, setTempPlayerName] = useState("");
  const [showTimeline, setShowTimeline] = useState(false);
  const [trendStatKey, setTrendStatKey] = useState<string | null>(null); // key of stat whose year-over-year chart is open
  const [addingPastSeason, setAddingPastSeason] = useState(false);
  const [editingPastSeasonId, setEditingPastSeasonId] = useState<string | null>(null);

  // Aggregate fielding history across FINAL games only (matches engine fairness logic).
  // Returns { byPosition: {P: 4, C: 2, ...}, bench, firstInningBench, totalDefensive,
  //           gamesPlayed, gamesAvailable }.
  const inningsBreakdown = useMemo(() => {
    const byPosition: Record<string, number> = {};
    let bench = 0;
    let firstInningBench = 0;
    let totalDefensive = 0;
    let gamesPlayed = 0;
    let gamesAvailable = 0;
    const pid = viewingPlayerId;
    if (!pid)
      return {
        byPosition,
        bench,
        firstInningBench,
        totalDefensive,
        gamesPlayed,
        gamesAvailable,
      };

    // Look up the player record on the current roster so we can use the
    // orphan-id-aware matcher. If the modal is open for an id that no
    // longer exists on the roster (rare), fall back to a minimal stub.
    const currentPlayer = (players || []).find((p: any) => p.id === pid) || {
      id: pid,
    };
    const livePlayerIds = new Set<string>((players || []).map((p: any) => p.id));
    const matches = (slot: any) =>
      lineupSlotMatchesPlayer(slot, currentPlayer, livePlayerIds);

    // A game counts as "finalized" for stat aggregation if either:
    //   1. status is "final" (the writer in App.jsx finalizeGame uses this)
    //   2. status is "completed" (legacy writer some older paths may have used)
    //   3. both teamScore and opponentScore are set (defensive — a coach
    //      who edited the score directly may not have flipped status)
    // The fielding-innings aggregation was previously gated on (1) only,
    // missing finalized games that had been entered via the older paths.
    // Routes through the shared isGameFinalized() so all stat surfaces
    // (record, leaderboards, trend tile) agree on which games count.
    for (const g of games || []) {
      if (!countsTowardStats(g)) continue;
      if (!g.lineup?.length) continue;

      // Did this player attend the game?
      const present = g.attendance?.[pid] !== false;
      if (!present) continue;
      gamesAvailable++;

      let appearedThisGame = false;

      // First-inning bench check
      const firstBench = g.lineup[0]?.BENCH || [];
      if (firstBench.some(matches)) firstInningBench++;

      // Walk every inning
      for (const inning of g.lineup) {
        // Position appearances
        for (const pos in inning) {
          if (pos === "BENCH") continue;
          if (matches(inning[pos])) {
            byPosition[pos] = (byPosition[pos] || 0) + 1;
            totalDefensive++;
            appearedThisGame = true;
          }
        }
        // Bench appearances
        const benchList = inning.BENCH || [];
        if (benchList.some(matches)) {
          bench++;
          appearedThisGame = true;
        }
      }
      if (appearedThisGame) gamesPlayed++;
    }
    return {
      byPosition,
      bench,
      firstInningBench,
      totalDefensive,
      gamesPlayed,
      gamesAvailable,
    };
  }, [games, players, viewingPlayerId]);

  // Per-game timeline for this player. Final games only, sorted by date desc.
  // Each entry: { id, date, opponent, result, score, positions, batOrder, benchInnings, totalInnings }
  const timeline = useMemo(() => {
    const out: any[] = [];
    const pid = viewingPlayerId;
    if (!pid) return out;
    const currentPlayer = (players || []).find((p: any) => p.id === pid) || {
      id: pid,
    };
    const livePlayerIds = new Set<string>((players || []).map((p: any) => p.id));
    const matches = (slot: any) =>
      lineupSlotMatchesPlayer(slot, currentPlayer, livePlayerIds);
    // Same predicate as the aggregation above — see isGameFinalized().
    for (const g of games || []) {
      if (!countsTowardStats(g)) continue;
      if (!g.lineup?.length) continue;
      if (g.attendance?.[pid] === false) continue;

      const positionsPlayed: Record<string, number> = {};
      let benchInnings = 0;
      let totalInnings = 0;
      for (const inning of g.lineup) {
        let inThisInning = false;
        for (const pos in inning) {
          if (pos === "BENCH") continue;
          if (matches(inning[pos])) {
            positionsPlayed[pos] = (positionsPlayed[pos] || 0) + 1;
            totalInnings++;
            inThisInning = true;
          }
        }
        if (!inThisInning) {
          const benchList = inning.BENCH || [];
          if (benchList.some(matches)) {
            benchInnings++;
          }
        }
      }
      // Skip if player wasn't on the field or bench at all
      if (totalInnings === 0 && benchInnings === 0) continue;

      const batOrderIdx = (g.battingLineup || []).findIndex(matches);
      const ts = Number(g.teamScore),
        os = Number(g.opponentScore);
      const hasScore = Number.isFinite(ts) && Number.isFinite(os);
      const result = hasScore ? (ts > os ? "W" : ts < os ? "L" : "T") : null;

      out.push({
        id: g.id,
        date: g.date,
        opponent: g.opponent,
        result,
        score: hasScore ? `${ts}-${os}` : null,
        positions: positionsPlayed,
        batOrder: batOrderIdx >= 0 ? batOrderIdx + 1 : null,
        benchInnings,
        totalInnings,
      });
    }
    out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return out;
  }, [games, players, viewingPlayerId]);

  // Eval-derived suggested primary position for the open player — surfaced
  // alongside the manual Primary Pos picker as a one-tap "use this". It never
  // auto-fills; the coach stays in control.
  const suggestedPrimary = useMemo(() => {
    const pid = viewingPlayerId;
    if (!pid) return null;
    const pl = (players || []).find((p: any) => p.id === pid);
    if (!pl) return null;
    const grades = getCombinedGrades(evaluationEvents || [], players || [], {
      teamAge,
    })[pid];
    return suggestPrimaryPosition(pl, grades, {
      kidPitch: isKidPitchFormat(pitchingFormat),
      teamAge,
    });
  }, [viewingPlayerId, players, evaluationEvents, pitchingFormat, teamAge]);

  const player = players.find((p: any) => p.id === viewingPlayerId);
  if (!player) return null;

  // Accepted positions always use the canonical 3-outfielder model (LF/CF/RF),
  // independent of team size — the engine maps a CF-eligible player onto the
  // LCF/RCF field slots in a 10-fielder game. Showing LCF/RCF here is what made
  // a 10-fielder roster "restricted from CF" when playing 9-fielder games.
  const positions = ROSTER_POSITIONS;

  const close = () => {
    setViewingPlayerId(null);
    setActiveSection("general");
    setEditingContact(false);
    setEditingPlayerName(false);
    setTrendStatKey(null);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-sm overflow-y-auto"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div
          className="p-1.5"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-6 sm:p-7 flex flex-col sm:flex-row items-start gap-5 border-b border-line">
          <div className="relative shrink-0">
            <PlayerAvatar player={player} size={96} showNumber showPosition />
          </div>
          <div className="flex-1 w-full">
            {editingPlayerName ? (
              <input
                type="text"
                value={tempPlayerName}
                autoFocus
                onChange={(e) => setTempPlayerName(e.target.value)}
                onBlur={() => {
                  if (
                    tempPlayerName.trim() &&
                    tempPlayerName.trim() !== player.name
                  )
                    updatePlayer(player.id, { name: tempPlayerName.trim() });
                  setEditingPlayerName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLElement).blur();
                  if (e.key === "Escape") setEditingPlayerName(false);
                }}
                className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-ink mb-1 w-full p-2 -ml-2 border border-line outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-xl bg-surface shadow-inner"
              />
            ) : (
              <h2
                onClick={() => {
                  setTempPlayerName(player.name);
                  setEditingPlayerName(true);
                }}
                className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-ink mb-1 truncate cursor-pointer hover:bg-surface-2 px-2 py-1 -ml-2 rounded-xl transition-colors"
              >
                {player.name}
              </h2>
            )}
            <p className="text-xs uppercase tracking-widest text-ink-3 font-extrabold mb-3">
              Athlete Profile
            </p>
            <div className="flex gap-2 flex-wrap">
              {canEdit && (
                <span
                  className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg"
                  style={{ backgroundColor: secondaryColor, color: primaryColor }}
                >
                  P: {player.primaryPosition || "N/A"}
                </span>
              )}
              <span className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg bg-surface-2 text-ink">
                B/T: {player.bats || "R"}/{player.throws || "R"}
              </span>
              {player.dob && (
                <span className="text-[11px] font-extrabold py-1.5 px-3 rounded-lg bg-surface-2 text-ink">
                  Age: {calculateBaseballAge(player.dob, currentSeason) || "?"}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={close}
            className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mr-2 -mt-2 absolute top-6 right-4 sm:relative sm:top-0 sm:right-0"
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-surface border-b border-line flex-shrink-0">
          <div className="flex overflow-x-auto px-6 sm:px-7 scrollbar-hide">
            {PROFILE_SECTIONS.filter(
              (t) => canEdit || (t.id !== "general" && t.id !== "contact")
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  const el = scrollContainerRef.current?.querySelector(
                    `[data-profile-section="${t.id}"]`
                  );
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActiveSection(t.id);
                  }
                }}
                aria-current={activeSection === t.id ? "true" : undefined}
                className={`py-3.5 px-4 font-extrabold text-[10px] uppercase tracking-widest whitespace-nowrap relative transition-colors border-b-2 ${
                  activeSection === t.id
                    ? "text-ink"
                    : "text-ink-3 border-transparent hover:text-ink"
                }`}
                style={
                  activeSection === t.id ? { borderColor: primaryColor } : {}
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="overflow-y-auto custom-scrollbar flex-1 bg-app/50"
        >
          <div
            data-profile-section="general"
            className={`p-6 sm:p-7 space-y-6 ${canEdit ? "" : "hidden"}`}
          >
            <h3 className="t-h3">General Info</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    Number
                  </label>
                  <input
                    type="text"
                    value={player.number || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, { number: e.target.value })
                    }
                    className="w-full p-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-inner"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    Bats
                  </label>
                  <select
                    value={player.bats || "R"}
                    onChange={(e) =>
                      updatePlayer(player.id, { bats: e.target.value })
                    }
                    className="w-full p-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-sm"
                  >
                    <option value="R">R</option>
                    <option value="L">L</option>
                    <option value="S">S</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    Throws
                  </label>
                  <select
                    value={player.throws || "R"}
                    onChange={(e) =>
                      updatePlayer(player.id, { throws: e.target.value })
                    }
                    className="w-full p-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-sm"
                  >
                    <option value="R">R</option>
                    <option value="L">L</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    Primary Pos
                  </label>
                  <select
                    value={player.primaryPosition || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, {
                        primaryPosition: e.target.value,
                      })
                    }
                    className="w-full p-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-sm"
                  >
                    <option value="">N/A</option>
                    {positions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {canEdit &&
                    suggestedPrimary &&
                    suggestedPrimary.position !== (player.primaryPosition || "") && (
                      <button
                        type="button"
                        onClick={() =>
                          updatePlayer(player.id, {
                            primaryPosition: suggestedPrimary.position,
                          })
                        }
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-team-primary hover:underline"
                        title="Suggested from this player's evaluations"
                      >
                        <Icons.Sparkles className="w-3 h-3" />
                        Eval suggests {suggestedPrimary.position} · Use
                      </button>
                    )}
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={player.dob || ""}
                    onChange={(e) =>
                      updatePlayer(player.id, { dob: e.target.value })
                    }
                    className="w-full p-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-inner"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                  Comfortable Positions
                </label>
                <p className="text-[11px] text-ink-3 font-medium mb-3">
                  Tap positions you&apos;re comfortable with this player playing.
                  Leave empty to let the engine consider them anywhere except
                  catcher — <strong className="text-ink">C is opt-in</strong>,
                  so a player is only ever seated at catcher when you select it
                  here.
                </p>
                {/* Quick group set/clear by positional grouping — a kid who
                    plays anywhere in a group is one tap. Toggles the group. */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {[
                    { name: "Corner IF", group: ["1B", "3B"] },
                    { name: "Middle IF", group: ["2B", "SS"] },
                    { name: "Outfield", group: ["LF", "CF", "RF"] },
                  ].map(({ name, group }) => {
                    const list = canonicalizePositionList(
                      player.comfortablePositions
                    );
                    const allOn = group.every((p) => list.includes(p));
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          const next = allOn
                            ? list.filter((p: string) => !group.includes(p))
                            : Array.from(new Set([...list, ...group]));
                          updatePlayer(player.id, {
                            comfortablePositions: next,
                          });
                        }}
                        className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border transition-all ${
                          allOn
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                            : "bg-surface border-line-strong text-ink hover:bg-surface-2"
                        }`}
                      >
                        {allOn ? `Clear ${name}` : `All ${name}`}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 bg-surface border border-line p-3 rounded-xl shadow-sm">
                  {positions.map((pos) => {
                    // Canonicalize so legacy LCF/RCF data lights up the CF chip,
                    // and every toggle re-saves the clean canonical list.
                    const list = canonicalizePositionList(
                      player.comfortablePositions
                    );
                    const active = list.includes(pos);
                    const isCatcher = pos === "C";
                    return (
                      <button
                        key={pos}
                        onClick={() => {
                          const next = active
                            ? list.filter((p: any) => p !== pos)
                            : [...list, pos];
                          updatePlayer(player.id, {
                            comfortablePositions: next,
                          });
                        }}
                        title={
                          isCatcher
                            ? "Catcher — only selected players are ever used at C"
                            : undefined
                        }
                        className={`p-2 text-xs font-black uppercase rounded-lg transition-all border ${
                          active
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm"
                            : "bg-surface border-line text-ink hover:bg-surface-2 hover:border-line-strong"
                        }`}
                      >
                        {pos}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scheduled Absences — dates the family already knows the kid
                  is out. Games on these dates default the kid to absent in
                  Game Day Attendance (still toggleable per game). */}
              <div className="p-5 bg-surface border border-line rounded-xl shadow-sm">
                <h4 className="font-black text-xs uppercase tracking-widest text-ink mb-2 flex items-center gap-2">
                  <Icons.Calendar className="w-4 h-4" /> Scheduled Absences
                </h4>
                <p className="text-[11px] text-ink-3 font-medium mb-3 leading-snug">
                  Know ahead of time when {player.name?.split(" ")[0] || "this player"} will
                  be out (vacation, school event)? Add the dates — games on
                  those days mark them absent automatically.
                </p>
                {(player.absences || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {[...(player.absences || [])].sort().map((d: string) => (
                      <span
                        key={d}
                        className="t-chip pl-2 pr-1 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900 tabular-nums inline-flex items-center gap-1"
                      >
                        {formatGameDateDisplay(d)}
                        <button
                          type="button"
                          aria-label={`Remove absence ${d}`}
                          onClick={() =>
                            updatePlayer(player.id, {
                              absences: (player.absences || []).filter(
                                (x: string) => x !== d
                              ),
                            })
                          }
                          className="p-0.5 rounded hover:bg-amber-100 text-amber-700"
                        >
                          <Icons.X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="date"
                  value=""
                  aria-label={`Add absence date for ${player.name}`}
                  onChange={(e) => {
                    const d = e.target.value;
                    if (!d || (player.absences || []).includes(d)) return;
                    updatePlayer(player.id, {
                      absences: [...(player.absences || []), d],
                    });
                  }}
                  className="w-full sm:w-48 p-2.5 bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
                />
              </div>

              {pitchingFormat === "Kid Pitch" && (
                <div className="p-5 bg-surface border border-line rounded-xl shadow-sm">
                  <h4 className="font-black text-xs uppercase tracking-widest text-ink mb-4 flex items-center gap-2">
                    <Icons.Pitch className="w-4 h-4" /> Recent Pitching
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Pitches Last Game
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={player.pitching?.recentPitches || 0}
                        onChange={(e) =>
                          updatePlayerNested(player.id, "pitching", {
                            recentPitches: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="w-full p-2.5 bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-surface-2 disabled:text-ink-3 shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Last Date Pitched
                      </label>
                      <input
                        type="date"
                        value={player.pitching?.lastPitchDate || ""}
                        onChange={(e) =>
                          updatePlayerNested(player.id, "pitching", {
                            lastPitchDate: e.target.value,
                          })
                        }
                        className="w-full p-2.5 bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-surface-2 disabled:text-ink-3 shadow-inner"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Top Fastball (mph)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        placeholder="—"
                        value={player.pitching?.topMph || ""}
                        onChange={(e) =>
                          updatePlayerNested(player.id, "pitching", {
                            topMph: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className="w-full p-2.5 bg-surface border border-line-strong rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-surface-2 disabled:text-ink-3 shadow-inner"
                      />
                      <p className="text-[10px] text-ink-3 font-medium mt-1 leading-tight">
                        Radar reading (optional). Scored vs. your age group, so it
                        helps the pitcher ranking.
                      </p>
                    </div>
                  </div>
                  {Array.isArray(player.pitching?.log) &&
                    player.pitching.log.length > 0 && (
                      <div className="mt-4">
                        {(() => {
                          const w = summarizePitchingWorkload(player.pitching);
                          return (
                            <div className="text-[11px] font-bold text-ink-2 mb-2">
                              Season workload:{" "}
                              <span className="tabular-nums">{w.totalPitches}</span> pitches
                              over <span className="tabular-nums">{w.outings}</span>{" "}
                              outing{w.outings === 1 ? "" : "s"} (high{" "}
                              <span className="tabular-nums">{w.maxPitches}</span>)
                            </div>
                          );
                        })()}
                        <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Outing History
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {player.pitching.log.map((o: any, i: number) => (
                            <span
                              key={o.gameId || `${o.date}-${i}`}
                              className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink tabular-nums"
                              title={`${o.pitches} pitches`}
                            >
                              {formatGameDateDisplay(o.date)} · {o.pitches}P
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

          <div
            data-profile-section="report"
            className="p-6 sm:p-7 space-y-6 border-t border-line"
          >
            <h3 className="t-h3">Season Report</h3>
              {/* Current season summary */}
              <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2">
                    <Icons.Bat className="w-4 h-4" /> {currentSeason}
                  </h4>
                </div>

                {/* Hitting */}
                <div className="mb-5">
                  <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                    Hitting
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { label: "AVG", v: formatStat(player.stats?.avg) },
                      { label: "OBP", v: formatStat(player.stats?.obp) },
                      { label: "OPS", v: formatStat(player.stats?.ops) },
                      { label: "H", v: player.stats?.h || 0 },
                      { label: "HR", v: player.stats?.hr || 0 },
                      { label: "RBI", v: player.stats?.rbi || 0 },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-app rounded-lg p-2 text-center"
                      >
                        <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest">
                          {s.label}
                        </div>
                        <div className="text-sm font-black tabular-nums text-ink">
                          {s.v}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pitching (only when team is Kid Pitch) */}
                {pitchingFormat === "Kid Pitch" && (
                  <div className="mb-5">
                    <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                      Pitching
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { label: "IP", v: player.stats?.ip || 0 },
                        { label: "ERA", v: formatStat(player.stats?.era) },
                        { label: "TP", v: player.stats?.totalPitches || 0 },
                      ].map((s) => (
                        <div
                          key={s.label}
                          className="bg-app rounded-lg p-2 text-center"
                        >
                          <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest">
                            {s.label}
                          </div>
                          <div className="text-sm font-black tabular-nums text-ink">
                            {s.v}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fielding */}
                <div>
                  <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                    Fielding
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {[
                      { label: "FPCT", v: formatStat(player.stats?.fpct) },
                      { label: "TC", v: player.stats?.tc || 0 },
                      { label: "PO", v: player.stats?.po || 0 },
                      { label: "A", v: player.stats?.a || 0 },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-app rounded-lg p-2 text-center"
                      >
                        <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest">
                          {s.label}
                        </div>
                        <div className="text-sm font-black tabular-nums text-ink">
                          {s.v}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Position innings — reused from Innings Played tab logic */}
              {inningsBreakdown.gamesAvailable > 0 &&
                (() => {
                  const entries = Object.entries(
                    inningsBreakdown.byPosition
                  ).sort((a, b) => b[1] - a[1]);
                  const maxCount = entries[0]?.[1] || 1;
                  return (
                    <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
                      <h4 className="font-black text-[11px] uppercase tracking-widest text-ink mb-4 flex items-center gap-2">
                        <Icons.Glove className="w-4 h-4" /> Innings by Position
                      </h4>
                      {entries.length === 0 ? (
                        <div className="text-xs font-bold text-ink-3 uppercase tracking-widest text-center py-3">
                          All Innings on Bench
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {entries.map(([pos, count]) => {
                            const pct = (count / maxCount) * 100;
                            return (
                              <div
                                key={pos}
                                className="flex items-center gap-3"
                              >
                                <div className="w-10 text-[11px] font-black uppercase tracking-widest text-ink shrink-0">
                                  {pos}
                                </div>
                                <div className="flex-1 h-5 bg-surface-2 rounded-md overflow-hidden">
                                  <div
                                    className="h-full rounded-md transition-all"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: primaryColor,
                                      opacity: 0.85,
                                    }}
                                  />
                                </div>
                                <div className="w-8 text-right text-sm font-black tabular-nums text-ink shrink-0">
                                  {count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* Past Seasons */}
              <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2">
                    <Icons.Clock className="w-4 h-4" /> Past Seasons
                  </h4>
                  {!addingPastSeason && (
                    <button
                      type="button"
                      onClick={() => setAddingPastSeason(true)}
                      className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-surface border border-line text-ink hover:bg-surface-2 transition-colors shadow-sm flex items-center gap-1.5"
                    >
                      <Icons.Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  )}
                </div>

                {addingPastSeason && (
                  <PastSeasonForm
                    primaryColor={primaryColor}
                    tertiaryColor={tertiaryColor}
                    onCancel={() => setAddingPastSeason(false)}
                    onSave={(entry: any) => {
                      addPastSeason(player.id, entry);
                      setAddingPastSeason(false);
                    }}
                  />
                )}

                {(player.pastSeasons || []).length === 0 &&
                !addingPastSeason ? (
                  <div className="text-xs font-bold text-ink-3 uppercase tracking-widest text-center py-4">
                    No Past Seasons On File
                  </div>
                ) : (
                  <div className="space-y-2 mt-3">
                    {(player.pastSeasons || []).map((entry: any) => {
                      const isEditing = editingPastSeasonId === entry.id;
                      if (isEditing) {
                        return (
                          <PastSeasonForm
                            key={entry.id}
                            initial={entry}
                            primaryColor={primaryColor}
                            tertiaryColor={tertiaryColor}
                            onCancel={() => setEditingPastSeasonId(null)}
                            onSave={(patch: any) => {
                              updatePastSeason(player.id, entry.id, patch);
                              setEditingPastSeasonId(null);
                            }}
                            onDelete={() => {
                              removePastSeason(player.id, entry.id);
                              setEditingPastSeasonId(null);
                            }}
                          />
                        );
                      }
                      const showPitching = entry.pitchingFormat === "Kid Pitch";
                      return (
                        <div
                          key={entry.id}
                          className="bg-app border border-line rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                              <div className="text-sm font-black text-ink uppercase">
                                {entry.season}
                              </div>
                              <div className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                                {entry.ageGroup} · {entry.pitchingFormat}
                                {entry.record &&
                                entry.record.wins +
                                  entry.record.losses +
                                  entry.record.ties >
                                  0
                                  ? ` · Team ${entry.record.wins}-${
                                      entry.record.losses
                                    }${
                                      entry.record.ties > 0
                                        ? "-" + entry.record.ties
                                        : ""
                                    }`
                                  : ""}
                              </div>
                            </div>
                            
                              <button
                                type="button"
                                onClick={() => setEditingPastSeasonId(entry.id)}
                                className="p-2 text-ink-3 hover:text-team-primary hover:bg-surface-2 rounded-lg transition-colors"
                              >
                                <Icons.Edit className="w-4 h-4" />
                              </button>
                            
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                            {[
                              { label: "AVG", v: formatStat(entry.stats?.avg) },
                              { label: "OBP", v: formatStat(entry.stats?.obp) },
                              { label: "OPS", v: formatStat(entry.stats?.ops) },
                              { label: "H", v: entry.stats?.h || 0 },
                              { label: "HR", v: entry.stats?.hr || 0 },
                              { label: "RBI", v: entry.stats?.rbi || 0 },
                            ].map((s) => (
                              <div
                                key={s.label}
                                className="bg-surface rounded-lg p-2 text-center border border-line"
                              >
                                <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest">
                                  {s.label}
                                </div>
                                <div className="text-sm font-black tabular-nums text-ink">
                                  {s.v}
                                </div>
                              </div>
                            ))}
                          </div>
                          {showPitching &&
                          (entry.stats?.ip ||
                            entry.stats?.era ||
                            entry.stats?.totalPitches) ? (
                            <div className="grid grid-cols-3 gap-2 mt-2">
                              {[
                                { label: "IP", v: entry.stats?.ip || 0 },
                                {
                                  label: "ERA",
                                  v: formatStat(entry.stats?.era),
                                },
                                {
                                  label: "TP",
                                  v: entry.stats?.totalPitches || 0,
                                },
                              ].map((s) => (
                                <div
                                  key={s.label}
                                  className="bg-surface rounded-lg p-2 text-center border border-line"
                                >
                                  <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest">
                                    {s.label}
                                  </div>
                                  <div className="text-sm font-black tabular-nums text-ink">
                                    {s.v}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Game-by-game timeline (collapsed by default) */}
              <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTimeline((s) => !s)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-2 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Icons.Calendar className="w-4 h-4 text-ink" />
                    <span className="font-black text-[11px] uppercase tracking-widest text-ink">
                      Game by Game
                    </span>
                    <span className="text-[10px] font-bold text-ink-3">
                      ({timeline.length})
                    </span>
                  </div>
                  {showTimeline ? (
                    <Icons.ChevronUp className="w-4 h-4 text-ink-3" />
                  ) : (
                    <Icons.ChevronDown className="w-4 h-4 text-ink-3" />
                  )}
                </button>
                {showTimeline &&
                  (timeline.length === 0 ? (
                    <div className="px-5 pb-5 text-xs font-bold text-ink-3 uppercase tracking-widest text-center">
                      No Final Games On File
                    </div>
                  ) : (
                    <div className="border-t border-line divide-y divide-line max-h-72 overflow-y-auto custom-scrollbar">
                      {timeline.map((g) => {
                        const positions = Object.entries(
                          (g.positions || {}) as Record<string, number>
                        )
                          .sort((a, b) => b[1] - a[1])
                          .map(([p, c]) => `${p}×${c}`)
                          .join(" ");
                        return (
                          <div
                            key={g.id}
                            className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-2 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-black text-ink uppercase truncate">
                                  vs. {g.opponent}
                                </span>
                                {g.result && (
                                  <span
                                    className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded tabular-nums ${
                                      g.result === "W"
                                        ? "bg-green-100 text-green-800"
                                        : g.result === "L"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {g.result} {g.score}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                                {formatGameDateDisplay(g.date)}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] font-bold text-ink tabular-nums">
                                {positions || "Bench"}
                              </div>
                              <div className="text-[9px] font-bold text-ink-3 uppercase tracking-widest">
                                {g.batOrder ? `Bat ${g.batOrder} · ` : ""}
                                {g.benchInnings} bench
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            </div>

          <div
            data-profile-section="stats"
            className="p-6 sm:p-7 space-y-6 border-t border-line"
          >
            <h3 className="t-h3">Season Stats</h3>
              <div className="flex items-center justify-between">
                <h4 className="font-black text-xs uppercase tracking-widest text-ink-3 flex items-center gap-2">
                  <Icons.Bat className="w-4 h-4" /> Season Statistics
                </h4>
                <span className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                  Tap a stat for trend
                </span>
              </div>

              {["hitting", "pitching", "fielding"].map((category) => {
                // Skip pitching section if team isn't running Kid Pitch
                if (category === "pitching" && pitchingFormat !== "Kid Pitch")
                  return null;
                const keys = STATS_TAB_KEYS.filter(
                  (k) => STAT_META[k]?.category === category
                );
                if (keys.length === 0) return null;
                return (
                  <div
                    key={category}
                    className="bg-surface border border-line rounded-xl p-5 shadow-sm"
                  >
                    <h5 className="font-black text-[11px] uppercase tracking-widest text-ink mb-3 capitalize">
                      {category}
                    </h5>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                      {keys.map((key) => {
                        const value = player.stats?.[key];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setTrendStatKey(key)}
                            className="group bg-app hover:bg-surface-2 border border-transparent rounded-lg p-2 text-center transition-colors cursor-pointer"
                          >
                            <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-0.5">
                              {STAT_META[key].label}
                            </div>
                            <div className="text-sm font-black tabular-nums text-ink group-hover:text-team-primary">
                              {formatStatValue(key, value)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Recent Movement — compact per-stat trend across the last
                  few CSV snapshots. Each cell shows current value, net
                  delta from ~5 snapshots ago, and a tiny inline sparkline.
                  No per-import row; coaches who want the per-snapshot
                  trail can open the per-stat trend modal from the Stats
                  grid above. */}
              <RecentMovementPanel player={player} />
            </div>

          <div
            data-profile-section="innings"
            className="p-6 sm:p-7 space-y-6 border-t border-line"
          >
            <h3 className="t-h3">Innings Played</h3>
              <div className="flex items-center justify-between">
                <h4 className="font-black text-xs uppercase tracking-widest text-ink-3 flex items-center gap-2">
                  <Icons.Glove className="w-4 h-4" /> Defensive Innings
                </h4>
                <span className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                  From Final games only
                </span>
              </div>

              {inningsBreakdown.gamesAvailable === 0 ? (
                <div className="bg-surface border border-line rounded-xl p-8 text-center shadow-sm">
                  <Icons.Calendar className="w-10 h-10 text-ink-3 mx-auto mb-3" />
                  <p className="text-sm font-black uppercase tracking-widest text-ink-3 mb-1">
                    No Game History Yet
                  </p>
                  <p className="text-xs text-ink-3 font-medium">
                    Mark games as Final on the Schedule tab to start tracking
                    innings here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Games Played
                      </div>
                      <div className="text-2xl font-black text-ink tabular-nums">
                        {inningsBreakdown.gamesPlayed}
                        <span className="text-sm text-ink-3 font-bold">
                          /{inningsBreakdown.gamesAvailable}
                        </span>
                      </div>
                    </div>
                    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Defensive Inn.
                      </div>
                      <div className="text-2xl font-black text-ink tabular-nums">
                        {inningsBreakdown.totalDefensive}
                      </div>
                    </div>
                    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Bench Inn.
                      </div>
                      <div className="text-2xl font-black text-ink tabular-nums">
                        {inningsBreakdown.bench}
                      </div>
                    </div>
                    <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
                      <div className="text-[9px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        1st Inn. Bench
                      </div>
                      <div className="text-2xl font-black text-ink tabular-nums">
                        {inningsBreakdown.firstInningBench}
                      </div>
                    </div>
                  </div>

                  <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
                    <h5 className="font-black text-[11px] uppercase tracking-widest text-ink mb-4">
                      By Position
                    </h5>
                    {(() => {
                      const entries = Object.entries(
                        inningsBreakdown.byPosition
                      ).sort((a, b) => b[1] - a[1]);
                      if (entries.length === 0) {
                        return (
                          <div className="text-xs font-bold text-ink-3 uppercase tracking-widest text-center py-4">
                            All Innings on Bench
                          </div>
                        );
                      }
                      const maxCount = entries[0][1];
                      return (
                        <div className="space-y-2.5">
                          {entries.map(([pos, count]) => {
                            const pct = (count / maxCount) * 100;
                            return (
                              <div
                                key={pos}
                                className="flex items-center gap-3"
                              >
                                <div className="w-10 text-[11px] font-black uppercase tracking-widest text-ink shrink-0">
                                  {pos}
                                </div>
                                <div className="flex-1 h-6 bg-surface-2 rounded-md overflow-hidden relative">
                                  <div
                                    className="h-full rounded-md transition-all"
                                    style={{
                                      width: `${pct}%`,
                                      backgroundColor: primaryColor,
                                      opacity: 0.85,
                                    }}
                                  />
                                </div>
                                <div className="w-10 text-right text-sm font-black tabular-nums text-ink shrink-0">
                                  {count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>

          <div
            data-profile-section="contact"
            className={`p-6 sm:p-7 space-y-4 border-t border-line ${
              canEdit ? "" : "hidden"
            }`}
          >
            <h3 className="t-h3">Contact</h3>
              <div className="flex justify-between items-center">
                <h4 className="font-black text-xs uppercase tracking-widest text-ink-3 flex items-center gap-2">
                  <Icons.User className="w-4 h-4" /> Family Contact
                </h4>
                
                  <button
                    onClick={() => setEditingContact(!editingContact)}
                    className="text-[10px] font-black uppercase tracking-widest bg-surface border border-line hover:bg-surface-2 text-ink px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                  >
                    {editingContact ? "Done" : "Edit"}
                  </button>
                
              </div>
              {[
                { key: "parentName", label: "Parent / Guardian Name" },
                { key: "phone", label: "Phone Number" },
                { key: "email", label: "Email Address" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={player[key] || ""}
                    disabled={!editingContact}
                    onChange={(e) =>
                      updatePlayer(player.id, { [key]: e.target.value })
                    }
                    className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold disabled:bg-app disabled:text-ink-3 shadow-inner"
                  />
                </div>
              ))}
            </div>
        </div>

        <div className="bg-surface border-t border-line p-4 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
          
            <button
              onClick={() =>
                updatePlayer(player.id, { present: player.present === false })
              }
              className={`text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl transition-colors shadow-sm border ${
                player.present === false
                  ? "bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                  : "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200"
              }`}
            >
              {player.present === false ? "MARK ACTIVE" : "MARK INACTIVE"}
            </button>
          
          <div className="flex gap-3 ml-auto">
            
              <button
                onClick={() => removePlayer(player.id)}
                className="text-[10px] font-black uppercase tracking-widest bg-surface border border-red-200 text-red-700 hover:bg-red-50 px-4 py-2.5 rounded-xl shadow-sm transition-colors flex items-center gap-2"
              >
                <Icons.Trash className="w-3.5 h-3.5" /> Delete
              </button>
            
            <button
              onClick={close}
              className="text-[10px] font-black uppercase tracking-widest text-white px-4 py-2.5 rounded-xl shadow-md transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
      {trendStatKey && (
        <StatTrendModal
          statKey={trendStatKey}
          player={player}
          currentSeason={currentSeason}
          currentPitchingFormat={pitchingFormat}
          primaryColor={primaryColor}
          tertiaryColor={tertiaryColor}
          onClose={() => setTrendStatKey(null)}
        />
      )}
    </div>
  );
});

export const AddPlayerModal = memo(() => {
  const { team, addPlayer } = useTeam();
  const { isAddingPlayer, setIsAddingPlayer } = useUI();
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
    primaryPosition: "",
  });

  if (!isAddingPlayer) return null;

  const close = () => {
    setIsAddingPlayer(false);
    setForm({
      name: "",
      number: "",
      bats: "R",
      throws: "R",
      primaryPosition: "",
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addPlayer(form);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-line"
      >
        <div
          className="p-1.5"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <form onSubmit={submit} className="p-6 sm:p-7 space-y-4">
          <h3 className="t-card-title mb-2">Add Player</h3>
          <div className="flex items-center gap-4">
            <PlayerAvatar
              player={{
                name: form.name,
                number: form.number,
                primaryPosition: form.primaryPosition,
              }}
              size={64}
              showNumber
              showPosition
            />
            <p className="flex-1 text-xs font-medium text-ink-3 leading-snug">
              Players show your team logo. Set a number and primary position to
              tell them apart at a glance.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
              Name *
            </label>
            <input
              autoFocus
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Number
              </label>
              <input
                type="text"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-inner"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Bats
              </label>
              <select
                value={form.bats}
                onChange={(e) => setForm({ ...form, bats: e.target.value })}
                className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-sm"
              >
                <option>R</option>
                <option>L</option>
                <option>S</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                Throws
              </label>
              <select
                value={form.throws}
                onChange={(e) => setForm({ ...form, throws: e.target.value })}
                className="w-full p-3 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold shadow-sm"
              >
                <option>R</option>
                <option>L</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-3 justify-end">
            <button
              type="button"
              onClick={close}
              className="px-5 py-2.5 bg-surface border border-line text-ink-2 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
              style={{ backgroundColor: primaryColor, color: tertiaryColor }}
            >
              Add Player
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
