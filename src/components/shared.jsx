// Small reusable presentational components extracted from App.jsx Section 8.
// All consumers go through useTeam/useUI from ../contexts.js.

import React, { memo, useMemo } from "react";
import { formatStat } from "../utils/helpers";
import { useTeam, useUI } from "../contexts.js";

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
  }) => {
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
      <div className="bg-white/30 rounded-lg shadow-[0_2px_8px_rgb(0,0,0,0.03)] border border-white/50 overflow-hidden">
        <div className="px-2.5 py-1.5 border-b border-white/40">
          <h4 className="font-extrabold text-[9px] uppercase tracking-widest text-slate-600 truncate">
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
                  <span className="text-[10px] font-black text-slate-400 w-2 shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPlayerClick && onPlayerClick(p.id)}
                    className="text-[11px] font-extrabold text-slate-800 truncate text-left hover:text-team-primary transition-colors cursor-pointer leading-tight"
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
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center py-2 italic">
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
  ({ record, variant = "compact", primaryColor, tertiaryColor }) => {
    const { wins, losses, ties, runsScored, runsAllowed } = record || {
      wins: 0,
      losses: 0,
    };
    if (!record || (wins === 0 && losses === 0 && ties === 0)) return null;
    const wl = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    if (variant === "compact") {
      return (
        <span
          className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-white/50 tabular-nums"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {wl}
        </span>
      );
    }
    return (
      <div className="inline-flex items-center gap-3 bg-white/80 px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          Record
        </span>
        <span className="text-base font-black tabular-nums text-slate-900">
          {wl}
        </span>
        <span className="h-4 w-px bg-slate-300" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RS
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsScored}
        </span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          RA
        </span>
        <span className="text-sm font-black tabular-nums text-slate-900">
          {runsAllowed}
        </span>
      </div>
    );
  }
);

/* ============================================================================
   Design-system primitives — Coach's Card handoff
   ============================================================================ */

export const GlassCard = ({ accent = false, className = "", children, ...rest }) => (
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

export const Eyebrow = ({ className = "", children, ...rest }) => (
  <span className={`t-eyebrow ${className}`} {...rest}>
    {children}
  </span>
);

const getPlayerInitials = (name) => {
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
  ({ player, size = 40, className = "", showNumber = false }) => {
    const photo = player?.photoUrl;
    const initials = getPlayerInitials(player?.name);
    const dim = { width: size, height: size };
    if (photo) {
      return (
        <span
          className={`relative inline-flex items-center justify-center rounded-full overflow-hidden bg-slate-200 border border-white/60 shadow-inner ${className}`}
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
        className={`relative inline-flex items-center justify-center rounded-full font-black tabular-nums text-white border border-white/60 shadow-inner ${className}`}
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
// PlayerProfileModal + AddPlayerModal. Returns a JPEG Blob, ~5–10 KB.
export const cropImageTo256 = (file) =>
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
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas export failed"));
          },
          "image/jpeg",
          0.82
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

export const StatTile = ({ label, value, className = "" }) => (
  <div
    className={`bg-white/60 px-6 py-5 border border-slate-200 text-center shadow-sm rounded-xl ${className}`}
  >
    <span className="block mb-1.5 t-eyebrow">{label}</span>
    <span className="block t-stat-num">{value}</span>
  </div>
);

const CHIP_VARIANTS = {
  primary: { bg: "var(--team-primary)", color: "var(--team-tertiary)", border: "transparent" },
  success: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  danger: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  warn: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  info: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  slate: { bg: "#f1f5f9", color: "#334155", border: "#e2e8f0" },
};

export const Chip = ({ variant = "slate", className = "", children, ...rest }) => {
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

const BUTTON_SIZE = {
  sm: "px-3 py-2 text-[11px]",
  md: "px-5 py-2.5 text-xs",
  lg: "px-6 py-3 text-xs",
};

const BUTTON_VARIANTS = {
  primary: {
    className: "shadow-md hover:-translate-y-0.5 hover:shadow-xl",
    style: { backgroundColor: "var(--team-primary)", color: "var(--team-tertiary)" },
  },
  secondary: {
    className:
      "bg-white/80 border border-slate-200 text-slate-700 shadow-sm hover:bg-white",
    style: {},
  },
  ghost: {
    className: "bg-transparent text-slate-600 hover:bg-white/60",
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
}) => {
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

export const SharedModals = memo(() => {
  const { modal, setModal } = useUI();
  const { team } = useTeam();
  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-white/50">
        <div className="p-1.5" style={{ backgroundColor: team.primaryColor }} />
        <div className="p-6 bg-white">
          <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight">
            {modal.title}
          </h3>
          <p className="text-slate-600 font-medium mb-8 text-sm leading-relaxed whitespace-pre-line">
            {modal.message}
          </p>
          <div className="flex gap-3 justify-end">
            {modal.type === "confirm" && (
              <button
                onClick={() => setModal({ ...modal, isOpen: false })}
                className="px-5 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-colors shadow-sm"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                if (modal.onConfirm) modal.onConfirm();
                setModal({ ...modal, isOpen: false });
              }}
              className="px-5 py-2.5 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:-translate-y-0.5 transition-transform shadow-md"
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
