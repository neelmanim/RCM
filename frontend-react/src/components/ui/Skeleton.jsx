import React from 'react';

/* ── Base Skeleton Primitive ────────────────────────────────────────────── */
export const Skeleton = ({ className = '', style, ...props }) => (
  <div
    className={`animate-pulse bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 bg-[length:200%_100%] rounded-lg ${className}`}
    style={{ animationDuration: '1.8s', ...style }}
    {...props}
  />
);

/* ── Text Line ──────────────────────────────────────────────────────────── */
export const SkeletonText = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2.5 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className="h-3.5"
        style={{ width: i === lines - 1 ? '60%' : `${85 + Math.random() * 15}%` }}
      />
    ))}
  </div>
);

/* ── Circular Avatar ────────────────────────────────────────────────────── */
export const SkeletonAvatar = ({ size = 40, className = '' }) => (
  <Skeleton
    className={`rounded-full shrink-0 ${className}`}
    style={{ width: size, height: size }}
  />
);

/* ── Stat Card Skeleton ─────────────────────────────────────────────────── */
export const SkeletonStatCard = ({ className = '' }) => (
  <div className={`bg-white border border-slate-100 rounded-2xl p-5 shadow-sm ${className}`}>
    <div className="flex items-center gap-5">
      <Skeleton className="w-14 h-14 rounded-2xl shrink-0" />
      <div className="flex-1 space-y-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-28 rounded-xl" />
      </div>
    </div>
  </div>
);

/* ── Table Row Skeleton ─────────────────────────────────────────────────── */
export const SkeletonTableRow = ({ cols = 5, className = '' }) => (
  <div className={`flex items-center gap-4 px-6 py-4 border-b border-slate-50 ${className}`}>
    {Array.from({ length: cols }).map((_, i) => (
      <div key={i} className="flex-1">
        <Skeleton className={`h-4 ${i === 0 ? 'w-3/4' : 'w-1/2'}`} />
        {i === 0 && <Skeleton className="h-3 w-1/2 mt-2" />}
      </div>
    ))}
  </div>
);

/* ── Table Skeleton ─────────────────────────────────────────────────────── */
export const SkeletonTable = ({ rows = 6, cols = 5, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm ${className}`}>
    {/* Header */}
    <div className="flex items-center gap-4 px-6 py-3.5 bg-slate-50/60 border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="flex-1">
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonTableRow key={i} cols={cols} />
    ))}
  </div>
);

/* ── Card Skeleton ──────────────────────────────────────────────────────── */
export const SkeletonCard = ({ className = '', children }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${className}`}>
    {/* Header */}
    <div className="px-5 py-4 border-b border-slate-50">
      <Skeleton className="h-4 w-32 mb-2" />
      <Skeleton className="h-3 w-48" />
    </div>
    {/* Body */}
    <div className="p-5">
      {children || <SkeletonText lines={4} />}
    </div>
  </div>
);

/* ── Metric Card Skeleton (Analytics) ───────────────────────────────────── */
export const SkeletonMetricCard = ({ className = '' }) => (
  <div className={`bg-white border border-slate-100 rounded-2xl p-5 shadow-sm ${className}`}>
    <div className="flex items-center justify-between mb-3">
      <Skeleton className="w-9 h-9 rounded-xl" />
    </div>
    <Skeleton className="h-7 w-16 mb-2" />
    <Skeleton className="h-3 w-20" />
  </div>
);

/* ── Funnel Strip Skeleton ──────────────────────────────────────────────── */
export const SkeletonFunnel = ({ bars = 8, className = '' }) => (
  <div className={`flex items-end gap-1 h-20 ${className}`}>
    {Array.from({ length: bars }).map((_, i) => (
      <div key={i} className="flex flex-col items-center gap-1 flex-1">
        <Skeleton className="h-2.5 w-6" />
        <Skeleton
          className="w-full rounded-t-lg"
          style={{ height: `${15 + Math.random() * 45}px` }}
        />
        <Skeleton className="h-2 w-full" />
      </div>
    ))}
  </div>
);

/* ── Pipeline Bar Skeleton ──────────────────────────────────────────────── */
export const SkeletonPipelineBar = ({ className = '' }) => (
  <div className={`space-y-2 ${className}`}>
    <div className="flex justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-10" />
    </div>
    <Skeleton className="h-2.5 w-full rounded-full" />
  </div>
);

/* ── Call Row Skeleton ──────────────────────────────────────────────────── */
export const SkeletonCallRow = ({ className = '' }) => (
  <div className={`flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 ${className}`}>
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-3.5 w-32" />
      <Skeleton className="h-2.5 w-20" />
    </div>
    <Skeleton className="h-3 w-16" />
    <Skeleton className="h-6 w-20 rounded-full" />
    <Skeleton className="h-3 w-12" />
    <Skeleton className="h-4 w-28 rounded-md" />
  </div>
);

/* ══════════════════════════════════════════════════════════════════════════ */
/* ── Composite Page Skeletons ─────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════════════ */

/* ── Dashboard Skeleton ─────────────────────────────────────────────────── */
export const DashboardSkeleton = () => (
  <div className="space-y-8 animate-[fadeIn_0.2s_ease_forwards]">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-32 rounded-xl" />
    </div>
    {/* Stat Cards */}
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
    {/* Pipeline + Chart */}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <SkeletonCard>
        <div className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonPipelineBar key={i} />
          ))}
        </div>
      </SkeletonCard>
      <SkeletonCard className="lg:col-span-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
      </SkeletonCard>
    </div>
  </div>
);

/* ── Calls Page Skeleton ────────────────────────────────────────────────── */
export const CallsSkeleton = () => (
  <div className="space-y-4 animate-[fadeIn_0.2s_ease_forwards]">
    {/* Summary cards */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonMetricCard key={i} />
      ))}
    </div>
    {/* Call rows */}
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
      <div className="flex items-center gap-4 px-5 py-3 bg-slate-50/60 border-b border-slate-100">
        {['Lead', 'Date & Time', 'Duration', 'Outcome', 'SDR', 'Recording'].map(h => (
          <div key={h} className="flex-1"><Skeleton className="h-3 w-14" /></div>
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCallRow key={i} />
      ))}
    </div>
  </div>
);
