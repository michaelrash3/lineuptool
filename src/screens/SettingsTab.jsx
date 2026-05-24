import React, { memo, useCallback, useMemo, useState } from "react";
import { Icons } from "../icons";
import { QRCodeImg } from "../components/QRCodeImg.jsx";
import {
  parseGameChangerPastSeasonCsv,
  suggestPlayerMatch,
} from "../utils/helpers";
import { computeNextSeason } from "../constants/ui";
import { useTeam, useUI, useToast } from "../contexts.js";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { AdvanceSeasonModal } from "../components/AdvanceSeasonModal.jsx";
import { StorageUsagePanel, TeamManagementPanel } from "./settings/AdvancedSettingsPanel.jsx";

// One row per team color: swatch (native color picker) + hex text input.
// Typing a valid #rrggbb commits on every keystroke; invalid input is
// ignored, and the field snaps back to the stored value on blur.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const TeamColorPicker = memo(({ colorKey, val, label, updateTeam }) => {
  const [draft, setDraft] = useState(val);
  // Keep draft in sync when the underlying team value changes externally
  // (e.g. another tab edits the team or the user picks via the swatch).
  React.useEffect(() => {
    setDraft(val);
  }, [val]);
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full shadow-inner border-2 border-white overflow-hidden relative shrink-0">
        <input
          type="color"
          value={val}
          onChange={(e) => updateTeam({ [colorKey]: e.target.value })}
          className="absolute -inset-2 w-16 h-16 cursor-pointer opacity-0"
          aria-label={`${label} color picker`}
        />
        <div
          className="w-full h-full"
          style={{ backgroundColor: val }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {label}
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (HEX_RE.test(next)) updateTeam({ [colorKey]: next.toLowerCase() });
          }}
          onBlur={() => {
            if (!HEX_RE.test(draft)) setDraft(val);
          }}
          spellCheck={false}
          placeholder="#000000"
          maxLength={7}
          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-700 outline-none focus:ring-2 focus:ring-[var(--team-primary)] uppercase"
        />
      </div>
    </div>
  );
});

