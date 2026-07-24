import { cn } from "@/lib/utils";

/**
 * Inline trend line for the metric strip and KPI cards.
 *
 * Hand-rolled SVG rather than Recharts: these render a dozen to a page at
 * ~60×20px with no axes, tooltips or interaction, so a charting library would
 * be all cost and no benefit.
 */
export function Sparkline({
  data,
  className,
  width = 64,
  height = 20,
}: {
  data: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    // A single point has no shape — draw the baseline so the slot keeps its
    // height and the strip does not reflow once data arrives.
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("overflow-visible", className)}
        aria-hidden
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="text-muted-foreground/40"
        />
      </svg>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((value, i) => {
    const x = i * step;
    // Inset by 1.5px top and bottom so the stroke is not clipped at extremes.
    const y = height - 1.5 - ((value - min) / range) * (height - 3);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
