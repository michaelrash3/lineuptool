import React, { useEffect, useState } from "react";
import { Icons } from "../../icons";
import { Button, Eyebrow } from "../shared";

// The multi-step tour shell extracted from OnboardingTutorial: scrim, accent
// bar, icon chip, CTA row, progress, and keyboard navigation. Steps come in
// as a prop (already numbered — see attachStepNumbers) and persistence of
// "which tour was completed" is the caller's job; this touches no storage.

export interface TourCtaCtx {
  hasPlayers: boolean;
  hasGames: boolean;
  hasGameToday: boolean;
  setActiveTab: (tab: string) => void;
  setIsAddingPlayer: (v: boolean) => void;
  setIsAddingGame?: (v: boolean) => void;
}

export interface TourStepCta {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface TourStep {
  eyebrow?: string;
  title: string;
  icon: React.ComponentType<any>;
  body: string;
  numbered?: boolean;
  cta?: TourStepCta[] | null;
}

// Stamp "Step N of M" onto each numbered step. M is the count of numbered
// steps, so adding/removing a step keeps the labels correct automatically.
export const attachStepNumbers = (steps: TourStep[]): TourStep[] => {
  const total = steps.filter((s) => s.numbered).length;
  let n = 0;
  return steps.map((s) => {
    if (!s.numbered) return s;
    n += 1;
    return { ...s, eyebrow: `Step ${n} of ${total}` };
  });
};

export const TourModal = ({
  open,
  onClose,
  steps,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  steps: TourStep[];
  onComplete?: () => void;
}) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        setStep((s) => Math.min(steps.length - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, steps.length]);

  if (!open || steps.length === 0) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;
  const finish = () => {
    onComplete?.();
    onClose();
  };
  const runCta = (cta: TourStepCta) => {
    cta.run();
    // CTA navigates somewhere; close the tour so the user actually sees
    // the destination rather than the modal scrim over it.
    onClose();
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
              <Icon className="w-7 h-7" style={{ color: "var(--team-ink)" }} />
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>{current.eyebrow}</Eyebrow>
              <h2 className="t-card-title mt-1.5">{current.title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 -mr-2 -mt-1 p-2 text-ink-3 hover:text-ink"
              aria-label="Close tour"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>
          <p className="t-body mb-5 leading-relaxed">{current.body}</p>
          {current.cta && current.cta.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-7">
              {current.cta.map((c) =>
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
                ),
              )}
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {steps.length <= 10 ? (
              steps.map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === step ? "24px" : "8px",
                    backgroundColor:
                      i === step ? "var(--team-primary)" : "var(--line-strong)",
                  }}
                />
              ))
            ) : (
              <span className="t-eyebrow tabular-nums">
                {`${step + 1} / ${steps.length}`}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="t-button text-ink-3 hover:text-ink"
            >
              Skip Tour
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
                <Button onClick={finish}>
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
