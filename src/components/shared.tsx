// Small reusable presentational components extracted from App.jsx Section 8.
// All consumers go through useTeam/useUI from ../contexts.

import React, { memo, useContext, useMemo } from "react";
import { formatStat } from "../utils/helpers";
import { TeamContext, useTeam, useUI } from "../contexts";
import { useModalA11y } from "../hooks/useModalA11y";
import { m, SCALE_IN } from "./motion";

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
    stripped = false,
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

    // Stripped: one compact row — stat label + the single leader + value, no
    // card chrome or top-3 list.
    if (stripped) {
      const top = sorted[0];
      return (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 truncate">
            {title}
          </span>
          {top ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => onPlayerClick && onPlayerClick(top.id)}
                className="text-[11px] font-extrabold text-ink truncate text-left hover:text-team-primary transition-colors cursor-pointer"
              >
                {top.name}
              </button>
              <span
                className="text-[11px] font-black tabular-nums px-1.5 py-0 rounded-md shrink-0"
                style={{ backgroundColor: primaryColor, color: tertiaryColor }}
              >
                {formatStr
                  ? formatStat(top.stats?.[statKey])
                  : (top.stats?.[statKey] || 0).toString()}
              </span>
            </span>
          ) : (
            <span className="text-[9px] font-bold text-ink-3 uppercase tracking-widest italic">
              No data
            </span>
          )}
        </div>
      );
    }

    return (
      <div className="border border-line overflow-hidden">
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
                    ? formatStat(p.stats?.[statKey])
                    : (p.stats?.[statKey] || 0).toString()}
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
  },
);

/* Empty-state for blank surfaces (no roster, no games, no stats…). Unified to
   the Schedule look: a transparent (card-less) center column with the team logo
   as a faint grayscale watermark — falling back to a large sanctioned emoji
   glyph (⚾ 🧢 📋 ⭐ 📅 📊) when no `logoUrl` is supplied. Pass an
   `action`/`onAction` for a primary CTA. */
export const EmptyState = memo(
  ({ glyph, icon: Icon, title, body, action, onAction }: any) => {
    const teamContext = useContext(TeamContext);
    const logoUrl = teamContext?.team?.logoUrl;
    return (
      <div className="relative overflow-hidden border border-line bg-transparent px-6 py-20 text-center min-h-[276px] flex flex-col items-center justify-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Team Logo"
            className="absolute inset-0 m-auto h-[82%] w-[82%] object-contain opacity-20 grayscale pointer-events-none select-none"
            aria-hidden
          />
        ) : glyph ? (
          <div className="text-5xl leading-none mb-4 opacity-80" aria-hidden>
            {glyph}
          </div>
        ) : null}
        <div className="relative z-10 flex flex-col items-center">
          {Icon && !logoUrl && (
            <div className="inline-flex p-3 bg-surface-2 mb-4">
              <Icon className="w-7 h-7 text-ink-3" />
            </div>
          )}
          {title && (
            <h3 className="font-black uppercase tracking-widest text-ink-3 text-lg mb-2">
              {title}
            </h3>
          )}
          {body && (
            <p className="text-ink-3 text-sm font-semibold max-w-sm mx-auto mb-5">
              {body}
            </p>
          )}
          {action && (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center gap-2 t-button px-5 py-2.5 text-white"
              style={{ backgroundColor: "var(--team-primary)" }}
            >
              {action}
            </button>
          )}
        </div>
      </div>
    );
  },
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
          className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-lg shadow-sm border border-line tabular-nums whitespace-nowrap"
          style={{ backgroundColor: primaryColor, color: tertiaryColor }}
        >
          {wl}
        </span>
      );
    }
    // Scoreboard strip — three equal cells (Record / RS / RA) stacked
    // label-over-number. Fills the row on mobile (w-full) and shrinks to
    // content on larger screens. tabular-nums + whitespace-nowrap keep the
    // W-L value from breaking at its hyphens into a vertical stack.
    const cells: Array<{ label: string; value: React.ReactNode }> = [
      { label: "Record", value: wl },
      { label: "RS", value: runsScored ?? 0 },
      { label: "RA", value: runsAllowed ?? 0 },
    ];
    return (
      <div className="flex w-full sm:w-auto items-stretch divide-x divide-line rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
        {cells.map(({ label, value }) => (
          <div
            key={label}
            className="flex-1 sm:flex-none flex flex-col items-center justify-center gap-1 px-4 py-2 sm:min-w-[64px]"
          >
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-ink-3 leading-none">
              {label}
            </span>
            <span className="text-base font-black tabular-nums text-ink leading-none whitespace-nowrap">
              {value}
            </span>
          </div>
        ))}
      </div>
    );
  },
);

