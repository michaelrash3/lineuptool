import React, { useState } from "react";
import { Icons } from "../icons";
import { Button, Eyebrow } from "./shared.jsx";

// First-run modal shown when a signed-in user has no teams yet.
// Replaces the previous "auto-create My Team" bootstrap so a coach who
// meant to join via a 6-char code can do so without first cleaning up
// an unwanted default team.
//
// Single combined form with two clearly-separated sections. The user
// picks whichever flow they meant — Create or Join — and only that
// section's button is wired. The modal is intentionally NOT dismissible
// (no X, no backdrop, no Esc): a signed-in user with zero teams has
// nothing to fall back to.
export const WelcomeChooser = ({ open, onCreate, onJoin }) => {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(null); // "create" | "join" | null
  const [error, setError] = useState("");

  if (!open) return null;

  const codeNormalized = code.trim().toUpperCase();
  const codeValid = /^[A-HJ-NP-Z2-9]{6}$/.test(codeNormalized);
  const trimmedName = name.trim();

  const handleJoin = async (e) => {
    e?.preventDefault();
    if (!codeValid || busy) return;
    setBusy("join");
    setError("");
    try {
      const result = await onJoin?.(codeNormalized);
      if (!result?.ok) {
        // useInviteFlows already surfaces a toast; mirror it inline so the
        // failure is visible right next to the input the user was looking at.
        setError(
          result?.retryable
            ? "We couldn't join that team. Check the code or your connection and try again."
            : "Code not recognized. Double-check the 6 characters from your head coach."
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy("create");
    setError("");
    try {
      // Empty name falls back to "My Team" — matches the prior bootstrap default.
      const finalName = trimmedName || "My Team";
      const result = await onCreate?.(finalName);
      if (result === false) {
        setError("We couldn't create your team. Please try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="bg-white/95 max-w-lg w-full rounded-2xl shadow-2xl border border-white/50 overflow-hidden">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-7">
          <div className="flex items-start gap-4 mb-6">
            <div
              className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icons.Clipboard
                className="w-7 h-7"
                style={{ color: "var(--team-primary)" }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>Welcome</Eyebrow>
              <h2 className="t-card-title mt-1.5">Set up your team</h2>
              <p className="t-body mt-2 leading-relaxed">
                Joining a team your head coach already set up? Drop in the
                6-character code. Otherwise start a new team and you can invite
                others later.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={handleJoin}
            className="rounded-xl border border-slate-200 bg-white/80 p-5"
          >
            <div className="flex items-start gap-2 mb-3">
              <Icons.Users
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: "var(--team-primary)" }}
              />
              <div className="min-w-0">
                <h3 className="t-h3 text-[13px] tracking-widest text-slate-800">
                  Join an existing team
                </h3>
                <p className="t-body text-xs mt-1">
                  Ask your head coach for the team's 6-character join code.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => {
                  setError("");
                  setCode(e.target.value.toUpperCase().replace(/\s+/g, ""));
                }}
                placeholder="TEAM CODE"
                maxLength={6}
                aria-label="6-character team join code"
                className="flex-1 px-3 py-2.5 text-sm font-mono uppercase tracking-[0.4em] text-slate-900 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-offset-0 transition"
                style={{
                  // Focus ring uses the team primary so the modal feels branded.
                  "--tw-ring-color": "var(--team-primary)",
                }}
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={!codeValid || busy === "join"}
                style={
                  !codeValid || busy === "join"
                    ? { opacity: 0.6, cursor: "not-allowed" }
                    : undefined
                }
              >
                {busy === "join" ? (
                  <>
                    <Icons.Refresh className="w-4 h-4 animate-spin" /> Joining…
                  </>
                ) : (
                  <>
                    <Icons.Check className="w-4 h-4" /> Join Team
                  </>
                )}
              </Button>
            </div>
          </form>

          <div className="my-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-slate-200" />
            <span className="t-eyebrow text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 bg-white/80 p-5"
          >
            <div className="flex items-start gap-2 mb-3">
              <Icons.Plus
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: "var(--team-primary)" }}
              />
              <div className="min-w-0">
                <h3 className="t-h3 text-[13px] tracking-widest text-slate-800">
                  Start a new team
                </h3>
                <p className="t-body text-xs mt-1">
                  Name your team — you can change this any time in Settings.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <input
                type="text"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setError("");
                  setName(e.target.value);
                }}
                placeholder="My Team"
                maxLength={60}
                aria-label="Team name"
                className="flex-1 px-3 py-2.5 text-sm font-bold text-slate-900 bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 transition"
                style={{ "--tw-ring-color": "var(--team-primary)" }}
              />
              <Button
                type="submit"
                variant="secondary"
                size="md"
                disabled={busy === "create"}
                style={
                  busy === "create"
                    ? { opacity: 0.6, cursor: "not-allowed" }
                    : undefined
                }
              >
                {busy === "create" ? (
                  <>
                    <Icons.Refresh className="w-4 h-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <Icons.Plus className="w-4 h-4" /> Create Team
                  </>
                )}
              </Button>
            </div>
          </form>

          <p className="t-meta text-center mt-6 text-slate-400">
            Signed in. Choose one to continue.
          </p>
        </div>
      </div>
    </div>
  );
};
