import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts";
import { EvalGradeCard } from "../components/EvalGradeCard";
import {
  getActivePositionList,
  getCombinedGrades,
} from "../lineupEngine";
import {
  getEvalCategoriesForTeam,
  getEvalCategoriesForPlayer,
  EVAL_SCALE_DEFAULT,
  leftHandedPitcherRosterPremium,
  isLeftHandedThrower,
} from "../constants/ui";
import { calculateBaseballAge, getReturningDecision, normalizeTryoutSessions, combinedTryoutGradeForSignup, evaluatorTryoutGradeForSignup } from "../utils/helpers";
import { A11yDialog } from "../components/shared";
import { OfferLetterModal } from "../components/OfferLetterModal";
import { makeOfferLetterContext } from "../utils/offerContext";
import type { OfferLetterKind } from "../constants/offerLetters";

const STATUS_PILLS = {
  tryout: { label: "Tryout", className: "bg-surface-2 border-line text-ink" },
  offered: { label: "Offered", className: "bg-warn-bg border-line text-warnfg" },
  accepted: { label: "Accepted", className: "bg-win-bg border-line text-win" },
  declined: { label: "Declined", className: "bg-loss-bg border-line text-loss" },
};

const StatusPill = memo(({ status }: any) => {
  const cfg = (STATUS_PILLS as any)[status || "tryout"] || STATUS_PILLS.tryout;
  return (
    <span
      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
});

// "Too old" age check. team.teamAge is a string like "10U" / "11U to 12U";
// pull the LARGEST eligible age from it. If the signup's baseball age
// exceeds that ceiling, flag them. Heads still see + can grade the kid
// — this is a visual nudge, not a block.
const teamAgeCeiling = (teamAgeStr: any) => {
  if (!teamAgeStr) return null;
  const nums = String(teamAgeStr)
    .match(/\d+/g)
    ?.map((n) => parseInt(n, 10))
    .filter(Number.isFinite);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums);
};

const tryoutIsTooOld = (signup: any, team: any) => {
  const ceiling = teamAgeCeiling(team?.teamAge);
  if (ceiling == null) return false;
  const age = calculateBaseballAge(signup?.dob, team?.currentSeason);
  if (age == null) return false;
  return age > ceiling;
};

type RosterProjectionCandidateKind = "unknown" | "tryout";
type RosterProjectionBucket = "recommended" | "next" | "below";

export type RosterProjectionCandidate = {
  kind: RosterProjectionCandidateKind;
  id: string;
  name: string;
  player?: any;
  signup?: any;
  score: number | null;
  baseScore: number | null;
  fitBonus: number;
  fitReasons: string[];
  bucket?: RosterProjectionBucket;
};

type RosterProjection = {
  rosterCap: number;
  returningYesCount: number;
  returningNoCount: number;
  returningUnknownCount: number;
  acceptedCount: number;
  lockedCount: number;
  slotsRemaining: number;
  recommended: RosterProjectionCandidate[];
  nextBest: RosterProjectionCandidate[];
  belowLine: RosterProjectionCandidate[];
  needsEvaluation: RosterProjectionCandidate[];
  tooOld: any[];
};

