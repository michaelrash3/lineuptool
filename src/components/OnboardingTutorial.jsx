import React, { useCallback, useEffect, useState } from "react";
import { Icons } from "../icons";
import { Button, Eyebrow } from "./shared.jsx";

const STORAGE_KEY = "lineuptool.onboardingComplete.v1";

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

const STEPS = [
  {
    eyebrow: "Welcome",
    title: "Coach's Card",
    body: "The advanced lineup, scoring, and stats dashboard for youth-baseball coaches. This quick tour walks you through every screen — about 60 seconds.",
    icon: Icons.HomePlate,
  },
  {
    eyebrow: "Step 1 of 7",
    title: "Create or Join a Team",
    body: "From Settings, create a new team or join an existing one with a team code. Set the age group, league rule set, and pitching format — these drive every recommendation downstream.",
    icon: Icons.Users,
  },
  {
    eyebrow: "Step 2 of 7",
    title: "Build the Roster",
    body: "Add each player with a jersey number, primary position, and any position restrictions. Mark batting/throwing hand. The roster is the foundation for every lineup the engine builds.",
    icon: Icons.UserPlus,
  },
  {
    eyebrow: "Step 3 of 7",
    title: "Add Games",
    body: "Use the Schedule tab to add games — date, opponent, home/away. Flag a game as a Big Game (⭐) when you want primary-position-only fielding, e.g. tournaments and rivalries.",
    icon: Icons.Calendar,
  },
  {
    eyebrow: "Step 4 of 7",
    title: "Generate the Lineup",
    body: "From a scheduled game, hit Generate. The engine fills positions inning-by-inning with fairness rules, the catcher 2-inning cap, scarcity-aware ordering, and Big Game rules when flagged.",
    icon: Icons.Clipboard,
  },
  {
    eyebrow: "Step 5 of 7",
    title: "Run In-Game Mode",
    body: "On gameday, open In-Game from the Home dashboard. Tap any cell to swap players. Mid-game injury or removal? Use the red Alert button — fairness math prorates automatically.",
    icon: Icons.Forward,
  },
  {
    eyebrow: "Step 6 of 7",
    title: "Score & Track Stats",
    body: "Save the final score and per-player stats. Hitting/Fielding/Pitching leaderboards on the Home tab refresh instantly. Evaluations tab lets you grade kids across rounds and see trends.",
    icon: Icons.FileText,
  },
  {
    eyebrow: "All Set",
    title: "You're Ready",
    body: "Click the ? button in the bottom corner at any time to replay this tour. Have a great season, Coach.",
    icon: Icons.Check,
  },
];

export const OnboardingTutorial = ({ open, onClose }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const close = useCallback(() => {
    markOnboardingComplete();
    onClose && onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  if (!open) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white/95 max-w-lg w-full rounded-2xl shadow-2xl border border-white/50 overflow-hidden">
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
              className="shrink-0 -mr-2 -mt-1 p-2 text-slate-400 hover:text-slate-700"
              aria-label="Close tutorial"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>
          <p className="t-body mb-7 leading-relaxed">{current.body}</p>
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
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
              className="t-button text-slate-500 hover:text-slate-800"
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