// Tryouts settings panel — head-only. Generate the public share link,
// toggle the public form open/closed, and configure roster cap for
// impact analysis comparisons.
const TryoutsSettingsPanel = memo(
  ({
    team,
    generateTryoutShareId,
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    toast,
  }) => {
    const shareId = team.tryoutShareId;
    const open = team.tryoutsOpen === true;
    const phase = team.tryoutsPhase || (open ? "open" : "intake_closed");
    const cap = team.rosterCap || 12;
    const shareUrl =
      shareId && typeof window !== "undefined"
        ? `${window.location.origin}/tryouts-portal/${shareId}`
        : null;
    return (
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
          <Icons.Users className="w-4 h-4" /> Tryouts
        </h3>
        <p className="text-[11px] text-slate-500 font-medium mb-3">
          Generate a public share link parents can fill out. Toggle off
          when tryouts close to stop accepting new signups.
        </p>
        <div className="space-y-3">
          {shareId ? (
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                Public link
              </div>
              <code className="block text-[11px] text-slate-700 break-all font-mono bg-slate-50 border border-slate-200 rounded-md p-2">
                {shareUrl}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard && shareUrl) {
                      navigator.clipboard.writeText(shareUrl);
                      toast.push({ kind: "success", title: "Link copied" });
                    }
                  }}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => generateTryoutShareId?.()}
                  className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                >
                  Regenerate
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => generateTryoutShareId?.()}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md"
              style={{ backgroundColor: "var(--team-primary)" }}
            >
              Generate Tryout Share Link
            </button>
          )}


          <TryoutDateLinkPanel
            team={team}
            generateTryoutDateLink={generateTryoutDateLink}
            toast={toast}
          />

          <label className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3 cursor-pointer">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-slate-800">
                Tryouts Open
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                {open
                  ? "Public form is accepting signups."
                  : "Public form is closed. Existing signups stay visible."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTryoutsOpen?.(!open)}
              className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                open ? "bg-emerald-500" : "bg-slate-300"
              }`}
              aria-label="Toggle tryouts open"
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                  open ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </label>



          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
              Tryout lifecycle
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setTryoutsOpen?.(false)}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Close Signups
              </button>
              <button
                type="button"
                onClick={() => completeTryouts?.()}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white rounded-md"
                style={{ backgroundColor: "#334155" }}
              >
                Complete Tryouts
              </button>
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              Current phase: <strong>{phase}</strong>
            </div>
          </div>

          <label className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-black uppercase tracking-widest text-slate-800">
                Roster Cap
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                Used by Impact Analysis to compute the cutoff returner.
              </div>
            </div>
            <input
              type="number"
              min={5}
              max={30}
              value={cap}
              onChange={(e) => setRosterCap?.(e.target.value)}
              className="shrink-0 w-16 text-center px-2 py-1 text-sm font-black bg-white border border-slate-200 rounded-md"
            />
          </label>
        </div>
      </div>
    );
  }
);


const TryoutDateLinkPanel = memo(({ team, generateTryoutDateLink, toast }) => {
  const [date, setDate] = useState("");
  const slug = team.tryoutDateSlug || "";
  const url =
    slug && typeof window !== "undefined"
      ? `${window.location.origin}/tryouts-portal/${slug}`
      : "";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
        Tryout date link
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Tryout Date</label>
          <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg" />
        </div>
        <button
          type="button"
          onClick={() => {
            const made = generateTryoutDateLink?.(date);
            if (!made) {
              toast.push({ kind: "warn", title: "Enter a tryout date first" });
              return;
            }
            toast.push({ kind: "success", title: "Date link generated" });
          }}
          className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white rounded-md"
          style={{ backgroundColor: "var(--team-primary)" }}
        >
          Generate Link
        </button>
      </div>
      {url ? (
        <>
          <code className="block text-[11px] text-slate-700 break-all font-mono bg-slate-50 border border-slate-200 rounded-md p-2">{url}</code>
          <div className="flex items-start gap-3 flex-wrap">
            <QRCodeImg value={url} size={120} />
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(url);
                    toast.push({ kind: "success", title: "Date link copied" });
                  }
                }}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Copy Date Link
              </button>
              <p className="text-[10px] font-medium text-slate-500 leading-snug">
                Scan to open the signup page on a phone — useful at the field.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
});

// Team Join Code panel. Shows the persistent 6-char code anyone can
// use to join the team as an assistant. HC regenerates to rotate.
const JoinCodePanel = memo(({ team, regenerateJoinCode, toast }) => {
  const code = team.joinCode || "";
  const url =
    code && typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?join=${code}`
      : "";
  // In-app replacement for the window.confirm prompt that previously
  // guarded code rotation. Modal matches the patterns in #131 / #132.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ kind: "success", title: `${label} copied` });
    } catch {
      toast.push({ kind: "warn", title: "Couldn't access clipboard" });
    }
  };
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
        <Icons.Users className="w-4 h-4" /> Team Code
      </h3>
      <p className="text-[11px] text-slate-500 font-medium mb-3">
        Share this 6-character code with anyone you want to invite as
        an assistant coach. They tap <strong>Join Team</strong> in the
        header and enter it. Head coaches can promote them later via
        Coach Roles below. Regenerate any time to rotate the code.
      </p>
      {code ? (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
            <code
              className="text-2xl font-black tracking-[0.25em] font-mono px-3 py-2 rounded-lg"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-tertiary)",
              }}
            >
              {code}
            </code>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={() => copy(code, "Team code")}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Copy Code
              </button>
              <button
                type="button"
                onClick={() => copy(url, "Join link")}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Copy Link
              </button>
            </div>
          </div>
          <div className="flex justify-between items-center gap-3">
            <code className="text-[10px] text-slate-500 font-mono truncate flex-1 min-w-0">
              {url}
            </code>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="shrink-0 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
            >
              Regenerate
            </button>
          </div>
          <div className="flex items-start gap-3 flex-wrap pt-1">
            <QRCodeImg value={url} size={120} />
            <p className="text-[10px] font-medium text-slate-500 leading-snug flex-1 min-w-0">
              Have an assistant coach scan this with their phone — they'll
              land in-app on Join Team with the code pre-filled.
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => regenerateJoinCode?.()}
          className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-tertiary)",
          }}
        >
          Generate Team Code
        </button>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-1.5 bg-amber-500" />
            <div className="p-5 sm:p-6">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-1">
                Rotate team code?
              </h3>
              <p className="text-sm text-slate-600 font-medium mb-5">
                The current code{" "}
                <code className="font-mono font-black text-slate-900">
                  {code}
                </code>{" "}
                will stop working immediately. Anyone you've already invited
                with the old code will need the new one to join.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    regenerateJoinCode?.();
                    setConfirmOpen(false);
                  }}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-md transition-colors"
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// Diagnostics — head-only triage tool. Surfaces the Firestore truth
// for the active team alongside the current Auth UID so account /
// data-linkage problems are visible without DevTools.
const DiagnosticsPanel = memo(({ team, user, activeTeamId }) => {
  const [open, setOpen] = React.useState(false);
  const uid = user?.uid || "(not signed in)";
  const ownerId = team?.ownerId || "(none)";
  const members = Array.isArray(team?.members) ? team.members : [];
  const isOwner = uid === ownerId;
  const isMember = members.includes(uid);
  return (
    <div className="pt-6 border-t border-slate-200/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900"
      >
        <Icons.Alert className="w-3.5 h-3.5" />
        {open ? "Hide" : "Show"} Diagnostics
      </button>
      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 text-[11px] font-mono space-y-2">
          <Row
            label="Your Auth UID"
            value={uid}
            badge={isOwner ? "OWNER" : isMember ? "MEMBER" : "NOT IN MEMBERS"}
            badgeKind={isOwner ? "ok" : isMember ? "ok" : "warn"}
          />
          <Row label="Active Team ID" value={activeTeamId || "(none)"} />
          <Row label="Team ownerId" value={ownerId} />
          <Row
            label={`Members (${members.length})`}
            value={
              members.length
                ? members.join(", ")
                : "(empty — engine writes will be rejected by rules)"
            }
          />
          <Row
            label="Players"
            value={`${(team?.players || []).length} entries`}
          />
          <Row
            label="Evaluation events"
            value={`${(team?.evaluationEvents || []).length} entries`}
          />
          <Row
            label="Games"
            value={`${(team?.games || []).length} entries`}
          />
          {!isOwner && !isMember && (
            <p className="pt-2 text-[10px] text-rose-700 font-bold not-italic font-sans">
              ⚠ Your UID isn&apos;t in this team&apos;s members[]. Ask the
              owner to add it via Firestore Console, or sign in with the
              account whose UID matches ownerId.
            </p>
          )}
          <div className="pt-3 border-t border-slate-200 flex flex-wrap gap-2 not-italic font-sans">
            <button
              type="button"
              onClick={async () => {
                try {
                  // Best-effort local-state flush — clears the active-team
                  // pointer + any cached offline writes so the next sign-in
                  // is a clean read.
                  if (typeof window !== "undefined") {
                    try {
                      window.sessionStorage.clear();
                    } catch {}
                  }
                  await signOut(auth);
                  if (typeof window !== "undefined") {
                    window.location.reload();
                  }
                } catch (err) {
                  // Surface but don't crash — user can hard-refresh if needed.
                  // eslint-disable-next-line no-alert
                  alert(
                    "Sign-out failed: " +
                      (err?.message || "unknown error") +
                      ". Try reloading the page."
                  );
                }
              }}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Sign Out + Reload
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;
                try {
                  window.localStorage.clear();
                  window.sessionStorage.clear();
                } catch {}
                window.location.reload();
              }}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-white border border-amber-300 text-amber-800 hover:bg-amber-50"
            >
              Reset Local Cache + Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

const Row = ({ label, value, badge, badgeKind }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
    <span className="text-slate-500 shrink-0 font-bold uppercase tracking-widest text-[10px]">
      {label}
    </span>
    <span className="text-slate-800 break-all flex-1 min-w-0">{value}</span>
    {badge && (
      <span
        className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${
          badgeKind === "ok"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-rose-50 border-rose-200 text-rose-700"
        }`}
      >
        {badge}
      </span>
    )}
  </div>
);

export const SettingsTab = memo(() => {
  const {
    team,
    teams,
    user,
    activeTeamId,
    updateTeam,
    advanceSeason,
    exportRosterCsv,
    exportNewPlayersCsv,
    setPlayerStatus,
    generateTryoutShareId,
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    regenerateJoinCode,
    uploadLogo,
    uploadScheduleCsv,
    uploadStatsCsv,
    exportBackup,
    importBackup,
    deleteTeamCmd,
    leaveTeamCmd,
    addCoach,
    removeCoach,
    setCoachRole,
    realRole,
    viewAsRole,
    setViewAsRole,
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
  } = team;
  const isDefenseLocked = !(leagueRuleSet === "NKB" && teamAge === "9U");
  const [settingsMenu, setSettingsMenu] = useState("team");
  const [advanceSeasonOpen, setAdvanceSeasonOpen] = useState(false);

  // Pre-compute the next-season label so the modal header can render
  // it without the user pressing the button first. computeNextSeason
  // returns null when the current label can't be parsed (e.g. blank),
  // which the modal renders as "Next Season".
  const nextSeasonLabel = useMemo(() => {
    const next = computeNextSeason(team?.currentSeason);
    return next?.nextSeason || "Next Season";
  }, [team?.currentSeason]);
  const settingsMenuItems = [
    { id: "team", label: "Team" },
    { id: "tryouts", label: "Tryouts" },
    { id: "staff", label: "Staff" },
    { id: "imports", label: "Imports" },
    { id: "advanced", label: "Advanced" },
  ];
  const settingsMenuDescriptions = {
    team: "Core game defaults, season identity, and visual branding.",
    tryouts: "Tryout portal controls, share links, and roster cap behavior.",
    staff: "Coaching roster, roles, and join-code controls.",
    imports: "CSV imports plus backup/export/restore operations.",
    advanced: "Diagnostics, storage details, team leave/delete, and test mode.",
  };

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
        <div className="px-8 pt-6">
          <div className="flex flex-wrap gap-2">
            {settingsMenuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSettingsMenu(item.id)}
                className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                  settingsMenu === item.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white/80 text-slate-600 border-slate-200 hover:bg-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500 font-medium">
            {settingsMenuDescriptions[settingsMenu]}
          </p>
        </div>
        <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-10">
            {settingsMenu === "team" && (
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
                      className="w-full p-3 bg-white/80 border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-white"
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
            )}
            {settingsMenu === "staff" && (
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
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-lg shadow-inner"
                  />
                  <select
                    value={newCoachForm.role}
                    onChange={(e) =>
                      setNewCoachForm({ ...newCoachForm, role: e.target.value })
                    }
                    className="w-full p-2.5 border border-slate-300 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-lg bg-white shadow-sm"
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
            )}

            {settingsMenu === "tryouts" && (
            <TryoutsSettingsPanel
              team={team}
              generateTryoutShareId={generateTryoutShareId}
              generateTryoutDateLink={generateTryoutDateLink}
              setTryoutsOpen={setTryoutsOpen}
              completeTryouts={completeTryouts}
              setRosterCap={setRosterCap}
              toast={toast}
            />
            )}

            {settingsMenu === "staff" && (
            <JoinCodePanel
              team={team}
              regenerateJoinCode={regenerateJoinCode}
              toast={toast}
            />
            )}

            {settingsMenu === "staff" && (
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Users className="w-4 h-4" /> Coach Roles
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mb-3">
                Head coaches can edit lineups, evals, and settings. Assistants
                submit eval grades and view today&apos;s lineup.
              </p>
              <div className="space-y-2 mb-2">
                {(team.members || [])
                  .filter((uid) => uid !== team.ownerId)
                  .map((uid) => {
                    const role =
                      team.coachRoles?.[uid] === "head" ? "head" : "assistant";
                    const isMe = user && uid === user.uid;
                    return (
                      <div
                        key={uid}
                        className="flex justify-between items-center bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 truncate">
                            {isMe ? "You" : uid.slice(0, 12) + "…"}
                          </div>
                          <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                            {role === "head" ? "Head Coach" : "Assistant Coach"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCoachRole?.(
                              uid,
                              role === "head" ? "assistant" : "head"
                            )
                          }
                          className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 whitespace-nowrap"
                        >
                          {role === "head" ? "Make Assistant" : "Make Head"}
                        </button>
                      </div>
                    );
                  })}
                {(team.members || []).filter((uid) => uid !== team.ownerId)
                  .length === 0 && (
                  <p className="text-[11px] text-slate-400 font-medium italic">
                    No other coaches have joined yet.
                  </p>
                )}
              </div>
            </div>
            )}

            {settingsMenu === "staff" && (
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Clipboard className="w-4 h-4" /> Eval Reminders
              </h3>
              <label className="flex items-start gap-3 bg-white border border-slate-200 p-3 rounded-xl shadow-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={team.emailEvalRemindersDisabled !== true}
                  onChange={(e) =>
                    updateTeam({
                      emailEvalRemindersDisabled: !e.target.checked,
                    })
                  }
                  className="mt-0.5 w-4 h-4 accent-blue-600"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-black uppercase tracking-widest text-slate-800">
                    Email eval reminders to coaches
                  </span>
                  <span className="block text-[11px] text-slate-500 font-medium mt-0.5">
                    When an eval round is due, send a single reminder
                    email from your signed-in Gmail to every coach who
                    hasn&apos;t submitted. Cool-off of 7 days between
                    batches.
                  </span>
                </span>
              </label>
              {team.lastEvalEmailedAt && (
                <p className="text-[10px] text-slate-400 font-medium mt-2 px-1">
                  Last reminder batch sent{" "}
                  {new Date(team.lastEvalEmailedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            )}

          </div>

          <div className="space-y-10">
            {settingsMenu === "team" && (
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
                      className="w-full p-3 bg-white/80 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => setAdvanceSeasonOpen(true)}
                      className="p-3 bg-slate-900 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 w-full sm:w-auto h-[46px] rounded-xl shadow-md"
                    >
                      <Icons.Forward className="w-4 h-4" /> Advance Season
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 font-medium">
                  Marks each player as Returning or Released when you advance
                  to the next season. Stats from finished games are archived
                  to season history.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={exportRosterCsv}
                    className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Icons.Forward className="w-3.5 h-3.5" /> Export Roster CSV
                  </button>
                  <button
                    type="button"
                    onClick={exportNewPlayersCsv}
                    className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Icons.Forward className="w-3.5 h-3.5" /> Export New Players CSV
                  </button>
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">
                    Team Colors
                  </label>
                  <div className="bg-white/80 p-4 border border-slate-200 rounded-xl shadow-sm space-y-3">
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
                      <TeamColorPicker
                        key={key}
                        colorKey={key}
                        val={val}
                        label={label}
                        updateTeam={updateTeam}
                      />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mr-1">
                      Live Preview
                    </span>
                    <span
                      className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-sm tabular-nums"
                      style={{
                        backgroundColor: primaryColor,
                        color: tertiaryColor,
                      }}
                    >
                      8-3
                    </span>
                    <span
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border"
                      style={{
                        backgroundColor: secondaryColor,
                        color: primaryColor,
                        borderColor: primaryColor,
                      }}
                    >
                      Today
                    </span>
                    <button
                      type="button"
                      className="text-[11px] px-4 py-2 font-black uppercase tracking-widest rounded-xl shadow-md cursor-default"
                      style={{
                        backgroundColor: primaryColor,
                        color: tertiaryColor,
                      }}
                      tabIndex={-1}
                    >
                      Primary Button
                    </button>
                    <span
                      className="text-[10px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full border cursor-default"
                      style={{
                        backgroundColor: secondaryColor,
                        color: primaryColor,
                        borderColor: primaryColor,
                      }}
                    >
                      Active Tab
                    </span>
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
                    <label
                      htmlFor="settings-logo-upload"
                      className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl p-3.5 text-xs text-center cursor-pointer font-black text-slate-700 uppercase tracking-widest transition-colors shadow-sm"
                    >
                      Choose File{" "}
                      <input
                        id="settings-logo-upload"
                        type="file"
                        accept="image/*"
                        className="sr-only"
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
            )}
            {settingsMenu === "imports" && (
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Icons.Cloud className="w-4 h-4" /> Data Management
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label
                    htmlFor="settings-import-schedule-csv"
                    className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md"
                  >
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Schedule CSV
                    </span>
                    <input
                      id="settings-import-schedule-csv"
                      type="file"
                      className="sr-only"
                      accept=".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain"
                      onChange={uploadScheduleCsv}
                    />
                  </label>
                  <label
                    htmlFor="settings-import-roster-csv"
                    className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md"
                  >
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-blue-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Roster / Stats CSV
                    </span>
                    <input
                      id="settings-import-roster-csv"
                      type="file"
                      className="sr-only"
                      accept=".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain"
                      onChange={uploadStatsCsv}
                    />
                  </label>
                  <label
                    htmlFor="settings-import-past-season-csv"
                    className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-white/60 hover:bg-white hover:border-slate-400 transition-all group h-full shadow-sm hover:shadow-md col-span-2 md:col-span-1"
                  >
                    <Icons.Upload className="w-6 h-6 text-slate-300 group-hover:text-amber-500 mb-3 transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center leading-snug">
                      Import
                      <br />
                      Past Season CSV
                    </span>
                    <input
                      id="settings-import-past-season-csv"
                      type="file"
                      className="sr-only"
                      accept=".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain"
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
                  <label
                    htmlFor="settings-restore-backup"
                    className="flex-1 bg-white border border-slate-300 rounded-xl py-3.5 text-[10px] sm:text-xs text-center cursor-pointer font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                  >
                    <Icons.Upload className="w-4 h-4" /> Restore{" "}
                    <input
                      id="settings-restore-backup"
                      type="file"
                      accept=".json"
                      className="sr-only"
                      onChange={importBackup}
                    />
                  </label>
                </div>
              </div>
            </div>
            )}
            {settingsMenu === "advanced" && <StorageUsagePanel team={team} />}
            {settingsMenu === "advanced" && (
              <DiagnosticsPanel team={team} user={user} activeTeamId={activeTeamId} />
            )}
            {settingsMenu === "advanced" && (
              <TeamManagementPanel
                teams={teams}
                leaveTeamCmd={leaveTeamCmd}
                deleteTeamCmd={deleteTeamCmd}
              />
            )}
            {settingsMenu === "advanced" && realRole === "head" && (
              <div className="pt-6 border-t border-slate-200/50">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  Testing
                </div>
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">
                      View as Assistant Coach
                    </h4>
                    <p className="text-[11px] text-slate-600 mt-1 font-medium leading-snug max-w-md">
                      Preview the assistant experience. Revert anytime from
                      the header chip or this toggle.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setViewAsRole?.(
                        viewAsRole === "assistant" ? null : "assistant"
                      )
                    }
                    className={`shrink-0 px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-colors ${
                      viewAsRole === "assistant"
                        ? "bg-amber-600 text-white hover:bg-amber-700"
                        : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-50"
                    }`}
                  >
                    {viewAsRole === "assistant" ? "Revert to Head" : "View as Assistant"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AdvanceSeasonModal
        open={advanceSeasonOpen}
        players={team.players || []}
        currentSeason={team.currentSeason}
        nextSeasonLabel={nextSeasonLabel}
        setPlayerStatus={setPlayerStatus}
        onClose={() => setAdvanceSeasonOpen(false)}
        onConfirm={() => {
          setAdvanceSeasonOpen(false);
          advanceSeason({ skipConfirm: true });
        }}
      />
    </div>
  );
});
