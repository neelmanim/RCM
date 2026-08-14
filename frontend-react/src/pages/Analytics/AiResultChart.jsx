/**
 * AiResultChart.jsx — Premium Chart.js visualization for Smart Analytics results.
 *
 * Renders horizontal bar charts for SDR/category comparisons (best readability
 * when category labels are names). Vertical line chart for time-series.
 * Includes value labels at end of bars, gradient fills, and clean typography.
 */
import React, { useRef, useEffect } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
);

/* Palette */
const INDIGO  = 'rgba(99,102,241,1)';
const INDIGO_LIGHT = 'rgba(99,102,241,0.12)';
const VIOLET  = 'rgba(139,92,246,1)';
const TEAL    = 'rgba(20,184,166,1)';

/* ── Value-label plugin (shows numbers at end of bars) ───── */
const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((bar, j) => {
        const value = dataset.data[j];
        if (value == null) return;
        ctx.save();
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        // Horizontal bar: value after bar end
        const x = bar.x + 6;
        const y = bar.y;
        ctx.fillText(typeof value === 'number' ? value.toLocaleString() : value, x, y);
        ctx.restore();
      });
    });
  },
};

export const AiResultChart = ({ data }) => {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data?.labels?.length) return;
    chartRef.current?.destroy();

    const isTimeSeries = data.type === 'line';
    const colors = [INDIGO, VIOLET, TEAL];
    const primaryColor = colors[0];

    if (isTimeSeries) {
      // ── Line chart for time-series ──────────────────────────
      chartRef.current = new Chart(canvasRef.current, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [{
            label: data.label || 'Value',
            data: data.values,
            borderColor: primaryColor,
            backgroundColor: INDIGO_LIGHT,
            borderWidth: 2.5,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#fff',
            pointBorderColor: primaryColor,
            pointBorderWidth: 2,
            pointHoverRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#94a3b8',
              bodyColor: '#f8fafc',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => ` ${ctx.parsed.y.toLocaleString()}`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: 'Inter, sans-serif', size: 11 }, color: '#94a3b8' },
            },
            y: {
              border: { display: false },
              grid: { color: 'rgba(148,163,184,0.1)' },
              ticks: { font: { family: 'Inter, sans-serif', size: 11 }, color: '#94a3b8' },
            },
          },
        },
      });
    } else {
      // ── Horizontal bar chart (default — best for SDR names) ──
      // Sort descending so highest value is at top
      const paired = data.labels.map((l, i) => ({ label: l, value: data.values[i] ?? 0 }));
      paired.sort((a, b) => b.value - a.value);
      const sortedLabels = paired.map(p => p.label);
      const sortedValues = paired.map(p => p.value);
      const maxVal = Math.max(...sortedValues, 1);

      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        plugins: [valueLabelsPlugin],
        data: {
          labels: sortedLabels,
          datasets: [{
            label: data.label || 'Value',
            data: sortedValues,
            backgroundColor: sortedValues.map((_, i) =>
              i === 0 ? INDIGO : `rgba(99,102,241,${Math.max(0.25, 0.85 - i * 0.12)})`
            ),
            borderColor: 'transparent',
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          indexAxis: 'y',   // horizontal bars
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 50 } }, // space for value labels
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#94a3b8',
              bodyColor: '#f8fafc',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => ` ${ctx.parsed.x.toLocaleString()} ${data.label || ''}`,
              },
            },
          },
          scales: {
            x: {
              display: false,
              max: maxVal * 1.2,
              grid: { display: false },
            },
            y: {
              border: { display: false },
              grid: { display: false },
              ticks: {
                font: { family: 'Inter, sans-serif', size: 12, weight: '500' },
                color: '#334155',
                padding: 8,
              },
            },
          },
        },
      });
    }

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [data]);

  // Calculate chart height based on bar count (min 160px, 44px per bar)
  const barCount = data?.labels?.length ?? 0;
  const height = data?.type === 'line' ? 200 : Math.max(160, barCount * 44);

  return (
    <div style={{ height: `${height}px`, position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
};
