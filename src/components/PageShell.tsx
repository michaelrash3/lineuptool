import React from "react";
import { Icons } from "../icons";
import { Eyebrow } from "./shared";

// Shared chrome for routed sub-pages — the app-wide modal→page conversion
// standard. Renders inline in the main column like any tab: a back chip
// (wired to useBackOrFallback by the caller), an eyebrow + title header, an
// optional actions row, and the page body. Pages own their body layout; this
// only standardizes the frame so every converted surface reads as one product.
export const PageShell = ({
  eyebrow,
  title,
  onBack,
  backLabel = "Back",
  actions,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="w-full py-2">
    <div className="max-w-3xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 -ml-2 p-2 hover:bg-surface-2 text-ink-3 hover:text-ink rounded-xl transition-colors flex items-center gap-1"
      >
        <Icons.ChevronLeft className="w-5 h-5" />
        <span className="text-[10px] font-black uppercase tracking-widest">
          {backLabel}
        </span>
      </button>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 className="t-card-title mt-1.5 break-words">{title}</h2>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  </div>
);
