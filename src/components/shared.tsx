// Small reusable presentational components extracted from App.jsx Section 8.
// All consumers go through useTeam/useUI from ../contexts.

import React, { memo, useMemo } from "react";
import { formatStat } from "../utils/helpers";
import { useTeam, useUI } from "../contexts";

export const LeaderboardCard = memo(
  ({
    title,
    icon: Icon,
    statKey,
    formatStr,
    asc,
    players,
    primaryColor,
    tertiaryColor,
    onPlayerClick,
  }: any) => {
    const sorted = useMemo(() => {
      return [...players]
        .filter((p) => {
          const val = p.stats?.[statKey];
          if (asc && statKey === "era" && (!p.stats?.ip || p.stats.ip === 0))
            return false;
          if (
            !asc &&
            (val === undefined || val === null || val === 0 || val === "0")
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const valA = a.stats?.[statKey] || 0;
          const valB = b.stats?.[statKey] || 0;
          return asc ? valA - valB : valB - valA;
        })
        .slice(0, 3);
    }, [players, statKey, asc]);

    return (
      <div className="bg-surface rounded-lg shadow-[0_2px_8px_rgb(0,0,0,0.03)] border border-line overflow-hidden">
        <div className="px-2.5 py-1.5 border-b border-line">
          <h4 className="font-extrabold text-[9px] uppercase tracking-widest text-ink-2 truncate">
            {title}
          </h4>
        </div>
        <div className="p-2 space-y-1">
          {sorted.length > 0 ? (
            sorted.map((p, i) => (
              <div
                key={p.id}
                className="flex justify-between items-center gap-1.5"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-black text-ink-3 w-2 shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPlayerClick && onPlayerClick(p.id)}
                    className="text-[11px] font-extrabold text-ink truncate text-left hover:text-team-primary transition-colors cursor-pointer leading-tight"
                  >
                    {p.name}
                  </button>
                </div>
                <span
                  className="text-[11px] font-black tabular-nums px-1.5 py-0 rounded-md shrink-0"
                  style={{
                    backgroundColor: primaryColor,
                    color: tertiaryColor,
                  }}
                >
                  {formatStr
                    ? formatStat(p.stats[statKey])
                    : (p.stats[statKey] || 0).toString()}
                </span>
              </div>
            ))
          ) : (
            <div className="text-[9px] font-bold text-ink-3 uppercase tracking-widest text-center py-2 italic">
              No data
            </div>
          )}
        </div>
      </div>
    );
  }
);

/* Compact W-L record. `variant`: "compact" (header) | "full" (home/schedule). */
export const RecordBadge = memo(
  ({ record, variant = "compact", primaryColor, tertiaryColor }: any) => {
    const { wins, losses, ties, runsScored, runsAllowed } = record || {
      wins: 0,
      losses: 0,
    };
    if (!record || (wins === 0 && losses === 0 && ties === 0)) return null;
    const wl = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    if (variant === "compact") {
      return (
        <span
          className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-line tabular-nums"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {wl}
        </span>
      );
    }
    return (
      <div className="inline-flex items-center gap-3 bg-surface px-4 py-2.5 rounded-xl border border-line shadow-sm">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
          Record
        </span>
        <span className="text-base font-black tabular-nums text-ink">
          {wl}
        </span>
        <span className="h-4 w-px bg-slate-300" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
          RS
        </span>
        <span className="text-sm font-black tabular-nums text-ink">
          {runsScored}
        </span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3">
          RA
        </span>
        <span className="text-sm font-black tabular-nums text-ink">
          {runsAllowed}
        </span>
      </div>
    );
  }
);

/* ============================================================================
   Design-system primitives — Coach's Card handoff
   ============================================================================ */

export const GlassCard = ({ accent = false, className = "", children, ...rest }: any) => (
  <div
    className={`glass-card ${className}`}
    {...rest}
  >
    {accent && (
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: "var(--team-primary)" }}
      />
    )}
    {children}
  </div>
);

export const Eyebrow = ({ className = "", children, ...rest }: any) => (
  <span className={`t-eyebrow ${className}`} {...rest}>
    {children}
  </span>
);

