import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "../icons";
import { Button, Eyebrow } from "./shared";
import { useTeam, useUI } from "../contexts";

// Bumped from v1 → v2 when the tour switched from passive descriptions to
// action-oriented walkthrough with per-step CTAs. v3 adds the tryouts /
// interest-survey step and makes step numbering dynamic so it can't drift
// out of sync with the panel count again.
const STORAGE_KEY = "lineuptool.onboardingComplete.v3";

export const onboardingHasBeenCompleted = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const markOnboardingComplete = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
};

export const resetOnboarding = () => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// Each step's `cta` returns a list of { label, action } buttons. The action
// receives the ctx (useUI bag) and runs setters that navigate / open modals.
// A null cta means there's no jump-into-the-app affordance for that step.
//
// Step numbering is applied AFTER this array is built (see attachStepNumbers)
// so the "Step N of M" eyebrows always match the actual numbered-step count —
// no more hand-maintained "of 7" labels that drift when steps are added.
const buildSteps = (ctx: any) => {
  const { hasGameToday, hasPlayers, hasGames } = ctx;
  return [
    {
      eyebrow: "Welcome",
      title: "Coach's Card",
      icon: Icons.HomePlate,
      body: "Lineups, in-game swaps, eval rounds, tryouts, season stats — all in one place. Each step below pushes you to actually do the thing.",
    },
    {
      numbered: true,
      title: "Set up your team",
      icon: Icons.Settings,
      body: "Open Settings to set the team name, age group, league rules, and pitching format. These drive every recommendation downstream. You can also set team colors and upload a logo here.",
      cta: [
        {
          label: "Go to Settings",
          primary: true,
          run: () => ctx.setActiveTab("settings"),
        },
      ],
    },
    {
      numbered: true,
      title: "Add your players",
      icon: Icons.UserPlus,
      body: hasPlayers
        ? "Roster is started. You can keep adding players one at a time, or bulk-import from a CSV."
        : "Two ways: add players one at a time on the Roster tab, or import a CSV from GameChanger / TeamSnap in Settings.",
      cta: [
        {
          label: "Add a player",
          primary: true,
          run: () => {
            ctx.setActiveTab("roster");
            ctx.setIsAddingPlayer(true);
          },
        },
        {
          label: "Import a CSV",
          run: () => ctx.setActiveTab("settings"),
        },
      ],
    },
    {
      numbered: true,
      title: "Recruit with tryouts & interest",
      icon: Icons.Users,
      body: "Settings → Tryouts gives you two shareable links (with downloadable QR codes for flyers): a year-round Player Interest survey, and per-date tryout signup forms. Signups land in the Tryouts tab where you can grade, take attendance, and project your roster. Interest leads collect in the Interest tab until you're ready.",
      cta: [
        {
          label: "Set up tryouts",
          primary: true,
          run: () => ctx.setActiveTab("settings"),
        },
      ],
    },
    {
      numbered: true,
      title: "Add a game",
      icon: Icons.Calendar,
      body: "Schedule tab → Add Game. Pick the date and opponent. Flag a game as a Big Game ⭐ when you want primary-position-only fielding; otherwise Fair mode rotates kids through the positions they're comfortable playing.",
      cta: [
        {
          label: "Go to Schedule",
          primary: true,
          run: () => {
            ctx.setActiveTab("schedule");
            ctx.setIsAddingGame?.(true);
          },
        },
      ],
    },
    {
      numbered: true,
      title: "Generate a lineup",
      icon: Icons.Clipboard,
      body: "Open a scheduled game and tap Generate. The engine fills positions inning-by-inning with season-long bench + position fairness, the catcher inning cap, pitch-eligibility rules, scarcity-aware ordering, and Big Game rules when flagged.",
      cta: hasGames
        ? [
            {
              label: "Open Schedule",
              primary: true,
              run: () => ctx.setActiveTab("schedule"),
            },
          ]
        : null,
    },
    {
      numbered: true,
      title: "Run In-Game mode",
      icon: Icons.Forward,
      body: "On gameday, open In-Game from the Home dashboard. Tap any cell to swap players; the red Alert button handles mid-game injuries and re-balances the remaining innings automatically.",
      cta: hasGameToday
        ? [
            {
              label: "Go to Home",
              primary: true,
              run: () => ctx.setActiveTab("home"),
            },
          ]
        : null,
    },
    {
      numbered: true,
      title: "Save score & evaluate",
      icon: Icons.FileText,
      body: "After a game: enter the score (Home or Schedule), then open Evaluation to grade players on the 1–5 scale. Eval rounds are due on a set calendar cadence; trends, leaderboards, the Bench Equity tile, and Roster Decisions all refresh instantly.",
      cta: [
        {
          label: "Open Evaluation",
          primary: true,
          run: () => ctx.setActiveTab("evaluation"),
        },
      ],
    },
    {
      eyebrow: "All Set",
      title: "You're ready",
      icon: Icons.Check,
      body: "⌘K / Ctrl-K opens the command palette from anywhere. The ? button in the bottom corner replays this tour. Have a great season.",
    },
  ];
};

