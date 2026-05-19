import React, { memo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts.js";
import { RecordBadge } from "./shared.jsx";

export const LoginScreen = ({ logoUrl, primaryColor, tertiaryColor, onSignIn, onEmailSignIn, genError }) => (
  <div
    className="min-h-screen flex flex-col items-center justify-center p-6 border-t-8 bg-slate-50 relative"
    style={{ borderColor: primaryColor }}
  >
    {logoUrl && (
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `url(${logoUrl})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "60%",
          opacity: 0.25,
        }}
      />
    )}
    <div className="bg-white/40 p-10 shadow-2xl max-w-sm w-full text-center rounded-2xl border border-white/50 relative z-10">
      <div className="flex justify-center mb-6">
        <div className="p-4 rounded-full bg-white border border-white/40 shadow-sm">
          <Icons.Clipboard
            className="w-10 h-10"
            style={{ color: primaryColor }}
          />
        </div>
      </div>
      <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-slate-900">
        Lineup Generator
      </h1>
      <p className="text-slate-500 mb-8 text-sm font-bold uppercase tracking-wider">
        Authentication Required
      </p>
      <button
        onClick={onSignIn}
        className="w-full py-4 px-4 font-black uppercase tracking-wider flex items-center justify-center gap-3 transition-all rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5"
        style={{ backgroundColor: primaryColor, color: tertiaryColor }}
      >
        <Icons.Users className="w-5 h-5" /> Sign In with Google
      </button>
      {onEmailSignIn && (
        <button
          onClick={onEmailSignIn}
          className="w-full mt-3 py-3 px-4 font-black uppercase tracking-wider rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
          type="button"
        >
          Sign In with Email Link
        </button>
      )}
      {genError && (
        <p className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs font-bold">
          {genError}
        </p>
      )}
    </div>
  </div>
);

export const AppHeader = memo(() => {
  const {
    team,
    teams,
    activeTeamId,
    syncStatus,
    switchTeam,
    createTeam,
    record,
    currentRole,
    realRole,
    viewAsRole,
    setViewAsRole,
    joinTeamByCode,
  } = useTeam();
  const {
    isAddingTeam,
    setIsAddingTeam,
    newTeamName,
    setNewTeamName,
  } = useUI();
  const [isJoiningTeam, setIsJoiningTeam] = React.useState(false);
  const [joinCodeInput, setJoinCodeInput] = React.useState("");
  const activeTeamName =
    teams.find((t) => t.id === activeTeamId)?.name || "TEAM";
  const subtitle =
    currentRole === "assistant"
      ? "Assistant Coach View"
      : "Head Coach Dashboard";
  // Persistent chip when the head coach is previewing the assistant view.
  // Only the real head sees this — assistants can never toggle it on.
  const showViewAsChip = realRole === "head" && viewAsRole === "assistant";

  return (
    <header className="print:hidden w-full relative z-20 bg-white/40 shadow-[0_4px_20px_rgb(0,0,0,0.04)]">
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: team.primaryColor }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 md:gap-5">
          {team.logoUrl ? (
            <img
              src={team.logoUrl}
              alt="Team Logo"
              className="w-16 h-16 md:w-20 md:h-20 object-contain p-1"
            />
          ) : (
            <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm">
              <Icons.Clipboard
                className="w-6 h-6"
                style={{ color: team.primaryColor }}
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none text-slate-900">
                {activeTeamName}
              </h1>
              <RecordBadge
                record={record}
                variant="compact"
                primaryColor={team.primaryColor}
                tertiaryColor={team.tertiaryColor}
              />
            </div>
            <p className="text-xs uppercase tracking-widest font-extrabold mt-1 text-slate-500">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {showViewAsChip && (
            <div className="flex items-center gap-2 bg-amber-100 border border-amber-300 rounded-xl px-3 py-2 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-900 whitespace-nowrap">
                Viewing as Assistant
              </span>
              <button
                type="button"
                onClick={() => setViewAsRole?.(null)}
                className="text-[10px] font-black uppercase tracking-widest text-amber-900 underline hover:no-underline"
              >
                Revert
              </button>
            </div>
          )}
          <select
            value={activeTeamId}
            onChange={(e) => switchTeam(e.target.value)}
            className="p-3 outline-none flex-1 sm:w-64 text-sm font-black uppercase tracking-wider cursor-pointer rounded-xl bg-white/20 hover:bg-white transition-colors border border-slate-200 shadow-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-slate-900/85 text-white print:hidden relative z-10 border-b border-slate-900 shadow-inner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full sm:max-w-md">
            {isJoiningTeam ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await joinTeamByCode?.(joinCodeInput);
                  if (ok) {
                    setJoinCodeInput("");
                    setIsJoiningTeam(false);
                  }
                }}
                className="flex items-center gap-2 w-full"
              >
                <input
                  autoFocus
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) =>
                    setJoinCodeInput(e.target.value.toUpperCase())
                  }
                  placeholder="TEAM CODE"
                  maxLength={8}
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 flex-1 uppercase tracking-widest font-mono bg-slate-900/50 text-white rounded-lg shadow-inner"
                />
                <button
                  type="submit"
                  className="p-2 text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                  style={{
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-tertiary)",
                  }}
                  title="Join team"
                >
                  <Icons.Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsJoiningTeam(false);
                    setJoinCodeInput("");
                  }}
                  className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </form>
            ) : isAddingTeam ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createTeam(newTeamName);
                }}
                className="flex items-center gap-2 w-full"
              >
                <input
                  autoFocus
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="NEW TEAM NAME"
                  className="p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 flex-1 uppercase bg-slate-900/50 text-white rounded-lg shadow-inner"
                />
                <button
                  type="submit"
                  className="p-2 text-white rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                  style={{
                    backgroundColor: "var(--team-primary)",
                    color: "var(--team-tertiary)",
                  }}
                >
                  <Icons.Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingTeam(false)}
                  className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAddingTeam(true)}
                  className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Plus className="w-3.5 h-3.5" /> New Team
                </button>
                <button
                  onClick={() => setIsJoiningTeam(true)}
                  className="text-xs bg-slate-700/80 hover:bg-slate-600 py-2 px-4 transition-colors flex items-center gap-2 justify-center font-extrabold uppercase tracking-wider rounded-lg shadow-sm"
                >
                  <Icons.Users className="w-3.5 h-3.5" /> Join Team
                </button>
              </div>
            )}
          </div>
          {syncStatus && (
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
              {syncStatus === "Saving" || syncStatus === "Creating" ? (
                <Icons.Refresh className="w-3 h-3 animate-spin text-blue-400" />
              ) : (
                <Icons.Cloud className="w-3 h-3 text-green-400" />
              )}
              {syncStatus}
            </div>
          )}
        </div>
      </div>
    </header>
  );
});

export const TabBarNav = memo(({ activeTab, setActiveTab, navButtons }) => {
  return (
    <div className="bg-white/30 border-b border-white/40 print:hidden relative z-10 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="flex overflow-x-auto scrollbar-hide gap-2 pb-4">
          {navButtons.map((btn) => {
            const Icon = btn.icon;
            const isActive = activeTab === btn.id;
            // Settings is the only right-pushed tab (per design spec).
            // The retired `submit-eval` pseudo-tab gate was carried for a
            // release; safe to drop now since PR F replaced it with a
            // real `eval` tab.
            const rightAlign = btn.id === "settings";
            return (
              <button
                key={btn.id}
                onClick={() => setActiveTab(btn.id)}
                className={`py-2.5 px-5 font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 whitespace-nowrap rounded-full transition-all duration-200 border ${
                  isActive
                    ? "shadow-sm"
                    : "text-slate-600 hover:bg-white/80 hover:text-slate-900 border-transparent"
                } ${rightAlign ? "ml-auto" : ""}`}
                style={
                  isActive
                    ? {
                        backgroundColor: "var(--team-secondary)",
                        color: "var(--team-primary)",
                        borderColor: "var(--team-primary)",
                      }
                    : undefined
                }
              >
                <Icon className="w-4 h-4" /> {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
