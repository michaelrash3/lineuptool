import React, { memo, useMemo, useState, useRef, useEffect } from "react";
import { Icons } from "../icons";
import {
  formatStat,
  formatGameDateDisplay,
  calculateBaseballAge,
  blankStats,
  lineupSlotMatchesPlayer,
  isGameFinalized,
} from "../utils/helpers";
import { AGE_TIERS } from "../constants/ui";
import { getActivePositionList } from "../lineupEngine";
import { useTeam, useUI, useToast } from "../contexts.js";
import { PlayerAvatar, cropImageTo256DataURL } from "./shared.jsx";


const PROFILE_SECTIONS = [
  { id: "general", label: "General" },
  { id: "report", label: "Report" },
  { id: "stats", label: "Stats" },
  { id: "innings", label: "Innings" },
  { id: "contact", label: "Contact" },
];

// Convert a chosen file into a 256×256 JPEG data URL ready to persist
// inline on the player record. Photos no longer round-trip through Cloud
// Storage (Spark plan compatibility) — they're stored alongside the rest
// of the player document in Firestore. Removal is just clearing the
// photoUrl field; nothing external needs to be deleted.
const STATS_TAB_KEYS = [
  "ops",
  "obp",
  "avg",
  "contact",
  "totalPitches",
  "ab",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "fpct",
  "tc",
  "a",
  "po",
  "ip",
  "era",
  "ld",
  "fb",
  "gb",
  "hard",
  "qab",
  "babip",
];

