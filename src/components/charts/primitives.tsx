import React from "react";
import { ResponsiveContainer } from "recharts";

// Shared recharts building blocks. Every chart in the app goes through these
// so tooltips, gradients, and accessibility behave the same everywhere.

// useId can contain ":" which breaks url(#…) references in some engines.
export const useChartId = () => {
  const raw = React.useId();
  return React.useMemo(
    () => `chart-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [raw],
  );
};

// Vertical fade gradient for area/bar fills. CSS variables are valid SVG
// paint values, so passing var(--team-primary) keeps dark mode retints free.
export const FadeGradient = ({
  id,
  color,
  from = 0.7,
  to = 0.04,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor={color} stopOpacity={from} />
    <stop offset="100%" stopColor={color} stopOpacity={to} />
  </linearGradient>
);

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
}

// Custom recharts Tooltip content styled to the design tokens. Pass as
// <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />.
export const ChartTooltip = ({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (value: number, entry: TooltipEntry) => React.ReactNode;
  labelFormatter?: (label: string | number) => React.ReactNode;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-card min-w-[8rem]">
      {label != null && label !== "" && (
        <div className="t-eyebrow text-ink-3 mb-1">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li
            key={`${entry.dataKey ?? entry.name ?? i}`}
            className="flex items-center gap-2 text-xs font-bold text-ink-2"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: entry.color || entry.stroke || entry.fill,
              }}
            />
            <span className="truncate">{entry.name}</span>
            <span className="tabular-nums font-black text-ink ml-auto pl-3">
              {formatter ? formatter(Number(entry.value), entry) : entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Sized wrapper around ResponsiveContainer. The aria role/label live here
// (not on the SVG) because ResponsiveContainer measures 0x0 under jsdom and
// renders nothing — tests assert against this wrapper.
export const ChartFrame = ({
  label,
  height,
  className = "",
  children,
}: {
  label: string;
  height: number;
  className?: string;
  children: React.ReactElement;
}) => (
  <div
    role="img"
    aria-label={label}
    className={`w-full ${className}`}
    style={{ height }}
  >
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  </div>
);
