import React, { memo, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "../icons";
import { useTeam } from "../contexts";
import {
  formatGameDateDisplay,
  isDepartedPlayer,
  dateToIsoLocal,
  genId,
} from "../utils/helpers";
import { isoInstantToLocalTime } from "../utils/icsParse";
import { StaggerList, StaggerItem } from "../components/motion";
import { EmptyState } from "../components/shared";
import { DEFAULT_DRILL_LIBRARY, EVAL_CATEGORIES } from "../constants/ui";
import { featureEnabled } from "../constants/features";
import { drillAssignmentIndex } from "../utils/developmentPlan";
import type { DrillCategory, DrillDefinition, EvalCategoryId } from "../types";

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

const newId = (p: string) => genId(p);

// Attendance is tri-state: present / absent (a real miss) / excused (e.g. a
// fall conflict with football, or winter basketball/wrestling — not held
// against the player). Legacy values: true = present, false = absent.
type AttStatus = "present" | "absent" | "excused";
export const statusOf = (v: any): AttStatus =>
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

// A single practice as an open, expandable row. The Smart Planner lives at
// /practices/:practiceId/plan (see screens/practices/PracticePlanPage).
const PracticeRow = memo(
  ({
    practice,
    players,
    isHead,
    drillLibrary,
    targetsByDrill,
    updatePractice,
    removePractice,
    savePracticeAttendance,
  }: any) => {
    const navigate = useNavigate();
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
                color: "var(--team-on-primary)",
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
                        {d.libraryId &&
                        targetsByDrill?.[d.libraryId]?.length ? (
                          <span
                            className="block text-[10px] font-bold text-ink-3 normal-case tracking-normal truncate"
                            title="Players whose development plan assigns this drill"
                          >
                            Targets: {targetsByDrill[d.libraryId].join(", ")}
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
                  <button
                    type="button"
                    onClick={() => navigate(`/practices/${practice.id}/plan`)}
                    className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-black uppercase tracking-widest rounded-sm border border-line bg-surface text-ink-2 hover:text-ink hover:border-ink-3 transition-colors"
                  >
                    <Icons.Sparkles className="w-4 h-4" /> Build a plan
                  </button>
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
                      style={{ color: "var(--team-on-primary)" }}
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
          style={{ color: "var(--team-on-primary)" }}
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
// Eval categories a drill can be tagged with — real 1–5 graded skills only
// (zero-weight radar readings aren't trainable targets in this sense).
const DRILL_EVAL_TARGETS = EVAL_CATEGORIES.filter((c) => c.weight > 0);

const DrillLibraryManager = ({ library, onAdd, onRemove }: any) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<DrillCategory>("Hitting");
  const [minutes, setMinutes] = useState("");
  const [environment, setEnvironment] = useState<"both" | "indoor" | "outdoor">(
    "both",
  );
  const [description, setDescription] = useState("");
  const [evalCategory, setEvalCategory] = useState<EvalCategoryId | "">("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      category,
      defaultMinutes: Number(minutes) || undefined,
      environment,
      description: description.trim() || undefined,
      evalCategory: evalCategory || undefined,
    });
    setName("");
    setMinutes("");
    setDescription("");
    setEvalCategory("");
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
          <div className="flex flex-col gap-2 mb-3">
            {library.map((d: DrillDefinition) => (
              <div
                key={d.id}
                className="rounded-sm border border-line bg-surface-2 p-2.5"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
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
                  {d.evalCategory ? (
                    <span
                      className="t-chip px-1.5 py-0.5 rounded-sm border border-line text-ink-2"
                      style={{ backgroundColor: "var(--team-primary-15)" }}
                      title="Suggested for players whose plan targets this eval category"
                    >
                      →{" "}
                      {EVAL_CATEGORIES.find((c) => c.id === d.evalCategory)
                        ?.label || d.evalCategory}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemove(d.id)}
                    className="ml-auto shrink-0 text-ink-3 hover:text-loss"
                    aria-label={`Remove ${d.name} from library`}
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {d.description ? (
                  <p className="t-meta text-ink-3 mt-1 leading-snug">
                    {d.description}
                  </p>
                ) : null}
              </div>
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
                style={{ color: "var(--team-on-primary)" }}
                aria-label="Add drill to library"
              >
                <Icons.Plus className="w-4 h-4" />
              </button>
            </div>
            <label className="block sm:col-span-2 lg:col-span-2">
              <span className="t-eyebrow text-ink-3 block mb-1">
                Targets eval category (optional)
              </span>
              <select
                value={evalCategory}
                onChange={(e) =>
                  setEvalCategory(e.target.value as EvalCategoryId | "")
                }
                className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
              >
                <option value="">None</option>
                {DRILL_EVAL_TARGETS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2 lg:col-span-2">
              <span className="t-eyebrow text-ink-3 block mb-1">
                What it is (optional)
              </span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One line on what the drill is and why you run it…"
                className="w-full px-2.5 py-2 text-sm bg-surface border border-line rounded-sm outline-none focus:ring-2 focus:ring-[var(--team-primary)] placeholder:text-ink-3"
              />
            </label>
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
  const navigate = useNavigate();
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

  // drill library id → assigned player names, for the agenda's "Targets: …"
  // annotations. Null when the Development module is off (annotation hidden).
  const devEnabled = featureEnabled(team, "development");
  const targetsByDrill = useMemo(
    () => (devEnabled ? drillAssignmentIndex(players) : null),
    [devEnabled, players],
  );

  // Upcoming first: the next/soonest practice on top, ascending by date; once a
  // practice's date passes it drops below the upcoming set (past group ordered
  // most-recent-first). Mirrors the Schedule tab's "working set on top" grouping.
  const practices = useMemo(() => {
    const today = dateToIsoLocal(new Date());
    const isPast = (p: any) => String(p.date || "") < today;
    return [...(team.practices || [])].sort((a: any, b: any) => {
      const ap = isPast(a) ? 1 : 0;
      const bp = isPast(b) ? 1 : 0;
      if (ap !== bp) return ap - bp; // upcoming/today before past
      return ap === 1
        ? String(b.date).localeCompare(String(a.date)) // past: newest first
        : String(a.date).localeCompare(String(b.date)); // upcoming: soonest first
    });
  }, [team.practices]);

  // The season attendance report lives at /practices/attendance-report
  // (see screens/practices/PracticeAttendanceReportPage).

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="block h-4 w-1 rounded-sm"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <h1 className="t-h2">Practices</h1>
        </div>
        {isHead && !adding && (
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => navigate("/practices/attendance-report")}
              className="self-start sm:self-auto py-2.5 px-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-sm whitespace-nowrap bg-surface border border-line-strong text-ink hover:bg-surface-2"
            >
              <Icons.Clipboard className="w-4 h-4" /> Attendance Report
            </button>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-premium self-start sm:self-auto px-4 py-2.5 rounded-sm font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2"
              style={{ color: "var(--team-on-primary)" }}
            >
              <Icons.Plus className="w-4 h-4" /> Add Practice
            </button>
          </div>
        )}
      </div>

      {adding && isHead && (
        <AddPracticeForm onAdd={addPractice} onClose={() => setAdding(false)} />
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
        <EmptyState
          glyph="📋"
          title="No Practices Yet"
          body="Add a practice manually, or import your schedule from GameChanger in Settings — practices come in alongside games."
          {...(isHead
            ? { action: "Add Practice", onAction: () => setAdding(true) }
            : {})}
        />
      ) : (
        <StaggerList className="flex flex-col">
          {practices.map((p: any) => (
            <StaggerItem key={p.id}>
              <PracticeRow
                practice={p}
                players={players}
                isHead={isHead}
                drillLibrary={drillLibrary}
                targetsByDrill={targetsByDrill}
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
