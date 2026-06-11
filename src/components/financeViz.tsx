import React from "react";
import { formatCurrency } from "../utils/helpers";
import type { CashflowMonth, YearComparisonRow } from "../utils/helpers";

// Dependency-free SVG money visuals for the Finances tab, built on the same
// design tokens as the rest of the app (team gradient hero like HomeTab's
// scoreboard, win/loss colors, t-* typography). No chart library on purpose.

// Slim progress bar — green normally, amber past 80%, red when over 100%.
export const MoneyMeter = ({
  value,
  max,
  className = "",
}: {
  value: number;
  max: number;
  className?: string;
}) => {
  const pct = max > 0 ? (value / max) * 100 : value > 0 ? 100 : 0;
  const width = Math.max(0, Math.min(100, pct));
  const color =
    pct > 100 ? "var(--loss)" : pct > 80 ? "var(--warn-fg)" : "var(--win)";
  return (
    <div
      className={`h-1.5 w-full rounded-full bg-surface-2 overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
};

// White polyline sparkline of the running balance, for the hero card.
const BalanceSparkline = ({ months }: { months: CashflowMonth[] }) => {
  if (months.length < 2) return null;
  const w = 160;
  const h = 36;
  const vals = months.map((m) => m.balanceEnd);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="opacity-90"
      aria-label="Balance trend"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Gradient scoreboard-style hero: big club balance + balance trend + the
// same metric labels the old tiles used (tests and muscle memory survive).
export const FinanceHero = ({
  balanceNow,
  collected,
  otherIncome,
  spent,
  stillOwed,
  balanceOnceAllPaid,
  months,
}: {
  balanceNow: number;
  collected: number;
  otherIncome: number;
  spent: number;
  stillOwed: number;
  balanceOnceAllPaid: number;
  months: CashflowMonth[];
}) => (
  <div
    className="glass-card relative overflow-hidden text-white"
    style={{
      background:
        "linear-gradient(135deg, var(--team-primary), var(--team-primary-2))",
    }}
  >
    <div className="p-5 sm:p-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="t-eyebrow text-white/70">Balance now</div>
        <div className="text-4xl sm:text-5xl font-black tabular-nums tracking-tight">
          {formatCurrency(balanceNow)}
        </div>
      </div>
      <BalanceSparkline months={months} />
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-white/15 border-t border-white/15 bg-black/10">
      {[
        { label: "Fees collected", value: collected },
        { label: "Sponsorships & income", value: otherIncome },
        { label: "Spent", value: spent },
        { label: "Still owed", value: stillOwed },
        { label: "Balance once all paid", value: balanceOnceAllPaid },
      ].map((m) => (
        <div key={m.label} className="px-3 py-2.5 text-center">
          <div className="t-eyebrow text-white/60">{m.label}</div>
          <div className="text-sm font-black tabular-nums">
            {formatCurrency(m.value)}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Monthly paired bars (money in green / money out red) with a running
// balance line over the top — axis approach borrowed from statTrend.tsx.
export const CashflowChart = ({ months }: { months: CashflowMonth[] }) => {
  if (months.length === 0) return null;
  const W = 460;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxBar = Math.max(...months.map((m) => Math.max(m.in, m.out)), 1);
  const balVals = months.map((m) => m.balanceEnd);
  const balMin = Math.min(...balVals, 0);
  const balMax = Math.max(...balVals, 1);
  const balSpan = balMax - balMin || 1;
  const slot = plotW / months.length;
  const barW = Math.min(14, slot / 3);
  const x0 = (i: number) => padL + i * slot + slot / 2;
  const barH = (v: number) => (v / maxBar) * plotH;
  const balY = (v: number) => padT + plotH - ((v - balMin) / balSpan) * plotH;
  const balPts = months
    .map((m, i) => `${x0(i)},${balY(m.balanceEnd)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Monthly cash flow"
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={padT + plotH * f}
          y2={padT + plotH * f}
          stroke="var(--line)"
          strokeWidth="1"
        />
      ))}
      {months.map((m, i) => (
        <g key={m.month}>
          <rect
            x={x0(i) - barW - 1}
            y={padT + plotH - barH(m.in)}
            width={barW}
            height={barH(m.in)}
            rx={2}
            fill="var(--win)"
          />
          <rect
            x={x0(i) + 1}
            y={padT + plotH - barH(m.out)}
            width={barW}
            height={barH(m.out)}
            rx={2}
            fill="var(--loss)"
          />
          <text
            x={x0(i)}
            y={H - 7}
            textAnchor="middle"
            fontSize="9"
            fontWeight="800"
            fill="var(--ink-3)"
          >
            {m.label}
          </text>
        </g>
      ))}
      <polyline
        points={balPts}
        fill="none"
        stroke="var(--team-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {months.map((m, i) => (
        <circle
          key={m.month}
          cx={x0(i)}
          cy={balY(m.balanceEnd)}
          r="2.5"
          fill="var(--team-primary)"
        />
      ))}
    </svg>
  );
};

