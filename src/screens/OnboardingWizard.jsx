import React, { memo, useEffect, useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts.js";

export const OnboardingWizard = memo(() => {
  const { team, teams, activeTeamId, user, updateTeam } = useTeam();
  const {
    setActiveTab,
    setIsAddingTeam,
    setIsAddingPlayer,
    setIsAddingGame,
  } = useUI();

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) || null,
    [teams, activeTeamId]
  );

  const hasTeamBasics = Boolean((activeTeam?.name || "").trim());
  const hasRoster = (team.players || []).length > 0;
  const hasGame = (team.games || []).length > 0;
  const hasAttendance = (team.games || []).some(
    (g) => g.attendance && Object.keys(g.attendance).length > 0
  );
  const hasGeneratedLineup = (team.games || []).some(
    (g) => Array.isArray(g.lineup) && g.lineup.length > 0 && Array.isArray(g.battingLineup)
  );

  const steps = [
    { id: 1, label: "Create team basics", done: hasTeamBasics },
    { id: 2, label: "Add or import roster", done: hasRoster },
    { id: 3, label: "Add your first game", done: hasGame },
    {
      id: 4,
      label: "Set attendance and generate lineup",
      done: hasAttendance && hasGeneratedLineup,
    },
  ];

  const allDone = steps.every((s) => s.done);
  const dismissed = Boolean(team.onboardingDismissedBy?.[user?.uid || ""]);

  useEffect(() => {
    if (!user?.uid || !allDone) return;
    const completedBy = team.onboardingCompletedBy || {};
    if (completedBy[user.uid]) return;
    updateTeam({
      onboardingCompletedBy: {
        ...completedBy,
        [user.uid]: true,
      },
    });
  }, [allDone, team.onboardingCompletedBy, updateTeam, user?.uid]);

  const firstIncomplete = steps.find((s) => !s.done)?.id || 4;
  if (dismissed || allDone) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white/50 border border-white/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-white/60 bg-white/40">
          <h2 className="text-2xl font-black uppercase tracking-wider text-slate-900">Coach Setup Wizard</h2>
          <p className="text-sm font-semibold text-slate-600 mt-2">
            Let&apos;s get your team ready in four quick steps.
          </p>
        </div>
        <div className="p-6 space-y-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`rounded-xl border p-4 flex items-center justify-between ${
                step.done ? "bg-green-50 border-green-200" : "bg-white/70 border-slate-200"
              }`}
            >
              <div className="flex items-center gap-3">
                {step.done ? (
                  <Icons.Check className="w-5 h-5 text-green-700" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                )}
                <div className="text-sm font-black uppercase tracking-wider text-slate-800">
                  {step.id}. {step.label}
                </div>
              </div>
              {step.done && <span className="text-[10px] font-black uppercase text-green-700">Done</span>}
            </div>
          ))}
        </div>
        <div className="p-6 border-t border-white/60 bg-white/40 flex flex-wrap gap-3">
          {firstIncomplete === 1 && (
            <button
              onClick={() => {
                setActiveTab("home");
                setIsAddingTeam(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest"
            >
              Team Basics
            </button>
          )}
          {firstIncomplete === 2 && (
            <>
              <button
                onClick={() => {
                  setActiveTab("roster");
                  setIsAddingPlayer(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest"
              >
                Add Player
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest"
              >
                Import Roster
              </button>
            </>
          )}
          {firstIncomplete === 3 && (
            <>
              <button
                onClick={() => {
                  setActiveTab("schedule");
                  setIsAddingGame(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest"
              >
                Add First Game
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest"
              >
                Import Schedule
              </button>
            </>
          )}
          {firstIncomplete === 4 && (
            <button
              onClick={() => setActiveTab("schedule")}
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest"
            >
              Open Game Setup
            </button>
          )}
          <button
            onClick={() => {
              if (!user?.uid) return;
              const dismissedBy = team.onboardingDismissedBy || {};
              updateTeam({
                onboardingDismissedBy: { ...dismissedBy, [user.uid]: true },
              });
            }}
            className="ml-auto px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs font-black uppercase tracking-widest"
          >
            Hide Guide
          </button>
        </div>
      </div>
    </div>
  );
});
