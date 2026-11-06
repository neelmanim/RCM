import { TodayStatsPanel } from './features/power-dialer-hub/components/TodayStatsPanel';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './power-dialer-tailwind.css';
import { registerHub } from './hub-entry';

const crashFallback = (
  <div className="p-8 text-center text-sm text-slate-500">
    <p className="mb-2">Something went wrong loading call history.</p>
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="text-blue-600 underline underline-offset-2 font-semibold"
    >
      Reload
    </button>
  </div>
);

registerHub('PowerDialerHub', () => (
  <ErrorBoundary fallback={crashFallback}>
    <section className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="m-0 text-xl font-bold text-slate-800">Call history</h1>
        <p className="mt-1 text-sm text-slate-500">Review previous calls and outcomes. Outbound calling is unavailable.</p>
      </header>
      <TodayStatsPanel />
    </section>
  </ErrorBoundary>
));
