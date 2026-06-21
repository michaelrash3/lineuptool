import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import { formatGameDateDisplay, isDepartedPlayer } from "../utils/helpers";
import { isoInstantToLocalTime } from "../utils/icsParse";
import { StaggerList, StaggerItem } from "../components/motion";
import { DEFAULT_DRILL_LIBRARY } from "../constants/ui";
import type { DrillCategory, DrillDefinition } from "../types";

// The drill categories a coach can tag a library drill with. Mirrors the
// DrillCategory union in types.ts; order here drives the picker grouping.
const DRILL_CATEGORIES: DrillCategory[] = [
  "Hitting",
  "Fielding",
  "Pitching",
  "Catching",
  "Baserunning",
  "Conditioning",
  "Team",
];

// A library drill fits a practice if it's tagged for that environment or both.
const fitsEnv = (d: DrillDefinition, env: string): boolean =>
  !d.environment || d.environment === "both" || d.environment === env;

const newId = (p: string) =>
  p + "-" + Math.random().toString(36).substring(2, 9);

// Attendance is tri-state: present / absent (a real miss) / excused (e.g. a
// fall conflict with football, or winter basketball/wrestling — not held
// against the player). Legacy values: true = present, false = absent.
type AttStatus = "present" | "absent" | "excused";
const statusOf = (v: any): AttStatus =>
  v === false || v === "absent"
    ? "absent"
    : v === "excused"
      ? "excused"
      : "present";
const nextStatus = (s: AttStatus): AttStatus =>
  s === "present" ? "absent" : s === "absent" ? "excused" : "present";
const STATUS_META: Record<
  AttStatus,
  { label: string; dot: string; chip: string }
> = {
  present: {
    label: "Here",
    dot: "bg-win",
    chip: "bg-win-bg text-win border-line",
  },
  absent: {
    label: "Out",
    dot: "bg-loss",
    chip: "bg-loss-bg text-loss border-line",
  },
  excused: {
    label: "Excused",
    dot: "bg-warnfg",
    chip: "bg-warn-bg text-warnfg border-line",
  },
};

// Compact attendance toggle row — tap cycles Here → Out → Excused.
const AttendanceRow = ({ player, status, onCycle }: any) => {
  const m = STATUS_META[status as AttStatus] || STATUS_META.present;
  return (
    <button
      type="button"
      onClick={onCycle}
      className="flex items-center justify-between gap-3 px-1 py-2 border-b border-line text-left w-full hover:bg-surface-2 transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${m.dot}`} />
        <span className="font-bold text-ink truncate">
          {player.number != null && player.number !== "" && (
            <span className="text-ink-3 tabular-nums mr-1.5">
              #{player.number}
            </span>
          )}
          {player.name}
        </span>
      </span>
      <span className={`t-chip px-2 py-0.5 rounded-md border ${m.chip}`}>
        {m.label}
      </span>
    </button>
  );
};

