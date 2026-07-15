import React, { memo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "../icons";
import { QRCodeImg } from "../components/QRCodeImg";
import {
  parseGameChangerPastSeasonCsv,
  suggestPlayerMatch,
  buildScheduleIcs,
} from "../utils/helpers";
import { allowedPitchingFormats, leagueRuleSetLabel } from "../constants/ui";
import {
  TOGGLEABLE_FEATURES,
  featureEnabled,
  toggleFeature,
} from "../constants/features";
import { useConfirm, useTeam, useUI, useToast } from "../contexts";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { extractLogoPalette } from "../components/shared";
import {
  StorageUsagePanel,
  TeamManagementPanel,
} from "./settings/AdvancedSettingsPanel";

// One row per team color: swatch (native color picker) + hex text input.
// Typing a valid #rrggbb commits on every keystroke; invalid input is
// ignored, and the field snaps back to the stored value on blur.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const TeamColorPicker = memo(({ colorKey, val, label, updateTeam }: any) => {
  const [draft, setDraft] = useState(val);
  // Keep draft in sync when the underlying team value changes externally
  // (e.g. another tab edits the team or the user picks via the swatch).
  React.useEffect(() => {
    setDraft(val);
  }, [val]);
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full shadow-inner border-2 border-line overflow-hidden relative shrink-0">
        <input
          type="color"
          value={val}
          onChange={(e) => updateTeam({ [colorKey]: e.target.value })}
          className="absolute -inset-2 w-16 h-16 cursor-pointer opacity-0"
          aria-label={`${label} color picker`}
        />
        <div className="w-full h-full" style={{ backgroundColor: val }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="block text-[9px] font-black text-ink-3 uppercase tracking-widest mb-1">
          {label}
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (HEX_RE.test(next))
              updateTeam({ [colorKey]: next.toLowerCase() });
          }}
          onBlur={() => {
            if (!HEX_RE.test(draft)) setDraft(val);
          }}
          spellCheck={false}
          placeholder="#000000"
          maxLength={7}
          className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-lg text-xs font-mono text-ink outline-none focus:ring-2 focus:ring-[var(--team-primary)] uppercase"
        />
      </div>
    </div>
  );
});

// Settings-driven feature switches. A toggle hides that module's tab and
// routes for the WHOLE staff (head and assistants) until it's switched back
// on; nothing is deleted — the data stays on the team doc, so re-enabling
// picks up exactly where the module left off.
const FeatureTogglesPanel = memo(({ team, updateTeam }: any) => (
  <div>
    <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
      <Icons.Sparkles className="w-4 h-4" /> Features
    </h3>
    <p className="text-[11px] text-ink-3 font-medium mb-4">
      Turn off the modules this team doesn&apos;t use — their tabs and pages
      disappear for the whole staff until switched back on. Nothing is deleted,
      and shared portal links (tryout signup, availability, player info) keep
      working either way.
    </p>
    <div className="space-y-2">
      {TOGGLEABLE_FEATURES.map((f) => {
        const enabled = featureEnabled(team, f.id);
        return (
          <label
            key={f.id}
            className="flex items-start justify-between gap-3 bg-surface p-3 border border-line rounded-xl shadow-sm cursor-pointer"
          >
            <span className="min-w-0">
              <span className="block text-sm font-black text-ink uppercase">
                {f.label}
              </span>
              <span className="text-[11px] text-ink-3 font-medium leading-snug">
                {f.description}
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) =>
                updateTeam({
                  disabledFeatures: toggleFeature(
                    team?.disabledFeatures,
                    f.id,
                    e.target.checked,
                  ),
                })
              }
              aria-label={`${f.label} feature`}
              className="mt-1 w-5 h-5 accent-[var(--team-primary)] shrink-0"
            />
          </label>
        );
      })}
    </div>
  </div>
));

// Editable team name. Commits on blur/Enter (never per keystroke — each
// updateTeam is a Firestore write); a blank draft snaps back to the stored
// name so a rename can't erase it. The team-doc name is authoritative: the
// switcher list and the public portal mirror sync from it automatically.
const TeamNameField = memo(({ team, updateTeam }: any) => {
  const stored = team?.name || "";
  const [draft, setDraft] = useState(stored);
  // Re-seed the draft when the stored name changes elsewhere (another device,
  // team switch) and the field isn't mid-edit.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(stored);
  }, [stored, editing]);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === stored) {
      setDraft(stored);
      return;
    }
    updateTeam({ name: next });
  };
  return (
    <div>
      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
        Team Name
      </label>
      <input
        type="text"
        value={draft}
        maxLength={60}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") {
            setDraft(stored);
            setEditing(false);
          }
        }}
        aria-label="Team name"
        className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-xl shadow-sm transition-all"
      />
    </div>
  );
});

