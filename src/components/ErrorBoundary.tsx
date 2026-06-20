import React from "react";
import { Icons } from "../icons";
import { reportError } from "../utils/errorReporter";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  // When this value changes (e.g. the route pathname), the boundary clears a
  // captured error and retries rendering its children. Without it, a single
  // failed screen would stay stuck on the fallback even after the user
  // navigates to a healthy tab.
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
  // Bumped by "Try again" to force React to remount the subtree, since the
  // children themselves are unchanged and would otherwise re-throw immediately.
  retry: number;
}

// App-wide safety net for the lazily-loaded screens. Before this existed any
// render-time throw — or a failed dynamic import of a screen chunk (common
// when a coach keeps a stale tab open across a deploy) — unmounted the whole
// React tree and left a blank white page with no message and no way back.
// That blank screen was the "Settings tab comes up blank" report. Now the
// failure is contained: the rest of the shell (header, tab bar) stays up, the
// user sees a recoverable error instead of nothing, and the underlying error
// is logged + shown so the real cause is diagnosable.
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, retry: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Clear the error when the reset key changes so navigating away from a
    // broken screen lands on a fresh render rather than the fallback.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Route through the central reporter (console trail + any configured sink).
    // The on-screen detail stays intentionally terse.
    reportError(error, {
      source: "ErrorBoundary",
      componentStack: info.componentStack,
    });
  }

  handleRetry = () => {
    this.setState((s) => ({ error: null, retry: s.retry + 1 }));
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return (
        <React.Fragment key={this.state.retry}>
          {this.props.children}
        </React.Fragment>
      );
    }

    const isChunkError =
      /loading chunk|dynamically imported module|failed to fetch/i.test(
        error.message || "",
      );

    return (
      <div className="max-w-lg mx-auto my-10 bg-surface border border-line rounded-2xl shadow-sm overflow-hidden">
        <div className="p-1.5 bg-rose-500" />
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-full bg-rose-50">
              <Icons.Alert className="w-6 h-6 text-rose-600" />
            </div>
            <h2 className="text-lg font-black uppercase tracking-wide text-ink">
              Something went wrong
            </h2>
          </div>
          <p className="text-sm text-ink-2 font-medium mb-5 leading-snug">
            {isChunkError
              ? "This screen couldn't finish loading — usually because the app was updated while this tab was open. Reloading the page fixes it."
              : "This screen hit an unexpected error. You can try again, switch tabs, or reload the page."}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-xl hover:bg-surface-2 transition-colors"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white bg-slate-900 rounded-xl shadow-sm hover:bg-slate-800 transition-colors"
            >
              Reload Page
            </button>
          </div>
          {error.message && (
            <details className="mt-5">
              <summary className="text-[10px] font-black uppercase tracking-widest text-ink-3 cursor-pointer">
                Error details
              </summary>
              <pre className="mt-2 text-[11px] text-ink-2 bg-app border border-line rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words">
                {error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