// Stamp "Step N of M" onto each numbered step. M is the count of numbered
// steps, so adding/removing a step keeps the labels correct automatically.
const attachStepNumbers = (steps: any[]) => {
  const total = steps.filter((s: any) => s.numbered).length;
  let n = 0;
  return steps.map((s: any) => {
    if (!s.numbered) return s;
    n += 1;
    return { ...s, eyebrow: `Step ${n} of ${total}` };
  });
};

export const OnboardingTutorial = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { team } = useTeam();
  const ui = useUI();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const close = useCallback(() => {
    markOnboardingComplete();
    onClose && onClose();
  }, [onClose]);

  // Action ctx for CTAs — re-derived on each render so it picks up
  // current player/game counts.
  const ctaCtx = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const games = team?.games || [];
    const players = team?.players || [];
    return {
      hasPlayers: players.length > 0,
      hasGames: games.length > 0,
      hasGameToday: games.some(
        (g: any) => g.date === today && g.status !== "final" && g.status !== "postponed"
      ),
      setActiveTab: ui.setActiveTab,
      setIsAddingPlayer: ui.setIsAddingPlayer,
      setIsAddingGame: ui.setIsAddingGame,
    };
  }, [team, ui]);

  const steps = useMemo(() => attachStepNumbers(buildSteps(ctaCtx)), [ctaCtx]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        setStep((s) => Math.min(steps.length - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close, steps.length]);

  if (!open) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;
  const runCta = (cta: any) => {
    cta.run();
    // CTA navigates somewhere; close the tour so the user actually sees
    // the destination rather than the modal scrim over it.
    close();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-surface max-w-lg w-full rounded-2xl shadow-2xl border border-line overflow-hidden">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="p-7">
          <div className="flex items-start gap-5 mb-6">
            <div
              className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: "var(--team-primary-15)" }}
            >
              <Icon className="w-7 h-7" style={{ color: "var(--team-primary)" }} />
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>{current.eyebrow}</Eyebrow>
              <h2 className="t-card-title mt-1.5">{current.title}</h2>
            </div>
            <button
              type="button"
              onClick={close}
              className="shrink-0 -mr-2 -mt-1 p-2 text-ink-3 hover:text-ink"
              aria-label="Close tutorial"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>
          <p className="t-body mb-5 leading-relaxed">{current.body}</p>
          {current.cta && current.cta.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-7">
              {current.cta.map((c: any) =>
                c.primary ? (
                  <Button key={c.label} onClick={() => runCta(c)}>
                    {c.label}
                  </Button>
                ) : (
                  <Button
                    key={c.label}
                    variant="secondary"
                    onClick={() => runCta(c)}
                  >
                    {c.label}
                  </Button>
                )
              )}
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {steps.map((_: any, i: number) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === step ? "24px" : "8px",
                  backgroundColor:
                    i === step ? "var(--team-primary)" : "#cbd5e1",
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={close}
              className="t-button text-ink-3 hover:text-ink"
            >
              Skip Tutorial
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  <Icons.ChevronLeft className="w-4 h-4" /> Back
                </Button>
              )}
              {!isLast ? (
                <Button onClick={() => setStep((s) => s + 1)}>
                  Next <Icons.ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={close}>
                  Done <Icons.Check className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
