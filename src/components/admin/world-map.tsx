"use client";

import { useMemo } from "react";
import { GRID_W, GRID_H, landMask, project } from "@/lib/analytics/world-mask";

export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  kind: "visitor" | "order";
}

/** SVG units per grid cell. Fixed, so dot radius and pin size stay in step. */
const CELL = 4;

interface WorldMapProps {
  pins?: MapPin[];
  /** Muted background treatment for the Home hero, where the map is decoration. */
  variant?: "hero" | "live";
  className?: string;
}

/**
 * Dot-matrix world map. The land mask is a generated bitmap (see
 * scripts/build-world-mask.mjs), so this renders real geography without
 * pulling a mapping library into the admin bundle.
 */
export function WorldMap({ pins = [], variant = "live", className }: WorldMapProps) {
  const dots = useMemo(() => {
    const mask = landMask();
    const out: string[] = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (mask[y * GRID_W + x]) {
          out.push(`${x * CELL + CELL / 2},${y * CELL + CELL / 2}`);
        }
      }
    }
    return out;
  }, []);

  const placed = useMemo(
    () =>
      pins
        .map((pin) => {
          const point = project(pin.latitude, pin.longitude);
          return point ? { ...pin, ...point } : null;
        })
        .filter((p): p is MapPin & { x: number; y: number } => p !== null),
    [pins]
  );

  const isHero = variant === "hero";

  return (
    <svg
      viewBox={`0 0 ${GRID_W * CELL} ${GRID_H * CELL}`}
      className={className}
      role="img"
      aria-label={
        pins.length
          ? `World map showing ${pins.length} active visitor locations`
          : "World map"
      }
      preserveAspectRatio="xMidYMid meet"
    >
      {/* One path of zero-length round-capped segments draws every land dot as a
          single node — 4,800 <circle> elements would cost far more to lay out. */}
      <path
        d={dots.map((d) => `M${d}h0`).join("")}
        stroke="currentColor"
        strokeWidth={isHero ? CELL * 0.5 : CELL * 0.62}
        strokeLinecap="round"
        fill="none"
        className={
          isHero ? "text-foreground/[0.09]" : "text-emerald-500/35"
        }
      />

      {placed.map((pin) => (
        <g key={pin.id} transform={`translate(${pin.x * CELL} ${pin.y * CELL})`}>
          <title>{pin.label}</title>
          {/* Halo pulses so a fresh visitor is noticeable without animating the
              4,800 land dots. */}
          <circle
            r={CELL * 2.4}
            className={
              pin.kind === "order"
                ? "fill-violet-500/25 animate-ping"
                : "fill-sky-500/25 animate-ping"
            }
            style={{ animationDuration: "2.6s" }}
          />
          <circle
            r={CELL * 1.05}
            className={pin.kind === "order" ? "fill-violet-500" : "fill-sky-500"}
            stroke="white"
            strokeWidth={CELL * 0.28}
          />
        </g>
      ))}
    </svg>
  );
}
