import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// Horizontal bar, one row per cadence — a ranking needs a ranking visual, not
// a table a human has to re-sort in their head. `ranked` is already sorted
// descending by reply_rate (see JourneyList.jsx).
export function ReplyRateChart({ ranked }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: ranked.map((r) => r.name),
        datasets: [{
          data: ranked.map((r) => Math.round(r.engagement.reply_rate * 100)),
          backgroundColor: '#4f46e5',
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.x}% reply rate · ${ranked[ctx.dataIndex].engagement.sent} sent`,
            },
          },
        },
        scales: {
          x: { max: 100, ticks: { callback: (v) => `${v}%` }, grid: { display: false } },
          y: { grid: { display: false }, ticks: { font: { size: 12 }, color: '#334155' } },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [ranked]);

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-bold text-slate-500 mb-2">Email engagement, ranked by reply rate</div>
      <div style={{ height: Math.max(120, ranked.length * 36), position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
