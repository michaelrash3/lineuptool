import React from "react";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatCurrency } from "../utils/helpers";
import type { CashflowMonth, YearComparisonRow } from "../utils/helpers";
import {
  ChartFrame,
  ChartTooltip,
  FadeGradient,
  useChartId,
} from "./charts/primitives";
import { Sparkline } from "./charts/Sparkline";
import { AnimatedNumber } from "./motion";

// Money visuals for the Finances tab, built on recharts and the same design
// tokens as the rest of the app (team gradient hero like HomeTab's
// scoreboard, win/loss colors, t-* typography).

const currency = (v: number) => formatCurrency(v);

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
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${width}%`,
          backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, white), ${color})`,
        }}
      />
    </div>
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
          <AnimatedNumber value={balanceNow} format={formatCurrency} />
        </div>
      </div>
      <Sparkline
        values={months.map((m) => m.balanceEnd)}
        width={160}
        height={36}
        stroke="white"
        fill="white"
        animate
        label="Balance trend"
        className="opacity-90"
      />
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

// Monthly paired bars (money in green / money out red) with the running
// balance line over the top. Bars and the balance line use separate hidden
// Y scales, matching the old hand-rolled dual-scale behavior.
export const CashflowChart = ({ months }: { months: CashflowMonth[] }) => {
  const id = useChartId();
  if (months.length === 0) return null;
  return (
    <ChartFrame label="Monthly cash flow" height={220}>
      <ComposedChart
        data={months}
        margin={{ top: 10, right: 8, bottom: 0, left: 8 }}
        barGap={2}
      >
        <defs>
          <FadeGradient id={`${id}-in`} color="var(--win)" from={0.9} to={0.35} />
          <FadeGradient id={`${id}-out`} color="var(--loss)" from={0.9} to={0.35} />
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--line)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fontWeight: 800, fill: "var(--ink-3)" }}
        />
        <YAxis yAxisId="bars" hide domain={[0, "auto"]} />
        <YAxis
          yAxisId="balance"
          hide
          domain={[
            (dataMin: number) => Math.min(dataMin, 0),
            (dataMax: number) => Math.max(dataMax, 1),
          ]}
        />
        <Tooltip
          content={<ChartTooltip formatter={currency} />}
          cursor={{ fill: "var(--team-primary-15)" }}
        />
        <Bar
          yAxisId="bars"
          dataKey="in"
          name="Money in"
          fill={`url(#${id}-in)`}
          radius={[3, 3, 0, 0]}
          maxBarSize={14}
        />
        <Bar
          yAxisId="bars"
          dataKey="out"
          name="Money out"
          fill={`url(#${id}-out)`}
          radius={[3, 3, 0, 0]}
          maxBarSize={14}
        />
        <Line
          yAxisId="balance"
          dataKey="balanceEnd"
          name="Balance"
          type="monotone"
          stroke="var(--team-primary)"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: "var(--team-primary)", strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          style={{ filter: "drop-shadow(0 1px 4px var(--team-primary-15))" }}
        />
      </ComposedChart>
    </ChartFrame>
  );
};

// Donut of spending by budget category, total in the hole.
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
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div
        className="relative w-28 h-28 shrink-0"
        role="img"
        aria-label="Spending by category"
      >
        <PieChart width={112} height={112}>
          <Pie
            data={used}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={36}
            outerRadius={52}
            paddingAngle={2}
            cornerRadius={2}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            animationDuration={800}
          >
            {used.map((s, i) => (
              <Cell
                key={s.label}
                fill={DONUT_COLORS[i % DONUT_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={currency} />} />
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="t-eyebrow text-ink-3">Spent</span>
          <span className="text-xs font-black tabular-nums text-ink">
            {formatCurrency(total)}
          </span>
        </div>
      </div>
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

// X-axis tick for the year comparison: season label with the closing balance
// printed beneath it (red when the year closed in the hole).
const YearTick = ({
  x,
  y,
  index,
  payload,
  rows,
}: {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value?: string | number };
  rows: YearComparisonRow[];
}) => {
  const row = index != null ? rows[index] : undefined;
  const label = String(payload?.value ?? "");
  const short = label.length > 18 ? `${label.slice(0, 18)}…` : label;
  return (
    <g>
      <text
        x={x}
        y={(y ?? 0) + 12}
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        fill="var(--ink-3)"
      >
        {short}
      </text>
      <text
        x={x}
        y={(y ?? 0) + 25}
        textAnchor="middle"
        fontSize="10"
        fontWeight="900"
        fill={row && row.closing < 0 ? "var(--loss)" : "var(--ink)"}
      >
        {row ? formatCurrency(row.closing) : ""}
      </text>
    </g>
  );
};

// Year-over-year grouped bars (money in vs out per season year) with the
// closing balance printed under each pair.
export const YearComparisonChart = ({ rows }: { rows: YearComparisonRow[] }) => {
  const id = useChartId();
  if (rows.length === 0) return null;
  return (
    <ChartFrame label="Year over year money in and out" height={200}>
      <BarChart
        data={rows}
        margin={{ top: 10, right: 8, bottom: 0, left: 8 }}
        barGap={4}
      >
        <defs>
          <FadeGradient id={`${id}-in`} color="var(--win)" from={0.9} to={0.35} />
          <FadeGradient id={`${id}-out`} color="var(--loss)" from={0.9} to={0.35} />
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--line)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          height={34}
          tick={<YearTick rows={rows} />}
        />
        <YAxis hide domain={[0, "auto"]} />
        <Tooltip
          content={<ChartTooltip formatter={currency} />}
          cursor={{ fill: "var(--team-primary-15)" }}
        />
        <Bar
          dataKey="in"
          name="Money in"
          fill={`url(#${id}-in)`}
          radius={[3, 3, 0, 0]}
          maxBarSize={26}
        />
        <Bar
          dataKey="out"
          name="Money out"
          fill={`url(#${id}-out)`}
          radius={[3, 3, 0, 0]}
          maxBarSize={26}
        />
      </BarChart>
    </ChartFrame>
  );
};
