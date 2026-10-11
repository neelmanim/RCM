import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../../components/ui/Card';

const FIELDS = [
  { label: 'Industry', key: 'industry' },
  { label: 'Employees', key: 'employee_count' },
  { label: 'Revenue', key: 'annual_revenue' },
  { label: 'Funding', key: 'total_funding' },
  { label: 'Website', key: 'website', link: true },
  { label: 'LinkedIn', key: 'linkedin_url', altKey: 'person_linkedin', link: true },
  { label: 'Company LinkedIn', key: 'company_linkedin', link: true },
  { label: 'Founded', key: 'company_founded' },
];

function locationOf(lead) {
  return [lead.city, lead.state, lead.country].filter(Boolean).join(', ');
}
function companyAddressOf(lead) {
  return [lead.company_street, lead.company_city, lead.company_state, lead.company_postal_code, lead.company_country].filter(Boolean).join(', ');
}

export function EnrichmentCard({ lead }) {
  const [open, setOpen] = useState(false);
  if (!lead) return null;

  const rows = [
    ...FIELDS.map((f) => ({ label: f.label, value: lead[f.key] || (f.altKey && lead[f.altKey]), link: f.link })),
    { label: 'Location', value: locationOf(lead) },
    { label: 'Company Address', value: companyAddressOf(lead) },
  ].filter((r) => r.value);

  if (!rows.length) return null;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700"
      >
        <span>🔍 Enrichment Data</span>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {open && (
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {rows.map((r) => (
              <div key={r.label}>
                <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{r.label}</dt>
                <dd className="text-slate-700 m-0 break-words">
                  {r.link ? (
                    <a href={r.value.startsWith('http') ? r.value : `https://${r.value}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {r.value}
                    </a>
                  ) : r.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  );
}
