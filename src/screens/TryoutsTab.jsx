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
  const tryoutGrade = tryoutEvent?.grades?.["__signup__"];
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
    const seed = ev?.grades?.["__signup__"] || {};
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
        <div className="p-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="t-h2 flex items-center gap-3">
              <Icons.Users className="w-6 h-6" /> Tryouts
            </h2>
            <p className="t-eyebrow text-slate-500 mt-1">
              {(tryoutSignups || []).length} signup
              {(tryoutSignups || []).length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

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
            return (
              <div
                key={s.id}
                className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
              >
                <div className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-black uppercase tracking-tight text-slate-900">
                      {s.firstName} {s.lastName}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      {s.email || "no email"} ·{" "}
                      {new Date(s.submittedAt).toLocaleDateString()}
                    </div>
                  </div>
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
                  {isHead && (
                    <button
                      type="button"
                      onClick={() => deleteTryoutSignup?.(s.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                      title="Delete signup"
                    >
                      <Icons.Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
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
                    </div>
                    {s.notes && (
                      <p className="text-[11px] text-slate-700 italic bg-white border border-slate-200 rounded-lg p-2">
                        {s.notes}
                      </p>
                    )}

                    {isHead && impact && (
                      <div className="bg-white border border-amber-200 rounded-lg p-3 text-[11px]">
                        <div className="font-black uppercase tracking-widest text-amber-900 text-[10px] mb-1.5">
                          Impact Analysis
                        </div>
                        <div className="text-slate-800 font-bold">
                          {impact.verdict}
                        </div>
                        {impact.tryoutScore != null && (
                          <div className="text-slate-500 mt-0.5">
                            Tryout score: {impact.tryoutScore.toFixed(1)} ·
                            Cutoff (roster cap {impact.rosterCap}):{" "}
                            {impact.cutoff.toFixed(1)}
                          </div>
                        )}
                        {impact.positionalFit.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {impact.positionalFit.map((f) => (
                              <span
                                key={f.pos}
                                className="px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-800 font-black uppercase tracking-widest text-[9px]"
                              >
                                Fills {f.pos} ({f.returnerCount} returners)
                              </span>
                            ))}
                          </div>
                        )}
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
    </div>
  );
});