const numericGradeScore = (grade: any, categories: any[]) => {
  if (!grade) return null;
  let score = 0;
  let used = 0;
  for (const cat of categories || []) {
    if (cat?.inputKind === "mph") continue;
    const value = grade?.[cat.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    score += value * (Number(cat.weight) || 1);
    used++;
  }
  return used > 0 ? score : null;
};

const hasRosterEvaluation = (playerId: string, evaluationEvents: any[]) =>
  (evaluationEvents || []).some((e: any) => {
    if (e?.tryoutSignupId || e?.tryoutSessionId) return false;
    return !!e?.grades?.[playerId];
  });

const positionsForTryout = (grade: any, signup: any): string[] => {
  if (Array.isArray(grade?.suggestedPositions) && grade.suggestedPositions.length) {
    return grade.suggestedPositions;
  }
  return Array.isArray(signup?.comfortablePositions) ? signup.comfortablePositions : [];
};

const uniquePositions = (positions: any[]) =>
  [...new Set((positions || []).map((p) => String(p || "").trim()).filter(Boolean))];

const LEFTY_LIMITED_INFIELD_POSITIONS = new Set(["2B", "3B", "SS"]);

const fitBonusForPositions = (
  positions: string[],
  lockedPositions: Map<string, number>,
  playerLike?: any
) => {
  let fitBonus = leftHandedPitcherRosterPremium({
    comfortablePositions: positions,
    throws: playerLike?.throws,
  });
  const fitReasons: string[] = [];
  const leftyThrower = isLeftHandedThrower(playerLike);
  for (const pos of uniquePositions(positions)) {
    if (leftyThrower && LEFTY_LIMITED_INFIELD_POSITIONS.has(pos)) continue;
    const count = lockedPositions.get(pos) || 0;
    if (count === 0) {
      fitBonus += 4;
      fitReasons.push(`fills ${pos}`);
    } else if ((pos === "P" || pos === "C") && count < 2) {
      fitBonus += 3;
      fitReasons.push(`thin at ${pos}`);
    } else if (count < 3) {
      fitBonus += 1;
      fitReasons.push(`adds ${pos} depth`);
    }
  }
  return { fitBonus, fitReasons };
};

// Combined next-season roster projection. Confirmed Yes returners and accepted
// tryouts are locked slots. Unknown current players and eligible, undecided,
// graded tryouts compete together for the remaining slots on weighted eval
// score plus an explainable positional-fit bonus.
export const computeRosterProjection = (
  team: any,
  tryoutSessions: any,
  tryoutSignups: any,
  evaluationEvents: any[] = []
): RosterProjection => {
  const rosterCap = Number(team?.rosterCap) || 12;
  const currentRoster = (team?.players || []).filter(
    (p: any) => p.playerStatus !== "accepted" && p.playerStatus !== "tryout"
  );
  const returningYes = currentRoster.filter((p: any) => getReturningDecision(p) === "yes");
  const returningNo = currentRoster.filter((p: any) => getReturningDecision(p) === "no");
  const returningUnknown = currentRoster.filter((p: any) => getReturningDecision(p) === "unknown");
  const acceptedSignups = (tryoutSignups || []).filter((s: any) => s.status === "accepted");
  const lockedCount = returningYes.length + acceptedSignups.length;
  const slotsRemaining = Math.max(0, rosterCap - lockedCount);

  const lockedPositions = new Map<string, number>();
  const addLockedPositions = (positions: any[]) => {
    for (const pos of uniquePositions(positions)) lockedPositions.set(pos, (lockedPositions.get(pos) || 0) + 1);
  };
  returningYes.forEach((p: any) => addLockedPositions(p.comfortablePositions || []));
  acceptedSignups.forEach((s: any) => {
    const grade = combinedTryoutGradeForSignup(tryoutSessions, s.id, s.tryoutDate);
    addLockedPositions(positionsForTryout(grade, s));
  });

  const rosterGrades = getCombinedGrades(evaluationEvents || [], returningUnknown, {
    teamAge: team?.teamAge,
    games: team?.games || [],
  });

  const graded: RosterProjectionCandidate[] = [];
  const needsEvaluation: RosterProjectionCandidate[] = [];

  for (const player of returningUnknown) {
    const categories = getEvalCategoriesForPlayer(team?.pitchingFormat, player);
    const baseScore = hasRosterEvaluation(player.id, evaluationEvents || [])
      ? numericGradeScore(rosterGrades[player.id], categories)
      : null;
    const { fitBonus, fitReasons } = fitBonusForPositions(player.comfortablePositions || [], lockedPositions, player);
    const candidate: RosterProjectionCandidate = {
      kind: "unknown",
      id: player.id,
      name: player.name || "Unknown player",
      player,
      baseScore,
      fitBonus,
      fitReasons,
      score: baseScore == null ? null : baseScore + fitBonus,
    };
    if (candidate.score == null) needsEvaluation.push(candidate);
    else graded.push(candidate);
  }

  const tooOld = [];
  for (const signup of tryoutSignups || []) {
    if (signup.status === "declined" || signup.status === "accepted") continue;
    if (tryoutIsTooOld(signup, team)) {
      tooOld.push(signup);
      continue;
    }
    const grade = combinedTryoutGradeForSignup(tryoutSessions, signup.id, signup.tryoutDate);
    const positions = positionsForTryout(grade, signup);
    const categories = getEvalCategoriesForPlayer(team?.pitchingFormat, { comfortablePositions: positions });
    const baseScore = numericGradeScore(grade, categories);
    const { fitBonus, fitReasons } = fitBonusForPositions(positions, lockedPositions, signup);
    const name = `${signup.firstName || ""} ${signup.lastName || ""}`.trim() || "Tryout candidate";
    const candidate: RosterProjectionCandidate = {
      kind: "tryout",
      id: signup.id,
      name,
      signup,
      baseScore,
      fitBonus,
      fitReasons,
      score: baseScore == null ? null : baseScore + fitBonus,
    };
    if (candidate.score == null) needsEvaluation.push(candidate);
    else graded.push(candidate);
  }

  graded.sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
  const recommended = graded.slice(0, slotsRemaining).map((c) => ({ ...c, bucket: "recommended" as const }));
  const nextWindow = Math.max(slotsRemaining, 3);
  const nextBest = graded.slice(slotsRemaining, slotsRemaining + nextWindow).map((c) => ({ ...c, bucket: "next" as const }));
  const belowLine = graded.slice(slotsRemaining + nextWindow).map((c) => ({ ...c, bucket: "below" as const }));

  return {
    rosterCap,
    returningYesCount: returningYes.length,
    returningNoCount: returningNo.length,
    returningUnknownCount: returningUnknown.length,
    acceptedCount: acceptedSignups.length,
    lockedCount,
    slotsRemaining,
    recommended,
    nextBest,
    belowLine,
    needsEvaluation,
    tooOld,
  };
};

// Bottom-N + positional-fit impact analysis. Returning roster is the
// current team.players excluding any with status === "released" /
// "declined" / "accepted" (accepted are the tryouts themselves).
const computeImpact = (signup: any, team: any, evaluationEvents: any, tryoutSessions: any) => {
  const rosterCap = Number(team.rosterCap) || 12;
  const returners = (team.players || []).filter(
    (p: any) =>
      p.playerStatus !== "accepted" &&
      p.playerStatus !== "tryout" &&
      getReturningDecision(p) === "yes"
  );
  // Combined grades cover ONLY current roster players via getCombinedGrades.
  // For each returner, sum the eval scores; sort descending.
  const grades = getCombinedGrades(evaluationEvents || [], returners, {
    teamAge: team.teamAge,
    games: team.games || [],
  });
  const scoreOf = (p: any) => {
    const g = grades[p.id];
    if (!g) return 0;
    return Object.values(g).reduce(
      (sum: number, v: any) => sum + (typeof v === "number" ? v : 0),
      0
    );
  };
  const ranked = returners
    .map((p: any) => ({ p, score: scoreOf(p) }))
    .sort((a: any, b: any) => b.score - a.score);
  const nth = ranked[rosterCap - 1];
  const cutoff = nth?.score ?? 0;
  const wouldBumpName = nth?.p?.name || null;

  // Tryout kid's eval score — only computed once a coach has graded them
  // in the date-grouped Tryouts session. Until grades exist we surface
  // "not graded yet".
  const tryoutGrade = combinedTryoutGradeForSignup(tryoutSessions, signup.id, signup.tryoutDate);
  const tryoutScore = tryoutGrade
    ? Object.values(tryoutGrade).reduce(
        (sum: number, v: any) => sum + (typeof v === "number" ? v : 0),
        0
      )
    : null;

  // Positional fit. Count how thin the roster is at each position the
  // signup is comfortable with. < 3 returners = "fills X" callout.
  const positionalFit = [];
  const positions = positionsForTryout(tryoutGrade, signup);
  for (const pos of positions) {
    const count = returners.filter((p: any) =>
      (p.comfortablePositions || []).includes(pos)
    ).length;
    if (count < 3) positionalFit.push({ pos, returnerCount: count });
  }
  if (signup.isCatcher) {
    const catcherCount = returners.filter((p: any) =>
      (p.comfortablePositions || []).includes("C")
    ).length;
    if (catcherCount < 2)
      positionalFit.push({ pos: "C (catcher)", returnerCount: catcherCount });
  }

  let verdict = "Below the line";
  if (tryoutScore != null && tryoutScore > cutoff) {
    verdict = wouldBumpName
      ? `Above the line — would bump ${wouldBumpName}`
      : "Above the line";
  } else if (tryoutScore == null) {
    verdict = "Not graded yet";
  }

  return { verdict, tryoutScore, cutoff, positionalFit, rosterCap };
};

const rosterEvalScore = (player: any, evaluationEvents: any[], team: any) => {
  const grades = getCombinedGrades(evaluationEvents || [], [player], {
    teamAge: team?.teamAge,
    games: team?.games || [],
  });
  const g = grades[player.id];
  if (!g) return null;
  return Object.values(g).reduce(
    (sum: number, v: any) => sum + (typeof v === "number" ? v : 0),
    0
  );
};

const ReturningIntentPanel = memo(({ team, evaluationEvents, setPlayerReturning }: any) => {
  const players = (team?.players || []).filter(
    (p: any) => p.playerStatus !== "accepted" && p.playerStatus !== "tryout"
  );
  if (players.length === 0) return null;
  return (
    <div className="glass-card p-4 sm:p-5 space-y-3">
      <div>
        <h3 className="t-h3 flex items-center gap-2">
          <Icons.Clipboard className="w-4 h-4" /> Returning Intent
        </h3>
        <p className="text-xs text-ink-3 font-medium mt-1">
          Head-coach planning assumptions only. Advance Season remains the final confirmation.
        </p>
      </div>
      <div className="space-y-2">
        {players.map((p: any) => {
          const decision = getReturningDecision(p);
          const score = rosterEvalScore(p, evaluationEvents || [], team);
          return (
            <div key={p.id} className="flex items-center gap-3 flex-wrap bg-surface border border-line rounded-xl p-3">
              <div className="flex-1 min-w-[160px]">
                <div className="text-sm font-black text-ink">{p.name}</div>
                <div className="text-[11px] text-ink-3 font-bold">
                  Latest eval: {score == null ? "—" : score.toFixed(0)}
                </div>
              </div>
              <div className="flex items-center gap-1" aria-label={`${p.name} returning intent`}>
                {[["yes", "Yes"], ["no", "No"], ["unknown", "Unknown"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPlayerReturning?.(p.id, value === "unknown" ? null : value === "yes")}
                    className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md border ${
                      decision === value
                        ? "bg-team-primary text-team-tertiary border-team-primary"
                        : "bg-surface border-line text-ink-2 hover:bg-surface-2"
                    }`}
                    style={
                      decision === value
                        ? { backgroundColor: "var(--team-primary)", color: "var(--team-tertiary)", borderColor: "var(--team-primary)" }
                        : undefined
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// Three-bucket projection of who's likely to make the team — modeled
// after the RosterDecisionsPanel on the Evaluation tab. Reads the
// roster object built by computeRosterBuckets above; render-only,
// no internal state.
const TeamImpactPanel = memo(({ roster }: any) => {
  const buckets = [
    {
      key: "make",
      title: "Recommended Fillers",
      sub: `Top fit scores for open roster spots`,
      tone: "bg-win-bg border-line text-win",
      countTone: "text-win",
      items: roster.recommended,
    },
    {
      key: "bubble",
      title: "Next Best",
      sub: "Best remaining bubble or upgrade candidates",
      tone: "bg-warn-bg border-line text-warnfg",
      countTone: "text-warnfg",
      items: roster.nextBest,
    },
    {
      key: "cut",
      title: "Below Line",
      sub: "Below current roster-fit line",
      tone: "bg-app border-line text-ink",
      countTone: "text-ink-3",
      items: roster.belowLine,
    },
  ];
  const empty = roster.recommended.length + roster.nextBest.length + roster.belowLine.length === 0;
  return (
    <div className="glass-card p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="t-h3 flex items-center gap-2">
          <Icons.Clipboard className="w-4 h-4" /> Roster Projection
        </h3>
        <span className="t-eyebrow text-ink-3">
          {roster.returningYesCount} returning yes · {roster.returningNoCount} no · {roster.returningUnknownCount} unknown
          {roster.acceptedCount > 0 ? ` · ${roster.acceptedCount} accepted tryout${roster.acceptedCount === 1 ? "" : "s"}` : ""}{" "}
          · {roster.slotsRemaining} open of {roster.rosterCap}
        </span>
      </div>
      {roster.returningUnknownCount > 0 && (
        <p className="text-xs text-warnfg font-bold bg-warn-bg border border-line rounded-lg px-3 py-2">
          Confirmed Yes returners and accepted tryouts are locked. Unknown current players compete with eligible tryout candidates for the remaining spots.
        </p>
      )}
      {roster.slotsRemaining === 0 && (
        <p className="text-xs text-ink-3 font-bold bg-surface-2 border border-line rounded-lg px-3 py-2">
          No open competitive spots: confirmed returners plus accepted tryouts already fill the roster cap. The lists below show bubble or upgrade candidates only.
        </p>
      )}
      {empty ? (
        <p className="text-xs text-ink-3 font-medium italic">
          Grade {roster.needsEvaluation.length > 0
            ? `the ${roster.needsEvaluation.length} candidate${roster.needsEvaluation.length === 1 ? "" : "s"} needing evaluation `
            : "candidates "}
          to see the roster projection.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {buckets.map((b) => (
            <div
              key={b.key}
              className={`rounded-xl border p-3 ${b.tone}`}
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-[10px] font-black uppercase tracking-widest">
                  {b.title}
                </div>
                <div className={`text-lg font-black tabular-nums ${b.countTone}`}>
                  {b.items.length}
                </div>
              </div>
              <div className="text-[9px] font-medium opacity-70 mb-2">
                {b.sub}
              </div>
              {b.items.length === 0 ? (
                <div className="text-[10px] italic opacity-70">—</div>
              ) : (
                <ul className="space-y-0.5">
                  {b.items.map((candidate: any) => (
                    <li
                      key={candidate.id}
                      className="flex items-start justify-between gap-2 text-[11px]"
                    >
                      <span className="min-w-0">
                        <span className="font-bold truncate block">{candidate.name}</span>
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-70">
                          {candidate.kind === "unknown" ? "Current unknown" : "Tryout"}
                          {candidate.fitReasons.length > 0 ? ` · ${candidate.fitReasons.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="font-black tabular-nums opacity-80 shrink-0">
                        {candidate.score.toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {(roster.needsEvaluation.length > 0 || roster.tooOld.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {roster.needsEvaluation.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-surface-2 border border-line text-ink-2">
              {roster.needsEvaluation.length} ungraded
            </span>
          )}
          {roster.tooOld.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-warn-bg border border-line text-warnfg">
              {roster.tooOld.length} outside age group
            </span>
          )}
        </div>
      )}
    </div>
  );
});

const BUCKET_BADGES = {
  make: { label: "Recommended", className: "bg-win-bg text-win border-line" },
  bubble: { label: "Next Best", className: "bg-warn-bg text-warnfg border-line" },
  cut: { label: "Below Line", className: "bg-surface-2 text-ink-2 border-line" },
  ungraded: { label: "Ungraded", className: "bg-surface text-ink-3 border-line" },
  tooOld: { label: "Too Old", className: "bg-warn-bg text-warnfg border-line" },
};

export const TryoutsTab = memo(() => {
  const {
    team,
    user,
    currentRole,
    updateTeam,
    updateTryoutSignup,
    deleteTryoutSignup,
    deleteTryoutSignups,
    acceptTryout,
    saveTryoutEvaluation,
    saveTryoutEvaluations,
    setPlayerReturning,
  } = useTeam();
  const toast = useToast();
  const {
    tryoutSignups,
    evaluationEvents,
    tryoutSessions: rawTryoutSessions,
    defenseSize,
    pitchingFormat,
  } = team;

  const tryoutSessions = useMemo(
    () => normalizeTryoutSessions(team),
    [team]
  );
  const [openSignupIds, setOpenSignupIds] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Two-tap confirm on signup delete — the trash icon previously fired
  // deleteTryoutSignup on first click with no guard, which was a real
  // footgun next to so many other small action buttons in the row.
  const [pendingDeleteSignupId, setPendingDeleteSignupId] = useState(null);
  // End-tryout modal: bulk-delete every signup marked present === false.
  // The HC's day-of cleanup pattern — assign numbers to who showed,
  // mark the rest absent, then tap End Tryout to wipe no-shows.
  const [endTryoutOpen, setEndTryoutOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = tryoutSignups || [];
    if (statusFilter !== "all") {
      list = list.filter((s: any) => (s.status || "tryout") === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s: any) =>
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
          (s.email || "").toLowerCase().includes(q) ||
          (s.parentName || "").toLowerCase().includes(q)
      );
    }
    return list
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
      );
  }, [tryoutSignups, statusFilter, search]);

  const isHead = currentRole !== "assistant";

  // 3-bucket roster projection, computed once for both the top-of-tab
  // panel and the per-row bucket badge lookup.
  const roster = useMemo(
    () =>
      isHead
        ? computeRosterProjection(team, tryoutSessions, tryoutSignups, evaluationEvents || [])
        : null,
    [isHead, team, tryoutSessions, tryoutSignups, evaluationEvents]
  );
  // Map signup.id → "make" | "bubble" | "cut" | "ungraded" | "tooOld"
  // for the per-row badge.
  const bucketBySignupId = useMemo(() => {
    const map = new Map();
    if (!roster) return map;
    roster.recommended.forEach((c: any) => { if (c.kind === "tryout") map.set(c.id, "make"); });
    roster.nextBest.forEach((c: any) => { if (c.kind === "tryout") map.set(c.id, "bubble"); });
    roster.belowLine.forEach((c: any) => { if (c.kind === "tryout") map.set(c.id, "cut"); });
    roster.needsEvaluation.forEach((c: any) => { if (c.kind === "tryout") map.set(c.id, "ungraded"); });
    roster.tooOld.forEach((s: any) => map.set(s.id, "tooOld"));
    return map;
  }, [roster]);
  const noShowCount = useMemo(
    () =>
      (tryoutSignups || []).filter((s: any) => s.present === false).length,
    [tryoutSignups]
  );

  const activePositions = useMemo(
    () => getActivePositionList(defenseSize),
    [defenseSize]
  );
  const activeCategories = useMemo(
    () => getEvalCategoriesForTeam(pitchingFormat),
    [pitchingFormat]
  );

  const [localGradesBySignup, setLocalGradesBySignup] = useState<Record<string, any>>({});
  React.useEffect(() => {
    if (!user) {
      setLocalGradesBySignup({});
      return;
    }
    setLocalGradesBySignup((prev) => {
      const next = { ...prev };
      for (const signup of tryoutSignups || []) {
        if (next[signup.id]) continue;
        const seed: Record<string, any> = evaluatorTryoutGradeForSignup(
          tryoutSessions,
          signup.id,
          user.uid,
          signup.tryoutDate
        ) ?? {};
        const seeded: Record<string, any> = {};
        for (const c of activeCategories) seeded[c.id] = seed[c.id] ?? EVAL_SCALE_DEFAULT;
        if (seed.notes) seeded.notes = seed.notes;
        if (Array.isArray(seed.suggestedPositions)) seeded.suggestedPositions = seed.suggestedPositions;
        next[signup.id] = seeded;
      }
      return next;
    });
  }, [user, tryoutSignups, tryoutSessions, activeCategories]);

  const updateLocalSignupGrades = (signupId: string, updater: (prev: any) => any) =>
    setLocalGradesBySignup((prev) => ({ ...prev, [signupId]: updater(prev[signupId] || {}) }));

  const setLocalGrade = (pid: any, catId: any, value: any) =>
    updateLocalSignupGrades(pid, (prev) => ({ ...prev, [catId]: value }));
  const setLocalNotes = (pid: any, notes: any) =>
    updateLocalSignupGrades(pid, (prev) => ({ ...prev, notes }));
  const toggleLocalPos = (pid: any, pos: any) =>
    updateLocalSignupGrades(pid, (prev) => {
      const list = Array.isArray(prev.suggestedPositions) ? prev.suggestedPositions : [];
      return {
        ...prev,
        suggestedPositions: list.includes(pos) ? list.filter((p: any) => p !== pos) : [...list, pos],
      };
    });

  const saveTryoutEval = (signup: any) => {
    if (!signup) return;
    saveTryoutEvaluation?.(
      signup.id,
      localGradesBySignup[signup.id] || {},
      isHead ? "Head" : "Assistant",
      signup.tryoutDate
    );
    toast.push({ kind: "success", title: "Tryout eval saved" });
  };

  const saveVisibleTryoutEvals = () => {
    saveTryoutEvaluations?.(
      filtered.map((signup: any) => ({
        signupId: signup.id,
        date: signup.tryoutDate,
        grades: localGradesBySignup[signup.id] || {},
      })),
      isHead ? "Head" : "Assistant"
    );
    toast.push({ kind: "success", title: `${filtered.length} tryout eval${filtered.length === 1 ? "" : "s"} saved` });
  };

  // Recruiting letters are COPYABLE drafts (Gmail send is unreliable here), so
  // "Make an Offer" / "Decline" just open a pre-filled draft the coach hands to
  // the family. We only flip the signup status once they actually deliver it.
  const [offerDraft, setOfferDraft] = useState<
    { signup: any; kind: OfferLetterKind } | null
  >(null);
  // Accept-time routing choice: accepts default to NEXT season (held in
  // Tryouts, promoted on Advance Season); the coach can opt a kid onto the
  // CURRENT roster instead.
  const [acceptChoice, setAcceptChoice] = useState<any | null>(null);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="glass-card">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="t-h2 flex items-center gap-3">
              <Icons.Users className="w-6 h-6" /> Tryouts
            </h2>
            <p className="t-eyebrow text-ink-3 mt-1">
              {(tryoutSignups || []).length} signup
              {(tryoutSignups || []).length === 1 ? "" : "s"}
              {noShowCount > 0 && (
                <span className="text-loss ml-2">
                  · {noShowCount} no-show{noShowCount === 1 ? "" : "s"}
                </span>
              )}
            </p>
          </div>
          {isHead && noShowCount > 0 && (
            <button
              type="button"
              onClick={() => setEndTryoutOpen(true)}
              className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white bg-loss hover:opacity-90 rounded-lg transition-opacity"
              title={`Bulk-delete the ${noShowCount} no-show signup${noShowCount === 1 ? "" : "s"}`}
            >
              End Tryout · Clear No-Shows
            </button>
          )}
        </div>
      </div>

      {isHead && (
        <ReturningIntentPanel
          team={team}
          evaluationEvents={evaluationEvents}
          setPlayerReturning={setPlayerReturning}
        />
      )}

      {isHead && roster && (tryoutSignups || []).length > 0 && (
        <TeamImpactPanel roster={roster} />
      )}

      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / email…"
          className="flex-1 min-w-[180px] px-3 py-2 text-xs bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
        {["all", "tryout", "offered", "accepted", "declined"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md border ${
              statusFilter === s
                ? "bg-team-primary text-team-tertiary border-team-primary"
                : "bg-surface border-line text-ink-2 hover:bg-surface-2"
            }`}
            style={
              statusFilter === s
                ? {
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-tertiary)",
                    borderColor: "var(--team-primary)",
                  }
                : undefined
            }
          >
            {s}
          </button>
        ))}
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={saveVisibleTryoutEvals}
            className="ml-auto px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white rounded-lg shadow-sm"
            style={{ backgroundColor: "var(--team-primary)" }}
          >
            Save Visible Evals
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-ink-3 text-sm font-medium">
          No tryout signups yet. Share the public form link from
          Settings to start collecting.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s: any) => {
            const impact = isHead
              ? computeImpact(s, team, evaluationEvents, tryoutSessions)
              : null;
            const expanded = openSignupIds.has(s.id);
            const bucket = bucketBySignupId.get(s.id);
            const bucketCfg = bucket ? (BUCKET_BADGES as any)[bucket] : null;
            const presence = s.present; // true | false | undefined
            return (
              <div
                key={s.id}
                className={`bg-surface border rounded-xl overflow-hidden ${
                  presence === false
                    ? "border-line bg-loss-bg"
                    : "border-line"
                }`}
              >
                <div className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black uppercase tracking-tight text-ink flex items-center gap-2 flex-wrap">
                      <span className="truncate">
                        {s.tryoutNumber && (
                          <span className="text-ink-3 mr-1 tabular-nums">
                            #{s.tryoutNumber}
                          </span>
                        )}
                        {s.firstName} {s.lastName}
                      </span>
                      {bucketCfg && (
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${bucketCfg.className}`}
                        >
                          {bucketCfg.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-3 font-medium">
                      {isHead && (
                        <>
                          {s.email || "no email"} ·{" "}
                        </>
                      )}
                      {new Date(s.submittedAt).toLocaleDateString()}
                      {s.tryoutDate ? ` · Tryout date: ${s.tryoutDate}` : ""}
                    </div>
                  </div>
                  {isHead && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={s.tryoutNumber || ""}
                        onChange={(e) =>
                          updateTryoutSignup?.(s.id, {
                            tryoutNumber: e.target.value.replace(/\D/g, "").slice(0, 3),
                          })
                        }
                        placeholder="#"
                        title="Tryout number"
                        className="w-12 text-center text-xs font-black tabular-nums px-1 py-1 bg-surface border border-line rounded-md outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateTryoutSignup?.(s.id, {
                            present: presence === true ? null : true,
                          })
                        }
                        title="Mark present"
                        aria-pressed={presence === true}
                        className={`p-1.5 rounded-md border transition-colors ${
                          presence === true
                            ? "bg-win-bg border-line text-win"
                            : "bg-surface border-line text-ink-3 hover:text-win"
                        }`}
                      >
                        <Icons.Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateTryoutSignup?.(s.id, {
                            present: presence === false ? null : false,
                          })
                        }
                        title="Mark no-show"
                        aria-pressed={presence === false}
                        className={`p-1.5 rounded-md border transition-colors ${
                          presence === false
                            ? "bg-loss-bg border-line text-loss"
                            : "bg-surface border-line text-ink-3 hover:text-loss"
                        }`}
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <StatusPill status={s.status} />
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSignupIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                    className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                  >
                    {expanded ? "Close" : "Open"}
                  </button>
                  {isHead && (() => {
                    const armed = pendingDeleteSignupId === s.id;
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          // Stop the click from also toggling the parent
                          // row's expand/collapse handler.
                          e.stopPropagation();
                          if (armed) {
                            deleteTryoutSignup?.(s.id);
                            setPendingDeleteSignupId(null);
                          } else {
                            setPendingDeleteSignupId(s.id);
                          }
                        }}
                        onBlur={() => {
                          if (armed) setPendingDeleteSignupId(null);
                        }}
                        className={`flex items-center gap-1 rounded-md transition-colors ${
                          armed
                            ? "px-2 py-1 bg-loss-bg text-loss ring-2 ring-loss"
                            : "p-1.5 text-ink-3 hover:text-loss hover:bg-loss-bg"
                        }`}
                        title={armed ? "Tap again to delete" : "Delete signup"}
                        aria-label={armed ? "Confirm delete signup" : "Delete signup"}
                      >
                        <Icons.Trash className="w-3.5 h-3.5" />
                        {armed && (
                          <span className="text-[10px] font-black uppercase tracking-widest">
                            Confirm
                          </span>
                        )}
                      </button>
                    );
                  })()}
                </div>
                {expanded && (
                  <div className="border-t border-line p-4 space-y-3 bg-app/50">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                      <div>
                        <div className="t-eyebrow">DOB</div>
                        <div className="font-bold text-ink">
                          {s.dob || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="t-eyebrow">Bats/Throws</div>
                        <div className="font-bold text-ink">
                          {s.bats || "R"}/{s.throws || "R"}
                        </div>
                      </div>
                      {isHead && (
                        <>
                          <div>
                            <div className="t-eyebrow">Parent</div>
                            <div className="font-bold text-ink truncate">
                              {s.parentName || "—"}
                            </div>
                          </div>
                          <div>
                            <div className="t-eyebrow">Phone</div>
                            <div className="font-bold text-ink">
                              {s.phone || "—"}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {s.notes && (
                      <p className="text-[11px] text-ink italic bg-surface border border-line rounded-lg p-2">
                        {s.notes}
                      </p>
                    )}

                    {isHead && impact && impact.positionalFit.length > 0 && (
                      <div className="bg-surface border border-line rounded-lg p-3 text-[11px]">
                        <div className="font-black uppercase tracking-widest text-win text-[10px] mb-1.5">
                          Position Fit
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {impact.positionalFit.map((f) => (
                            <span
                              key={f.pos}
                              className="px-1.5 py-0.5 rounded border bg-win-bg border-line text-win font-black uppercase tracking-widest text-[9px]"
                            >
                              Fills {f.pos} ({f.returnerCount} returners)
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <EvalGradeCard
                        player={{
                          id: s.id,
                          name: `${s.firstName} ${s.lastName}`,
                          number: s.number,
                        }}
                        grades={localGradesBySignup[s.id] || {}}
                        activeCategories={activeCategories}
                        positions={activePositions}
                        onGradeChange={setLocalGrade}
                        onPositionToggle={toggleLocalPos}
                        onNotesChange={setLocalNotes}
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => saveTryoutEval(s)}
                          className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md"
                          style={{ backgroundColor: "var(--team-primary)" }}
                        >
                          Save Eval
                        </button>
                        {isHead && s.status !== "accepted" && (
                          <button
                            type="button"
                            onClick={() =>
                              setOfferDraft({ signup: s, kind: "newPlayer" })
                            }
                            className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-warn-bg text-warnfg border border-line rounded-lg hover:opacity-90 transition-opacity"
                          >
                            Make an Offer
                          </button>
                        )}
                        {isHead && s.status !== "accepted" && s.status !== "declined" && (
                          <button
                            type="button"
                            onClick={() =>
                              setOfferDraft({ signup: s, kind: "rejection" })
                            }
                            className="px-4 py-2 text-xs font-black uppercase tracking-widest bg-surface-2 text-ink border border-line rounded-lg hover:opacity-90 transition-opacity"
                          >
                            Decline
                          </button>
                        )}
                        {isHead && s.status === "offered" && (
                          <button
                            type="button"
                            onClick={() => setAcceptChoice(s)}
                            className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                          >
                            Mark Accepted
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {endTryoutOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setEndTryoutOpen(false)}
        >
          <A11yDialog
            label="End tryout — clear no-shows?"
            onClose={() => setEndTryoutOpen(false)}
            className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
          >
            <div className="p-1.5 bg-loss" />
            <div className="p-5 sm:p-6">
              <h3 className="text-lg font-black uppercase tracking-tight text-ink mb-1">
                End tryout — clear no-shows?
              </h3>
              <p className="text-sm text-ink-2 font-medium mb-4">
                {noShowCount} signup{noShowCount === 1 ? "" : "s"} marked
                no-show will be permanently deleted. Their grades, if
                any, are kept for historical reference but the signup
                itself is removed. Anyone unmarked or marked present
                stays.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEndTryoutOpen(false)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const noShowIds = (tryoutSignups || [])
                      .filter((s: any) => s.present === false)
                      .map((s: any) => s.id);
                    // Single bulk write — looping deleteTryoutSignup would only
                    // remove the last one (optimistic merge keeps last write).
                    const removed = deleteTryoutSignups?.(noShowIds) ?? 0;
                    setEndTryoutOpen(false);
                    toast.push({
                      kind: "success",
                      title: `${removed} no-show${
                        removed === 1 ? "" : "s"
                      } removed`,
                    });
                  }}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-loss hover:opacity-90 text-white rounded-xl shadow-md transition-opacity"
                >
                  Delete No-Shows
                </button>
              </div>
            </div>
          </A11yDialog>
        </div>
      )}

      {offerDraft && (
        <OfferLetterModal
          open
          onClose={() => setOfferDraft(null)}
          kind={offerDraft.kind}
          recipientEmail={offerDraft.signup.email}
          ctx={makeOfferLetterContext(
            team,
            user,
            [offerDraft.signup.firstName, offerDraft.signup.lastName]
              .filter(Boolean)
              .join(" ")
          )}
          onSaveNextSeasonMoney={(patch) =>
            updateTeam({ finances: { ...(team.finances || {}), ...patch } })
          }
          onDelivered={() =>
            updateTryoutSignup?.(offerDraft.signup.id, {
              status: offerDraft.kind === "rejection" ? "declined" : "offered",
            })
          }
        />
      )}

      {acceptChoice && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setAcceptChoice(null)}
        >
          <A11yDialog
            label={`Accept ${acceptChoice.firstName || "player"}`}
            onClose={() => setAcceptChoice(null)}
            className="bg-surface max-w-sm w-full rounded-2xl shadow-2xl border border-line overflow-hidden"
          >
            <div className="p-6 space-y-4">
              <div>
                <h3 className="t-card-title">
                  Accept {acceptChoice.firstName} {acceptChoice.lastName}
                </h3>
                <p className="t-body mt-1.5 leading-relaxed">
                  Which roster does this player join?
                </p>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    acceptTryout?.(acceptChoice.id, "next");
                    setAcceptChoice(null);
                  }}
                  className="w-full text-left p-3 rounded-xl border border-line bg-surface hover:bg-surface-2 transition-colors"
                >
                  <div className="text-sm font-black text-ink">
                    Next season{" "}
                    <span className="text-[10px] font-bold text-ink-3 uppercase tracking-widest">
                      Default
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-3 font-medium mt-0.5">
                    Stays in Tryouts marked Accepted. Joins the roster
                    automatically when you Advance Season.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    acceptTryout?.(acceptChoice.id, "current");
                    setAcceptChoice(null);
                  }}
                  className="w-full text-left p-3 rounded-xl border border-line bg-surface hover:bg-surface-2 transition-colors"
                >
                  <div className="text-sm font-black text-ink">
                    Current roster now
                  </div>
                  <div className="text-[11px] text-ink-3 font-medium mt-0.5">
                    Adds them to this season&apos;s roster immediately
                    (available in lineups right away).
                  </div>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setAcceptChoice(null)}
                className="w-full px-4 py-2 text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          </A11yDialog>
        </div>
      )}
    </div>
  );
});
