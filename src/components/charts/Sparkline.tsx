import React from "react";
import { AreaChart, Area, YAxis } from "recharts";
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
  animate?: boolean;
  label?: string;
  className?: string;
}) => {
  const id = useChartId();
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
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
        {domain && <YAxis hide domain={domain} allowDataOverflow />}
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