/* ============================================================================
   Design-system primitives — Coach's Card handoff
   ============================================================================ */

export const Eyebrow = ({ className = "", children, ...rest }: any) => (
  <span className={`t-eyebrow ${className}`} {...rest}>
    {children}
  </span>
);

export const getPlayerInitials = (name: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Reusable player avatar. Per-player photos were removed (they were stored as
// inline base64 inside the single team doc and pushed it toward Firestore's
// 1 MB cap), so the avatar now shows the TEAM LOGO when one is set, falling
// back to the player's initials over a team-primary gradient when it isn't.
// The jersey number (and, when asked, the primary position) overlay on top so a
// roster of identical logos is still readable at a glance. Used in:
//   - roster row
//   - player profile modal header + add-player preview
// (The lineup card PNG/PDF export draws its own avatars off-DOM in lineupCard.)
export const PlayerAvatar = memo(
  ({
    player,
    size = 40,
    className = "",
    showNumber = false,
    showPosition = false,
    // Background fill behind the (transparent) team logo. Defaults to white so
    // the logo always reads; callers on a dark surface can pass a dark fill so
    // the avatar reads as a medallion instead of a white blob.
    circleClassName = "bg-white",
  }: any) => {
    const { team } = useTeam();
    const logoUrl = team?.logoUrl;
    const initials = getPlayerInitials(player?.name);
    const dim = { width: size, height: size };
    const hasNumber =
      showNumber && player?.number != null && player.number !== "";
    const hasPosition = showPosition && !!player?.primaryPosition;
    const numberBadge = hasNumber ? (
      <span
        className="absolute bottom-0 right-0 px-1 rounded-tl-md text-[10px] font-black tabular-nums text-white"
        style={{ background: "rgba(15,23,42,0.7)", lineHeight: 1.1 }}
      >
        {player.number}
      </span>
    ) : null;
    const positionBadge = hasPosition ? (
      <span
        className="absolute top-0 left-0 px-1 rounded-br-md text-[9px] font-black uppercase tracking-wider"
        style={{
          background: "var(--team-tertiary)",
          color: "var(--team-primary)",
          lineHeight: 1.2,
        }}
      >
        {player.primaryPosition}
      </span>
    ) : null;

    if (logoUrl) {
      return (
        <span
          className={`relative inline-flex items-center justify-center rounded-full overflow-hidden ${circleClassName} border border-line shadow-inner ${className}`}
          style={dim}
        >
          <img
            src={logoUrl}
            alt={player?.name ? `${player.name} — team logo` : "Team logo"}
            className="w-full h-full object-contain p-1"
            loading="lazy"
          />
          {positionBadge}
          {numberBadge}
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
        {positionBadge}
        {numberBadge}
      </span>
    );
  },
);

// Cache the one-time WebP-encode capability check.
let _webpEncodeSupport: boolean | null = null;
const canvasSupportsWebp = (): boolean => {
  if (_webpEncodeSupport !== null) return _webpEncodeSupport;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    _webpEncodeSupport = c
      .toDataURL("image/webp")
      .startsWith("data:image/webp");
  } catch {
    _webpEncodeSupport = false;
  }
  return _webpEncodeSupport;
};

// Byte cost of a data URL when stored in Firestore (the doc holds it as a
// UTF-8 string, so the string length is the storage cost).
const dataUrlBytes = (url: string): number => url.length;

// Downscale + compress an image so a logo can ALWAYS be stored inline without
// blowing the Firestore document limit — instead of rejecting an oversized
// file, we shrink it to fit. An image already within `maxDim` and under
// `targetBytes` is returned untouched (no needless quality loss). Otherwise it
// is scaled to fit `maxDim` and re-encoded, preferring WebP (which keeps
// transparency AND compresses; PNG is the fallback), stepping quality and then
// dimensions down until the data URL fits `targetBytes`. Transparency is
// preserved (no background fill), so PNG logos with alpha stay clean.
export const downscaleImageToDataURL = (
  file: File,
  {
    maxDim = 512,
    targetBytes = 200_000,
  }: { maxDim?: number; targetBytes?: number } = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file"));
    // Reject non-image files up front so a renamed binary (e.g. a .pdf picked as
    // a "photo") never gets fed to the canvas/decoder. Browsers set file.type
    // from the OS MIME mapping; empty type (unknown) is treated as not-an-image.
    if (!file.type || !file.type.startsWith("image/")) {
      return reject(new Error("Please choose an image file."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const original = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        const longest = Math.max(img.width, img.height) || 1;
        // Already small enough in both dimensions and bytes — keep as-is.
        if (longest <= maxDim && dataUrlBytes(original) <= targetBytes) {
          resolve(original);
          return;
        }
        const webp = canvasSupportsWebp();
        // Encode at a target longest-edge size; return the smallest data URL we
        // can make at that size (under target if possible, else best effort).
        const encodeAt = (dim: number): string | null => {
          const scale = Math.min(1, dim / longest);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0, w, h); // no fill -> preserve transparency
          let best: string | null = null;
          if (webp) {
            for (const q of [0.85, 0.7, 0.55, 0.4]) {
              const url = canvas.toDataURL("image/webp", q);
              if (url && url !== "data:,") {
                best = url;
                if (dataUrlBytes(url) <= targetBytes) return url;
              }
            }
          }
          const png = canvas.toDataURL("image/png");
          if (png && png !== "data:,") {
            if (dataUrlBytes(png) <= targetBytes) return png;
            if (!best || dataUrlBytes(png) < dataUrlBytes(best)) best = png;
          }
          return best;
        };

        let dim = Math.min(maxDim, longest);
        let last: string | null = null;
        for (let i = 0; i < 6; i++) {
          const url = encodeAt(dim);
          if (url) {
            last = url;
            if (dataUrlBytes(url) <= targetBytes) {
              resolve(url);
              return;
            }
          }
          dim = Math.round(dim * 0.75);
          if (dim < 48) break;
        }
        if (last) resolve(last);
        else reject(new Error("Could not process image"));
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });

// Pull the dominant colors out of a logo so we can suggest team colors.
// Uses the same FileReader → Image → <canvas> approach as downscaleImageToDataURL,
// but instead of re-encoding the image we read its pixels and bucket them.
//
// `src` may be a data URL string (uploadLogo already produces one) or a
// File. Returns up to `count` distinct #rrggbb colors ordered by how much
// of the logo they cover. On ANY failure it resolves to [] rather than
// rejecting — color suggestion is a nicety and must never break the upload.
const toHex = (n: number) => n.toString(16).padStart(2, "0");
const rgbToHex = (r: number, g: number, b: number) =>
  `#${toHex(r)}${toHex(g)}${toHex(b)}`;

export const extractLogoPalette = (
  src: string | File,
  count = 6,
): Promise<string[]> =>
  new Promise((resolve) => {
    const run = (dataUrl: string) => {
      const img = new Image();
      img.onerror = () => resolve([]);
      img.onload = () => {
        try {
          // Downscale to a small canvas — we only need relative color
          // frequencies, and 48×48 keeps the pixel loop fast.
          const SIZE = 48;
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve([]);
          const ratio = Math.min(SIZE / img.width, SIZE / img.height) || 1;
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
          const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

          // Bucket near-identical shades together by quantizing each channel
          // to 32-level steps. Track a running sum per bucket so we can emit
          // the average (truer) color rather than the rounded bucket key.
          const STEP = 32;
          const buckets = new Map<
            string,
            { count: number; r: number; g: number; b: number }
          >();
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 125) continue; // skip transparent logo backgrounds
            if (r > 240 && g > 240 && b > 240) continue; // skip near-white bg
            const key = `${Math.round(r / STEP)}-${Math.round(
              g / STEP,
            )}-${Math.round(b / STEP)}`;
            const cur = buckets.get(key);
            if (cur) {
              cur.count++;
              cur.r += r;
              cur.g += g;
              cur.b += b;
            } else {
              buckets.set(key, { count: 1, r, g, b });
            }
          }

          const sorted = Array.from(buckets.values())
            .sort((x, y) => y.count - x.count)
            .map((bk) =>
              rgbToHex(
                Math.round(bk.r / bk.count),
                Math.round(bk.g / bk.count),
                Math.round(bk.b / bk.count),
              ),
            );

          // Drop colors that are perceptually too close to one already
          // chosen so the suggested swatches feel distinct.
          const picked: string[] = [];
          const hexToRgb = (hex: string) => [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
          ];
          for (const hex of sorted) {
            const [r, g, b] = hexToRgb(hex);
            const tooClose = picked.some((p) => {
              const [pr, pg, pb] = hexToRgb(p);
              return (
                Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 48
              );
            });
            if (!tooClose) picked.push(hex);
            if (picked.length >= count) break;
          }
          resolve(picked);
        } catch {
          // getImageData throws on a tainted canvas, etc. — degrade quietly.
          resolve([]);
        }
      };
      img.src = dataUrl;
    };

    if (typeof src === "string") {
      run(src);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve([]);
    reader.onload = () => run(reader.result as string);
    reader.readAsDataURL(src);
  });

export const StatTile = ({ label, value, className = "" }: any) => (
  <div className={`cc-card px-6 py-5 text-center rounded-2xl ${className}`}>
    <span className="block mb-1.5 t-eyebrow">{label}</span>
    <span className="block t-stat-num t-gradient">{value}</span>
  </div>
);

// Semantic-lane tokens (theme-aware); borders are a translucent mix of the
// lane color so they tint correctly on both light and dark surfaces.
const CHIP_VARIANTS: Record<
  string,
  { bg: string; color: string; border: string }
> = {
  primary: {
    bg: "var(--team-primary)",
    color: "var(--team-tertiary)",
    border: "transparent",
  },
  success: {
    bg: "var(--win-bg)",
    color: "var(--win)",
    border: "color-mix(in srgb, var(--win) 30%, transparent)",
  },
  danger: {
    bg: "var(--loss-bg)",
    color: "var(--loss)",
    border: "color-mix(in srgb, var(--loss) 30%, transparent)",
  },
  warn: {
    bg: "var(--warn-bg)",
    color: "var(--warn-fg)",
    border: "color-mix(in srgb, var(--warn-fg) 30%, transparent)",
  },
  info: {
    bg: "var(--info-bg)",
    color: "var(--info-fg)",
    border: "color-mix(in srgb, var(--info-fg) 30%, transparent)",
  },
  slate: {
    bg: "var(--surface-2)",
    color: "var(--ink-2)",
    border: "var(--line)",
  },
};

export const Chip = ({
  variant = "slate",
  className = "",
  children,
  ...rest
}: any) => {
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

const BUTTON_VARIANTS: Record<
  string,
  { className: string; style: React.CSSProperties }
> = {
  primary: {
    className: "btn-premium hover:-translate-y-0.5",
    style: { color: "var(--team-tertiary)" },
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
    className:
      "bg-emerald-600 text-white shadow-md hover:bg-emerald-700 hover:-translate-y-0.5",
    style: {},
  },
  danger: {
    className:
      "bg-rose-600 text-white shadow-md hover:bg-rose-700 hover:-translate-y-0.5",
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
    <m.button
      type={type}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl transition-all t-button ${BUTTON_SIZE[size] || BUTTON_SIZE.md} ${v.className} ${className}`}
      style={{ ...v.style, ...styleOverride }}
      {...rest}
    >
      {children}
    </m.button>
  );
};

// Dialog-panel wrapper for the app's hand-rolled modal shells (the ones
// with bespoke layouts that don't fit <Modal>). Renders the panel div with
// dialog semantics + useModalA11y behaviors; the caller keeps its own scrim
// and layout classes. `label` feeds aria-label; pass onClose to enable
// Escape (omit it for non-dismissible flows like WelcomeChooser).
export const A11yDialog = ({
  onClose,
  label,
  className = "",
  children,
  ...rest
}: any) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useModalA11y(ref, { onClose });
  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className={`outline-none ${className}`}
      {...SCALE_IN}
      {...rest}
    >
      {children}
    </m.div>
  );
};

// Shared form input recipe — apply via className on bare <input>/<select>/
// <textarea>. The focus ring color is wired to the team primary via inline
// style so the focus highlight feels branded instead of using Tailwind's
// generic blue ring. Inputs across the app should use this string rather
// than redefining the same border / radius / focus combo locally.
export const FORM_INPUT_CLASS =
  "w-full px-3 py-2.5 text-sm bg-surface border border-line rounded-xl outline-none transition-shadow focus:ring-2 focus:border-transparent placeholder:text-ink-3 disabled:opacity-60 disabled:cursor-not-allowed";

export const FORM_INPUT_RING_STYLE = {
  "--tw-ring-color": "var(--team-primary)",
} as React.CSSProperties;

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
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  // Escape-close, focus trap, and focus restore (stack-aware for nested
  // dialogs) — see useModalA11y.
  useModalA11y(dialogRef, {
    onClose: closeOnEscape && onClose ? onClose : undefined,
    enabled: !!open,
  });

  if (!open) return null;

  const widthClass =
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return (
    <m.div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <m.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bg-surface ${widthClass} w-full rounded-2xl shadow-2xl border border-line overflow-hidden outline-none`}
        {...SCALE_IN}
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
                  <h3 id={titleId} className="t-card-title mt-1.5 break-words">
                    {title}
                  </h3>
                )}
              </div>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 -mr-2 -mt-1 inline-flex items-center justify-center min-h-[40px] min-w-[40px] text-ink-3 hover:text-ink hover:bg-surface-2 rounded-lg transition-colors"
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
      </m.div>
    </m.div>
  );
};

export const SharedModals = memo(() => {
  const { modal, setModal } = useUI();
  const { team } = useTeam();
  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <A11yDialog
        label={modal.title}
        onClose={() => setModal({ ...modal, isOpen: false })}
        className="bg-surface rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-line"
      >
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
      </A11yDialog>
    </div>
  );
});
