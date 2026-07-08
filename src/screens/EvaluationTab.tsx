import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icons } from "../icons";
import {
  calculateBaseballAge,
  evalStatHint,
  evalRoundRecency,
  isDepartedPlayer,
} from "../utils/helpers";
import {
  EVAL_CATEGORIES,
  EVAL_GROUPS_UNIVERSAL,
  EVAL_GROUPS_KID_PITCH_ADDONS,
  getEvalCategoriesForTeam,
  getEvalCategoriesForPlayer,
  playerIsPitcher,
  playerIsCatcher,
  pitcherRosterPremium,
  leftHandedPitcherRosterPremium,
  isKidPitchFormat,
  EVAL_SCALE_LABELS,
  EVAL_SCALE_MAX,
  EVAL_SCALE_DEFAULT,
  velocityGradeFromMph,
} from "../constants/ui";
import {
  calculateTotalScore,
  calcPitcherScore,
  calcCatcherScore,
  TOTAL_SCORE_MAX,
  PITCHER_EVAL_MAX,
  CATCHER_EVAL_MAX,
  PITCHER_SCORE_WEIGHTS,
  getCombinedGrades,
  suggestPrimaryPosition,
} from "../lineupEngine";
import { useTeam, useUI, useToast } from "../contexts";
import {
  currentEvaluationScore100,
  playerTopMph,
} from "../utils/evaluationScore";
import { A11yDialog, EmptyState } from "../components/shared";
import { evalRoundCsv, evalRoundCsvFilename } from "../utils/evalExport";
import { downloadEvalRoundPdf } from "../evaluation/evalRoundPdf";
import { EvalTrendModal } from "./evaluation/EvalTrendModal";
import { RosterDecisionsPanel } from "./evaluation/RosterDecisionsPanel";
import {
  AssistantSubmissionsPanel,
  GradeChipRow,
  InsightsPanel,
  PlayerAssistantEvals,
  RoundComparisonView,
} from "./evaluation/panels";
import { evalPromptStatus } from "../utils/helpers";
import type {
  Player,
  PlayerStats,
  GradeMap,
  EvaluationEvent,
  EvalCategoryId,
} from "../types";
import type { EvalCategory, EvalGroup } from "../constants/ui";
import type { PrimarySuggestion } from "../lineupEngine";
import {
  asGradeMap,
  avgUniversal,
  computeFlags,
  DEFAULT_GRADES,
  fmtDelta,
  formatRoundName,
  pitcherPremium,
  PITCH_WEIGHT_SUM,
  sanitizeGrades,
  SUGGESTED_POSITIONS,
  type DecisionBucket,
  type DecisionRow,
  type EvalGradeRecord,
  type EvalRound,
} from "../utils/evalScoring";

// The grade-record + scoring helpers (EvalGradeRecord, EvalRound,
// DecisionRow, pitcherPremium, sanitizeGrades, formatRoundName, …) were
// extracted to src/utils/evalScoring.ts and are imported above.

