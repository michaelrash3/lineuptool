import React, { memo, useCallback } from "react";
import { Icons } from "../icons";
import {
  parseGameChangerPastSeasonCsv,
  suggestPlayerMatch,
} from "../utils/helpers";
import { useTeam, useUI, useToast } from "../contexts.js";

export const SettingsTab = memo(() => {
  const {
    team,
    teams,
    updateTeam,
    advanceSeason,
    uploadLogo,
    uploadScheduleCsv,
    uploadStatsCsv,
    syncGameChangerDirect,
    exportBackup,
    importBackup,
    deleteTeamCmd,
    leaveTeamCmd,
    addCoach,
    removeCoach,
  } = useTeam();
  const {
    isAddingCoach,
    setIsAddingCoach,
    newCoachForm,
    setNewCoachForm,
    setPastSeasonImport,
  } = useUI();
  const toast = useToast();
  const {
    leagueRuleSet,
    pitchingFormat,
    teamAge,
    inningsCount,
    positionLock,
    battingSize,
    defenseSize,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    logoUrl,
    coaches,
    players,
    currentSeason,
    gameChangerEmail,
    gameChangerPassword,
    gameChangerAutoSyncEnabled,
    gameChangerLastSyncAt,
  } = team;
  const isDefenseLocked = !(leagueRuleSet === "NKB" && teamAge === "9U");

  // Past-season CSV import: parse the file, open the review modal.
  const startPastSeasonImport = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = parseGameChangerPastSeasonCsv(ev.target.result);
        if (result.error) {
          toast.push({
            kind: "error",
            title: "Could not import",
            message: result.error,
          });
          return;
        }
        if (result.rows.length === 0) {
          toast.push({ kind: "warn", title: "No player rows found in file" });
          return;
        }
        // Pre-populate assignments with auto-suggested matches
        const assignments = {};
        for (const row of result.rows) {
          assignments[row.csvName] =
            suggestPlayerMatch(row.csvName, players) || "skip";
        }
        setPastSeasonImport({
          rows: result.rows,
          season: "",
          ageGroup: "",
          pitchingFormat: "Kid Pitch",
          assignments,
        });
      };
      reader.onerror = () =>
        toast.push({ kind: "error", title: "Could not read file" });
      reader.readAsText(file);
      e.target.value = "";
    },
    [players, setPastSeasonImport, toast]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white/30 shadow-[0_4px_20px_rgb(0,0,0,0.04)] border border-white/50 rounded-2xl overflow-hidden">
        <div className="p-5 flex items-center gap-4 bg-white/40 border-b border-white/40">
          <div
            className="p-2.5 rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <Icons.Settings
              className="w-6 h-6"
              style={{ color: primaryColor }}
            />
          </div>
          <h2 className="text-xl font-black uppercase tracking-wider text-slate-800">
            Team Settings
          </h2>
        </div>
        <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-10">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-5 border-b border-slate-200/50 pb-3 flex items-center gap-2">
                <Icons.Settings className="w-4 h-4" /> Game Default
                Configuration
              </h3>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      League Rules
                    </label>
                    <select
                      value={leagueRuleSet}
                      onChange={(e) =>
                        updateTeam({ leagueRuleSet: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="USSSA">USSSA Baseball</option>
                      <option value="NKB">
                        Northern Kentucky Baseball (NKB)
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Pitching Format
                    </label>
                    <select
                      value={pitchingFormat}
                      onChange={(e) =>
                        updateTeam({ pitchingFormat: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      {leagueRuleSet === "NKB" &&
                      ["6U", "7U", "8U"].includes(teamAge) ? (
                        <option value="Machine Pitch">Machine Pitch</option>
                      ) : leagueRuleSet === "USSSA" && teamAge === "8U" ? (
                        <>
                          <option value="Kid Pitch">Kid Pitch</option>
                          <option value="Coach Pitch">Coach Pitch</option>
                        </>
                      ) : (
                        <>
                          <option value="Kid Pitch">Kid Pitch</option>
                          <option value="Coach Pitch">Coach Pitch</option>
                          <option value="Machine Pitch">Machine Pitch</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Age Group
                    </label>
                    <select
                      value={teamAge}
                      onChange={(e) => updateTeam({ teamAge: e.target.value })}
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="6U">6U</option>
                      <option value="7U">7U</option>
                      <option value="8U">8U</option>
                      <option value="9U">9U</option>
                      <option value="10U">10U</option>
                      <option value="11U to 12U">11U to 12U</option>
                      <option value="13U to 14U">13U to 14U</option>
                      <option value="15U to 18U">15U to 18U</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Innings
                    </label>
                    <select
                      value={inningsCount}
                      onChange={(e) =>
                        updateTeam({ inningsCount: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                        <option key={num} value={num}>
                          {num}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Rotation
                    </label>
                    <select
                      value={positionLock}
                      onChange={(e) =>
                        updateTeam({ positionLock: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="1">1 Inn</option>
                      <option value="2">2 Inn</option>
                      <option value="3">3 Inn</option>
                      <option value="full">Full Game</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Batters
                    </label>
                    <select
                      value={battingSize}
                      onChange={(e) =>
                        updateTeam({ battingSize: e.target.value })
                      }
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
                    >
                      <option value="roster">Roster</option>
                      <option value="9">9</option>
                      <option value="10">10</option>
                      <option value="11">11</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Defense Mode
                  </label>
                  <div className="flex border border-slate-200 bg-white/60 rounded-xl shadow-sm overflow-hidden p-1">
                    <button
                      onClick={() => updateTeam({ defenseSize: "9" })}
                      disabled={isDefenseLocked}
                      className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                        defenseSize === "9"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                          : "text-slate-500 hover:bg-white/80 border border-transparent"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      9 Fielders
                    </button>
                    <button
                      onClick={() => updateTeam({ defenseSize: "10" })}
                      disabled={isDefenseLocked}
                      className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                        defenseSize === "10"
                          ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                          : "text-slate-500 hover:bg-white/80 border border-transparent"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      10 Fielders
                    </button>
                  </div>
                  {isDefenseLocked ? (
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">
                      Locked by {leagueRuleSet} rules
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">
                      Unlocked for Recreational Rules
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Users className="w-4 h-4" /> Coaching Staff
              </h3>
              <div className="space-y-3 mb-4">
                {coaches.map((c) => (
                  <div
                    key={c.id}
                    className="flex justify-between items-center bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm"
                  >
                    <div>
                      <span className="block text-sm font-black text-slate-800 uppercase">
                        {c.name}
                      </span>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                        {c.role}
                      </span>
                    </div>
                    <button
                      onClick={() => removeCoach(c.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              {isAddingCoach ? (
                <div className="bg-white/80 p-4 border border-slate-200 rounded-xl space-y-3 shadow-sm">
                  <input
                    type="text"
                    value={newCoachForm.name}
                    onChange={(e) =>
                      setNewCoachForm({ ...newCoachForm, name: e.target.value })
                    }
                    placeholder="Coach Name"
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 rounded-lg shadow-inner"
                  />
                  <select
                    value={newCoachForm.role}
                    onChange={(e) =>
                      setNewCoachForm({ ...newCoachForm, role: e.target.value })
                    }
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 rounded-lg bg-white shadow-sm"
                  >
                    <option value="Head Coach">Head Coach</option>
                    <option value="Assistant Coach">Assistant Coach</option>
                  </select>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => addCoach(newCoachForm)}
                      className="flex-1 text-white text-xs font-black uppercase tracking-widest py-3 rounded-lg shadow-sm transition-transform hover:-translate-y-0.5"
                      style={{ backgroundColor: primaryColor }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsAddingCoach(false)}
                      className="flex-1 bg-white border border-slate-300 text-slate-600 text-xs font-black uppercase tracking-widest py-3 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsAddingCoach(true)}
                  className="w-full bg-white/60 hover:bg-white text-slate-600 text-xs font-black uppercase tracking-widest py-3.5 rounded-xl border-2 border-dashed border-slate-300 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <Icons.Plus className="w-4 h-4" /> Add Coach
                </button>
              )}
            </div>
          </div>

          <div className="space-y-10">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-200/50 pb-3 flex items-center gap-2">
                <Icons.MapPin className="w-4 h-4" /> Team Identity & Season
              </h3>
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row gap-5">
                  <div className="flex-1">
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      Current Season
                    </label>
                    <input
                      type="text"
                      value={currentSeason}
                      onChange={(e) =>
                        updateTeam({ currentSeason: e.target.value })
                      }
                      placeholder="Spring 2026"
                      className="w-full p-3 bg-white/80 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={advanceSeason}
                      className="p-3 bg-slate-900 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 w-full sm:w-auto h-[46px] rounded-xl shadow-md"
                    >
                      <Icons.Forward className="w-4 h-4" /> Advance Season
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Team Colors
                  </label>
                  <div className="flex gap-8 bg-white/80 p-4 border border-slate-200 rounded-xl shadow-sm">
                    {[
                      {
                        key: "primaryColor",
                        val: primaryColor,
                        label: "Primary",
                      },
                      {
                        key: "secondaryColor",
                        val: secondaryColor,
                        label: "Accent",
                      },
                      {
                        key: "tertiaryColor",
                        val: tertiaryColor,
                        label: "Tertiary",
                      },
                    ].map(({ key, val, label }) => (
                      <div
                        key={key}
                        className="flex flex-col items-center gap-2"
                      >
                        <div className="w-10 h-10 rounded-full shadow-inner border-2 border-white overflow-hidden relative">
                          <input
                            type="color"
                            value={val}
                            onChange={(e) =>
                              updateTeam({ [key]: e.target.value })
                            }
                            className="absolute -inset-2 w-16 h-16 cursor-pointer opacity-0"
                          />
                          <div
                            className="w-full h-full"
                            style={{ backgroundColor: val }}
                          />
                        </div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Logo Upload
                  </label>
                  <div className="flex items-center gap-4 bg-white/80 p-4 border border-slate-200 rounded-xl shadow-sm">
                    {logoUrl ? (
                      <div className="relative group">
                        <img
                          src={logoUrl}
                          alt="Logo"
                          className="w-16 h-16 object-contain bg-white border border-slate-200 p-1.5 rounded-xl shadow-sm"
                        />
                        <button
                          onClick={() => updateTeam({ logoUrl: "" })}
                          className="absolute -top-2 -right-2 p-1.5 bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Icons.X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-white border border-slate-200 border-dashed rounded-xl flex items-center justify-center">
                        <Icons.Upload className="w-6 h-6 text-slate-300" />
                      </div>
                    )}
                    <label className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl p-3.5 text-xs text-center cursor-pointer font-black text-slate-700 uppercase tracking-widest transition-colors shadow-sm">
                      Choose File{" "}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={uploadLogo}
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 font-medium">
                    PNG/JPG up to 1 MB. Stored inline in your team document.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Cloud className="w-4 h-4" /> GameChanger Connection
              </h3>
              <div className="space-y-4 bg-white/70 border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      GameChanger Email
                    </label>
                    <input
                      type="email"
                      value={gameChangerEmail || ""}
                      onChange={(e) =>
                        updateTeam({ gameChangerEmail: e.target.value })
                      }
                      placeholder="coach@team.com"
                      className="w-full p-3 bg-white border border-slate-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 rounded-xl shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">
                      GameChanger Password
                    </label>
                    <input
                      type="password"
                      value={gameChangerPassword || ""}
                      onChange={(e) =>
                        updateTeam({ gameChangerPassword: e.target.value })
                      }
                      placeholder="Enter password"
                      className="w-full p-3 bg-white border border-slate-200 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 rounded-xl shadow-sm"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!gameChangerAutoSyncEnabled}
                    onChange={(e) =>
                      updateTeam({
                        gameChangerAutoSyncEnabled: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                  Enable auto-sync from GameChanger when direct integration is configured.
                </label>
                <p className="text-xs text-slate-500">
                  Credentials are stored with your team settings so future
                  direct-import integration can use them.
                </p>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={syncGameChangerDirect}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest rounded-lg"
                  >
                    Sync Now
                  </button>
                  <span className="text-[11px] text-slate-500">
                    Last sync:{" "}
                    {gameChangerLastSyncAt
                      ? new Date(gameChangerLastSyncAt).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Cloud className="w-4 h-4" /> Data Management
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Schedule CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={uploadScheduleCsv}
                    />
                  </label>
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Roster / Stats CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={uploadStatsCsv}
                    />
                  </label>
                  <label className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md col-span-2 md:col-span-1">
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-amber-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Past Season CSV
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv"
                      onChange={startPastSeasonImport}
                    />
                  </label>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={exportBackup}
                    className="flex-1 bg-white border border-slate-300 rounded-xl py-3.5 text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                  >
                    <Icons.Download className="w-4 h-4" /> Backup
                  </button>
                  <label className="flex-1 bg-white border border-slate-300 rounded-xl py-3.5 text-[10px] sm:text-xs text-center cursor-pointer font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2">
                    <Icons.Upload className="w-4 h-4" /> Restore{" "}
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={importBackup}
                    />
                  </label>
                </div>
              </div>
            </div>
            {/* Storage usage indicator — shows how close the team document is
                to Firestore's 1MB hard limit. Mostly useful as an early warning
                if the document starts approaching the cap. Slim lineup data
                keeps this well under control during normal use. */}
            {(() => {
              const FIRESTORE_LIMIT = 1048576; // 1 MB in bytes
              let docSize = 0;
              try {
                docSize = new TextEncoder().encode(
                  JSON.stringify(team || {})
                ).length;
              } catch {
                docSize = 0;
              }
              const pct = Math.min(100, (docSize / FIRESTORE_LIMIT) * 100);
              const sizeKb = Math.round(docSize / 1024);
              const limitKb = Math.round(FIRESTORE_LIMIT / 1024);
              const color =
                pct >= 90
                  ? "bg-red-500"
                  : pct >= 70
                  ? "bg-amber-500"
                  : "bg-emerald-500";
              const label =
                pct >= 90
                  ? "Critical — saves may fail soon"
                  : pct >= 70
                  ? "Watch — getting close to the limit"
                  : "Healthy";
              return (
                <div className="pt-6 border-t border-slate-200/50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-slate-800 text-sm">
                      Storage Usage
                    </h4>
                    <span className="text-xs font-black tabular-nums text-slate-700">
                      {sizeKb} KB / {limitKb} KB
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 font-medium">
                    {label} ({pct.toFixed(0)}%). Saves are limited to 1 MB per
                    team. Data resets at season rollover.
                  </p>
                </div>
              );
            })()}
            <div className="pt-6 border-t border-slate-200/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">
                  Team Management
                </h4>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Leave this team or permanently delete it.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={leaveTeamCmd}
                  disabled={teams.length <= 1}
                  className="px-6 py-3 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
                >
                  Leave Team
                </button>
                <button
                  onClick={deleteTeamCmd}
                  disabled={teams.length <= 1}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm whitespace-nowrap"
                >
                  Delete Team
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