const getPlayerInitials = (name: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Reusable player avatar. Renders the player's photoUrl when set, otherwise
// the player's initials over a team-primary gradient. Used in:
//   - roster row
//   - lineup grid (mobile cards + desktop cells)
//   - lineup card PNG / PDF export (off-DOM via Image preload)
//   - player profile modal header
// Size is a Tailwind-compatible pixel measure; the wrapper takes care of
// rounding + shadow + border.
export const PlayerAvatar = memo(
  ({ player, size = 40, className = "", showNumber = false }: any) => {
    const photo = player?.photoUrl;
    const initials = getPlayerInitials(player?.name);
    const dim = { width: size, height: size };
    if (photo) {
      return (
        <span
          className={`relative inline-flex items-center justify-center rounded-full overflow-hidden bg-line border border-line shadow-inner ${className}`}
          style={dim}
        >
          <img
            src={photo}
            alt={player?.name || "Player photo"}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {showNumber && player?.number != null && player.number !== "" && (
            <span
              className="absolute bottom-0 right-0 px-1 rounded-tl-md text-[10px] font-black tabular-nums text-white"
              style={{
                background: "rgba(15,23,42,0.7)",
                lineHeight: 1.1,
              }}
            >
              {player.number}
            </span>
          )}
        </span>
      );
    }
    return (
      <span
        className={`relative inline-flex items-center justify-center rounded-full font-black tabular-nums text-white border border-line shadow-inner ${className}`}
        style={{
          ...dim,
          fontSize: Math.max(10, size * 0.4),
          background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 60%), linear-gradient(135deg, var(--team-primary) 0%, color-mix(in srgb, var(--team-primary) 70%, #0f172a) 60%, #0f172a 100%)`,
        }}
        aria-label={player?.name || "Player"}
      >
        {initials}
        {showNumber && player?.number != null && player.number !== "" && (
          <span
            className="absolute bottom-0 right-0 px-1 rounded-tl-md text-[10px] font-black tabular-nums"
            style={{
              background: "rgba(15,23,42,0.7)",
              lineHeight: 1.1,
            }}
          >
            {player.number}
          </span>
        )}
      </span>
    );
  }
);

// Off-DOM 256×256 canvas crop helper for photo upload. Used by
// PlayerProfileModal + AddPlayerModal. Returns a base64 JPEG data URL
// that's persisted inline on the player record — the app does not use
// Cloud Storage (Spark-plan compatible), so photos live alongside the
// rest of the player document in Firestore.
export const cropImageTo256DataURL = (file: File) =>
  new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        // Cover crop: fill the square, center the longer side.
        const ratio = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        const x = (SIZE - w) / 2;
        const y = (SIZE - h) / 2;
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, x, y, w, h);
        // 0.78 quality keeps a 256×256 JPEG data URL under ~15 KB. Thirty
        // players × 15 KB ≈ 450 KB inline, comfortably under the Firestore
        // 1 MB document cap once games + evaluationEvents are also there.
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
          if (!dataUrl || dataUrl === "data:,") {
            reject(new Error("Canvas export failed"));
            return;
          }
          resolve(dataUrl);
        } catch (err) {
          reject(
            err instanceof Error ? err : new Error("Canvas export failed")
          );
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

export const StatTile = ({ label, value, className = "" }: any) => (
  <div
    className={`bg-surface px-6 py-5 border border-line text-center shadow-sm rounded-xl ${className}`}
  >
    <span className="block mb-1.5 t-eyebrow">{label}</span>
    <span className="block t-stat-num">{value}</span>
  </div>
);

const CHIP_VARIANTS: Record<string, { bg: string; color: string; border: string }> = {
  primary: { bg: "var(--team-primary)", color: "var(--team-tertiary)", border: "transparent" },
  success: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  danger: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  warn: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  info: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  slate: { bg: "#f1f5f9", color: "#334155", border: "#e2e8f0" },
};

export const Chip = ({ variant = "slate", className = "", children, ...rest }: any) => {
  const v = CHIP_VARIANTS[variant] || CHIP_VARIANTS.slate;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border t-chip ${className}`}
      style={{ backgroundColor: v.bg, color: v.color, borderColor: v.border }}
      {...rest}
    >
      {children}
    </span>
  );
};

const BUTTON_SIZE: Record<string, string> = {
  sm: "px-3 py-2 text-[11px]",
  md: "px-5 py-2.5 text-xs",
  lg: "px-6 py-3 text-xs",
};

const BUTTON_VARIANTS: Record<string, { className: string; style: React.CSSProperties }> = {
  primary: {
    className: "shadow-md hover:-translate-y-0.5 hover:shadow-xl",
    style: { backgroundColor: "var(--team-primary)", color: "var(--team-tertiary)" },
  },
  secondary: {
    className:
      "bg-surface border border-line text-ink shadow-sm hover:bg-surface-2",
    style: {},
  },
  ghost: {
    className: "bg-transparent text-ink-2 hover:bg-surface",
    style: {},
  },
  success: {
    className: "bg-emerald-600 text-white shadow-md hover:bg-emerald-700 hover:-translate-y-0.5",
    style: {},
  },
  danger: {
    className: "bg-rose-600 text-white shadow-md hover:bg-rose-700 hover:-translate-y-0.5",
    style: {},
  },
};

export const Button = ({
  variant = "primary",
  size = "md",
  className = "",
  style: styleOverride,
  type = "button",
  children,
  ...rest
}: any) => {
  const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl transition-all t-button ${BUTTON_SIZE[size] || BUTTON_SIZE.md} ${v.className} ${className}`}
      style={{ ...v.style, ...styleOverride }}
      {...rest}
    >
      {children}
    </button>
  );
};

