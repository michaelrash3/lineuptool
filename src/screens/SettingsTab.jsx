import React, { memo, useCallback, useMemo, useState } from "react";
import { Icons } from "../icons";
import {
  parseGameChangerPastSeasonCsv,
  suggestPlayerMatch,
} from "../utils/helpers";
import { useTeam, useUI, useToast } from "../contexts.js";
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import {
  sendGmailMessage,
  buildMailtoUrl,
} from "../integrations/gmailSend";

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
          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 uppercase"
        />
      </div>
    </div>
  );
});

// Invite-by-email panel. Reads the roster for any player with an email
// on file, lets the head pick which ones to invite + at which role,
// then either sends via the head's signed-in Gmail account or opens a
// mailto: composer per row. Tokens are generated on-the-fly via
// `createInviteToken(role)` so each recipient gets a unique one-time
// invite URL.
const InviteCoachesPanel = memo(
  ({ activeTeamId, team, createInviteToken, user, primaryColor, toast }) => {
    // Candidates come exclusively from team.coachContacts — the list
    // the TeamSnap CSV import populates from rows whose Position column
    // says "coach"/"manager". Parent emails on player rows stay out of
    // this flow on purpose so the invite UI only ever proposes actual
    // coaches.
    const candidates = useMemo(() => {
      return (team.coachContacts || [])
        .filter((c) => c.email && c.email.trim())
        .map((c) => ({
          id: c.id,
          name: c.name || c.email,
          email: c.email.trim(),
          sourceRole: c.sourceRole,
        }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }, [team.coachContacts]);

    // Per-row state: { selected: boolean, role: "head"|"assistant", status }
    const [rows, setRows] = useState(() => ({}));
    const [bulkSending, setBulkSending] = useState(false);

    const getRow = (id) => rows[id] || { selected: false, role: "assistant", status: null };
    const setRow = (id, patch) =>
      setRows((prev) => ({ ...prev, [id]: { ...getRow(id), ...patch } }));

    const buildInviteUrl = (token) =>
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}?invite=${activeTeamId || ""}.${token}`
        : `?invite=${activeTeamId || ""}.${token}`;

    const buildEmailBody = (name, url) => {
      const teamName = team.name || "the team";
      const fromName = user?.displayName || "Your coach";
      return [
        `Hi ${name || "there"},`,
        "",
        `${fromName} has invited you to help coach ${teamName} on LineupTool.`,
        "",
        "Click the link below to accept (one-time use):",
        url,
        "",
        "LineupTool keeps the roster, schedule, lineups, and player evaluations in one place. Once you accept you'll be able to view games and submit your own evaluations.",
      ].join("\n");
    };

    const sendOne = async (candidate, role) => {
      const token = createInviteToken?.(role);
      if (!token) {
        toast.push({ kind: "error", title: "Couldn't create invite token" });
        return false;
      }
      const url = buildInviteUrl(token);
      const subject = `Coach invite — ${team.name || "your team"}`;
      const body = buildEmailBody(candidate.name, url);
      const fromEmail = user?.email;
      if (!fromEmail) {
        toast.push({
          kind: "error",
          title: "No sender email",
          message: "Sign in with Google to send invites.",
        });
        return false;
      }
      try {
        await sendGmailMessage({
          auth,
          to: candidate.email,
          subject,
          body,
          fromEmail,
          fromName: user?.displayName || undefined,
        });
        return true;
      } catch (err) {
        // Fallback: open mailto so the user can still get the invite out.
        const reason =
          err?.message === "consent_declined"
            ? "Gmail access wasn't granted."
            : err?.message === "not_google_user"
            ? "Only Google sign-in supports auto-send."
            : "Send failed — using your mail app instead.";
        toast.push({
          kind: "warn",
          title: `${candidate.email} — ${reason}`,
          message: "Opening your mail app with the invite drafted.",
        });
        if (typeof window !== "undefined") {
          window.open(buildMailtoUrl(candidate.email, subject, body), "_blank");
        }
        return false;
      }
    };

    const handleSendOne = async (candidate) => {
      const row = getRow(candidate.id);
      setRow(candidate.id, { status: "sending" });
      const ok = await sendOne(candidate, row.role);
      setRow(candidate.id, { status: ok ? "sent" : "failed" });
    };

    const handleMailtoOne = (candidate) => {
      const row = getRow(candidate.id);
      const token = createInviteToken?.(row.role);
      if (!token) return;
      const url = buildInviteUrl(token);
      const subject = `Coach invite — ${team.name || "your team"}`;
      const body = buildEmailBody(candidate.name, url);
      window.open(buildMailtoUrl(candidate.email, subject, body), "_blank");
      setRow(candidate.id, { status: "queued" });
    };

    // Generate an invite token + copy ONLY the URL to the clipboard so
    // the head coach can paste it into whatever channel they want
    // (text, Slack, manually-composed email, etc.) without dealing
    // with mailto draft quirks.
    const handleCopyLinkOne = async (candidate) => {
      const row = getRow(candidate.id);
      const token = createInviteToken?.(row.role);
      if (!token) return;
      const url = buildInviteUrl(token);
      try {
        await navigator.clipboard.writeText(url);
        toast.push({
          kind: "success",
          title: "Invite link copied",
          message: `Paste it to ${candidate.name}.`,
        });
        setRow(candidate.id, { status: "copied" });
      } catch {
        toast.push({
          kind: "warn",
          title: "Couldn't access clipboard",
          message: url,
        });
      }
    };

    const handleBulkSend = async () => {
      const selected = candidates.filter((c) => getRow(c.id).selected);
      if (selected.length === 0) {
        toast.push({ kind: "info", title: "Pick at least one row" });
        return;
      }
      setBulkSending(true);
      let sent = 0;
      for (const c of selected) {
        setRow(c.id, { status: "sending" });
        // eslint-disable-next-line no-await-in-loop
        const ok = await sendOne(c, getRow(c.id).role);
        setRow(c.id, { status: ok ? "sent" : "failed" });
        if (ok) sent++;
      }
      setBulkSending(false);
      toast.push({
        kind: sent === selected.length ? "success" : "warn",
        title: `Sent ${sent} of ${selected.length}`,
      });
    };

    if (candidates.length === 0) {
      return (
        <div className="bg-white/60 border border-slate-200 rounded-xl p-4 text-[11px] text-slate-500 font-medium italic">
          No coach contacts yet. Import a TeamSnap roster CSV — rows
          with a &quot;Position&quot; of Coach or Manager will be
          captured here automatically.
        </div>
      );
    }

    const selectedCount = candidates.filter((c) => getRow(c.id).selected).length;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-[11px] font-bold text-slate-500">
            {selectedCount > 0
              ? `${selectedCount} of ${candidates.length} selected`
              : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            disabled={selectedCount === 0 || bulkSending}
            onClick={handleBulkSend}
            className="px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: primaryColor }}
          >
            {bulkSending ? "Sending…" : "Send Selected"}
          </button>
        </div>
        <div className="space-y-1.5">
          {candidates.map((c) => {
            const row = getRow(c.id);
            return (
              <div
                key={c.id}
                className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) =>
                      setRow(c.id, { selected: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-tight text-slate-800 truncate">
                      {c.name}
                      {c.sourceRole && (
                        <span className="ml-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          · {c.sourceRole}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      {c.email}
                    </div>
                  </div>
                </label>
                <select
                  value={row.role}
                  onChange={(e) => setRow(c.id, { role: e.target.value })}
                  className="p-1.5 text-[11px] font-bold bg-white border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="assistant">Assistant</option>
                  <option value="head">Head</option>
                </select>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyLinkOne(c)}
                    title="Generate the invite link and copy it"
                    className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white rounded-md shadow-sm hover:opacity-90"
                    style={{
                      backgroundColor: "var(--team-primary)",
                      color: "var(--team-tertiary)",
                    }}
                  >
                    {row.status === "copied" ? "Copied ✓" : "Copy Link"}
                  </button>
                  <button
                    type="button"
                    disabled={row.status === "sending" || bulkSending}
                    onClick={() => handleSendOne(c)}
                    title="Send via your signed-in Gmail"
                    className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {row.status === "sending"
                      ? "Sending…"
                      : row.status === "sent"
                      ? "Sent ✓"
                      : row.status === "failed"
                      ? "Retry"
                      : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMailtoOne(c)}
                    title="Open in your mail app instead"
                    className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                  >
                    Mail
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

// Per-player Returning / Released chips for the head to mark up the
// current roster before tapping Advance Season. Status sticks on the
// player doc until advanceSeason consumes it.
const MarkForNextSeasonPanel = memo(({ players, setPlayerStatus }) => {
  if (!Array.isArray(players) || players.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
        Mark for Next Season
      </div>
      <p className="text-[11px] text-slate-500 font-medium mb-3">
        Pick who&apos;s coming back. Released players are dropped on
        Advance Season; tryout accepts (status &quot;accepted&quot;)
        ride in automatically.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {players.map((p) => {
          const status = p.playerStatus || "returning";
          const isReturning = status === "returning";
          const isReleased = status === "released";
          const isAccepted = status === "accepted";
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg p-2.5"
            >
              <span className="text-xs font-extrabold text-slate-800 uppercase tracking-tight truncate">
                {p.name}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {isAccepted && (
                  <span
                    className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border"
                    style={{
                      backgroundColor: "var(--team-primary-15)",
                      borderColor: "var(--team-primary)",
                      color: "var(--team-primary)",
                    }}
                  >
                    Tryout
                  </span>
                )}
                {!isAccepted && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setPlayerStatus?.(p.id, "returning")
                      }
                      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${
                        isReturning
                          ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Returning
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlayerStatus?.(p.id, "released")}
                      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${
                        isReleased
                          ? "bg-slate-200 border-slate-300 text-slate-700"
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Released
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
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
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    setTryoutDetails,
    toast,
  }) => {
    const open = team.tryoutsOpen === true;
    const phase = team.tryoutsPhase || (open ? "open" : "intake_closed");
    const cap = team.rosterCap || 12;
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

          <TryoutDateLinkPanel
            team={team}
            generateTryoutDateLink={generateTryoutDateLink}
            toast={toast}
          />



          <div className="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Tryout Location
              <input
                type="text"
                defaultValue={team.tryoutLocation || ""}
                onBlur={(e) => setTryoutDetails?.({ tryoutLocation: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                placeholder="1300 Burmwood Rd. Hebron, KY"
              />
            </label>
            <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Tryout Date
              <input
                type="date"
                defaultValue={team.tryoutDate || ""}
                onChange={(e) => setTryoutDetails?.({ tryoutDate: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
              />
            </label>
            <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Tryout Time
              <input
                type="text"
                defaultValue={team.tryoutTime || ""}
                onBlur={(e) => setTryoutDetails?.({ tryoutTime: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                placeholder="10am"
              />
            </label>
          </div>

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
              onClick={() => {
                if (
                  window.confirm(
                    "Regenerate the team code? The old one will stop working."
                  )
                )
                  regenerateJoinCode?.();
              }}
              className="shrink-0 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
            >
              Regenerate
            </button>
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


const SettingsSection = ({ id, title, icon: Icon, openSections, toggleSection, children }) => (
  <section className="bg-white/40 border border-slate-200 rounded-2xl p-3 sm:p-4">
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between gap-3 text-left"
    >
      <span className="text-sm font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
        <Icon className="w-4 h-4" /> {title}
      </span>
      <Icons.ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openSections[id] ? "rotate-180" : ""}`} />
    </button>
    {openSections[id] ? <div className="mt-3">{children}</div> : null}
  </section>
);

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
    generateTryoutDateLink,
    setTryoutsOpen,
    completeTryouts,
    setRosterCap,
    setTryoutDetails,
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
    createInviteToken,
    revokeInviteToken,
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
    inviteModal,
    setInviteModal,
  } = useUI();
  const toast = useToast();
  const [openSections, setOpenSections] = useState({
    team: true,
    coaches: false,
    roles: true,
    reminders: false,
    invites: false,
  });
  const toggleSection = (id) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const copyToClipboard = useCallback(
    (text) => {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      toast.push({ kind: "success", title: "Link copied" });
    },
    [toast]
  );
  const memberDisplay = useCallback((uid) => {
    if (!uid) return "Unknown";
    if (user?.uid === uid) return user?.displayName || user?.email || "You";
    const byInvite = (team.invites || []).find((i) => i.usedBy === uid);
    if (byInvite?.email) return byInvite.email;
    return `${uid.slice(0, 12)}…`;
  }, [team.invites, user]);

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

            <TryoutsSettingsPanel
              team={team}
              generateTryoutDateLink={generateTryoutDateLink}
              setTryoutsOpen={setTryoutsOpen}
              completeTryouts={completeTryouts}
              setRosterCap={setRosterCap}
              setTryoutDetails={setTryoutDetails}
              toast={toast}
            />

            <JoinCodePanel
              team={team}
              regenerateJoinCode={regenerateJoinCode}
              toast={toast}
            />

            <SettingsSection id="roles" title="Coach Roles" icon={Icons.Users} openSections={openSections} toggleSection={toggleSection}>
              <p className="text-[11px] text-slate-500 font-medium mb-3">
                Head coaches can edit lineups, evals, and settings. Assistants
                submit eval grades and view today&apos;s lineup.
              </p>
              <div className="space-y-2 mb-2">
                <div className="flex justify-between items-center bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 truncate">{team.ownerId === user?.uid ? "You" : memberDisplay(team.ownerId)}</div>
                    <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Head Coach (Owner)</div>
                  </div>
                </div>

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
                            {isMe ? "You" : memberDisplay(uid)}
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
            </SettingsSection>

            <SettingsSection id="reminders" title="Eval Reminders" icon={Icons.Clipboard} openSections={openSections} toggleSection={toggleSection}>
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
            </SettingsSection>

            <SettingsSection id="invites" title="Invite Coaches" icon={Icons.Plus} openSections={openSections} toggleSection={toggleSection}>
              <p className="text-[11px] text-slate-500 font-medium mb-3">
                Pulls coach emails from your TeamSnap roster CSV (rows
                marked Coach or Manager). Pick who to invite, hit Send
                Selected, and we&apos;ll email each a one-time invite link
                from your signed-in Gmail. Tap &quot;Mail&quot; on a row
                to compose manually instead.
              </p>
              <InviteCoachesPanel
                activeTeamId={activeTeamId}
                team={team}
                createInviteToken={createInviteToken}
                user={user}
                primaryColor={primaryColor}
                toast={toast}
              />
              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mt-6 mb-2">
                Pending &amp; Used Invites
              </h4>
              <div className="space-y-2">
                {(team.invites || []).map((inv) => (
                  <div
                    key={inv.token}
                    className="bg-white/80 p-3 border border-slate-200 rounded-xl shadow-sm flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                        {inv.role === "head" ? "Head" : "Assistant"} ·{" "}
                        {inv.usedBy
                          ? `Used ${new Date(inv.usedAt || inv.createdAt).toLocaleDateString()}`
                          : `Created ${new Date(inv.createdAt).toLocaleDateString()}`}
                      </div>
                      {!inv.usedBy && (
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(
                              `${window.location.origin}${window.location.pathname}?invite=${activeTeamId}.${inv.token}`
                            )
                          }
                          className="text-[11px] font-bold text-team-primary hover:underline truncate block max-w-full"
                        >
                          Copy invite link
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => revokeInviteToken?.(inv.token)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      aria-label="Revoke invite"
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {(team.invites || []).length === 0 && (
                  <p className="text-[11px] text-slate-400 font-medium italic">
                    No invites yet.
                  </p>
                )}
              </div>
            </SettingsSection>
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

                <MarkForNextSeasonPanel
                  players={team.players || []}
                  setPlayerStatus={setPlayerStatus}
                />

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
            <DiagnosticsPanel team={team} user={user} activeTeamId={activeTeamId} />
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
            {realRole === "head" && (
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

      {inviteModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-900">
                Invite Link Ready
              </h3>
              <button
                type="button"
                onClick={() => setInviteModal(null)}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                aria-label="Close"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600 font-medium">
                Send this link to your{" "}
                <strong>
                  {inviteModal.role === "head"
                    ? "head coach"
                    : "assistant coach"}
                </strong>
                . They&apos;ll be added to the team when they open it.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] font-mono break-all text-slate-800">
                {inviteModal.url}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => copyToClipboard(inviteModal.url)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-lg shadow-md"
                  style={{ backgroundColor: primaryColor }}
                >
                  Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