// Tryouts settings panel — head-only. Coach identity/contact used by offer
// letters and the public page. The OPERATIONAL controls (share link, dates,
// open/close, lifecycle, roster cap) live in the Tryouts tab
// (components/TryoutControlsPanel.tsx).
const TryoutsSettingsPanel = memo(({ team, updateTeam }: any) => {
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
        <Icons.Users className="w-4 h-4" /> Tryouts
      </h3>
      <p className="text-[11px] text-ink-3 font-medium mb-3">
        Coach contact used on offer letters and the public interest page.
      </p>
      <div className="mb-4 space-y-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
            Head coach phone (for offer letters)
          </label>
          <input
            type="tel"
            value={team.headCoachPhone || ""}
            onChange={(e) => updateTeam?.({ headCoachPhone: e.target.value })}
            placeholder="(555) 123-4567"
            className="w-full p-2.5 bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold"
          />
          <p className="text-[10px] text-ink-3 font-medium mt-1">
            Filled into the offer-letter drafts. Stays private — never shown on
            the public tryouts page.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Coach Venmo account name
            </label>
            <input
              type="text"
              value={team.coachVenmoAccountName || ""}
              onChange={(e) =>
                updateTeam?.({ coachVenmoAccountName: e.target.value })
              }
              placeholder="@CoachVenmo"
              className="w-full p-2.5 bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Coach Venmo link
            </label>
            <input
              type="url"
              value={team.coachVenmoLink || ""}
              onChange={(e) => updateTeam?.({ coachVenmoLink: e.target.value })}
              placeholder="https://venmo.com/u/CoachVenmo"
              className="w-full p-2.5 bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Coach name (public)
            </label>
            <input
              type="text"
              value={team.headCoachName || ""}
              onChange={(e) => updateTeam?.({ headCoachName: e.target.value })}
              placeholder="Coach Smith"
              className="w-full p-2.5 bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">
              Coach email (public)
            </label>
            <input
              type="email"
              value={team.headCoachPublicEmail || ""}
              onChange={(e) =>
                updateTeam?.({ headCoachPublicEmail: e.target.value })
              }
              placeholder="coach@team.com"
              className="w-full p-2.5 bg-surface border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] text-sm font-bold"
            />
          </div>
        </div>
        <p className="text-[10px] text-ink-3 font-medium">
          Shown on your public tryouts/interest page so families can reach out.
          Leave blank to hide. Resync the public page after editing.
        </p>
      </div>
      {/* Operational tryout controls (share link, dates, open/close,
            lifecycle, roster cap) moved INTO the Tryouts tab so running a
            tryout never detours through Settings. */}
      <div className="bg-surface border border-line rounded-xl p-3 flex items-start gap-3">
        <Icons.Users className="w-4 h-4 mt-0.5 shrink-0 text-ink-3" />
        <p className="text-[11px] text-ink-3 font-medium leading-snug">
          Tryout dates, the share link, and intake controls now live in the{" "}
          <strong className="text-ink">Tryouts tab</strong> under “Tryout
          setup”.
        </p>
      </div>
    </div>
  );
});

// Team Join Code panel. Shows the persistent 6-char code anyone can
// use to join the team as an assistant. HC regenerates to rotate.
const JoinCodePanel = memo(({ team, regenerateJoinCode, toast }: any) => {
  const code = team.joinCode || "";
  const url =
    code && typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?join=${code}`
      : "";
  // Rotation is guarded by the app-wide confirm dialog (useConfirm) — the
  // one overlay system destructive confirms are consolidated on.
  const { confirm } = useConfirm();
  const rotateCode = async () => {
    const ok = await confirm({
      title: "Rotate team code?",
      message: `The current code ${code} will stop working immediately. Anyone you've already invited with the old code will need the new one to join.`,
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (ok) regenerateJoinCode?.();
  };
  const copy = async (text: any, label: any) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ kind: "success", title: `${label} copied` });
    } catch {
      toast.push({ kind: "warn", title: "Couldn't access clipboard" });
    }
  };
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
        <Icons.Users className="w-4 h-4" /> Team Code
      </h3>
      <p className="text-[11px] text-ink-3 font-medium mb-3">
        Share this 6-character code with anyone you want to invite as an
        assistant coach. They tap <strong>Join Team</strong> in the header and
        enter it. Head coaches can promote them later via Coach Roles below.
        Regenerate any time to rotate the code.
      </p>
      {code ? (
        <div className="space-y-3">
          <div className="cc-card p-3 flex items-center gap-3">
            <code
              className="text-2xl font-black tracking-[0.25em] font-mono px-3 py-2 rounded-lg"
              style={{
                backgroundColor: "var(--team-primary)",
                color: "var(--team-on-primary)",
              }}
            >
              {code}
            </code>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={() => copy(code, "Team code")}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
              >
                Copy Code
              </button>
              <button
                type="button"
                onClick={() => copy(url, "Join link")}
                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
              >
                Copy Link
              </button>
            </div>
          </div>
          <div className="flex justify-between items-center gap-3">
            <code className="text-[10px] text-ink-3 font-mono truncate flex-1 min-w-0">
              {url}
            </code>
            <button
              type="button"
              onClick={rotateCode}
              className="shrink-0 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink hover:bg-surface-2 rounded-md"
            >
              Regenerate
            </button>
          </div>
          <div className="flex items-start gap-3 flex-wrap pt-1">
            <QRCodeImg
              value={url}
              size={120}
              downloadable
              filename={`${team.name || "team"}-join-code-${code}`}
            />
            <p className="text-[10px] font-medium text-ink-3 leading-snug flex-1 min-w-0">
              Have an assistant coach scan this with their phone — they'll land
              in-app on Join Team with the code pre-filled.
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
            color: "var(--team-on-primary)",
          }}
        >
          Generate Team Code
        </button>
      )}
    </div>
  );
});

