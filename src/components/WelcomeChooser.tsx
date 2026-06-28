import React, { useState } from "react";
import { signOut } from "firebase/auth";
import { Icons } from "../icons";
import { auth } from "../firebase";
import {
  A11yDialog,
  Button,
  Eyebrow,
  FORM_INPUT_CLASS,
  FORM_INPUT_RING_STYLE,
} from "./shared";

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
interface WelcomeChooserProps {
  open: boolean;
  onCreate?: (
    name: string,
    leagueRuleSet?: "NKB" | "USSSA",
  ) => Promise<any> | any;
  onJoin?: (code: string) => Promise<any> | any;
}

export const WelcomeChooser = ({
  open,
  onCreate,
  onJoin,
}: WelcomeChooserProps) => {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [teamType, setTeamType] = useState<"NKB" | "USSSA" | null>(null);
  const [error, setError] = useState("");
  // In-app sign-out confirmation. Replaces window.confirm so first-run
  // users don't get a 1995-looking dialog over the polished modal.
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!open) return null;

  const performSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.clear();
        } catch {}
      }
      await signOut(auth);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch {
      // best-effort: if signOut fails we just let the user re-try.
      setSigningOut(false);
      setSignOutConfirmOpen(false);
    }
  };

  const codeNormalized = code.trim().toUpperCase();
  const codeValid = /^[A-HJ-NP-Z2-9]{6}$/.test(codeNormalized);
  const trimmedName = name.trim();

  const handleJoin = async (e?: React.FormEvent) => {
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
            : "Code not recognized. Double-check the 6 characters from your head coach.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!teamType) {
      setError("Pick a team type — Rec or Tournament.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      // Empty name falls back to "My Team" — matches the prior bootstrap default.
      const finalName = trimmedName || "My Team";
      const result = await onCreate?.(finalName, teamType);
      if (result === false) {
        setError("We couldn't create your team. Please try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      {/* Non-dismissible by design (no onClose) — the user must join or
          create a team. */}
      <A11yDialog
        label="Welcome — join or create a team"
        className="bg-surface max-w-lg w-full rounded-2xl shadow-2xl border border-line overflow-hidden"
      >
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
              className="mb-5 px-3 py-2 rounded-lg bg-loss-bg border border-line text-loss text-xs font-bold"
            >
              {error}
            </div>
          )}

          <form
            onSubmit={handleJoin}
            className="rounded-xl border border-line bg-surface p-5"
          >
            <div className="flex items-start gap-2 mb-3">
              <Icons.Users
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: "var(--team-primary)" }}
              />
              <div className="min-w-0">
                <h3 className="t-h3 text-[13px] tracking-widest text-ink">
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
                className={`${FORM_INPUT_CLASS} flex-1 font-mono uppercase tracking-[0.4em] text-center`}
                style={FORM_INPUT_RING_STYLE}
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
            <span className="h-px flex-1 bg-line" />
            <span className="t-eyebrow text-ink-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-line bg-surface p-5"
          >
            <div className="flex items-start gap-2 mb-3">
              <Icons.Plus
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: "var(--team-primary)" }}
              />
              <div className="min-w-0">
                <h3 className="t-h3 text-[13px] tracking-widest text-ink">
                  Start a new team
                </h3>
                <p className="t-body text-xs mt-1">
                  Name your team and pick a type — both changeable later in
                  Settings.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                {
                  v: "NKB" as const,
                  label: "Rec",
                  desc: "Everybody plays — fairness across the season.",
                },
                {
                  v: "USSSA" as const,
                  label: "Tournament",
                  desc: "Competitive — best lineup, minimum-play floor.",
                },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setError("");
                    setTeamType(opt.v);
                  }}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    teamType === opt.v
                      ? "border-[var(--team-primary)] bg-surface-2 ring-2 ring-[var(--team-primary)]"
                      : "border-line bg-surface hover:bg-surface-2"
                  }`}
                >
                  <div className="t-h3 text-[13px] tracking-widest text-ink">
                    {opt.label}
                  </div>
                  <div className="t-body text-[11px] text-ink-3 mt-1 leading-tight">
                    {opt.desc}
                  </div>
                </button>
              ))}
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
                className={`${FORM_INPUT_CLASS} flex-1 font-bold`}
                style={FORM_INPUT_RING_STYLE}
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

          <p className="t-meta text-center mt-6 text-ink-3">
            Signed in. Choose one to continue, or{" "}
            <button
              type="button"
              onClick={() => setSignOutConfirmOpen(true)}
              className="underline hover:text-ink-2"
            >
              sign out
            </button>
            .
          </p>
        </div>
      </A11yDialog>

      {signOutConfirmOpen && (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
          onClick={() => !signingOut && setSignOutConfirmOpen(false)}
        >
          <A11yDialog
            label="Sign out?"
            onClose={() => !signingOut && setSignOutConfirmOpen(false)}
            className="bg-surface max-w-sm w-full rounded-2xl shadow-2xl overflow-hidden"
          >
            <div
              className="h-1.5 w-full"
              style={{ backgroundColor: "var(--team-primary)" }}
            />
            <div className="p-6">
              <h3 className="text-lg font-extrabold tracking-tight text-ink mb-1">
                Sign out?
              </h3>
              <p className="text-sm text-ink-2 font-medium mb-5">
                You'll need to sign in again to access your team. Any
                in-progress data is already saved.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => setSignOutConfirmOpen(false)}
                  className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={performSignOut}
                  className="btn-premium px-4 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl shadow-md transition-colors disabled:opacity-60 flex items-center gap-2"
                  style={{ color: "var(--team-tertiary)" }}
                >
                  {signingOut ? (
                    <>
                      <Icons.Refresh className="w-4 h-4 animate-spin" />
                      Signing out…
                    </>
                  ) : (
                    "Sign Out"
                  )}
                </button>
              </div>
            </div>
          </A11yDialog>
        </div>
      )}
    </div>
  );
};
