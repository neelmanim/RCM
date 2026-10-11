const LEADS = [
  { initial: 'S', name: 'Sarah Chen', company: 'Acme Inc.', color: 'bg-violet-500' },
  { initial: 'M', name: 'Michael Torres', company: 'Globex', color: 'bg-teal-500' },
  { initial: 'P', name: 'Priya Shah', company: 'Helix Systems', color: 'bg-amber-500' },
];

/**
 * A stylized, illustrative dashboard mock — NOT a real screenshot. Deliberate:
 * a live screenshot goes stale every time the actual product UI changes and
 * becomes a recurring maintenance tax on a page that has no reason to track
 * the real dashboard pixel-for-pixel. Fake data throughout, on purpose.
 */
export function ProductPreviewMock() {
  return (
    <div className="relative w-full max-w-md rotate-[-2deg] rounded-2xl bg-white p-5 shadow-[0_30px_60px_-15px_rgba(30,16,53,0.55)] ring-1 ring-black/5">
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-auto text-[11px] font-semibold text-slate-400">Alternate CRM</span>
      </div>

      <p className="text-sm font-bold text-slate-900">Good morning!</p>
      <p className="mb-4 text-xs text-slate-400">Here's what's happening with your leads.</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] font-medium text-slate-400">Total Leads</p>
          <p className="text-lg font-extrabold text-slate-900">
            2,548 <span className="text-xs font-bold text-emerald-500">↑12%</span>
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] font-medium text-slate-400">Qualified Prospects</p>
          <p className="text-lg font-extrabold text-slate-900">
            842 <span className="text-xs font-bold text-emerald-500">↑28%</span>
          </p>
        </div>
      </div>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Top Priority Leads</p>
      <div className="flex flex-col gap-2">
        {LEADS.map((lead) => (
          <div key={lead.name} className="flex items-center gap-2.5">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${lead.color}`}>
              {lead.initial}
            </span>
            <span className="text-xs font-semibold text-slate-700">{lead.name}</span>
            <span className="ml-auto text-xs text-slate-400">{lead.company}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
