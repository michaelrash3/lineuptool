import React, { useState, useRef, useCallback, useMemo, memo } from "react";
import { Icons } from "../icons";
import { ToastContext } from "../contexts";
import { AnimatePresence, m } from "../components/motion";
import type { ToastInput } from "../types";

// Toast system extracted from App.tsx: a provider that exposes push/dismiss
// through ToastContext and the animated on-screen stack that renders them.

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<(ToastInput & { id: number })[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number | string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      counter.current += 1;
      const id = counter.current;
      const t = { kind: "info" as const, duration: 4000, ...toast, id };
      setToasts((cur) => [...cur, t]);
      if (t.duration > 0) {
        setTimeout(() => dismiss(id), t.duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const TOAST_TONES = {
  success: {
    accent: "#10b981",
    iconBg: "linear-gradient(180deg, #10b981, #059669)",
    iconShadow: "0 2px 6px rgba(16,185,129,0.35)",
    actionColor: "#047857",
    actionBorder: "#a7f3d0",
  },
  error: {
    accent: "#f43f5e",
    iconBg: "linear-gradient(180deg, #f43f5e, #e11d48)",
    iconShadow: "0 2px 6px rgba(244,63,94,0.35)",
    actionColor: "#b91c1c",
    actionBorder: "#fecaca",
  },
  warn: {
    accent: "#f59e0b",
    iconBg: "linear-gradient(180deg, #fbbf24, #f59e0b)",
    iconShadow: "0 2px 6px rgba(245,158,11,0.35)",
    actionColor: "#a16207",
    actionBorder: "#fcd34d",
  },
  info: {
    accent: "var(--team-primary)",
    iconBg: "linear-gradient(180deg, #3b82f6, var(--team-primary))",
    iconShadow: "0 2px 6px rgba(37,99,235,0.35)",
    actionColor: "var(--team-primary)",
    actionBorder: "#bfdbfe",
  },
};

const toastIcon = (kind: string) => {
  if (kind === "success") return Icons.Check;
  if (kind === "error") return Icons.Alert;
  if (kind === "warn") return Icons.Alert;
  return Icons.Cloud;
};

const ToastContainer = memo(
  ({
    toasts,
    dismiss,
  }: {
    toasts: (ToastInput & { id: number })[];
    dismiss: (id: number | string) => void;
  }) => {
    // Stays mounted even when empty so AnimatePresence can play exit
    // animations on the last toast; pointer-events pass through the empty
    // container.
    return (
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2.5 max-w-sm w-[min(92vw,360px)] print:hidden pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const tone =
              (TOAST_TONES as Record<string, typeof TOAST_TONES.info>)[
                t.kind as string
              ] || TOAST_TONES.info;
            const Icon = toastIcon(t.kind ?? "info");
            return (
              <m.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 48 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative bg-surface rounded-xl shadow-lg border border-slate-900/5 overflow-hidden flex items-center gap-3 pl-4 pr-3 py-3 pointer-events-auto"
                role="status"
              >
                <span
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ backgroundColor: tone.accent }}
                />
                <span
                  className="shrink-0 w-9 h-9 rounded-[10px] grid place-items-center text-white"
                  style={{
                    background: tone.iconBg,
                    boxShadow: tone.iconShadow,
                  }}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <div className="flex-1 min-w-0">
                  {t.title && (
                    <div
                      className="t-button text-ink"
                      style={{ fontSize: "12px" }}
                    >
                      {t.title}
                    </div>
                  )}
                  {t.message && (
                    <div className="text-[11.5px] font-semibold text-ink-2 mt-0.5 leading-snug">
                      {t.message}
                    </div>
                  )}
                </div>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="shrink-0 t-button px-2.5 py-1.5 rounded-lg border bg-transparent hover:bg-surface-2"
                    style={{
                      color: tone.actionColor,
                      borderColor: tone.actionBorder,
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="shrink-0 w-[22px] h-[22px] grid place-items-center text-ink-3 hover:text-ink rounded-md"
                >
                  <Icons.X className="w-3 h-3" />
                </button>
              </m.div>
            );
          })}
        </AnimatePresence>
      </div>
    );
  },
);
