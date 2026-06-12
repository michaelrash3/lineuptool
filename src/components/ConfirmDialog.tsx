// Promise-based in-app replacement for window.confirm / window.prompt.
// Visual anatomy mirrors the sign-out dialog in Chrome.tsx (scrim, accent
// strip, uppercase title, ghost Cancel + solid Confirm) so every destructive
// gate in the app reads as the same product instead of native browser chrome.
//
// Usage: const { confirm, promptText } = useConfirm();
//   if (!(await confirm({ title: "Delete this game?", danger: true }))) return;
//   const email = await promptText({ title: "Sign in", inputType: "email" });

import React, { useCallback, useMemo, useRef, useState } from "react";
import { ConfirmContext } from "../contexts";
import { useModalA11y } from "../hooks/useModalA11y";
import type {
  ConfirmContextValue,
  ConfirmOptions,
  PromptTextOptions,
} from "../types";

type PendingRequest = { id: number } & (
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | {
      kind: "prompt";
      opts: PromptTextOptions;
      resolve: (v: string | null) => void;
    }
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DialogShell = ({
  request,
  onDone,
}: {
  request: PendingRequest;
  onDone: () => void;
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(
    request.kind === "prompt" ? request.opts.defaultValue || "" : ""
  );
  const [inputError, setInputError] = useState("");

  const cancel = useCallback(() => {
    if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    onDone();
  }, [request, onDone]);

  useModalA11y(dialogRef, { onClose: cancel });

  const submit = () => {
    if (request.kind === "confirm") {
      request.resolve(true);
      onDone();
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setInputError("This field is required.");
      return;
    }
    if (request.opts.inputType === "email" && !EMAIL_RE.test(trimmed)) {
      setInputError("Enter a valid email address.");
      return;
    }
    request.resolve(trimmed);
    onDone();
  };

  const { opts } = request;
  const danger = request.kind === "confirm" && request.opts.danger;
  const accent = danger ? "var(--danger-600)" : "var(--team-primary)";

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 print:hidden"
      onClick={cancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
        className="bg-surface max-w-sm w-full rounded-2xl shadow-2xl overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />
        {/* noValidate: the dialog renders its own inline error styled like
            the rest of the app instead of the browser's native tooltip. */}
        <form
          className="p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h3
            id="confirm-dialog-title"
            className="text-lg font-black uppercase tracking-tight text-ink mb-1"
          >
            {opts.title}
          </h3>
          {opts.message && (
            <p className="text-sm text-ink-2 font-medium mb-4 whitespace-pre-line">
              {opts.message}
            </p>
          )}
          {request.kind === "prompt" && (
            <div className="mb-4">
              {request.opts.label && (
                <label
                  htmlFor="confirm-dialog-input"
                  className="t-label block mb-1.5"
                >
                  {request.opts.label}
                </label>
              )}
              <input
                id="confirm-dialog-input"
                data-autofocus
                type={request.opts.inputType || "text"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (inputError) setInputError("");
                }}
                placeholder={request.opts.placeholder}
                aria-invalid={inputError ? true : undefined}
                className="w-full p-3 rounded-xl border border-line bg-surface-2 text-ink text-sm font-semibold outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
              />
              {inputError && (
                <p role="alert" className="mt-1.5 text-xs font-bold text-loss">
                  {inputError}
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={cancel}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest bg-surface-2 hover:bg-line text-ink rounded-xl transition-colors"
            >
              {opts.cancelLabel || "Cancel"}
            </button>
            {/* Initial focus lands on Cancel (first focusable) so a stray
                Enter can't fire a destructive action. */}
            <button
              type="submit"
              className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white rounded-xl shadow-md transition-colors ${
                danger
                  ? "bg-[var(--danger-600)] hover:bg-[var(--danger-700)]"
                  : "bg-slate-900 hover:bg-slate-800"
              }`}
            >
              {opts.confirmLabel || "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ConfirmProvider = ({ children }: { children: React.ReactNode }) => {
  // Requests queue FIFO; only the head renders. In practice dialogs are
  // one-at-a-time, but a queue means a second request fired while one is
  // open waits instead of silently replacing it.
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const counter = useRef(0);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        counter.current += 1;
        setQueue((cur) => [
          ...cur,
          { id: counter.current, kind: "confirm", opts, resolve },
        ]);
      }),
    []
  );

  const promptText = useCallback(
    (opts: PromptTextOptions) =>
      new Promise<string | null>((resolve) => {
        counter.current += 1;
        setQueue((cur) => [
          ...cur,
          { id: counter.current, kind: "prompt", opts, resolve },
        ]);
      }),
    []
  );

  const onDone = useCallback(() => {
    setQueue((cur) => cur.slice(1));
  }, []);

  const value = useMemo<ConfirmContextValue>(
    () => ({ confirm, promptText }),
    [confirm, promptText]
  );

  const active = queue[0];

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {active && (
        <DialogShell key={active.id} request={active} onDone={onDone} />
      )}
    </ConfirmContext.Provider>
  );
};
