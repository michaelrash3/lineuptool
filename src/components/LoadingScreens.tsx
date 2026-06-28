import React from "react";
import { Icons } from "../icons";
import { APP_NAME } from "../constants/ui";

// Loading placeholders, extracted from App.tsx. Both are pure presentational
// components with no app state — kept together since they're the two "still
// loading" surfaces (one per lazy tab chunk, one for cold start).

// In-screen placeholder while a lazy tab chunk (and its data) resolves. A
// layout skeleton — an eyebrow, a title, and a card grid — reads as "content
// is loading" and reserves the space so the real screen doesn't jump in.
export const ScreenLoader = () => (
  <div
    role="status"
    aria-busy="true"
    aria-live="polite"
    className="w-full max-w-5xl mx-auto py-2"
  >
    <span className="sr-only">Loading…</span>
    <div aria-hidden="true">
      <div className="h-3 w-24 skeleton mb-3" />
      <div className="h-7 w-56 skeleton mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 skeleton" />
        ))}
      </div>
    </div>
  </div>
);

// Branded full-screen gate for cold start (auth / team / role resolution).
// Shares the login screen's visual language — accent-lit mark + wordmark —
// so the first paint feels like the app, not a blank spinner. Team colors
// may still be at their defaults here; the CSS vars handle that gracefully.
export const AppLoadingScreen = () => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-screen flex flex-col items-center justify-center bg-app relative overflow-hidden"
  >
    <div className="flex flex-col items-center gap-5 relative z-10">
      <div
        className="cc-breathe w-16 h-16 rounded-sm flex items-center justify-center glow-primary"
        style={{
          background:
            "linear-gradient(160deg, var(--team-primary), color-mix(in srgb, var(--team-primary) 55%, #000))",
        }}
      >
        <Icons.Clipboard
          className="w-8 h-8"
          style={{ color: "var(--team-tertiary)" }}
        />
      </div>
      <div className="text-center">
        <div className="t-h2">{APP_NAME}</div>
        <div className="t-eyebrow text-ink-3 mt-2 flex items-center justify-center gap-2">
          <Icons.Refresh className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      </div>
    </div>
  </div>
);