// Diagnostics — head-only triage tool. Surfaces the Firestore truth
// for the active team alongside the current Auth UID so account /
// data-linkage problems are visible without DevTools.
const DiagnosticsPanel = memo(({ team, user, activeTeamId }: any) => {
  const [open, setOpen] = React.useState(false);
  const uid = user?.uid || "(not signed in)";
  const ownerId = team?.ownerId || "(none)";
  const members = Array.isArray(team?.members) ? team.members : [];
  const isOwner = uid === ownerId;
  const isMember = members.includes(uid);
  return (
    <div className="pt-6 border-t border-line/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-ink-3 hover:text-ink"
      >
        <Icons.Alert className="w-3.5 h-3.5" />
        {open ? "Hide" : "Show"} Diagnostics
      </button>
      {open && (
        <div className="mt-3 bg-app border border-line rounded-xl p-4 text-[11px] font-mono space-y-2">
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
          <Row label="Games" value={`${(team?.games || []).length} entries`} />
          {!isOwner && !isMember && (
            <p className="pt-2 text-[10px] text-loss font-bold not-italic font-sans">
              ⚠ Your UID isn&apos;t in this team&apos;s members[]. Ask the owner
              to add it via Firestore Console, or sign in with the account whose
              UID matches ownerId.
            </p>
          )}
          <div className="pt-3 border-t border-line flex flex-wrap gap-2 not-italic font-sans">
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
                } catch (err: any) {
                  // Surface but don't crash — user can hard-refresh if needed.
                  // eslint-disable-next-line no-alert
                  alert(
                    "Sign-out failed: " +
                      (err?.message || "unknown error") +
                      ". Try reloading the page.",
                  );
                }
              }}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-surface border border-line-strong text-ink hover:bg-surface-2"
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
              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md bg-warn-bg border border-warn-bg text-warnfg hover:bg-warn-bg"
            >
              Reset Local Cache + Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

const Row = ({ label, value, badge, badgeKind }: any) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
    <span className="text-ink-3 shrink-0 font-bold uppercase tracking-widest text-[10px]">
      {label}
    </span>
    <span className="text-ink break-all flex-1 min-w-0">{value}</span>
    {badge && (
      <span
        className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${
          badgeKind === "ok"
            ? "bg-win-bg border-win-bg text-win"
            : "bg-loss-bg border-loss-bg text-loss"
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
    exportRosterCsv,
    exportNewPlayersCsv,
    generateTryoutShareId,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    regenerateJoinCode,
    mirrorStale,
    resyncPublicMirror,
    uploadLogo,
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
  const { isAddingCoach, setIsAddingCoach, newCoachForm, setNewCoachForm } =
    useUI();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    leagueRuleSet,
    pitchingFormat,
    teamAge,
    inningsCount,
    positionLock,
    battingSize,
    defenseSize,
    catcherMaxInnings,
    catcherConsecutive,
    statDisplay,
    pitchRuleSet,
    customPitchLimit,
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
  // Mobile drill-in: false = show the category list, true = show the panel.
  const [mobilePanel, setMobilePanel] = useState(false);
  // Wrap the existing uploadLogo: keep all its size-limit guards, then pull
  // the logo's dominant colors and (if any) hand them to the
  // /settings/logo-colors page via navigation state so the coach can assign
  // them to Primary / Secondary / Tertiary. Extraction failures must never
  // block the upload — extractLogoPalette resolves to [] rather than
  // throwing.
  const handleLogoUpload = useCallback(
    (e: any) => {
      uploadLogo(e);
      const file = e.target.files?.[0];
      if (!file) return;
      extractLogoPalette(file).then((palette) => {
        if (palette.length > 0)
          navigate("/settings/logo-colors", { state: { palette } });
      });
    },
    [uploadLogo, navigate],
  );

  // Re-run extraction on the already-saved logo for the manual trigger. An
  // empty palette still navigates — the page explains extraction found
  // nothing distinct.
  const pullColorsFromLogo = useCallback(() => {
    if (!logoUrl) return;
    extractLogoPalette(logoUrl).then((palette) => {
      navigate("/settings/logo-colors", { state: { palette } });
    });
  }, [logoUrl, navigate]);
  const settingsMenuItems = [
    { id: "team", label: "Team", icon: Icons.Settings },
    { id: "features", label: "Features", icon: Icons.Sparkles },
    { id: "tryouts", label: "Tryouts", icon: Icons.UserPlus },
    { id: "staff", label: "Staff", icon: Icons.Users },
    { id: "imports", label: "Imports", icon: Icons.FileText },
    { id: "advanced", label: "Advanced", icon: Icons.Cloud },
  ];

  // Past-season CSV import: parse the file, then hand the rows to the
  // /settings/import/past-season review page via navigation state (a file's
  // worth of rows never rides the URL; a refresh there bounces back here).
  const startPastSeasonImport = useCallback(
    (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        const result = parseGameChangerPastSeasonCsv(
          String(ev.target?.result ?? ""),
        );
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
        const assignments: Record<string, any> = {};
        for (const row of result.rows) {
          assignments[row.csvName] =
            suggestPlayerMatch(row.csvName, players) || "skip";
        }
        navigate("/settings/import/past-season", {
          state: {
            rows: result.rows,
            season: "",
            ageGroup: "",
            pitchingFormat: "Kid Pitch",
            assignments,
          },
        });
      };
      reader.onerror = () =>
        toast.push({ kind: "error", title: "Could not read file" });
      reader.readAsText(file);
      e.target.value = "";
    },
    [players, navigate, toast],
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="pb-4 mb-5 border-b border-line flex items-center gap-3">
        <span
          className="block h-5 w-1 rounded-sm"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <h1 className="t-h1">Settings</h1>
      </div>
      <div className="lg:flex lg:gap-8">
        {/* Category nav — sidebar on desktop, drill-in list on mobile. */}
        <nav
          className={`lg:w-52 lg:shrink-0 ${
            mobilePanel ? "hidden lg:block" : "block"
          }`}
        >
          <div className="flex flex-col lg:gap-1">
            {settingsMenuItems.map((item) => {
              const Icon = item.icon;
              const active = settingsMenu === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSettingsMenu(item.id);
                    setMobilePanel(true);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 px-3 py-3 text-left border-b border-line lg:border-b-0 lg:rounded-sm transition-colors ${
                    active ? "lg:bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <Icon
                    className="w-4 h-4 shrink-0"
                    style={{
                      color: active ? "var(--team-primary)" : "var(--ink-3)",
                    }}
                  />
                  <span
                    className={`flex-1 text-xs font-black uppercase tracking-widest ${
                      active ? "text-ink" : "text-ink-2"
                    }`}
                  >
                    {item.label}
                  </span>
                  <Icons.ChevronRight className="w-4 h-4 text-ink-3 lg:hidden" />
                </button>
              );
            })}
          </div>
        </nav>

        {/* Active category panel. */}
        <div
          className={`flex-1 min-w-0 ${mobilePanel ? "block" : "hidden lg:block"}`}
        >
          <button
            type="button"
            onClick={() => setMobilePanel(false)}
            className="lg:hidden inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-ink-2 hover:text-ink mb-4"
          >
            <Icons.ChevronRight className="w-4 h-4 rotate-180" /> All Settings
          </button>
          <h2 className="t-h2 mb-6">
            {settingsMenuItems.find((i) => i.id === settingsMenu)?.label}
          </h2>
          <div className="space-y-10">
            <div className="space-y-10">
              {settingsMenu === "team" && (
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-5 border-b border-line/50 pb-3 flex items-center gap-2">
                    <Icons.Settings className="w-4 h-4" /> Game Default
                    Configuration
                  </h3>
                  <div className="space-y-5">
                    <TeamNameField team={team} updateTeam={updateTeam} />
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          League Rules
                        </label>
                        <select
                          value={leagueRuleSet}
                          onChange={(e) =>
                            updateTeam({ leagueRuleSet: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                        >
                          <option value="USSSA">Tournament</option>
                          <option value="NKB">Rec</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Pitching Format
                        </label>
                        {(() => {
                          const allowedFormats = allowedPitchingFormats(
                            leagueRuleSet,
                            teamAge,
                          );
                          // One legal format for this league + age (e.g. 9U+
                          // is always kid pitch) — no dropdown, just the fact.
                          if (allowedFormats.length === 1) {
                            return (
                              <div className="w-full p-3 bg-surface border border-line text-sm font-bold text-ink-2 rounded-xl shadow-sm">
                                {allowedFormats[0]}
                              </div>
                            );
                          }
                          return (
                            <select
                              value={pitchingFormat}
                              onChange={(e) =>
                                updateTeam({ pitchingFormat: e.target.value })
                              }
                              className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                            >
                              {allowedFormats.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Age Group
                        </label>
                        <select
                          value={teamAge}
                          onChange={(e) =>
                            updateTeam({ teamAge: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
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
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Innings
                        </label>
                        <select
                          value={inningsCount}
                          onChange={(e) =>
                            updateTeam({ inningsCount: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
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
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Rotation
                        </label>
                        <select
                          value={positionLock}
                          onChange={(e) =>
                            updateTeam({ positionLock: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                        >
                          <option value="1">1 Inn</option>
                          <option value="2">2 Inn</option>
                          <option value="3">3 Inn</option>
                          <option value="full">Full Game</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Batters
                        </label>
                        <select
                          value={battingSize}
                          onChange={(e) =>
                            updateTeam({ battingSize: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                        >
                          <option value="roster">Roster</option>
                          <option value="9">9</option>
                          <option value="10">10</option>
                          <option value="11">11</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                        Defense Mode
                      </label>
                      <div className="flex border border-line bg-surface rounded-xl shadow-sm overflow-hidden p-1">
                        <button
                          onClick={() => updateTeam({ defenseSize: "9" })}
                          disabled={isDefenseLocked}
                          className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                            defenseSize === "9"
                              ? "bg-surface text-ink shadow-sm border border-line"
                              : "text-ink-3 hover:bg-surface border border-transparent"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          9 Fielders
                        </button>
                        <button
                          onClick={() => updateTeam({ defenseSize: "10" })}
                          disabled={isDefenseLocked}
                          className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider transition-all rounded-lg ${
                            defenseSize === "10"
                              ? "bg-surface text-ink shadow-sm border border-line"
                              : "text-ink-3 hover:bg-surface border border-transparent"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          10 Fielders
                        </button>
                      </div>
                      {isDefenseLocked ? (
                        <p className="text-[10px] text-ink-3 mt-2 uppercase tracking-widest font-bold">
                          Locked by {leagueRuleSetLabel(leagueRuleSet)} rules
                        </p>
                      ) : (
                        <p className="text-[10px] text-ink-3 mt-2 uppercase tracking-widest font-bold">
                          Unlocked for Recreational Rules
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Catcher Innings
                        </label>
                        <select
                          value={catcherMaxInnings || "auto"}
                          onChange={(e) =>
                            updateTeam({ catcherMaxInnings: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                        >
                          <option value="auto">Auto (by defense)</option>
                          <option value="1">Max 1</option>
                          <option value="2">Max 2</option>
                          <option value="3">Max 3</option>
                          <option value="4">Max 4</option>
                          <option value="none">No limit</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Back-to-back
                        </label>
                        {(() => {
                          const capIsExplicit =
                            catcherMaxInnings &&
                            catcherMaxInnings !== "auto" &&
                            catcherMaxInnings !== "none";
                          const consecutiveOn = catcherConsecutive !== false;
                          return (
                            <button
                              type="button"
                              disabled={!capIsExplicit}
                              onClick={() =>
                                updateTeam({
                                  catcherConsecutive: !consecutiveOn,
                                })
                              }
                              className={`w-full p-3 border border-line text-sm font-black uppercase tracking-wider rounded-xl shadow-sm transition-all ${
                                capIsExplicit && consecutiveOn
                                  ? "bg-[var(--team-primary)] text-white"
                                  : "bg-surface text-ink-3 hover:bg-surface-2"
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              {capIsExplicit && consecutiveOn ? "On" : "Off"}
                            </button>
                          );
                        })()}
                        <p className="text-[10px] text-ink-3 mt-2 uppercase tracking-widest font-bold">
                          {catcherMaxInnings &&
                          catcherMaxInnings !== "auto" &&
                          catcherMaxInnings !== "none"
                            ? "Catcher's innings stay consecutive"
                            : "Set a catcher limit to enable"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-5 mt-5">
                      <div>
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Pitch-Count Rules
                        </label>
                        <select
                          value={pitchRuleSet || "littleLeague"}
                          onChange={(e) =>
                            updateTeam({ pitchRuleSet: e.target.value })
                          }
                          className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] cursor-pointer rounded-xl shadow-sm transition-all hover:bg-surface-2"
                        >
                          <option value="littleLeague">
                            Little League / Pitch Smart
                          </option>
                          <option value="custom">Custom</option>
                        </select>
                        <p className="text-[10px] text-ink-3 mt-2 font-bold leading-tight normal-case tracking-normal">
                          Drives rest rules, the in-game limit, the lineup card,
                          and the availability planner.
                        </p>
                      </div>
                      {pitchRuleSet === "custom" && (
                        <div>
                          <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                            Daily Pitch Limit
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="200"
                            value={customPitchLimit || ""}
                            placeholder="e.g. 85"
                            onChange={(e) =>
                              updateTeam({
                                customPitchLimit:
                                  parseInt(e.target.value, 10) || 0,
                              })
                            }
                            className="w-full p-3 bg-surface border border-line text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-xl shadow-sm"
                          />
                          <p className="text-[10px] text-ink-3 mt-2 font-bold leading-tight normal-case tracking-normal">
                            Your league's daily max for this age. Rest tiers use
                            the standard 21/36/51/66 thresholds.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="mt-5">
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                        Stat display
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["rich", "stripped"] as const).map((mode) => {
                          const active = (statDisplay || "rich") === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => updateTeam({ statDisplay: mode })}
                              className={`p-3 border border-line text-sm font-black uppercase tracking-wider rounded-xl shadow-sm transition-all ${
                                active
                                  ? "bg-[var(--team-primary)] text-white"
                                  : "bg-surface text-ink-3 hover:bg-surface-2"
                              }`}
                            >
                              {mode === "rich" ? "Rich" : "Stripped"}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-ink-3 mt-2 font-bold leading-tight normal-case tracking-normal">
                        Rich shows full charts, tiles, and leaderboards.
                        Stripped collapses every stat surface to compact,
                        glanceable rows.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {settingsMenu === "staff" && (
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-2 border-b border-line pb-3 flex items-center gap-2">
                    <Icons.Users className="w-4 h-4" /> Lineup-Card Coaches
                  </h3>
                  <p className="text-[11px] text-ink-3 font-medium mb-3">
                    Names printed on the lineup card and reports. These are
                    labels only — they don&apos;t grant app access. To manage
                    who can sign in, use <strong>Coach Roles</strong> below.
                  </p>
                  <div className="space-y-3 mb-4">
                    {coaches.map((c: any) => (
                      <div
                        key={c.id}
                        className="flex justify-between items-center bg-surface p-3 border border-line rounded-xl shadow-sm"
                      >
                        <div>
                          <span className="block text-sm font-black text-ink uppercase">
                            {c.name}
                          </span>
                          <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
                            {c.role}
                          </span>
                        </div>
                        <button
                          onClick={() => removeCoach(c.id)}
                          title="Remove name"
                          aria-label={`Remove ${c.name || "coach"}`}
                          className="p-2 text-ink-3 hover:text-loss hover:bg-loss-bg rounded-lg transition-colors"
                        >
                          <Icons.Trash className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {isAddingCoach ? (
                    <div className="bg-surface p-4 border border-line rounded-xl space-y-3 shadow-sm">
                      <input
                        type="text"
                        value={newCoachForm.name}
                        onChange={(e) =>
                          setNewCoachForm({
                            ...newCoachForm,
                            name: e.target.value,
                          })
                        }
                        placeholder="Coach Name"
                        className="w-full p-2.5 border border-line-strong text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-lg shadow-inner"
                      />
                      <select
                        value={newCoachForm.role}
                        onChange={(e) =>
                          setNewCoachForm({
                            ...newCoachForm,
                            role: e.target.value,
                          })
                        }
                        className="w-full p-2.5 border border-line-strong text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] rounded-lg bg-surface shadow-sm"
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
                          className="flex-1 bg-surface border border-line-strong text-ink-2 text-xs font-black uppercase tracking-widest py-3 rounded-lg shadow-sm hover:bg-surface-2 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsAddingCoach(true)}
                      className="w-full bg-surface hover:bg-surface-2 text-ink-2 text-xs font-black uppercase tracking-widest py-3.5 rounded-xl border-2 border-dashed border-line-strong transition-colors flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Icons.Plus className="w-4 h-4" /> Add Coach
                    </button>
                  )}
                </div>
              )}

              {settingsMenu === "features" && (
                <FeatureTogglesPanel team={team} updateTeam={updateTeam} />
              )}

              {settingsMenu === "tryouts" && (
                <TryoutsSettingsPanel team={team} updateTeam={updateTeam} />
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
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
                    <Icons.Users className="w-4 h-4" /> Coach Roles
                  </h3>
                  <p className="text-[11px] text-ink-3 font-medium mb-3">
                    Everyone who can sign in to this team. Head coaches can edit
                    lineups, evals, and settings; assistants submit eval grades
                    and view today&apos;s lineup.
                  </p>
                  <div className="space-y-2 mb-2">
                    {team.ownerId && (
                      <div className="flex justify-between items-center bg-surface p-3 border border-line rounded-xl shadow-sm gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-ink truncate">
                            {user && team.ownerId === user.uid
                              ? "You"
                              : (team.coachContacts || []).find(
                                  (cc: any) => cc.uid === team.ownerId,
                                )?.name || team.ownerId.slice(0, 12) + "…"}
                          </div>
                          <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
                            Head Coach · Owner
                          </div>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 text-ink-3">
                          Owner
                        </span>
                      </div>
                    )}
                    {(team.members || [])
                      .filter((uid: any) => uid !== team.ownerId)
                      .map((uid: any) => {
                        const role =
                          team.coachRoles?.[uid] === "head"
                            ? "head"
                            : "assistant";
                        const isMe = user && uid === user.uid;
                        const contactName = (team.coachContacts || []).find(
                          (cc: any) => cc.uid === uid,
                        )?.name;
                        return (
                          <div
                            key={uid}
                            className="flex justify-between items-center bg-surface p-3 border border-line rounded-xl shadow-sm gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-black text-ink truncate">
                                {isMe
                                  ? "You"
                                  : contactName || uid.slice(0, 12) + "…"}
                              </div>
                              <div className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
                                {role === "head"
                                  ? "Head Coach"
                                  : "Assistant Coach"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setCoachRole?.(
                                  uid,
                                  role === "head" ? "assistant" : "head",
                                )
                              }
                              className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-line-strong hover:bg-surface-2 whitespace-nowrap"
                            >
                              {role === "head" ? "Make Assistant" : "Make Head"}
                            </button>
                          </div>
                        );
                      })}
                    {(team.members || []).filter(
                      (uid: any) => uid !== team.ownerId,
                    ).length === 0 && (
                      <p className="text-[11px] text-ink-3 font-medium italic">
                        No other coaches have joined yet.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {settingsMenu === "staff" && (
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
                    <Icons.Clipboard className="w-4 h-4" /> Eval Reminders
                  </h3>
                  <label className="flex items-start gap-3 cc-card p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={team.emailEvalRemindersDisabled !== true}
                      onChange={(e) =>
                        updateTeam({
                          emailEvalRemindersDisabled: !e.target.checked,
                        })
                      }
                      className="mt-0.5 w-4 h-4 accent-[var(--team-primary)]"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-black uppercase tracking-widest text-ink">
                        Eval reminder email prompt
                      </span>
                      <span className="block text-[11px] text-ink-3 font-medium mt-0.5">
                        When an eval round is due, show a one-tap prompt that
                        opens a pre-filled email draft to coaches who
                        haven&apos;t submitted — you send it from your own mail
                        app. Cool-off of 7 days between prompts.
                      </span>
                    </span>
                  </label>
                  {team.lastEvalEmailedAt && (
                    <p className="text-[10px] text-ink-3 font-medium mt-2 px-1">
                      Last reminder prompt{" "}
                      {new Date(team.lastEvalEmailedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-10">
              {settingsMenu === "team" && (
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line/50 pb-3 flex items-center gap-2">
                    <Icons.MapPin className="w-4 h-4" /> Team Identity & Season
                  </h3>
                  <div className="space-y-5">
                    <div className="flex flex-col sm:flex-row gap-5">
                      <div className="flex-1">
                        <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-1.5">
                          Current Season
                        </label>
                        <input
                          type="text"
                          value={currentSeason}
                          onChange={(e) =>
                            updateTeam({ currentSeason: e.target.value })
                          }
                          placeholder="Spring 2026"
                          className="w-full p-3 bg-surface border border-line rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--team-primary)] shadow-inner"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => navigate("/settings/advance-season")}
                          className="p-3 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5 w-full sm:w-auto h-[46px] rounded-xl shadow-md"
                          style={{
                            backgroundColor: "var(--team-primary)",
                            color: "var(--team-on-primary)",
                          }}
                        >
                          <Icons.Forward className="w-4 h-4" /> Advance Season
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-ink-3 font-medium">
                      Marks each player as Returning or Released when you
                      advance to the next season. Stats from finished games are
                      archived to season history.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={exportRosterCsv}
                        className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 flex items-center gap-2"
                      >
                        <Icons.Forward className="w-3.5 h-3.5" /> Export Roster
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={exportNewPlayersCsv}
                        className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-lg hover:bg-surface-2 flex items-center gap-2"
                      >
                        <Icons.Forward className="w-3.5 h-3.5" /> Export New
                        Players CSV
                      </button>
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                        Team Colors
                      </label>
                      <div className="bg-surface p-4 border border-line rounded-xl shadow-sm space-y-3">
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
                      <div className="mt-3 flex flex-wrap items-center gap-3 bg-surface p-3 border border-line rounded-xl shadow-sm">
                        <span className="text-[9px] font-black text-ink-3 uppercase tracking-widest mr-1">
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
                      <label className="block text-[10px] font-extrabold text-ink-3 uppercase tracking-widest mb-2">
                        Logo Upload
                      </label>
                      <div className="flex items-center gap-4 bg-surface p-4 border border-line rounded-xl shadow-sm">
                        {logoUrl ? (
                          <div className="relative group">
                            <img
                              src={logoUrl}
                              alt="Logo"
                              className="w-16 h-16 object-contain bg-surface border border-line p-1.5 rounded-xl shadow-sm"
                            />
                            <button
                              onClick={() => updateTeam({ logoUrl: "" })}
                              className="absolute -top-2 -right-2 p-1.5 bg-surface border border-line text-loss hover:bg-loss-bg hover:text-loss rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Icons.X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="w-16 h-16 bg-surface border border-line border-dashed rounded-xl flex items-center justify-center">
                            <Icons.Upload className="w-6 h-6 text-ink-3" />
                          </div>
                        )}
                        <label
                          htmlFor="settings-logo-upload"
                          className="flex-1 bg-surface border border-line-strong hover:bg-surface-2 rounded-xl p-3.5 text-xs text-center cursor-pointer font-black text-ink uppercase tracking-widest transition-colors shadow-sm"
                        >
                          Choose File{" "}
                          <input
                            id="settings-logo-upload"
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={handleLogoUpload}
                          />
                        </label>
                      </div>
                      {logoUrl && (
                        <button
                          type="button"
                          onClick={pullColorsFromLogo}
                          className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-ink-2 hover:text-ink bg-surface border border-line rounded-lg px-3 py-1.5 shadow-sm hover:bg-surface-2 transition-colors"
                        >
                          <Icons.Palette className="w-3 h-3" /> Pull colors from
                          logo
                        </button>
                      )}
                      <p className="text-[10px] text-ink-3 mt-2 font-medium">
                        PNG/JPG up to 1 MB. Stored inline in your team document.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {settingsMenu === "imports" && (
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
                    <Icons.Cloud className="w-4 h-4" /> Data Management
                  </h3>
                  <div className="space-y-4">
                    <p className="text-xs text-ink-3 -mt-2">
                      Roster, Stats, and Schedule imports now live at the bottom
                      of their own tabs.
                    </p>
                    <div className="grid grid-cols-1 gap-4">
                      <label
                        htmlFor="settings-import-past-season-csv"
                        className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-line-strong rounded-2xl cursor-pointer bg-surface hover:bg-surface-2 hover:border-line-strong transition-all group h-full shadow-sm hover:shadow-md"
                      >
                        <Icons.Upload className="w-6 h-6 text-ink-3 group-hover:text-warnfg mb-3 transition-colors" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-ink-2 text-center leading-snug">
                          Import
                          <br />
                          Previous Season Stats CSV
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
                        className="flex-1 bg-surface border border-line-strong rounded-xl py-3.5 text-[10px] sm:text-xs font-black uppercase tracking-widest text-ink hover:bg-surface-2 transition-colors shadow-sm flex items-center justify-center gap-2"
                      >
                        <Icons.Download className="w-4 h-4" /> Backup
                      </button>
                      <label
                        htmlFor="settings-restore-backup"
                        className="flex-1 bg-surface border border-line-strong rounded-xl py-3.5 text-[10px] sm:text-xs text-center cursor-pointer font-black uppercase tracking-widest text-ink hover:bg-surface-2 transition-colors shadow-sm flex items-center justify-center gap-2"
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
                <DiagnosticsPanel
                  team={team}
                  user={user}
                  activeTeamId={activeTeamId}
                />
              )}
              {settingsMenu === "advanced" && (
                <TeamManagementPanel
                  teams={teams}
                  leaveTeamCmd={leaveTeamCmd}
                  deleteTeamCmd={deleteTeamCmd}
                />
              )}
              {settingsMenu === "advanced" && realRole === "head" && (
                <div className="pt-6 border-t border-line/50">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2">
                    Testing
                  </div>
                  <div className="bg-warn-bg border border-warn-bg rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-ink text-sm">
                        View as Assistant Coach
                      </h4>
                      <p className="text-[11px] text-ink-2 mt-1 font-medium leading-snug max-w-md">
                        Preview the assistant experience. Revert anytime from
                        the header chip or this toggle.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setViewAsRole?.(
                          viewAsRole === "assistant" ? null : "assistant",
                        )
                      }
                      className={`shrink-0 px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-colors ${
                        viewAsRole === "assistant"
                          ? "bg-warn-bg text-warnfg hover:bg-warn-bg"
                          : "bg-surface border border-line text-warnfg hover:bg-surface-2"
                      }`}
                    >
                      {viewAsRole === "assistant"
                        ? "Revert to Head"
                        : "View as Assistant"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