// Donut of spending by budget category via stroke-dasharray arcs.
const DONUT_COLORS = [
  "var(--team-primary)",
  "var(--win)",
  "var(--warn-fg)",
  "var(--team-secondary)",
  "var(--loss)",
  "var(--ink-3)",
];

export const SpendingDonut = ({
  slices,
}: {
  slices: Array<{ label: string; value: number }>;
}) => {
  const used = slices.filter((s) => s.value > 0);
  const total = used.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg
        viewBox="0 0 100 100"
        className="w-28 h-28 shrink-0"
        role="img"
        aria-label="Spending by category"
      >
        {used.map((s, i) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C}`;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += frac * C;
          return el;
        })}
      </svg>
      <ul className="space-y-1 min-w-0">
        {used.map((s, i) => (
          <li
            key={s.label}
            className="flex items-center gap-2 text-xs font-bold text-ink-2"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="truncate">{s.label}</span>
            <span className="tabular-nums font-black text-ink ml-auto pl-3">
              {formatCurrency(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Year-over-year grouped bars (money in vs out per season year) with the
// closing balance printed under each pair. Same visual language as
// CashflowChart, one group per archived year + "This year".
export const YearComparisonChart = ({ rows }: { rows: YearComparisonRow[] }) => {
  if (rows.length === 0) return null;
  const W = 460;
  const H = 170;
  const padT = 10;
  const padB = 38;
  const plotH = H - padT - padB;
  const maxVal = Math.max(...rows.map((r) => Math.max(r.in, r.out)), 1);
  const slot = W / rows.length;
  const barW = Math.min(26, slot / 3.2);
  const x0 = (i: number) => i * slot + slot / 2;
  const barH = (v: number) => (v / maxVal) * plotH;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Year over year money in and out"
    >
      {[0.5].map((f) => (
        <line
          key={f}
          x1={0}
          x2={W}
          y1={padT + plotH * f}
          y2={padT + plotH * f}
          stroke="var(--line)"
          strokeWidth="1"
        />
      ))}
      {rows.map((r, i) => (
        <g key={r.label}>
          <rect
            x={x0(i) - barW - 2}
            y={padT + plotH - barH(r.in)}
            width={barW}
            height={barH(r.in)}
            rx={2}
            fill="var(--win)"
          />
          <rect
            x={x0(i) + 2}
            y={padT + plotH - barH(r.out)}
            width={barW}
            height={barH(r.out)}
            rx={2}
            fill="var(--loss)"
          />
          <text
            x={x0(i)}
            y={H - 24}
            textAnchor="middle"
            fontSize="9"
            fontWeight="800"
            fill="var(--ink-3)"
          >
            {r.label.length > 18 ? `${r.label.slice(0, 18)}…` : r.label}
          </text>
          <text
            x={x0(i)}
            y={H - 11}
            textAnchor="middle"
            fontSize="10"
            fontWeight="900"
            fill={r.closing < 0 ? "var(--loss)" : "var(--ink)"}
          >
            {formatCurrency(r.closing)}
          </text>
        </g>
      ))}
    </svg>
  );
};