// Shared form input recipe — apply via className on bare <input>/<select>/
// <textarea>. The focus ring color is wired to the team primary via inline
// style so the focus highlight feels branded instead of using Tailwind's
// generic blue ring. Inputs across the app should use this string rather
// than redefining the same border / radius / focus combo locally.
export const FORM_INPUT_CLASS =
  "w-full px-3 py-2.5 text-sm bg-surface border border-line rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-ink-3 disabled:opacity-60 disabled:cursor-not-allowed";

export const FORM_INPUT_RING_STYLE = { "--tw-ring-color": "var(--team-primary)" } as React.CSSProperties;

// Drop-in <Modal> shell. Standardizes backdrop, panel chrome, optional
// accent strip, and the close-on-backdrop / Escape behaviors so new modals
// don't each reinvent the recipe. Keep using OnboardingTutorial's
// purpose-built shell for the multi-step tour — this is the default for
// short confirmations + single-form panels.
export const Modal = ({
  open,
  onClose,
  title,
  eyebrow,
  accent = true,
  size = "md",
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
  footer,
}: any) => {
  React.useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  const widthClass =
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-surface ${widthClass} w-full rounded-2xl shadow-2xl border border-line overflow-hidden`}
      >
        {accent && (
          <div
            className="h-1.5 w-full"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
        )}
        <div className="p-6 sm:p-7">
          {(eyebrow || title || onClose) && (
            <div className="flex items-start gap-3 mb-4">
              <div className="min-w-0 flex-1">
                {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
                {title && (
                  <h3 className="t-card-title mt-1.5 break-words">{title}</h3>
                )}
              </div>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 -mr-2 -mt-1 p-2 text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <span className="block w-4 h-4 leading-none text-lg">×</span>
                </button>
              )}
            </div>
          )}
          <div className="t-body text-ink">{children}</div>
          {footer && (
            <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SharedModals = memo(() => {
  const { modal, setModal } = useUI();
  const { team } = useTeam();
  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-line">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: team.primaryColor }}
        />
        <div className="p-6 sm:p-7">
          <h3 className="t-card-title mb-2">{modal.title}</h3>
          <p className="t-body mb-6 leading-relaxed whitespace-pre-line">
            {modal.message}
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            {modal.type === "confirm" && (
              <button
                onClick={() => setModal({ ...modal, isOpen: false })}
                className="px-5 py-2.5 bg-surface border border-line text-ink font-black text-xs uppercase tracking-widest rounded-xl hover:bg-surface-2 transition-colors shadow-sm"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                if (modal.onConfirm) modal.onConfirm();
                setModal({ ...modal, isOpen: false });
              }}
              className="px-5 py-2.5 font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
              style={{
                backgroundColor: team.primaryColor,
                color: team.tertiaryColor,
              }}
            >
              {modal.type === "confirm" ? "Confirm" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