// A single practice as an open, expandable row.
const PracticeRow = memo(
  ({
    practice,
    players,
    isHead,
    drillLibrary,
    updatePractice,
    removePractice,
    savePracticeAttendance,
  }: any) => {
    const [open, setOpen] = useState(false);
    const [drillName, setDrillName] = useState("");
    const [drillMin, setDrillMin] = useState("");

    const att = practice.attendance || {};
    const presentCount = players.filter(
      (p: any) => statusOf(att[p.id]) === "present",
    ).length;
    const outCount = players.filter(
      (p: any) => statusOf(att[p.id]) === "absent",
    ).length;
    const excusedCount = players.filter(
      (p: any) => statusOf(att[p.id]) === "excused",
    ).length;
    const env = practice.environment || "outdoor";
    const drills = Array.isArray(practice.drills) ? practice.drills : [];
    // Running total so a coach can fill a time box while planning the agenda.
    const totalMinutes = drills.reduce(
      (sum: number, d: any) => sum + (Number(d.minutes) || 0),
      0,
    );
    // Library drills that suit this practice's environment, minus ones already
    // on the agenda (matched by libraryId).
    const usedLibraryIds = new Set(
      drills.map((d: any) => d.libraryId).filter(Boolean),
    );
    const planChoices = (drillLibrary as DrillDefinition[]).filter(
      (d) => fitsEnv(d, env) && !usedLibraryIds.has(d.id),
    );

    const [gy, gm, gd] = (practice.date || "").split("-");
    const moDate = gy ? new Date(Number(gy), Number(gm) - 1, Number(gd)) : null;
    const mo = moDate
      ? moDate.toLocaleDateString(undefined, { month: "short" }).toUpperCase()
      : "";
    const dnum = gd ? String(Number(gd)) : "";

    const cycleAttendance = (pid: string) => {
      savePracticeAttendance(practice.id, {
        ...att,
        [pid]: nextStatus(statusOf(att[pid])),
      });
    };
    // Free-typed drill (no library link).
    const addDrill = (name: string, minutes?: number) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updatePractice(practice.id, {
        drills: [
          ...drills,
          { id: newId("d"), name: trimmed, minutes: minutes || undefined },
        ],
      });
    };
    // Drop a library drill onto the agenda, carrying its category + link so the
    // chip can hide once used and the log keeps the skill tag.
    const addFromLibrary = (def: DrillDefinition) =>
      updatePractice(practice.id, {
        drills: [
          ...drills,
          {
            id: newId("d"),
            name: def.name,
            minutes: def.defaultMinutes || undefined,
            category: def.category,
            libraryId: def.id,
          },
        ],
      });
    const removeDrill = (id: string) =>
      updatePractice(practice.id, {
        drills: drills.filter((d: any) => d.id !== id),
      });
    // Reorder the agenda (drills is an ordered array). dir -1 = earlier.
    const moveDrill = (idx: number, dir: number) => {
      const j = idx + dir;
      if (j < 0 || j >= drills.length) return;
      const next = [...drills];
      [next[idx], next[j]] = [next[j], next[idx]];
      updatePractice(practice.id, { drills: next });
    };

    return (
      <div className="relative border-b border-line">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full py-3.5 pl-1 pr-1 flex items-center gap-4 text-left hover:bg-surface-2 transition-colors"
        >
          <div className="shrink-0 w-11 text-center rounded-md border border-line overflow-hidden">
            <div
              className="text-[8px] font-black uppercase tracking-widest py-0.5"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-tertiary)",
              }}
            >
              {mo}
            </div>
            <div className="text-xl font-black tabular-nums text-ink py-0.5 bg-surface">
              {dnum}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-black uppercase tracking-tight text-ink">
                Practice
              </h3>
              <span
                className={`t-chip px-2 py-0.5 rounded-md border border-line ${
                  env === "indoor" ? "" : "bg-surface-2 text-ink-2"
                }`}
                style={
                  env === "indoor"
                    ? {
                        backgroundColor: "var(--info-bg)",
                        color: "var(--info-fg)",
                      }
                    : undefined
                }
              >
                {env === "indoor" ? "Indoor" : "Outdoor"}
              </span>
              {practice.source === "gamechanger" && (
                <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-3">
                  GC
                </span>
              )}
            </div>
            <p className="text-[11px] font-bold text-ink-3 uppercase tracking-widest flex flex-wrap items-center gap-x-2 mt-1">
              <Icons.Clock className="w-3.5 h-3.5 shrink-0" />
              {formatGameDateDisplay(practice.date)}
              {isoInstantToLocalTime(practice.startUtc) && (
                <>
                  <span className="text-ink-3">·</span>
                  {isoInstantToLocalTime(practice.startUtc)}
                </>
              )}
              {practice.location && (
                <>
                  <span className="text-ink-3">|</span>
                  <span className="normal-case tracking-normal">
                    {String(practice.location).split("\n")[0]}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="t-stat-num-sm text-ink tabular-nums">
              {presentCount}
              <span className="text-ink-3">/{players.length}</span>
            </div>
            <div className="t-eyebrow text-ink-3">
              {outCount > 0 || excusedCount > 0
                ? `${outCount} out${excusedCount > 0 ? ` · ${excusedCount} exc` : ""}`
                : "all in"}
            </div>
          </div>
          <Icons.ChevronDown
            className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="pb-5 pl-1 pr-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Attendance */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="t-eyebrow text-ink-3">Attendance</span>
                {isHead && (
                  <div className="flex items-center gap-2">
                    <select
                      value={env}
                      onChange={(e) =>
                        updatePractice(practice.id, {
                          environment: e.target.value,
                        })
                      }
                      className="text-[10px] font-black uppercase tracking-widest bg-surface border border-line rounded-sm px-1.5 py-1 outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                      title="Environment"
                    >
                      <option value="outdoor">Outdoor</option>
                      <option value="indoor">Indoor</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removePractice(practice.id)}
                      className="t-button text-loss hover:opacity-80"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {players.length === 0 ? (
                <p className="t-body text-ink-3 italic">
                  No players on the roster yet.
                </p>
              ) : (
                <div>
                  {players.map((p: any) => (
                    <AttendanceRow
                      key={p.id}
                      player={p}
                      status={statusOf(att[p.id])}
                      onCycle={() => cycleAttendance(p.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Drill plan / log */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="t-eyebrow text-ink-3">
                  Practice Plan — drills, in order
                </span>
                {totalMinutes > 0 && (
                  <span className="t-chip px-2 py-0.5 rounded-md border border-line bg-surface-2 text-ink-2 tabular-nums">
                    {totalMinutes}m total
                  </span>
                )}
              </div>
              {drills.length > 0 ? (
                <div className="mb-2">
                  {drills.map((d: any, idx: number) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 px-1 py-1.5 border-b border-line"
                    >
                      <span className="font-bold text-ink text-sm truncate min-w-0">
                        <span className="text-ink-3 tabular-nums mr-1.5">
                          {idx + 1}.
                        </span>
                        {d.name}
                        {d.category ? (
                          <span className="t-chip ml-1.5 px-1.5 py-0.5 rounded-sm border border-line bg-surface-2 text-ink-3 align-middle">
                            {d.category}
                          </span>
                        ) : null}
                        {d.minutes ? (
                          <span className="text-ink-3 tabular-nums ml-1.5">
                            {d.minutes}m
                          </span>
                        ) : null}
                      </span>
                      {isHead && (
                        <span className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveDrill(idx, -1)}
                            disabled={idx === 0}
                            className="text-ink-3 hover:text-ink disabled:opacity-30 disabled:hover:text-ink-3"
                            aria-label="Move drill earlier"
                          >
                            <Icons.ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveDrill(idx, 1)}
                            disabled={idx === drills.length - 1}
                            className="text-ink-3 hover:text-ink disabled:opacity-30 disabled:hover:text-ink-3"
                            aria-label="Move drill later"
                          >
                            <Icons.ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDrill(d.id)}
                            className="text-ink-3 hover:text-loss ml-0.5"
                            aria-label="Remove drill"
                          >
                            <Icons.X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="t-body text-ink-3 italic mb-2">
                  No drills planned yet.
                </p>
              )}

              {isHead && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addDrill(drillName, Number(drillMin) || undefined);
                      setDrillName("");
                      setDrillMin("");
                    }}
                    className="flex items-center gap-2 mb-3"
                  >
                    <input
                      value={drillName}
                      onChange={(e) => setDrillName(e.target.value)}
                      placeholder="Add a drill…"
                      className="flex-1 min-w-0 px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3"
                    />
                    <input
                      value={drillMin}
                      onChange={(e) =>
                        setDrillMin(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      placeholder="min"
                      inputMode="numeric"
                      className="w-14 px-2 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3 tabular-nums"
                    />
                    <button
                      type="submit"
                      className="btn-premium px-3 py-2 rounded-sm shrink-0"
                      style={{ color: "var(--team-tertiary)" }}
                      aria-label="Add drill"
                    >
                      <Icons.Plus className="w-4 h-4" />
                    </button>
                  </form>

                  <span className="t-eyebrow text-ink-3 block mb-1.5">
                    From your {env === "indoor" ? "indoor" : "outdoor"} drill
                    library — tap to add
                  </span>
                  {planChoices.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {planChoices.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => addFromLibrary(d)}
                          title={
                            d.equipment
                              ? `Equipment: ${d.equipment}`
                              : undefined
                          }
                          className="t-chip px-2.5 py-1 rounded-sm border border-line transition-colors bg-surface text-ink-2 hover:text-ink hover:border-ink-3"
                        >
                          {"+ "}
                          {d.name}
                          {d.defaultMinutes ? (
                            <span className="text-ink-3 tabular-nums ml-1">
                              {d.defaultMinutes}m
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="t-body text-ink-3 italic">
                      Every {env} library drill is already on the plan. Add more
                      in the Drill Library above.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

const AddPracticeForm = ({ onAdd, onClose }: any) => {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [environment, setEnvironment] = useState("outdoor");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    // Combine date + optional local time into an ISO instant for startUtc.
    let startUtc: string | null = null;
    if (time) {
      const dt = new Date(`${date}T${time}`);
      if (!Number.isNaN(dt.getTime())) startUtc = dt.toISOString();
    }
    onAdd({ date, startUtc, location, environment });
    onClose();
  };

  return (
    <form
      onSubmit={submit}
      className="border-b border-line pb-6 mb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
    >
      <label className="block">
        <span className="t-eyebrow text-ink-3 block mb-1">Date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
      </label>
      <label className="block">
        <span className="t-eyebrow text-ink-3 block mb-1">Time (optional)</span>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
      </label>
      <label className="block">
        <span className="t-eyebrow text-ink-3 block mb-1">Location</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Field / gym"
          className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3"
        />
      </label>
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="t-eyebrow text-ink-3 block mb-1">Where</span>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
          >
            <option value="outdoor">Outdoor</option>
            <option value="indoor">Indoor</option>
          </select>
        </label>
        <button
          type="submit"
          className="btn-premium px-4 py-2 rounded-sm font-black uppercase tracking-widest text-xs shrink-0"
          style={{ color: "var(--team-tertiary)" }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-sm border border-line text-ink-2 hover:text-ink text-xs font-black uppercase tracking-widest shrink-0"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

// Collapsible manager for the reusable team drill library. Head coach builds
// the menu here once; every practice's planner picks from it.
const DrillLibraryManager = ({ library, onAdd, onRemove }: any) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DrillCategory>("Hitting");
  const [minutes, setMinutes] = useState("");
  const [environment, setEnvironment] = useState<"both" | "indoor" | "outdoor">(
    "both",
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      category,
      defaultMinutes: Number(minutes) || undefined,
      environment,
    });
    setName("");
    setMinutes("");
  };

  return (
    <div className="pb-5 border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="t-eyebrow text-ink-3">
          Drill Library · {library.length}
        </span>
        <Icons.ChevronDown
          className={`w-4 h-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {library.map((d: DrillDefinition) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-line bg-surface-2"
              >
                <span className="font-bold text-ink text-sm">{d.name}</span>
                <span className="t-chip px-1.5 py-0.5 rounded-sm border border-line bg-surface text-ink-3">
                  {d.category}
                </span>
                {d.defaultMinutes ? (
                  <span className="text-ink-3 text-xs tabular-nums">
                    {d.defaultMinutes}m
                  </span>
                ) : null}
                {d.environment && d.environment !== "both" ? (
                  <span className="text-ink-3 text-[10px] uppercase tracking-widest">
                    {d.environment}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemove(d.id)}
                  className="text-ink-3 hover:text-loss"
                  aria-label={`Remove ${d.name} from library`}
                >
                  <Icons.X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>

          <form
            onSubmit={submit}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end"
          >
            <label className="block lg:col-span-2">
              <span className="t-eyebrow text-ink-3 block mb-1">New drill</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Drill name…"
                className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3"
              />
            </label>
            <label className="block">
              <span className="t-eyebrow text-ink-3 block mb-1">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DrillCategory)}
                className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
              >
                {DRILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className="block w-16">
                <span className="t-eyebrow text-ink-3 block mb-1">Min</span>
                <input
                  value={minutes}
                  onChange={(e) =>
                    setMinutes(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  inputMode="numeric"
                  placeholder="min"
                  className="w-full px-2 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3 tabular-nums"
                />
              </label>
              <label className="block flex-1">
                <span className="t-eyebrow text-ink-3 block mb-1">Where</span>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as any)}
                  className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                >
                  <option value="both">Both</option>
                  <option value="outdoor">Outdoor</option>
                  <option value="indoor">Indoor</option>
                </select>
              </label>
              <button
                type="submit"
                className="btn-premium px-3 py-2 rounded-sm shrink-0"
                style={{ color: "var(--team-tertiary)" }}
                aria-label="Add drill to library"
              >
                <Icons.Plus className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const PracticesTab = memo(() => {
  const {
    team,
    currentRole,
    addPractice,
    updatePractice,
    removePractice,
    savePracticeAttendance,
    addDrillToLibrary,
    removeDrillFromLibrary,
  } = useTeam() as any;
  const isHead = currentRole !== "assistant";
  const [adding, setAdding] = useState(false);

  // Older teams have no stored drillLibrary; show the seed so the planner is
  // never empty. (The CRUD hook persists the seed + edits on first change.)
  const drillLibrary = useMemo(() => {
    const lib = team.drillLibrary;
    return Array.isArray(lib) && lib.length > 0 ? lib : DEFAULT_DRILL_LIBRARY;
  }, [team.drillLibrary]);

  const players = useMemo(
    () =>
      (team.players || []).filter(
        (p: any) => p && p.inactive !== true && !isDepartedPlayer(p),
      ),
    [team.players],
  );

  const practices = useMemo(
    () =>
      [...(team.practices || [])].sort((a: any, b: any) =>
        String(b.date).localeCompare(String(a.date)),
      ),
    [team.practices],
  );

  // Season miss-tracker: across practices where attendance was actually taken,
  // who has missed the most. Only explicit "out" marks count — present (the
  // default) and excused absences do not.
  const missLeaders = useMemo(() => {
    const taken = practices.filter(
      (p: any) =>
        p.status !== "cancelled" &&
        p.attendance &&
        Object.keys(p.attendance).length > 0,
    );
    if (taken.length === 0) return { total: 0, rows: [] as any[] };
    const rows = players
      .map((p: any) => {
        const missed = taken.filter(
          (pr: any) => statusOf(pr.attendance[p.id]) === "absent",
        ).length;
        return { player: p, missed, attended: taken.length - missed };
      })
      .filter((r: any) => r.missed > 0)
      .sort((a: any, b: any) => b.missed - a.missed);
    return { total: taken.length, rows };
  }, [practices, players]);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="block h-4 w-1 rounded-sm"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <h2 className="t-h2">Practices</h2>
          {missLeaders.total > 0 && (
            <span className="t-eyebrow text-ink-3">
              · {missLeaders.total} with attendance
            </span>
          )}
        </div>
        {isHead && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-premium self-start sm:self-auto px-4 py-2.5 rounded-sm font-black uppercase tracking-widest text-xs flex items-center gap-2"
            style={{ color: "var(--team-tertiary)" }}
          >
            <Icons.Plus className="w-4 h-4" /> Add Practice
          </button>
        )}
      </div>

      {adding && isHead && (
        <AddPracticeForm onAdd={addPractice} onClose={() => setAdding(false)} />
      )}

      {/* Season miss-tracker */}
      {missLeaders.rows.length > 0 && (
        <div className="pb-5 border-b border-line">
          <span className="t-eyebrow text-ink-3 block mb-2">
            Most practices missed
          </span>
          <div className="flex flex-wrap gap-2">
            {missLeaders.rows.slice(0, 8).map((r: any) => (
              <span
                key={r.player.id}
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm border border-line bg-surface-2"
              >
                <span className="font-bold text-ink text-sm">
                  {r.player.name}
                </span>
                <span className="t-chip px-1.5 py-0.5 rounded-sm bg-loss-bg text-loss border border-line tabular-nums">
                  {r.missed} missed
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reusable drill library — head builds the menu the planner picks from */}
      {isHead && (
        <DrillLibraryManager
          library={drillLibrary}
          onAdd={addDrillToLibrary}
          onRemove={removeDrillFromLibrary}
        />
      )}

      {practices.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl leading-none mb-4 opacity-80" aria-hidden>
            ⚾
          </div>
          <h3 className="font-black uppercase tracking-widest text-ink-3 text-lg mb-2">
            No Practices Yet
          </h3>
          <p className="text-ink-3 text-sm font-semibold max-w-sm mx-auto">
            Add a practice manually, or import your schedule from GameChanger in
            Settings — practices come in alongside games.
          </p>
        </div>
      ) : (
        <StaggerList className="flex flex-col">
          {practices.map((p: any) => (
            <StaggerItem key={p.id}>
              <PracticeRow
                practice={p}
                players={players}
                isHead={isHead}
                drillLibrary={drillLibrary}
                updatePractice={updatePractice}
                removePractice={removePractice}
                savePracticeAttendance={savePracticeAttendance}
              />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
});
