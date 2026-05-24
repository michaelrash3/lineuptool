import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useToast } from "../contexts.js";
import { EvalGradeCard } from "../components/EvalGradeCard.jsx";
import {
  getActivePositionList,
  getCombinedGrades,
} from "../lineupEngine";
import {
  getEvalCategoriesForTeam,
  EVAL_SCALE_DEFAULT,
} from "../constants/ui";
import { sendGmailMessage, buildMailtoUrl } from "../integrations/gmailSend";
import { calculateBaseballAge } from "../utils/helpers";
import { auth } from "../firebase";

const STATUS_PILLS = {
  tryout: { label: "Tryout", className: "bg-slate-100 border-slate-200 text-slate-700" },
  offered: { label: "Offered", className: "bg-amber-50 border-amber-200 text-amber-800" },
  accepted: { label: "Accepted", className: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  declined: { label: "Declined", className: "bg-rose-50 border-rose-200 text-rose-800" },
};

const StatusPill = memo(({ status }) => {
  const cfg = STATUS_PILLS[status || "tryout"] || STATUS_PILLS.tryout;
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
const teamAgeCeiling = (teamAgeStr) => {
  if (!teamAgeStr) return null;
  const nums = String(teamAgeStr)
    .match(/\d+/g)
    ?.map((n) => parseInt(n, 10))
    .filter(Number.isFinite);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums);
};

const tryoutIsTooOld = (signup, team) => {
  const ceiling = teamAgeCeiling(team?.teamAge);
  if (ceiling == null) return false;
  const age = calculateBaseballAge(signup?.dob, team?.currentSeason);
  if (age == null) return false;
  return age > ceiling;
};

// Roster-decision 3-bucket projection across the tryout pool. Returners
// are concrete (they're on the team), so the question is only who fills
// the remaining slots. Tryouts compete with each other on cumulative
// eval grade — same scoring the per-row impact used to do, just rolled
// up into Will Make / On The Bubble / Likely Cut piles. Too-old kids
// are surfaced separately regardless of grade. Ungraded kids surface
// as "not yet evaluated" so the head knows to grade them first.
const computeRosterBuckets = (team, evaluationEvents, tryoutSignups) => {
  const rosterCap = Number(team?.rosterCap) || 12;
  const returners = (team?.players || []).filter(
    (p) =>
      p.playerStatus !== "released" &&
      p.playerStatus !== "declined" &&
      p.playerStatus !== "accepted"
  );
  const slotsRemaining = Math.max(0, rosterCap - returners.length);

  const scoreOfSignup = (signup) => {
    const ev = (evaluationEvents || []).find(
      (e) => e.tryoutSignupId === signup.id
    );
    const grade = ev?.grades?.signup ?? ev?.grades?.["__signup__"];
    if (!grade) return null;
    return Object.values(grade).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0
    );
  };

  const tooOld = [];
  const notGraded = [];
  const graded = [];
  for (const s of tryoutSignups || []) {
    if (s.status === "declined") continue;
    if (tryoutIsTooOld(s, team)) {
      tooOld.push(s);
      continue;
    }
    const score = scoreOfSignup(s);
    if (score == null) notGraded.push(s);
    else graded.push({ signup: s, score });
  }
  graded.sort((a, b) => b.score - a.score);
  const makeIt = graded.slice(0, slotsRemaining);
  const bubble = graded.slice(
    slotsRemaining,
    slotsRemaining + Math.max(slotsRemaining, 3)
  );
  const cut = graded.slice(slotsRemaining + Math.max(slotsRemaining, 3));

  return {
    rosterCap,
    returnerCount: returners.length,
    slotsRemaining,
    makeIt,
    bubble,
    cut,
    notGraded,
    tooOld,
  };
};

// Bottom-N + positional-fit impact analysis. Returning roster is the
// current team.players excluding any with status === "released" /
// "declined" / "accepted" (accepted are the tryouts themselves).
const computeImpact = (signup, team, evaluationEvents) => {
  const rosterCap = Number(team.rosterCap) || 12;
  const returners = (team.players || []).filter(
    (p) =>
      p.playerStatus !== "released" &&
      p.playerStatus !== "declined" &&
      p.playerStatus !== "accepted"
  );
  // Combined grades cover ONLY current roster players via getCombinedGrades.
  // For each returner, sum the eval scores; sort descending.
  const grades = getCombinedGrades(evaluationEvents || [], returners);
  const scoreOf = (p) => {
    const g = grades[p.id];
    if (!g) return 0;
    return Object.values(g).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0
    );
  };
  const ranked = returners
    .map((p) => ({ p, score: scoreOf(p) }))
    .sort((a, b) => b.score - a.score);
  const nth = ranked[rosterCap - 1];
  const cutoff = nth?.score ?? 0;
  const wouldBumpName = nth?.p?.name || null;

  // Tryout kid's eval score — only computed if a coach has actually
  // graded them via team.evaluationEvents entries that reference the
  // signup id. Until grades exist we surface "not graded yet".
  const tryoutEvent = (evaluationEvents || []).find(
    (e) => e.tryoutSignupId === signup.id
  );
  const tryoutGrade = tryoutEvent?.grades?.signup ?? tryoutEvent?.grades?.["__signup__"];
  const tryoutScore = tryoutGrade
    ? Object.values(tryoutGrade).reduce(
        (sum, v) => sum + (typeof v === "number" ? v : 0),
        0
      )
    : null;

  // Positional fit. Count how thin the roster is at each position the
  // signup is comfortable with. < 3 returners = "fills X" callout.
  const positionalFit = [];
  const positions = signup.comfortablePositions || [];
  for (const pos of positions) {
    const count = returners.filter((p) =>
      (p.comfortablePositions || []).includes(pos)
    ).length;
    if (count < 3) positionalFit.push({ pos, returnerCount: count });
  }
  if (signup.isCatcher) {
    const catcherCount = returners.filter((p) => p.isCatcher).length;
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

// Three-bucket projection of who's likely to make the team — modeled
// after the RosterDecisionsPanel on the Evaluation tab. Reads the
// roster object built by computeRosterBuckets above; render-only,
// no internal state.
const TeamImpactPanel = memo(({ roster }) => {
  const buckets = [
    {
      key: "make",
      title: "Will Make Team",
      sub: `Top ${roster.slotsRemaining} graded — fill open slots`,
      tone: "bg-emerald-50 border-emerald-200 text-emerald-900",
      countTone: "text-emerald-700",
      items: roster.makeIt,
    },
    {
      key: "bubble",
      title: "On The Bubble",
      sub: "Need another look before final cuts",
      tone: "bg-amber-50 border-amber-200 text-amber-900",
      countTone: "text-amber-700",
      items: roster.bubble,
    },
    {
      key: "cut",
      title: "Likely Cut",
      sub: "Below the line on cumulative grade",
      tone: "bg-slate-50 border-slate-200 text-slate-700",
      countTone: "text-slate-500",
      items: roster.cut,
    },
  ];
  const empty = roster.makeIt.length + roster.bubble.length + roster.cut.length === 0;
  return (
    <div className="glass-card p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="t-h3 flex items-center gap-2">
          <Icons.Clipboard className="w-4 h-4" /> Roster Projection
        </h3>
        <span className="t-eyebrow text-slate-500">
          {roster.returnerCount} returning · {roster.slotsRemaining} open of {roster.rosterCap}
        </span>
      </div>
      {empty ? (
        <p className="text-xs text-slate-500 font-medium italic">
          Grade {roster.notGraded.length > 0
            ? `the ${roster.notGraded.length} ungraded tryout${roster.notGraded.length === 1 ? "" : "s"} `
            : "tryout players "}
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
                  {b.items.map(({ signup, score }) => (
                    <li
                      key={signup.id}
                      className="flex items-baseline justify-between gap-2 text-[11px]"
                    >
                      <span className="font-bold truncate">
                        {signup.firstName} {signup.lastName}
                      </span>
                      <span className="font-black tabular-nums opacity-80 shrink-0">
                        {score.toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {(roster.notGraded.length > 0 || roster.tooOld.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {roster.notGraded.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-600">
              {roster.notGraded.length} ungraded
            </span>
          )}
          {roster.tooOld.length > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-amber-50 border border-amber-300 text-amber-800">
              {roster.tooOld.length} outside age group
            </span>
          )}
        </div>
      )}
    </div>
  );
});

const BUCKET_BADGES = {
  make: { label: "Will Make", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  bubble: { label: "Bubble", className: "bg-amber-100 text-amber-800 border-amber-200" },
  cut: { label: "Likely Cut", className: "bg-slate-100 text-slate-600 border-slate-200" },
  ungraded: { label: "Ungraded", className: "bg-white text-slate-500 border-slate-200" },
  tooOld: { label: "Too Old", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export const TryoutsTab = memo(() => {
  const {
    team,
    user,
    currentRole,
    updateTryoutSignup,
    deleteTryoutSignup,
    acceptTryout,
    saveTryoutEvaluation,
  } = useTeam();
  const toast = useToast();
  const {
    tryoutSignups,
    evaluationEvents,
    defenseSize,
    pitchingFormat,
  } = team;

  const [openSignupId, setOpenSignupId] = useState(null);
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
      list = list.filter((s) => (s.status || "tryout") === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
          (s.email || "").toLowerCase().includes(q) ||
          (s.parentName || "").toLowerCase().includes(q)
      );
    }
    return list
      .slice()
      .sort(
        (a, b) =>
          new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0)
      );
  }, [tryoutSignups, statusFilter, search]);

  const isHead = currentRole !== "assistant";

  // 3-bucket roster projection, computed once for both the top-of-tab
  // panel and the per-row bucket badge lookup.
  const roster = useMemo(
    () =>
      isHead
        ? computeRosterBuckets(team, evaluationEvents, tryoutSignups)
        : null,
    [isHead, team, evaluationEvents, tryoutSignups]
  );
  // Map signup.id → "make" | "bubble" | "cut" | "ungraded" | "tooOld"
  // for the per-row badge.
  const bucketBySignupId = useMemo(() => {
    const map = new Map();
    if (!roster) return map;
    roster.makeIt.forEach(({ signup }) => map.set(signup.id, "make"));
    roster.bubble.forEach(({ signup }) => map.set(signup.id, "bubble"));
    roster.cut.forEach(({ signup }) => map.set(signup.id, "cut"));
    roster.notGraded.forEach((s) => map.set(s.id, "ungraded"));
    roster.tooOld.forEach((s) => map.set(s.id, "tooOld"));
    return map;
  }, [roster]);
  const noShowCount = useMemo(
    () =>
      (tryoutSignups || []).filter((s) => s.present === false).length,
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

  const openSignup = openSignupId
    ? (tryoutSignups || []).find((s) => s.id === openSignupId)
    : null;

  // Local grade state for the currently-open signup card.
  const [localGrades, setLocalGrades] = useState({});
  React.useEffect(() => {
    if (!openSignupId || !user) {
      setLocalGrades({});
      return;
    }
    const ev = (evaluationEvents || []).find(
      (e) =>
        e.tryoutSignupId === openSignupId &&
        e.evaluatorId === user.uid
    );
    const seed = ev?.grades?.signup ?? ev?.grades?.["__signup__"] ?? {};
    const next = {};
    for (const c of activeCategories) next[c.id] = seed[c.id] ?? EVAL_SCALE_DEFAULT;
    if (seed.notes) next.notes = seed.notes;
    if (Array.isArray(seed.suggestedPositions))
      next.suggestedPositions = seed.suggestedPositions;
    setLocalGrades(next);
  }, [openSignupId, user, evaluationEvents, activeCategories]);

  const setLocalGrade = (_pid, catId, value) =>
    setLocalGrades((prev) => ({ ...prev, [catId]: value }));
  const setLocalNotes = (_pid, notes) =>
    setLocalGrades((prev) => ({ ...prev, notes }));
  const toggleLocalPos = (_pid, pos) =>
    setLocalGrades((prev) => {
      const list = Array.isArray(prev.suggestedPositions)
        ? prev.suggestedPositions
        : [];
      return {
        ...prev,
        suggestedPositions: list.includes(pos)
          ? list.filter((p) => p !== pos)
          : [...list, pos],
      };
    });

  const saveTryoutEval = () => {
    if (!openSignup) return;
    saveTryoutEvaluation?.(
      openSignup.id,
      localGrades,
      isHead ? "Head" : "Assistant"
    );
    toast.push({ kind: "success", title: "Tryout eval saved" });
  };

  const sendOfferLetter = async (signup) => {
    if (!signup.email) {
      toast.push({ kind: "error", title: "No email on this signup" });
      return;
    }
    const teamName = team.name || "our team";
    const fromName = user?.displayName || "Your coach";
    const subject = `${teamName} — Tryout Offer for ${signup.firstName}`;
    const acceptUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}#/?acceptTryout=${signup.id}`
        : "";
    const body = [
      `Hi ${signup.parentName || "there"},`,
      "",
      `Thanks for trying out for ${teamName}. We'd love to offer ${
        signup.firstName
      } a spot on the team for the upcoming season.`,
      "",
      acceptUrl
        ? `Tap the link below to accept (or reply to this email):`
        : `Reply to this email to accept.`,
      acceptUrl,
      "",
      `— ${fromName}`,
    ].join("\n");
    try {
      await sendGmailMessage({
        auth,
        to: signup.email,
        subject,
        body,
        fromEmail: user?.email,
        fromName,
      });
      updateTryoutSignup?.(signup.id, { status: "offered" });
      toast.push({
        kind: "success",
        title: `Offer sent to ${signup.firstName}`,
      });
    } catch {
      // Fall back to mailto so the offer still goes out.
      if (typeof window !== "undefined") {
        window.open(buildMailtoUrl(signup.email, subject, body), "_blank");
      }
      updateTryoutSignup?.(signup.id, { status: "offered" });
      toast.push({
        kind: "warn",
        title: "Opening your mail app",
        message: "Gmail send didn't fire; offer drafted there.",
      });
    }
  };

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
            <p className="t-eyebrow text-slate-500 mt-1">
              {(tryoutSignups || []).length} signup
              {(tryoutSignups || []).length === 1 ? "" : "s"}
              {noShowCount > 0 && (
                <span className="text-rose-600 ml-2">
                  · {noShowCount} no-show{noShowCount === 1 ? "" : "s"}
                </span>
              )}
            </p>
          </div>
          {isHead && noShowCount > 0 && (
            <button
              type="button"
              onClick={() => setEndTryoutOpen(true)}
              className="shrink-0 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors"
              title={`Bulk-delete the ${noShowCount} no-show signup${noShowCount === 1 ? "" : "s"}`}
            >
              End Tryout · Clear No-Shows
            </button>
          )}
        </div>
      </div>

      {isHead && roster && (tryoutSignups || []).length > 0 && (
        <TeamImpactPanel roster={roster} />
      )}

      <div className="glass-card p-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / email…"
          className="flex-1 min-w-[180px] px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
        {["all", "tryout", "offered", "accepted", "declined"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md border ${
              statusFilter === s
                ? "bg-team-primary text-team-tertiary border-team-primary"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
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
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-slate-500 text-sm font-medium">
          No tryout signups yet. Share the public form link from
          Settings to start collecting.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const impact = isHead
              ? computeImpact(s, team, evaluationEvents)
              : null;
            const expanded = openSignupId === s.id;
            const bucket = bucketBySignupId.get(s.id);
            const bucketCfg = bucket ? BUCKET_BADGES[bucket] : null;
            const presence = s.present; // true | false | undefined
            return (
              <div
                key={s.id}
                className={`bg-white border rounded-xl shadow-sm overflow-hidden ${
                  presence === false
                    ? "border-rose-200 bg-rose-50/40"
                    : "border-slate-200"
                }`}
              >
                <div className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2 flex-wrap">
                      <span className="truncate">
                        {s.tryoutNumber && (
                          <span className="text-slate-400 mr-1 tabular-nums">
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
                    <div className="text-[11px] text-slate-500 font-medium">
                      {isHead && (
                        <>
                          {s.email || "no email"} ·{" "}
                        </>
                      )}
                      {new Date(s.submittedAt).toLocaleDateString()}
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
                        className="w-12 text-center text-xs font-black tabular-nums px-1 py-1 bg-white border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
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
                            ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                            : "bg-white border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-300"
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
                            ? "bg-rose-100 border-rose-300 text-rose-800"
                            : "bg-white border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300"
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
                      setOpenSignupId(expanded ? null : s.id)
                    }
                    className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
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
                            ? "px-2 py-1 bg-red-100 text-red-800 ring-2 ring-red-300"
                            : "p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50"
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
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                      <div>
                        <div className="t-eyebrow">DOB</div>
                        <div className="font-bold text-slate-800">
                          {s.dob || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="t-eyebrow">Bats/Throws</div>
                        <div className="font-bold text-slate-800">
                          {s.bats || "R"}/{s.throws || "R"}
                        </div>
                      </div>
                      {isHead && (
                        <>
                          <div>
                            <div className="t-eyebrow">Parent</div>
                            <div className="font-bold text-slate-800 truncate">
                              {s.parentName || "—"}
                            </div>
                          </div>
                          <div>
                            <div className="t-eyebrow">Phone</div>
                            <div className="font-bold text-slate-800">
                              {s.phone || "—"}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    {s.notes && (
                      <p className="text-[11px] text-slate-700 italic bg-white border border-slate-200 rounded-lg p-2">
                        {s.notes}
                      </p>
                    )}

                    {isHead && impact && impact.positionalFit.length > 0 && (
                      <div className="bg-white border border-emerald-200 rounded-lg p-3 text-[11px]">
                        <div className="font-black uppercase tracking-widest text-emerald-900 text-[10px] mb-1.5">
                          Position Fit
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {impact.positionalFit.map((f) => (
                            <span
                              key={f.pos}
                              className="px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-800 font-black uppercase tracking-widest text-[9px]"
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
                        grades={localGrades}
                        activeCategories={activeCategories}
                        positions={activePositions}
                        onGradeChange={setLocalGrade}
                        onPositionToggle={toggleLocalPos}
                        onNotesChange={setLocalNotes}
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          type="button"
                          onClick={saveTryoutEval}
                          className="px-4 py-2 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md"
                          style={{ backgroundColor: "var(--team-primary)" }}
                        >
                          Save Eval
                        </button>
                        {isHead && s.status !== "accepted" && (
                          <button
                            type="button"
                            onClick={() => sendOfferLetter(s)}
                            className="px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-800 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200"
                          >
                            Make an Offer
                          </button>
                        )}
                        {isHead && s.status === "offered" && (
                          <button
                            type="button"
                            onClick={() => acceptTryout?.(s.id)}
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
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5 bg-rose-500" />
            <div className="p-5 sm:p-6">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-1">
                End tryout — clear no-shows?
              </h3>
              <p className="text-sm text-slate-600 font-medium mb-4">
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
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const noShows = (tryoutSignups || []).filter(
                      (s) => s.present === false
                    );
                    for (const s of noShows) {
                      deleteTryoutSignup?.(s.id);
                    }
                    setEndTryoutOpen(false);
                    toast.push({
                      kind: "success",
                      title: `${noShows.length} no-show${
                        noShows.length === 1 ? "" : "s"
                      } removed`,
                    });
                  }}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition-colors"
                >
                  Delete No-Shows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
