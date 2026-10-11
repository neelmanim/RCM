import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Segment-ring donut chart: hover glow/scale per segment, animated draw-in
 * on mount. Adapted from a provided shadcn-style component — swapped
 * framer-motion (not a dependency in this app) for plain CSS transitions on
 * stroke-dashoffset/opacity, same visual effect, zero new dependency.
 *
 * `data`: [{ value, color, label }]. `centerContent` renders inside the ring
 * (e.g. a total count) — caller supplies it rather than this component
 * guessing a sensible default.
 */
export function DonutChart({
  data,
  totalValue: propTotalValue,
  size = 200,
  strokeWidth = 20,
  animationDuration = 1,
  animationDelayPerSegment = 0.05,
  highlightOnHover = true,
  centerContent,
  onSegmentHover,
  className,
  ...props
}) {
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = useMemo(
    () => propTotalValue || data.reduce((sum, s) => sum + s.value, 0),
    [data, propTotalValue]
  );
  const radius = size / 2 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    onSegmentHover?.(data.find((s) => s.label === hoveredLabel) || null);
  }, [hoveredLabel, data, onSegmentHover]);

  // Precomputed, no mutation (segment count is tiny — a handful — so the
  // O(n²) prefix-sum reads as clearly correct rather than a premature
  // micro-optimization for it): each segment's start offset is the sum of
  // every percentage before it.
  const segments = useMemo(() => {
    const pct = (s) => (total === 0 ? 0 : (s.value / total) * 100);
    return data.map((segment, i) => ({
      ...segment,
      percentage: pct(segment),
      offset: data.slice(0, i).reduce((sum, s) => sum + pct(s), 0),
    }));
  }, [data, total]);

  return (
    <div
      className={cn('relative flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      onMouseLeave={() => setHoveredLabel(null)}
      {...props}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        {segments.map((segment, index) => {
          if (!segment.value) return null;
          const dash = (segment.percentage / 100) * circumference;
          const offset = (segment.offset / 100) * circumference;
          const isActive = hoveredLabel === segment.label;
          const delay = index * animationDelayPerSegment;
          return (
            <circle
              key={segment.label ?? index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={mounted ? -offset : circumference}
              opacity={mounted ? 1 : 0}
              style={{
                transformOrigin: 'center',
                transform: isActive ? 'scale(1.03)' : 'scale(1)',
                filter: isActive ? `drop-shadow(0px 0px 6px ${segment.color}) brightness(1.1)` : 'none',
                cursor: highlightOnHover ? 'pointer' : 'default',
                transition: `stroke-dashoffset ${animationDuration}s ease-out ${delay}s, opacity 0.3s ease-out ${delay}s, filter 0.2s ease-out, transform 0.2s ease-out`,
              }}
              onMouseEnter={() => setHoveredLabel(segment.label)}
            />
          );
        })}
      </svg>
      {centerContent && (
        <div
          className="absolute flex flex-col items-center justify-center pointer-events-none"
          style={{ width: size - strokeWidth * 2.5, height: size - strokeWidth * 2.5 }}
        >
          {centerContent}
        </div>
      )}
    </div>
  );
}
