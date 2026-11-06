export function SmsCampaignsSection() {
  return (
    <section aria-labelledby="sms-campaigns-title" className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 id="sms-campaigns-title" className="text-base font-semibold text-slate-900">SMS campaigns</h2>
      <p className="mt-2 text-sm text-slate-600">
        Campaign sending is unavailable until a messaging provider is connected.
      </p>
    </section>
  );
}
