import React from "react";
import { AreaChart, Area, YAxis, ReferenceLine } from "recharts";
import { FadeGradient, useChartId } from "./primitives";

// Tiny inline trend chart (table rows, hero cards). Fixed-size on purpose:
// ResponsiveContainer would spawn a ResizeObserver per table row and render
// 0x0 under jsdom; a sized chart costs nothing and shows real SVG in tests.
export const Sparkline = ({
  values,
  width = 60,
  height = 16,
  stroke = "var(--team-primary)",
  strokeWidth = 2,
  fill,
  domain,
  baseline,
  animate = false,
  label,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Color for a fade-out gradient under the line; omit for line only. */
  fill?: string;
  /** Fixed Y domain (e.g. [1, 5] for eval scores); defaults to data extent. */
  domain?: [number, number];
  /** Faint dashed reference line (e.g. team average) so a dipping line reads
   *  against context. The Y domain auto-widens to keep it on-canvas. */
  baseline?: number;
  animate?: boolean;
  label?: string;
  className?: string;
}) => {
  const id = useChartId();
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  // When a baseline sits outside the data range it would clip off-canvas, so
  // derive a domain spanning the data and the baseline together.
  const effectiveDomain: [number, number] | undefined =
    domain ??
    (baseline != null
      ? [Math.min(...values, baseline), Math.max(...values, baseline)]
      : undefined);
  return (
    <span
      className={`inline-block leading-none ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <AreaChart
        width={width}
        height={height}
        data={data}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        {fill && (
          <defs>
            <FadeGradient id={id} color={fill} from={0.45} to={0.02} />
          </defs>
        )}
        {effectiveDomain && (
          <YAxis hide domain={effectiveDomain} allowDataOverflow />
        )}
        {baseline != null && (
          <ReferenceLine
            y={baseline}
            stroke="var(--ink-3)"
            strokeDasharray="2 3"
            strokeOpacity={0.5}
          />
        )}
        <Area
          dataKey="v"
          type="monotone"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill={fill ? `url(#${id})` : "none"}
          dot={false}
          isAnimationActive={animate}
          animationDuration={700}
        />
      </AreaChart>
    </span>
  );
};