// RosterDecisionsPanel was extracted to ./evaluation/RosterDecisionsPanel
// (docs/EVALUATIONS-AUDIT.md finding 3.4). Re-exported for backward compat.
export { RosterDecisionsPanel } from "./evaluation/RosterDecisionsPanel";
// The eval sub-panels (InsightsPanel, RoundComparisonView,
// AssistantSubmissionsPanel, PlayerAssistantEvals, GradeChipRow) were
// extracted to ./evaluation/panels. Re-exported for backward compat.
export {
  InsightsPanel,
  RoundComparisonView,
  AssistantSubmissionsPanel,
  PlayerAssistantEvals,
  GradeChipRow,
} from "./evaluation/panels";
export const EvaluationTab = memo(() => {
  const { team, user, saveTeamEvaluation, deleteEvaluation, currentRole } =
    useTeam();
  const toast = useToast();
  const isAssistant = currentRole === "assistant";
  const {
    teamEvalGrades,
    setTeamEvalGrades,
    selectedRoundId,
    setSelectedRoundId,
    evalTrendPlayerId,
    setEvalTrendPlayerId,
  } = useUI();
  const {
    players: rawPlayers,
    primaryColor,
    evaluationEvents,
    pitchingFormat,
    teamAge,
  } = team;
  // Sort eval cards by jersey number so the head can scan in the same
  // order coaches call kids on the field. Numeric sort; unnumbered
  // players sink to the bottom with name as the tie-break.
  const players = useMemo<Player[]>(() => {
    // Departed players are excluded everywhere but the Roster tab.
    return ((rawPlayers || []) as Player[])
      .filter((p) => !isDepartedPlayer(p))
      .slice()
      .sort((a, b) => {
        const na = parseInt(String(a.number ?? ""), 10);
        const nb = parseInt(String(b.number ?? ""), 10);
        const aValid = Number.isFinite(na);
        const bValid = Number.isFinite(nb);
        if (aValid && bValid) {
          if (na !== nb) return na - nb;
        } else if (aValid) return -1;
        else if (bValid) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [rawPlayers]);

  // Eval cadence: "Start new Eval" is gated until a preseason / biweekly
  // window opens for this head coach. Past rounds stay viewable + editable.
  const promptStatus = useMemo(
    () => evalPromptStatus(team, user?.uid, "Head"),
    [team, user],
  );

  const [saveState, setSaveState] = useState("idle");
  const [activeGroup, setActiveGroup] = useState("Hitting");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  // Two-tap confirm for the head's own round delete — arms the trash
  // button on first tap, commits on second. Replaces window.confirm.
  const [pendingRoundDelete, setPendingRoundDelete] = useState(false);
  // Two-tap confirm for overwriting an existing round — first tap names the
  // round being written, second tap commits. Creating a new round skips this.
  const [pendingUpdateConfirm, setPendingUpdateConfirm] = useState(false);
  // Manage Rounds modal: lists every saved round so the head can switch
  // or delete any of them without first selecting from the dropdown.
  // `pendingModalDeleteId` is the per-row armed-state id for the
  // modal's two-tap confirm.
  const [manageOpen, setManageOpen] = useState(false);
  const [pendingModalDeleteId, setPendingModalDeleteId] = useState<
    string | null
  >(null);
  // Player cards are collapsed by default — the eval grid was too tall
  // to scan a 12-kid roster without scrolling for days. Each card now
  // shows a single header row (name + jersey + total + chevron); tap
  // to expand the grading UI. Multi-expand allowed so coaches can
  // compare two kids side-by-side mid-grading.
  const [expandedPlayerIds, setExpandedPlayerIds] = useState(
    () => new Set<string>(),
  );
  const togglePlayerExpanded = useCallback((playerId: string) => {
    setExpandedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);
  const lastSavedRef = useRef("");

  const activeCategories = useMemo(
    () => getEvalCategoriesForTeam(pitchingFormat),
    [pitchingFormat],
  );
  const includeKidPitchAddons = useMemo(
    () => isKidPitchFormat(pitchingFormat),
    [pitchingFormat],
  );
  const visibleGroups = useMemo(() => {
    const base = [...EVAL_GROUPS_UNIVERSAL];
    if (includeKidPitchAddons) base.push(...EVAL_GROUPS_KID_PITCH_ADDONS);
    return base;
  }, [includeKidPitchAddons]);
  // If a group disappears (e.g. user changed pitchingFormat away from Kid Pitch
  // while viewing the Pitching tab), bounce back to Hitting.
  useEffect(() => {
    if (!visibleGroups.includes(activeGroup as EvalGroup))
      setActiveGroup("Hitting");
  }, [visibleGroups, activeGroup]);

  // Clear any armed-for-delete state when the user switches rounds —
  // otherwise the trash button stays "primed" for a different target
  // than what they're now viewing.
  useEffect(() => {
    setPendingRoundDelete(false);
  }, [selectedRoundId]);

  // Eval rounds belonging to this head coach, newest first (createdAt breaks
  // same-date ties so the genuinely newest round leads).
  const myRounds = useMemo(() => {
    return ((evaluationEvents || []) as EvalRound[])
      .filter(
        (e: EvalRound) =>
          !e.tryoutSignupId &&
          !e.tryoutSessionId &&
          e.coachRole === "Head" &&
          (!user || e.evaluatorId === user.uid),
      )
      .sort(evalRoundRecency);
  }, [evaluationEvents, user]);

  // Each assistant's most-recent submission (newest first), surfaced inline
  // under every player so the head sees their grades + all assistant grades
  // together. Same selection rule getCombinedGrades uses: latest per evaluator.
  const assistantRounds = useMemo(() => {
    const m = new Map<string, EvalRound>();
    for (const e of (evaluationEvents || []) as EvalRound[]) {
      if (
        e.tryoutSignupId ||
        e.tryoutSessionId ||
        e.coachRole !== "Assistant" ||
        !e.evaluatorId
      )
        continue;
      const cur = m.get(e.evaluatorId);
      if (!cur || evalRoundRecency(e, cur) < 0) m.set(e.evaluatorId, e);
    }
    return [...m.values()].sort(evalRoundRecency);
  }, [evaluationEvents]);

  // What Save actually does is driven purely by whether a saved round is
  // selected — NOT by the cadence window:
  //   • no round selected  → CREATE a brand-new round (pre-filled from the
  //                           latest as a baseline)
  //   • a round selected   → UPDATE (overwrite) that exact round
  // The old flow hid this: outside a cadence window it showed "Update Eval"
  // while a save with no round selected silently created a *new* round. We make
  // the split explicit instead. promptStatus only gates WHEN a new round is
  // offered, not what the button does.
  const isCreatingNew = !selectedRoundId;
  const activeRound = selectedRoundId
    ? myRounds.find((r: EvalRound) => r.id === selectedRoundId)
    : null;
  const activeRoundName = activeRound ? formatRoundName(activeRound) : "";

  // Export the selected saved round as a CSV grade grid (audit §4). The
  // detached-anchor download is short-circuited under jsdom (see setupTests),
  // so it's inert in tests; the CSV itself is built by the unit-tested
  // evalRoundCsv.
  const handleExportCsv = useCallback(() => {
    if (!activeRound) return;
    const csv = evalRoundCsv(activeRound, players, activeCategories);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = evalRoundCsvFilename(activeRound, team?.name);
    a.click();
    URL.revokeObjectURL(url);
  }, [activeRound, players, activeCategories, team?.name]);

  // Export the selected round as a formatted PDF grade grid (audit §4) — the
  // handout companion to the CSV. jspdf loads lazily inside downloadEvalRoundPdf
  // and the detached-anchor download is short-circuited under jsdom, so this is
  // inert in tests; the grid shape is built by the unit-tested buildEvalGradeGrid.
  const handleExportPdf = useCallback(() => {
    if (!activeRound) return;
    void downloadEvalRoundPdf({
      team,
      round: activeRound,
      roundName: activeRoundName,
      players,
      categories: activeCategories,
      toast,
    });
  }, [activeRound, activeRoundName, players, activeCategories, team, toast]);

  // The coach can explicitly start a new round at ANY time (the cadence prompt
  // is a nudge, never a gate). This flag records that explicit choice so the
  // auto-select below doesn't immediately snap back to the latest round.
  const [explicitNew, setExplicitNew] = useState(false);
  const startNewRound = useCallback(() => {
    setExplicitNew(true);
    setSelectedRoundId(null);
  }, [setSelectedRoundId]);

  // Outside a new-eval window, default to the most recent round so the screen
  // is squarely *editing* it (Save = Update, matching the "Editing …" label) —
  // unless the coach explicitly chose "Start a new Eval". Inside a window,
  // leaving it unselected means "new round".
  useEffect(() => {
    if (
      !explicitNew &&
      !promptStatus.active &&
      !selectedRoundId &&
      myRounds.length > 0
    ) {
      setSelectedRoundId(myRounds[0].id);
    }
  }, [
    explicitNew,
    promptStatus.active,
    selectedRoundId,
    myRounds,
    setSelectedRoundId,
  ]);

  // Track unsaved changes against the last persisted snapshot so the
  // header can show a single, honest "Unsaved changes" indicator until
  // the coach clicks Save. The localStorage draft + auto-restore that
  // used to live here was removed — it made it look like grades were
  // saving on their own, when in fact nothing committed until Save.
  // For both new rounds and existing-round edits the rule is the same:
  // typing flips state to "dirty"; Save flips it to "saved".
  useEffect(() => {
    const snapshot = JSON.stringify(teamEvalGrades);
    if (snapshot === lastSavedRef.current) return;
    if (lastSavedRef.current === "") {
      // First snapshot after mounting / switching rounds — initialize
      // the baseline without flagging dirty.
      lastSavedRef.current = snapshot;
      return;
    }
    setSaveState("dirty");
  }, [teamEvalGrades]);

  // Warn the coach before they close / navigate away with unsaved
  // grades. Modern browsers ignore the custom string but render their
  // own "Leave site?" prompt as long as the handler calls
  // preventDefault + sets returnValue.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  // Reset save baseline + any armed overwrite confirm when switching rounds.
  useEffect(() => {
    lastSavedRef.current = "";
    setSaveState("idle");
    setPendingUpdateConfirm(false);
  }, [selectedRoundId]);

  const doSave = useCallback(() => {
    const savedRoundId = saveTeamEvaluation();
    // After creating a new round, lock onto it so the next save updates it.
    if (isCreatingNew && savedRoundId) {
      setSelectedRoundId(savedRoundId);
    }
    setExplicitNew(false);
    lastSavedRef.current = JSON.stringify(teamEvalGrades);
    setSaveState("saved");
    setPendingUpdateConfirm(false);
  }, [saveTeamEvaluation, isCreatingNew, setSelectedRoundId, teamEvalGrades]);

  const handleSaveClick = useCallback(() => {
    // Creating a new round is low-risk — save straight through. Overwriting a
    // saved round is a two-tap confirm so it's unmistakable which round (file)
    // is being written.
    if (isCreatingNew) {
      doSave();
      return;
    }
    if (pendingUpdateConfirm) {
      doSave();
      return;
    }
    setPendingUpdateConfirm(true);
  }, [isCreatingNew, pendingUpdateConfirm, doSave]);

  const setGrade = useCallback(
    (playerId: string, categoryId: string, value: number | null) => {
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...(teamEvalGrades[playerId] || {}),
          [categoryId]: value,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades],
  );

  const setNotes = useCallback(
    (playerId: string, notesValue: string) => {
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...(teamEvalGrades[playerId] || {}),
          notes: notesValue,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades],
  );

  const toggleSuggestedPosition = useCallback(
    (playerId: string, pos: string) => {
      const cur: EvalGradeRecord = teamEvalGrades[playerId] || {};
      const list: string[] = Array.isArray(cur.suggestedPositions)
        ? cur.suggestedPositions
        : [];
      const next = list.includes(pos)
        ? list.filter((p: string) => p !== pos)
        : [...list, pos];
      setTeamEvalGrades({
        ...teamEvalGrades,
        [playerId]: {
          ...DEFAULT_GRADES,
          ...cur,
          suggestedPositions: next,
        },
      });
    },
    [teamEvalGrades, setTeamEvalGrades],
  );

  const applyAllAverage = useCallback(() => {
    const next: Record<string, EvalGradeRecord> = {};
    players.forEach((p: Player) => {
      next[p.id] = {
        ...DEFAULT_GRADES,
        notes: teamEvalGrades[p.id]?.notes || "",
      };
    });
    setTeamEvalGrades(next);
  }, [players, teamEvalGrades, setTeamEvalGrades]);

  const copyFromLastRound = useCallback(() => {
    const last = myRounds[0];
    if (!last) return;
    const next: Record<string, EvalGradeRecord> = {};
    players.forEach((p: Player) => {
      next[p.id] = sanitizeGrades({
        ...DEFAULT_GRADES,
        ...(last.grades?.[p.id] || {}),
        notes: teamEvalGrades[p.id]?.notes || "",
      });
    });
    setTeamEvalGrades(next);
  }, [myRounds, players, teamEvalGrades, setTeamEvalGrades]);

  const hasLastRound = myRounds.length > 0;

  const rankingRows = useMemo(() => {
    const combinedGrades = getCombinedGrades(
      evaluationEvents || [],
      players || [],
      {
        teamAge,
      },
    );
    return players
      .map((player: Player) => {
        const savedGrades: EvalGradeRecord = {
          ...(combinedGrades[player.id] || {}),
          ...(teamEvalGrades[player.id] || {}),
        };
        const grades: EvalGradeRecord = { ...DEFAULT_GRADES, ...savedGrades };
        const totalScore = Math.min(
          100,
          currentEvaluationScore100(asGradeMap(grades), player, teamAge) ?? 0,
        );
        const primarySuggestion = suggestPrimaryPosition(
          player,
          asGradeMap(grades),
          {
            kidPitch: isKidPitchFormat(pitchingFormat),
            teamAge,
          },
        );
        return { player, totalScore, primarySuggestion };
      })
      .sort((a, b) =>
        b.totalScore !== a.totalScore
          ? b.totalScore - a.totalScore
          : String(a.player.name || "").localeCompare(
              String(b.player.name || ""),
            ),
      )
      .map((row, idx: number) => ({ ...row, rank: idx + 1 }));
  }, [evaluationEvents, players, pitchingFormat, teamAge, teamEvalGrades]);

  type RankingRow = (typeof rankingRows)[number];

  const rankByPlayerId = useMemo(() => {
    return new Map<string, RankingRow>(
      rankingRows.map((row) => [row.player.id, row]),
    );
  }, [rankingRows]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="px-1 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-line">
          <div className="flex items-center gap-4">
            <div
              className="p-2.5 rounded-full"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: "var(--team-ink)" }}
              />
            </div>
            <div>
              <h2 className="t-h2 flex items-center gap-3">
                Player Evaluation
              </h2>
              <p className="t-eyebrow mt-1">Head Coach Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
            <span
              className="t-eyebrow flex items-center gap-1.5"
              aria-live="polite"
            >
              {saveState === "dirty" && (
                <>
                  <Icons.Alert className="w-3 h-3 text-warnfg" />
                  Unsaved changes
                </>
              )}
              {!isCreatingNew && saveState === "saved" && (
                <>
                  <Icons.Check className="w-3 h-3 text-win" />
                  Saved
                </>
              )}
            </span>
            {activeRound && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="t-button px-4 py-3 rounded-xl border border-line bg-surface text-ink hover:bg-surface-2 flex items-center justify-center gap-2"
                title={`Download “${activeRoundName}” as a CSV grade grid`}
              >
                <Icons.FileText className="w-4 h-4" />
                Export CSV
              </button>
            )}
            {activeRound && (
              <button
                type="button"
                onClick={handleExportPdf}
                className="t-button px-4 py-3 rounded-xl border border-line bg-surface text-ink hover:bg-surface-2 flex items-center justify-center gap-2"
                title={`Download “${activeRoundName}” as a printable PDF grade grid`}
              >
                <Icons.Download className="w-4 h-4" />
                Export PDF
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveClick}
              onBlur={() => setPendingUpdateConfirm(false)}
              className={`btn-premium flex-1 sm:flex-none t-button px-6 py-3 rounded-xl flex items-center justify-center gap-2 ${
                pendingUpdateConfirm ? "ring-2 ring-[var(--warn-fg)]" : ""
              }`}
              style={{
                color: "var(--team-on-primary)",
              }}
              title={
                isCreatingNew
                  ? "Save a brand-new eval round"
                  : pendingUpdateConfirm
                    ? `Tap again to overwrite the saved round "${activeRoundName}"`
                    : `Overwrite the saved round "${activeRoundName}"`
              }
            >
              <Icons.Save className="w-4 h-4" />
              {isCreatingNew
                ? "Save as New Round"
                : pendingUpdateConfirm
                  ? `Overwrite “${activeRoundName}”?`
                  : "Update This Round"}
            </button>
          </div>
        </div>

        {/* Desktop control-panel: 3-column workspace.
            Left rail (col-span-3): round/player selector + save explanation.
            Middle (col-span-6): insights, assistant submissions, quick-set, grading cards.
            Right rail (col-span-3): live Complete Ranking.
            Section order is unchanged, so on mobile/tablet the columns stack in
            the exact same order as before — only lg:+ gets the grid. */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
          {/* Left rail: round/player selector controls */}
          <div className="lg:col-span-3 space-y-4">
            {/* Round selection bar */}
            <div className="px-1 py-3 border-b border-line flex flex-col sm:flex-row lg:flex-col lg:items-stretch gap-3 sm:items-center">
              <label className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-2 shrink-0">
                  Eval:
                </span>
                <select
                  value={selectedRoundId || "__new"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new") {
                      startNewRound();
                    } else {
                      setExplicitNew(false);
                      setSelectedRoundId(v || null);
                    }
                  }}
                  className="flex-1 min-w-0 text-xs font-bold border border-line bg-surface text-ink px-3 py-2 outline-none rounded-lg cursor-pointer hover:bg-surface transition-colors"
                >
                  {/* Starting a new round is ALWAYS available — the cadence prompt
                  only decorates the label. Gating it forced coaches into
                  overwriting their previous round between windows. */}
                  <option value="__new">
                    + Start a new Eval
                    {promptStatus.active
                      ? promptStatus.kind === "preseason"
                        ? " (preseason due)"
                        : " (monthly due)"
                      : promptStatus.daysUntilDue != null
                        ? ` (next due in ${promptStatus.daysUntilDue}d)`
                        : ""}
                  </option>
                  {myRounds.map((r: EvalRound) => (
                    <option key={r.id} value={r.id}>
                      {formatRoundName(r)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedRoundId && (
                <button
                  type="button"
                  onClick={() => {
                    if (pendingRoundDelete) {
                      deleteEvaluation?.(selectedRoundId);
                      setSelectedRoundId(null);
                      lastSavedRef.current = "";
                      setSaveState("idle");
                      setPendingRoundDelete(false);
                    } else {
                      setPendingRoundDelete(true);
                    }
                  }}
                  onBlur={() => setPendingRoundDelete(false)}
                  className={`shrink-0 flex items-center gap-1.5 border rounded-lg transition-colors ${
                    pendingRoundDelete
                      ? "px-2.5 py-2 bg-loss-bg text-loss border-line ring-2 ring-[var(--loss)]"
                      : "p-2 text-ink-3 hover:text-loss hover:bg-loss-bg border-line hover:border-line"
                  }`}
                  title={
                    pendingRoundDelete
                      ? "Tap again to delete this eval round"
                      : "Delete this eval round"
                  }
                  aria-label={
                    pendingRoundDelete
                      ? "Confirm delete selected eval round"
                      : "Delete selected eval round"
                  }
                >
                  <Icons.Trash className="w-4 h-4" />
                  {pendingRoundDelete && (
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      Confirm
                    </span>
                  )}
                </button>
              )}
              {!isCreatingNew && activeRound && (
                <span className="text-[10px] font-bold text-ink-3 italic">
                  Editing &quot;{formatRoundName(activeRound)}&quot;
                </span>
              )}
              {/* Explicit escape hatch: while editing a saved round, branch off
              into a brand-new round instead of overwriting. Available at ALL
              times — the cadence prompt is a reminder, not a gate. */}
              {!isCreatingNew && (
                <button
                  type="button"
                  onClick={startNewRound}
                  className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 transition-colors flex items-center gap-1.5"
                  title="Start a brand-new eval round instead of overwriting this one"
                >
                  <Icons.Plus className="w-3.5 h-3.5" />
                  Start New Round
                </button>
              )}
              {myRounds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManageOpen(true)}
                  className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 transition-colors flex items-center gap-1.5"
                  title="View, switch between, and delete saved rounds"
                  aria-label="Manage saved eval rounds"
                >
                  <Icons.Clipboard className="w-3.5 h-3.5" />
                  Manage
                </button>
              )}
              {myRounds.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setComparisonOpen(true)}
                  className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 flex items-center gap-1.5 shrink-0"
                  title="Compare any two saved rounds side by side"
                >
                  <Icons.Forward className="w-3.5 h-3.5" /> Compare Rounds
                </button>
              )}
            </div>

            {/* Spells out exactly what Save will do right now — the fix for "is
            this updating a file or starting a new eval?" */}
            <div className="px-1 py-2 border-b border-line">
              <p className="text-[11px] font-medium text-ink-2 flex items-center gap-1.5">
                <Icons.Save className="w-3 h-3 text-ink-3 shrink-0" />
                {isCreatingNew ? (
                  <>
                    Save creates a{" "}
                    <strong className="font-black text-ink">
                      new eval round
                    </strong>
                    {promptStatus.active
                      ? promptStatus.kind === "preseason"
                        ? " (preseason)."
                        : " (monthly)."
                      : myRounds.length > 0
                        ? ", pre-filled from your latest round."
                        : "."}
                  </>
                ) : (
                  <>
                    Save{" "}
                    <strong className="font-black text-ink">
                      overwrites the saved round
                    </strong>{" "}
                    &ldquo;{activeRoundName}&rdquo; — it does not create a new
                    one.
                  </>
                )}
              </p>
            </div>
          </div>
          {/* end left rail */}

          {/* Middle column: insights, assistant submissions, quick-set, grading cards */}
          <div className="lg:col-span-6 space-y-4 min-w-0">
            {/* Round-over-round auto-flags (standouts / regressions / category drops) */}
            <InsightsPanel
              rounds={myRounds}
              players={players}
              activeCategories={activeCategories}
              onPlayerClick={setEvalTrendPlayerId}
            />

            {/* Head-only: read-only view of every assistant's most recent eval
            submission so the head can see their suggested positions + notes
            alongside the combined grade. */}
            <AssistantSubmissionsPanel
              evaluationEvents={evaluationEvents}
              players={players}
              onDelete={deleteEvaluation}
            />

            {/* Quick-set toolbar */}
            <div className="px-1 py-3 border-b border-line flex flex-wrap items-center gap-2">
              <span className="t-eyebrow mr-1">Quick Set:</span>
              <button
                type="button"
                onClick={copyFromLastRound}
                disabled={!hasLastRound}
                className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                title={
                  hasLastRound
                    ? "Copy grades from your most recent saved eval"
                    : "No previous eval to copy from"
                }
              >
                <Icons.Forward className="w-3.5 h-3.5" /> Copy From Last Round
              </button>
              <button
                type="button"
                onClick={applyAllAverage}
                className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2 flex items-center gap-1.5"
                title="Set every category for every player to 3"
              >
                <Icons.Refresh className="w-3.5 h-3.5" /> All Average (3)
              </button>
              <button
                type="button"
                onClick={() => setTeamEvalGrades({})}
                className="t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-loss-bg hover:border-line hover:text-loss flex items-center gap-1.5"
                title="Clear all in-progress grades"
              >
                <Icons.X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>

            {/* Per-player grading cards — single column inside the col-span-6
            middle. Same chip rows as the assistant flow so head + assistant
            inputs match. */}
            <div className="px-1 py-3">
              <div className="space-y-2">
                {players.length > 0 && (
                  <div className="flex items-center justify-between gap-2 px-1 pb-1">
                    <span className="t-eyebrow text-ink-3">
                      {expandedPlayerIds.size} of {players.length} open
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPlayerIds(
                            new Set(players.map((p: Player) => p.id)),
                          )
                        }
                        className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2"
                      >
                        Expand All
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedPlayerIds(new Set())}
                        className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2"
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>
                )}
                {players.length === 0 ? (
                  <EmptyState
                    glyph="⭐"
                    title="No Players to Evaluate"
                    body="Add players on the Roster tab to start grading."
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {players.map((player: Player) => {
                      const savedGrades: EvalGradeRecord =
                        teamEvalGrades[player.id] || {};
                      const grades: EvalGradeRecord = {
                        ...DEFAULT_GRADES,
                        ...savedGrades,
                      };
                      // Only the categories that apply to this kid (universal + their
                      // pitching/catching specialty), so non-pitchers/non-catchers
                      // aren't shown — or scored on — spots that don't apply to them.
                      const playerCats = getEvalCategoriesForPlayer(
                        pitchingFormat,
                        player,
                      );
                      // Eval value: percentage-normalized score across the universal
                      // bucket plus any applicable pitcher/catcher buckets.
                      const totalScore = Math.min(
                        100,
                        currentEvaluationScore100(
                          asGradeMap(grades),
                          player,
                          teamAge,
                        ) ?? 0,
                      );
                      const expanded = expandedPlayerIds.has(player.id);
                      const rankRow = rankByPlayerId.get(player.id);
                      const primarySuggestion =
                        rankRow?.primarySuggestion ||
                        suggestPrimaryPosition(player, asGradeMap(grades), {
                          kidPitch: isKidPitchFormat(pitchingFormat),
                          teamAge,
                        });
                      // Count how many categories the coach has graded (any non-default
                      // chip click) so the collapsed row can show progress at a glance.
                      // Optional measurement fields (Pitch Velocity) don't count toward
                      // the required total.
                      const requiredCats = playerCats.filter(
                        (c) => c.inputKind !== "mph",
                      );
                      const gradedCount = requiredCats.filter((c) => {
                        const v = Number(grades[c.id]);
                        return Number.isFinite(v) && v > 0;
                      }).length;
                      return (
                        <div
                          key={`mc-${player.id}`}
                          className="bg-surface-1 border border-line rounded-xl overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => togglePlayerExpanded(player.id)}
                            aria-expanded={expanded}
                            className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-surface transition-colors text-left"
                          >
                            <Icons.ChevronRight
                              className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${
                                expanded ? "rotate-90" : ""
                              }`}
                            />
                            {player.number && (
                              <span className="text-[11px] font-bold text-ink-3 tabular-nums shrink-0 w-7 text-center">
                                #{player.number}
                              </span>
                            )}
                            <span className="flex-1 min-w-0 text-sm font-black uppercase tracking-tight text-ink truncate">
                              {player.name}
                            </span>
                            {rankRow && (
                              <span
                                className="text-[10px] font-black text-ink-2 shrink-0 tabular-nums"
                                title="Team rank"
                              >
                                #{rankRow.rank}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-ink-3 shrink-0 tabular-nums">
                              {gradedCount}/{requiredCats.length}
                            </span>
                            <span
                              className="text-xs font-black tabular-nums px-2 py-0.5 rounded-md shrink-0"
                              style={{
                                backgroundColor: "var(--team-primary)",
                                color: "var(--team-on-primary)",
                              }}
                              title="Total Score (out of 100)"
                            >
                              {totalScore}
                            </span>
                          </button>
                          {expanded && (
                            <div className="px-3 pb-4 pt-3 border-t border-line space-y-2.5">
                              <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 pt-0.5">
                                Your Evaluation
                              </div>
                              {playerCats.map((cat) => (
                                <div
                                  key={cat.id}
                                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
                                >
                                  <div className="flex-1 min-w-0">
                                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-ink-2 flex items-center gap-1.5 flex-wrap">
                                      {cat.label}
                                      {(() => {
                                        const hint = evalStatHint(
                                          cat.id,
                                          player.stats,
                                          (
                                            player as {
                                              pitching?: { topMph?: number };
                                            }
                                          ).pitching,
                                        );
                                        return hint ? (
                                          <span className="text-[10px] font-black tabular-nums text-ink-2 bg-surface-2 border border-line rounded px-1.5 py-0.5 normal-case tracking-normal">
                                            {hint}
                                          </span>
                                        ) : null;
                                      })()}
                                    </span>
                                    {cat.description && (
                                      <span className="text-[10px] font-medium text-ink-3 leading-tight block mt-0.5">
                                        {cat.description}
                                      </span>
                                    )}
                                  </div>
                                  {cat.inputKind === "mph" ? (
                                    <div className="flex items-center justify-end gap-2 flex-wrap">
                                      {(() => {
                                        const mphScore = velocityGradeFromMph(
                                          Number(grades[cat.id]),
                                          teamAge,
                                        );
                                        return mphScore != null ? (
                                          <span className="text-[10px] font-black tabular-nums text-ink-2 bg-surface-2 border border-line rounded px-1.5 py-1">
                                            Age score {mphScore}/5
                                          </span>
                                        ) : null;
                                      })()}
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={120}
                                        value={
                                          grades[cat.id] == null
                                            ? ""
                                            : Number(grades[cat.id])
                                        }
                                        onChange={(e) =>
                                          setGrade(
                                            player.id,
                                            cat.id,
                                            e.target.value === ""
                                              ? null
                                              : Number(e.target.value),
                                          )
                                        }
                                        placeholder="mph"
                                        aria-label={`${player.name} ${cat.label} (mph)`}
                                        className="w-20 shrink-0 px-2 py-1.5 text-sm bg-surface text-ink placeholder:text-ink-3 border border-line rounded-md outline-none focus:ring-2 focus:ring-[var(--team-primary)] tabular-nums text-right"
                                      />
                                    </div>
                                  ) : (
                                    <GradeChipRow
                                      value={Number(grades[cat.id])}
                                      onChange={(v: number) =>
                                        setGrade(player.id, cat.id, v)
                                      }
                                      ariaLabel={`${player.name} ${cat.label}`}
                                    />
                                  )}
                                </div>
                              ))}
                              <div className="pt-1.5 border-t border-line">
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
                                    Position Fit Notes
                                  </div>
                                  {primarySuggestion && (
                                    <span className="text-[10px] font-black text-ink-2 bg-surface-2 border border-line rounded px-1.5 py-0.5">
                                      Best fit: {primarySuggestion.position}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-ink-3 mb-2 leading-snug">
                                  Mark positions to consider on the Depth Chart;
                                  use the best-fit hint for primary-position
                                  decisions.
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {SUGGESTED_POSITIONS.map((pos) => {
                                    const active = (
                                      grades.suggestedPositions || []
                                    ).includes(pos);
                                    return (
                                      <button
                                        key={pos}
                                        type="button"
                                        onClick={() =>
                                          toggleSuggestedPosition(
                                            player.id,
                                            pos,
                                          )
                                        }
                                        className="px-1.5 py-0.5 text-[10px] font-black rounded border transition-all"
                                        style={
                                          active
                                            ? {
                                                backgroundColor:
                                                  "var(--team-primary)",
                                                color: "var(--team-on-primary)",
                                                borderColor:
                                                  "var(--team-primary)",
                                              }
                                            : {
                                                backgroundColor:
                                                  "var(--surface)",
                                                color: "var(--ink-2)",
                                                borderColor: "var(--line)",
                                              }
                                        }
                                      >
                                        {pos}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <textarea
                                value={grades.notes || ""}
                                onChange={(e) =>
                                  setNotes(player.id, e.target.value)
                                }
                                placeholder="Notes"
                                rows={1}
                                className="w-full text-xs font-medium border border-line bg-surface text-ink px-2 py-1.5 outline-none rounded-md focus:ring-2 focus:ring-[var(--team-primary)] resize-y"
                              />
                              <PlayerAssistantEvals
                                player={player}
                                playerCats={playerCats}
                                assistantRounds={assistantRounds}
                              />
                              <button
                                type="button"
                                onClick={() => setEvalTrendPlayerId(player.id)}
                                className="text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink underline"
                              >
                                View trend →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {/* end cards wrapper */}
          </div>
          {/* end middle column */}

          {/* Right rail: live Complete Ranking */}
          <div className="lg:col-span-3">
            {players.length > 0 && (
              <aside className="cc-card lg:sticky lg:top-24 p-3 space-y-3">
                <div>
                  <div className="t-eyebrow text-ink-3">Complete Ranking</div>
                  <p className="text-[10px] text-ink-3 mt-1 leading-snug">
                    Ranked by Total Score from the current grades. Best-fit
                    positions are hints, not automatic assignments.
                  </p>
                </div>
                <div className="space-y-1.5 max-h-[70vh] overflow-auto pr-1">
                  {rankingRows.map((row) => (
                    <button
                      key={`rank-${row.player.id}`}
                      type="button"
                      onClick={() => {
                        setExpandedPlayerIds((prev) =>
                          new Set(prev).add(row.player.id),
                        );
                      }}
                      className="w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-left hover:bg-surface-2 transition-colors"
                      title="Open this player's evaluation card"
                    >
                      <span className="text-xs font-black tabular-nums text-ink-2">
                        #{row.rank}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-black uppercase text-ink truncate">
                          {row.player.name}
                        </span>
                        <span className="block text-[10px] font-bold text-ink-3 truncate">
                          {row.primarySuggestion?.position
                            ? `Fit: ${row.primarySuggestion.position}`
                            : "Fit: review"}
                        </span>
                      </span>
                      <span
                        className="text-xs font-black tabular-nums px-2 py-0.5 rounded-md"
                        style={{
                          backgroundColor: "var(--team-primary)",
                          color: "var(--team-on-primary)",
                        }}
                      >
                        {row.totalScore}
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
            )}
          </div>
          {/* end right rail */}
        </div>
        {/* end 3-column workspace grid */}
      </div>

      {/* Roster Decisions panel — advisory recommendations based on
          eval trends, current performance, and age eligibility.
          Head-coach-only; assistants don't make roster decisions. */}
      {!isAssistant && <RosterDecisionsPanel />}

      {/* Side-by-side round comparison modal */}
      {comparisonOpen && (
        <RoundComparisonView
          rounds={myRounds}
          players={players}
          activeCategories={activeCategories}
          primaryColor={primaryColor}
          onPlayerClick={(id: string) => {
            setComparisonOpen(false);
            setEvalTrendPlayerId(id);
          }}
          onClose={() => setComparisonOpen(false)}
        />
      )}

      {/* Trend modal — opens when a player name is clicked */}
      {evalTrendPlayerId && (
        <EvalTrendModal
          player={players.find((p: Player) => p.id === evalTrendPlayerId)}
          evaluationEvents={evaluationEvents}
          userUid={user?.uid}
          primaryColor={primaryColor}
          onClose={() => setEvalTrendPlayerId(null)}
        />
      )}

      {/* Manage Rounds modal — lists every saved round with per-row
          delete (two-tap armed) and a Select link. Lets the head jump
          to or remove any round without first selecting it from the
          dropdown. */}
      {manageOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm"
          onClick={() => {
            setManageOpen(false);
            setPendingModalDeleteId(null);
          }}
        >
          <A11yDialog
            label="Your saved rounds"
            onClose={() => {
              setManageOpen(false);
              setPendingModalDeleteId(null);
            }}
            className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="p-1.5" style={{ backgroundColor: primaryColor }} />
            <div className="p-5 sm:p-6 border-b border-line flex items-start justify-between gap-3">
              <div>
                <h3 className="t-h3">Your Saved Rounds</h3>
                <p className="text-[12px] text-ink-3 font-medium mt-1">
                  Select a round to review or edit, or delete one saved by
                  mistake.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setManageOpen(false);
                  setPendingModalDeleteId(null);
                }}
                className="p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors -mt-1 -mr-2"
                aria-label="Close"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              {myRounds.length === 0 ? (
                <div className="text-sm font-bold text-ink-3 italic text-center py-8">
                  No saved rounds yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {myRounds.map((r: EvalRound) => {
                    const armed = pendingModalDeleteId === r.id;
                    const isActive = r.id === selectedRoundId;
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                          isActive
                            ? "bg-app border-line-strong"
                            : "bg-surface border-line"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-ink truncate">
                            {formatRoundName(r)}
                          </div>
                          {isActive && (
                            <div className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3 mt-0.5">
                              Currently editing
                            </div>
                          )}
                        </div>
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRoundId(r.id);
                              setManageOpen(false);
                              setPendingModalDeleteId(null);
                            }}
                            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-ink hover:text-ink px-2 py-1 rounded hover:bg-surface-2 transition-colors"
                          >
                            Select
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (armed) {
                              deleteEvaluation?.(r.id);
                              setPendingModalDeleteId(null);
                              if (r.id === selectedRoundId) {
                                setSelectedRoundId(null);
                                lastSavedRef.current = "";
                                setSaveState("idle");
                              }
                            } else {
                              setPendingModalDeleteId(r.id);
                            }
                          }}
                          onBlur={() => {
                            if (armed) setPendingModalDeleteId(null);
                          }}
                          className={`shrink-0 flex items-center gap-1 rounded-md transition-colors ${
                            armed
                              ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-[var(--loss)]"
                              : "p-1.5 text-ink-3 hover:text-loss hover:bg-loss-bg"
                          }`}
                          title={
                            armed
                              ? "Tap again to delete this round"
                              : "Delete this round"
                          }
                          aria-label={
                            armed
                              ? `Confirm delete ${formatRoundName(r)}`
                              : `Delete ${formatRoundName(r)}`
                          }
                        >
                          <Icons.Trash className="w-3.5 h-3.5" />
                          {armed && (
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              Confirm
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </A11yDialog>
        </div>
      )}
    </div>
  );
});
// EvalTrendModal was extracted to ./evaluation/EvalTrendModal (it is the only
// eval surface that pulls in recharts). Re-exported for backward compat.
export { EvalTrendModal } from "./evaluation/EvalTrendModal";