// Per-stat metadata used by the Season Stats tab and the year-over-year chart.
// `kind`: "decimal" (e.g. .345 avg), "int" (e.g. 12 hr), "percent" (e.g. 45%),
//          "ip" (innings pitched, shows as 12.1 for 12 1/3).
// `label`: shown on cards/chart axes
// `category`: groups stats; pitching is hidden for non-Kid Pitch seasons
// `higherIsBetter`: used for the trend arrow direction
const STAT_META = {
  ops: {
    label: "OPS",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  obp: {
    label: "OBP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  avg: {
    label: "AVG",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  contact: {
    label: "Contact%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  ab: { label: "AB", kind: "int", category: "hitting", higherIsBetter: true },
  h: { label: "H", kind: "int", category: "hitting", higherIsBetter: true },
  doubles: {
    label: "2B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  triples: {
    label: "3B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  hr: { label: "HR", kind: "int", category: "hitting", higherIsBetter: true },
  rbi: { label: "RBI", kind: "int", category: "hitting", higherIsBetter: true },
  sb: { label: "SB", kind: "int", category: "hitting", higherIsBetter: true },
  k: { label: "K", kind: "int", category: "hitting", higherIsBetter: false },
  ld: {
    label: "LD%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  fb: {
    label: "FB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  gb: {
    label: "GB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: false,
  },
  hard: {
    label: "Hard%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  qab: {
    label: "QAB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  babip: {
    label: "BABIP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  fpct: {
    label: "FPCT",
    kind: "decimal",
    category: "fielding",
    higherIsBetter: true,
  },
  tc: { label: "TC", kind: "int", category: "fielding", higherIsBetter: true },
  a: { label: "A", kind: "int", category: "fielding", higherIsBetter: true },
  po: { label: "PO", kind: "int", category: "fielding", higherIsBetter: true },
  ip: { label: "IP", kind: "ip", category: "pitching", higherIsBetter: true },
  era: {
    label: "ERA",
    kind: "decimal",
    category: "pitching",
    higherIsBetter: false,
  },
  totalPitches: {
    label: "TP",
    kind: "int",
    category: "pitching",
    higherIsBetter: false,
  },
};

// Format a stat value for display. Returns "—" for missing/zero values when
// appropriate (so a kid with 0 HR shows as 0, but a kid with no AVG shows as —).

export const formatStatValue = (key, value) => {
  if (value === null || value === undefined) return "—";
  const meta = STAT_META[key];
  if (!meta) return String(value);
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  switch (meta.kind) {
    case "decimal":
      // Convention: drop leading 0 for sub-1 stats (.345 not 0.345)
      if (n > 0 && n < 1) return n.toFixed(3).replace(/^0/, "");
      return n.toFixed(3);
    case "percent":
      // Stored as decimal (0.45 = 45%) or already as percent (45)?
      // We treat values <= 1 as decimals to convert; otherwise display as-is.
      const pct = n <= 1 ? n * 100 : n;
      return `${pct.toFixed(1)}%`;
    case "int":
      return Math.round(n).toString();
    case "ip": {
      // IP convention: integer.thirds (e.g. 5.2 = 5 and 2/3)
      return n.toFixed(1);
    }
    default:
      return String(n);
  }
};
/* ============================================================================
   SECTION X · Lineup Card generator — see ./lineup/lineupCard.js
============================================================================ */

/* ============================================================================
   PastSeasonImportModal — review screen for bulk past-season CSV import.
   Lets the user assign each CSV row to an existing player (or skip), then
   commits all assignments at once via bulkAddPastSeasons.
============================================================================ */
export const PastSeasonImportModal = memo(() => {
  const { team, bulkAddPastSeasons } = useTeam();
  const { pastSeasonImport, setPastSeasonImport } = useUI();
  const toast = useToast();

  if (!pastSeasonImport) return null;
  const { rows, season, ageGroup, pitchingFormat, assignments } =
    pastSeasonImport;
  const { players, primaryColor, tertiaryColor } = team;

  const setField = (patch) =>
    setPastSeasonImport({ ...pastSeasonImport, ...patch });
  const setAssignment = (csvName, value) =>
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
            {rows.map((row) => {
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
                        {players.map((p) => {
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
  ({ initial, primaryColor, tertiaryColor, onSave, onCancel, onDelete }) => {
    const [season, setSeason] = useState(initial?.season || "");
    const [ageGroup, setAgeGroup] = useState(initial?.ageGroup || "");
    const [pitchingFormat, setPitchingFormat] = useState(
      initial?.pitchingFormat || "Kid Pitch"
    );
    const [stats, setStats] = useState(() => ({
      ...blankStats(),
      ...(initial?.stats || {}),
    }));

    const setStat = (key, raw) => {
      const n = parseFloat(raw);
      setStats((s) => ({ ...s, [key]: Number.isNaN(n) ? 0 : n }));
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
export const StatTrendModal = memo(
  ({
    statKey,
    player,
    currentSeason,
    currentPitchingFormat,
    primaryColor,
    tertiaryColor,
    onClose,
  }) => {
    if (!statKey) return null;
    const meta = STAT_META[statKey];
    if (!meta) return null;

    // Build a chronological data series. Each entry: { season, ageGroup, value, isCurrent }.
    // Sort: by year ascending, then Spring before Fall within a year.
    const seasonSortKey = (label) => {
      if (!label) return 99999;
      const m = String(label).match(/(spring|fall)\s+(\d{4})/i);
      if (!m) return 99999;
      const year = parseInt(m[2], 10);
      const seasonOffset = m[1].toLowerCase() === "spring" ? 0 : 1;
      return year * 10 + seasonOffset;
    };

    const series = [];

    // Past seasons
    for (const ps of player.pastSeasons || []) {
      // Skip pitching stats for non-Kid Pitch seasons
      if (meta.category === "pitching" && ps.pitchingFormat !== "Kid Pitch")
        continue;
      const v = ps.stats?.[statKey];
      if (v === null || v === undefined) continue;
      const num = Number(v);
      if (Number.isNaN(num)) continue;
      series.push({
        season: ps.season,
        ageGroup: ps.ageGroup,
        value: num,
        sortKey: seasonSortKey(ps.season),
        isCurrent: false,
      });
    }

    // Current season
    if (
      !(meta.category === "pitching" && currentPitchingFormat !== "Kid Pitch")
    ) {
      const v = player.stats?.[statKey];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
        series.push({
          season: currentSeason,
          ageGroup: null,
          value: Number(v),
          sortKey: seasonSortKey(currentSeason),
          isCurrent: true,
        });
      }
    }

    series.sort((a, b) => a.sortKey - b.sortKey);

    // Geometry: SVG drawn into a 600x300 viewBox, but the parent flexes the
    // width responsively. Margins reserved for axis labels.
    const W = 600,
      H = 300;
    const ML = 60,
      MR = 24,
      MT = 24,
      MB = 56;
    const innerW = W - ML - MR;
    const innerH = H - MT - MB;

    // Y range: pad by 10%; for percent stats clamp to [0, 100] sensibly.
    const values = series.map((s) => s.value);
    let yMin = values.length ? Math.min(...values) : 0;
    let yMax = values.length ? Math.max(...values) : 1;
    if (yMin === yMax) {
      // Single point or all-equal: pad symmetrically
      if (yMin === 0) {
        yMin = 0;
        yMax = 1;
      } else {
        yMin = yMin * 0.9;
        yMax = yMax * 1.1;
      }
    } else {
      const range = yMax - yMin;
      yMin = yMin - range * 0.1;
      yMax = yMax + range * 0.1;
    }
    // Don't go negative for stats that can't be negative
    if (meta.kind === "int" || meta.kind === "percent" || meta.kind === "ip") {
      if (yMin < 0) yMin = 0;
    }

    const xPos = (i) =>
      series.length === 1
        ? ML + innerW / 2
        : ML + (i / (series.length - 1)) * innerW;
    const yPos = (v) => MT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    // Axis ticks: 4-5 evenly spaced on Y
    const yTicks = [];
    const tickCount = 4;
    for (let i = 0; i <= tickCount; i++) {
      const v = yMin + ((yMax - yMin) * i) / tickCount;
      yTicks.push(v);
    }

    // Compute trend (first vs last)
    let trend = null;
    if (series.length >= 2) {
      const first = series[0].value;
      const last = series[series.length - 1].value;
      if (first !== last) {
        const direction = last > first ? "up" : "down";
        const isImproving = (direction === "up") === meta.higherIsBetter;
        const change = last - first;
        trend = { direction, isImproving, change };
      }
    }

    return (
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <div
          className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="p-1.5"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-4">
            <div>
              <div className="t-eyebrow mb-1">{player.name}</div>
              <h3 className="t-card-title">{meta.label}</h3>
              {trend && (
                <div
                  className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border tabular-nums ${
                    trend.isImproving
                      ? "bg-green-50 text-green-800 border-green-200"
                      : "bg-red-50 text-red-800 border-red-200"
                  }`}
                >
                  {trend.direction === "up" ? "↑" : "↓"}
                  {meta.kind === "decimal" || meta.kind === "ip"
                    ? Math.abs(trend.change).toFixed(3)
                    : meta.kind === "percent"
                    ? `${Math.abs(
                        trend.change <= 1 ? trend.change * 100 : trend.change
                      ).toFixed(1)}%`
                    : Math.abs(Math.round(trend.change))}
                  {trend.isImproving ? "Improving" : "Declining"}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 sm:p-7 overflow-y-auto custom-scrollbar flex-1">
            {series.length === 0 ? (
              <div className="bg-app border border-line rounded-xl p-12 text-center">
                <Icons.Bat className="w-10 h-10 text-ink-3 mx-auto mb-3" />
                <p className="text-sm font-black uppercase tracking-widest text-ink-3 mb-1">
                  No Data Available
                </p>
                <p className="text-xs text-ink-3 font-medium">
                  {meta.category === "pitching"
                    ? "No Kid Pitch seasons with this stat on file."
                    : "No seasons have data for this stat yet."}
                </p>
              </div>
            ) : series.length === 1 ? (
              <div className="bg-app border border-line rounded-xl p-8 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-2">
                  {series[0].season}
                  {series[0].ageGroup ? ` · ${series[0].ageGroup}` : ""}
                </div>
                <div className="text-5xl font-black tabular-nums text-ink mb-2">
                  {formatStatValue(statKey, series[0].value)}
                </div>
                <p className="text-xs text-ink-3 font-medium">
                  Add past seasons to see year-over-year trends.
                </p>
              </div>
            ) : (
              <>
                <div className="bg-app border border-line rounded-xl p-4 mb-4">
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-auto"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Y-axis grid lines + labels */}
                    {yTicks.map((v, i) => (
                      <g key={i}>
                        <line
                          x1={ML}
                          y1={yPos(v)}
                          x2={ML + innerW}
                          y2={yPos(v)}
                          stroke="#e2e8f0"
                          strokeWidth="1"
                          strokeDasharray={
                            i === 0 || i === tickCount ? "0" : "3,3"
                          }
                        />
                        <text
                          x={ML - 8}
                          y={yPos(v) + 4}
                          textAnchor="end"
                          className="text-[11px]"
                          fill="#64748b"
                          style={{
                            fontWeight: 700,
                            fontFamily: "ui-monospace, monospace",
                          }}
                        >
                          {formatStatValue(statKey, v)}
                        </text>
                      </g>
                    ))}

                    {/* X-axis labels (season names, rotated for fit) */}
                    {series.map((s, i) => (
                      <g key={i}>
                        <text
                          x={xPos(i)}
                          y={MT + innerH + 18}
                          textAnchor="middle"
                          className="text-[10px]"
                          fill={s.isCurrent ? primaryColor : "#64748b"}
                          style={{ fontWeight: s.isCurrent ? 900 : 700 }}
                        >
                          {s.season.replace(
                            /^(\w+)\s+(\d{4})$/,
                            (_, sn, yr) => `${sn.slice(0, 3)} '${yr.slice(2)}`
                          )}
                        </text>
                        {s.ageGroup && (
                          <text
                            x={xPos(i)}
                            y={MT + innerH + 32}
                            textAnchor="middle"
                            className="text-[9px]"
                            fill="#94a3b8"
                            style={{ fontWeight: 700 }}
                          >
                            {s.ageGroup}
                          </text>
                        )}
                      </g>
                    ))}

                    {/* Connecting line */}
                    <polyline
                      fill="none"
                      stroke={primaryColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={series
                        .map((s, i) => `${xPos(i)},${yPos(s.value)}`)
                        .join(" ")}
                    />

                    {/* Data points */}
                    {series.map((s, i) => (
                      <g key={i}>
                        <circle
                          cx={xPos(i)}
                          cy={yPos(s.value)}
                          r={s.isCurrent ? 7 : 5}
                          fill={s.isCurrent ? primaryColor : "#fff"}
                          stroke={primaryColor}
                          strokeWidth="2.5"
                        />
                        <text
                          x={xPos(i)}
                          y={yPos(s.value) - 14}
                          textAnchor="middle"
                          className="text-[11px] tabular-nums"
                          fill="#0f172a"
                          style={{ fontWeight: 900 }}
                        >
                          {formatStatValue(statKey, s.value)}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>

                {/* Season-by-season breakdown table */}
                <div className="bg-surface border border-line rounded-xl overflow-hidden">
                  <div className="grid grid-cols-3 px-4 py-2 bg-app border-b border-line">
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                      Season
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                      Age
                    </div>
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 text-right">
                      {meta.label}
                    </div>
                  </div>
                  {series.map((s, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-3 px-4 py-2 ${
                        i < series.length - 1 ? "border-b border-line" : ""
                      } ${s.isCurrent ? "bg-blue-50/30" : ""}`}
                    >
                      <div className="text-xs font-black text-ink uppercase">
                        {s.season}
                        {s.isCurrent ? " ·" : ""}
                      </div>
                      <div className="text-xs font-bold text-ink-2">
                        {s.ageGroup || "—"}
                      </div>
                      <div className="text-xs font-black tabular-nums text-ink text-right">
                        {formatStatValue(statKey, s.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

/* EvalTrendModal — see ./screens/EvaluationTab.jsx */

// Compact per-stat trend grid for the PlayerProfileModal. One panel per
// tracked stat (AVG / OPS / OBP / H / RBI / HR) showing current value,
// net delta over the last ~5 import snapshots, and a tiny sparkline.
// Replaces the prior per-import row list, which surfaced every CSV upload
// and got noisy fast.
const RECENT_MOVEMENT_WINDOW = 5;
const RECENT_MOVEMENT_TRACKED = [
  { key: "avg", label: "AVG", decimals: 3 },
  { key: "ops", label: "OPS", decimals: 3 },
  { key: "obp", label: "OBP", decimals: 3 },
  { key: "h", label: "H", decimals: 0 },
  { key: "rbi", label: "RBI", decimals: 0 },
  { key: "hr", label: "HR", decimals: 0 },
];

const fmtTrendVal = (v, decimals) =>
  decimals > 0
    ? Number(v || 0).toFixed(decimals).replace(/^0\./, ".")
    : String(Math.round(Number(v) || 0));

const fmtTrendDelta = (delta, decimals) => {
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "";
  return decimals > 0
    ? `${sign}${delta.toFixed(decimals).replace(/^([-+]?)0\./, "$1.")}`
    : `${sign}${Math.round(delta)}`;
};

// Inline SVG sparkline. Uses team-primary color via currentColor on the
// stroke so it retints with the team theme.
const Sparkline = memo(({ values }) => {
  if (!values || values.length < 2) return null;
  const w = 40;
  const h = 16;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ color: "var(--team-primary)" }}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
});

const RecentMovementPanel = memo(({ player }) => {
  const history = Array.isArray(player.statsHistory) ? player.statsHistory : [];
  if (history.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
        <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2 mb-3">
          <Icons.Forward className="w-4 h-4" /> Recent Movement
        </h4>
        <p className="text-[11px] text-ink-3 font-medium italic">
          No trend data yet — upload another CSV to start tracking.
        </p>
      </div>
    );
  }
  // Series = past snapshots + live stats. Sparkline uses the last
  // WINDOW+1 values so it shows the full trajectory the delta covers.
  const liveStats = player.stats || {};
  const series = [...history.map((h) => h.stats || {}), liveStats];
  const windowed = series.slice(-Math.min(RECENT_MOVEMENT_WINDOW + 1, series.length));

  return (
    <div className="bg-surface border border-line rounded-xl p-5 shadow-sm">
      <h4 className="font-black text-[11px] uppercase tracking-widest text-ink flex items-center gap-2 mb-3">
        <Icons.Forward className="w-4 h-4" /> Recent Movement
        <span className="ml-auto text-[9px] font-bold text-ink-3 normal-case tracking-normal">
          Last {Math.min(RECENT_MOVEMENT_WINDOW, series.length - 1)} updates
        </span>
      </h4>
      <div className="grid grid-cols-2 gap-2.5">
        {RECENT_MOVEMENT_TRACKED.map(({ key, label, decimals }) => {
          const values = windowed.map((s) => Number(s?.[key]) || 0);
          const current = values[values.length - 1];
          const prior = values[0];
          const delta = current - prior;
          const deltaTone =
            delta > 0
              ? "text-emerald-700 bg-emerald-50 border-emerald-200"
              : delta < 0
              ? "text-rose-700 bg-rose-50 border-rose-200"
              : "text-ink-3 bg-app border-line";
          return (
            <div
              key={key}
              className="rounded-lg border border-line bg-app/40 px-3 py-2.5 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3">
                  {label}
                </div>
                <div className="text-base font-black tabular-nums text-ink leading-tight">
                  {fmtTrendVal(current, decimals)}
                </div>
              </div>
              <Sparkline values={values} />
              <span
                className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded border ${deltaTone}`}
                title={`Net change over the last ${values.length - 1} updates`}
              >
                {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}
                {fmtTrendDelta(delta, decimals)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

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
  } = team;
  const [activeSection, setActiveSection] = useState("general");
  const scrollContainerRef = useRef(null);

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
  const [trendStatKey, setTrendStatKey] = useState(null); // key of stat whose year-over-year chart is open
  const [addingPastSeason, setAddingPastSeason] = useState(false);
  const [editingPastSeasonId, setEditingPastSeasonId] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef(null);

  // Aggregate fielding history across FINAL games only (matches engine fairness logic).
  // Returns { byPosition: {P: 4, C: 2, ...}, bench, firstInningBench, totalDefensive,
  //           gamesPlayed, gamesAvailable }.
  const inningsBreakdown = useMemo(() => {
    const byPosition = {};
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
    const currentPlayer = (players || []).find((p) => p.id === pid) || {
      id: pid,
    };
    const livePlayerIds = new Set((players || []).map((p) => p.id));
    const matches = (slot) =>
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
      if (!isGameFinalized(g)) continue;
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
    const out = [];
    const pid = viewingPlayerId;
    if (!pid) return out;
    const currentPlayer = (players || []).find((p) => p.id === pid) || {
      id: pid,
    };
    const livePlayerIds = new Set((players || []).map((p) => p.id));
    const matches = (slot) =>
      lineupSlotMatchesPlayer(slot, currentPlayer, livePlayerIds);
    // Same predicate as the aggregation above — see isGameFinalized().
    for (const g of games || []) {
      if (!isGameFinalized(g)) continue;
      if (!g.lineup?.length) continue;
      if (g.attendance?.[pid] === false) continue;

      const positionsPlayed = {};
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

  const player = players.find((p) => p.id === viewingPlayerId);
  if (!player) return null;

  // Defense-size-aware active position list. 10-defender setups use
  // LCF + RCF (no lone CF — those two cover center together); 9-defender
  // setups use CF alone. Matches `getActivePositionList` in lineupEngine.
  const positions = getActivePositionList(defenseSize);

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
          <div className="relative shrink-0 group">
            <PlayerAvatar player={player} size={96} showNumber />
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPhotoBusy(true);
                try {
                  const url = await cropImageTo256DataURL(file);
                  updatePlayer(player.id, { photoUrl: url });
                  toast.push({
                    kind: "success",
                    title: "Photo Updated",
                    message: `${player.name}'s photo is live.`,
                  });
                } catch (err) {
                  toast.push({
                    kind: "error",
                    title: "Upload Failed",
                    message: err?.message || "Couldn't process photo.",
                  });
                } finally {
                  setPhotoBusy(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy}
              className="absolute inset-0 rounded-full bg-slate-900/0 hover:bg-slate-900/40 flex items-center justify-center text-white opacity-0 hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
              title={player.photoUrl ? "Replace photo" : "Upload photo"}
              aria-label={player.photoUrl ? "Replace player photo" : "Upload player photo"}
            >
              {photoBusy ? (
                <Icons.Refresh className="w-5 h-5 animate-spin" />
              ) : (
                <Icons.Upload className="w-5 h-5" />
              )}
            </button>
            {player.photoUrl && !photoBusy && (
              <button
                type="button"
                onClick={() => updatePlayer(player.id, { photoUrl: "" })}
                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-surface border border-line text-rose-500 hover:bg-rose-50 hover:text-rose-700 shadow-sm flex items-center justify-center"
                aria-label="Remove photo"
                title="Remove photo"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            )}
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
                  if (e.key === "Enter") e.target.blur();
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
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 bg-surface border border-line p-3 rounded-xl shadow-sm">
                  {positions.map((pos) => {
                    const list = Array.isArray(player.comfortablePositions)
                      ? player.comfortablePositions
                      : [];
                    const active = list.includes(pos);
                    const isCatcher = pos === "C";
                    return (
                      <button
                        key={pos}
                        onClick={() => {
                          const next = active
                            ? list.filter((p) => p !== pos)
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
                  </div>
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
                    onSave={(entry) => {
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
                    {(player.pastSeasons || []).map((entry) => {
                      const isEditing = editingPastSeasonId === entry.id;
                      if (isEditing) {
                        return (
                          <PastSeasonForm
                            key={entry.id}
                            initial={entry}
                            primaryColor={primaryColor}
                            tertiaryColor={tertiaryColor}
                            onCancel={() => setEditingPastSeasonId(null)}
                            onSave={(patch) => {
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
                        const positions = Object.entries(g.positions)
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
  const { team, addPlayer, updatePlayer } = useTeam();
  const { isAddingPlayer, setIsAddingPlayer } = useUI();
  const toast = useToast();
  const { primaryColor, tertiaryColor } = team;
  const [form, setForm] = useState({
    name: "",
    number: "",
    bats: "R",
    throws: "R",
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const photoInputRef = useRef(null);

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
    setPhotoFile(null);
    setPhotoPreview("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const id = addPlayer(form);
    // Fire the photo data-URL build in the background — we don't make the
    // user wait for the canvas crop on submit.
    if (photoFile && id) {
      cropImageTo256DataURL(photoFile)
        .then((url) => updatePlayer(id, { photoUrl: url }))
        .catch((err) =>
          toast.push({
            kind: "error",
            title: "Photo Save Failed",
            message:
              err?.message || "Couldn't process photo. Add it later from the profile.",
          })
        );
    }
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
              player={{ name: form.name, photoUrl: photoPreview }}
              size={64}
            />
            <div className="flex-1">
              <label className="t-eyebrow block mb-1.5">Photo (optional)</label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPhotoFile(file);
                  const reader = new FileReader();
                  reader.onload = () => setPhotoPreview(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 flex items-center gap-1.5"
              >
                <Icons.Upload className="w-3.5 h-3.5" />
                {photoFile ? "Replace Photo" : "Choose Photo"}
              </button>
            </div>
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
