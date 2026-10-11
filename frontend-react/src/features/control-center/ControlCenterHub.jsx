import React, { useMemo, useState } from 'react';
import { Plug, Users, Bot, Database, ScrollText, ShieldAlert } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Tabs } from '../../components/ui/Tabs';
import { SearchInput } from '../../components/ui/SearchInput';
import { SECTION_TABS, sectionsForRole } from './constants';
import { CONTROL_CENTER_SEARCH_INDEX } from './searchIndex';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { TeamAccessSection } from './sections/TeamAccessSection';
import { AutomationSection } from './sections/AutomationSection';
import { DataSection } from './sections/DataSection';
import { MonitoringSection } from './sections/MonitoringSection';
import { ControlCenterTour } from './ControlCenterTour';

const SECTION_ICONS = {
    integrations: Plug,
    'team-access': Users,
    automation: Bot,
    data: Database,
    monitoring: ScrollText,
};

const SECTION_COMPONENTS = {
    integrations: IntegrationsSection,
    'team-access': TeamAccessSection,
    automation: AutomationSection,
    data: DataSection,
    monitoring: MonitoringSection,
};

/**
 * Props from the Vanilla JS shell (mirrors activity-monitor-entry.jsx's contract):
 *   token, userRole, apiBase
 *
 * Additive surface, Super-Admin-only for now — see
 * .claude/plans/i-was-working-on-idempotent-ritchie.md and
 * .claude/skills/settings-architecture/skill.md. Gated here a second time,
 * on top of the nav-item gate (NavSidebar.jsx) and the route gate (app.js),
 * matching this repo's existing per-component gate idiom (ActivityMonitorHub's
 * ACTIVITY_MONITOR_ALLOWED_ROLES, AnalyticsHub's VNEXT_ALLOWED_ROLES) — this
 * is a UI restriction, not a new backend security boundary.
 */
export function ControlCenterHub({ userRole, token, apiBase }) {
    // Only the sections this role may open (v12.2 — Pod Admins now get Team &
    // Access). Landing tab is the first one they can actually see, so a Pod
    // Admin doesn't open onto an Integrations tab that isn't theirs.
    const visibleSections = useMemo(() => sectionsForRole(userRole), [userRole]);
    const [active, setActive] = useState(() => sectionsForRole(userRole)[0]?.key || null);
    const [query, setQuery] = useState('');
    // No sections visible = no Control Center for this role.
    const allowed = visibleSections.length > 0;

    // The old fixed line pointed at Settings/Admin/Upload Center/System
    // Logs — none of which are in anybody's nav any more, and a Pod Admin
    // sees one tab. Keyed on the visible section, not just the count, so a
    // role that later gets one *different* section keeps generic copy.
    const subtitle = (visibleSections.length === 1 && visibleSections[0].key === 'team-access')
        ? 'Manage your POD — the people in it, their roles, and what they can access.'
        : 'One home for org configuration — integrations, team access, AI, data and monitoring.';

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const visibleKeys = new Set(visibleSections.map((t) => t.key));
        return CONTROL_CENTER_SEARCH_INDEX.filter((e) =>
            visibleKeys.has(e.section) &&
            (e.label.toLowerCase().includes(q) || e.keywords.includes(q))
        ).slice(0, 8);
    }, [query, visibleSections]);

    if (!allowed || !active) {
        return (
            <div className="controlcenter p-8">
                <EmptyState
                    icon={ShieldAlert}
                    title="Not available"
                    message="Control Center isn't enabled for this account."
                />
            </div>
        );
    }

    const tabs = visibleSections.map((t) => ({ ...t, icon: SECTION_ICONS[t.key] }));
    const ActiveSection = SECTION_COMPONENTS[active];

    return (
        <div className="controlcenter min-h-full bg-slate-50">
            <div className="px-6 pt-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 m-0">Control Center</h1>
                        <p className="text-sm text-slate-500 mt-1 mb-4">{subtitle}</p>
                    </div>
                    <div className="relative w-full max-w-xs" data-tour="cc-search">
                        <SearchInput
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search settings…"
                        />
                        {matches.length > 0 && (
                            <div className="absolute right-0 z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                                {matches.map((m) => (
                                    <button
                                        key={`${m.section}-${m.label}`}
                                        type="button"
                                        onClick={() => { setActive(m.section); setQuery(''); }}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2"
                                    >
                                        <span className="text-slate-800">{m.label}</span>
                                        <span className="text-xs text-slate-400">{SECTION_TABS.find((t) => t.key === m.section)?.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <Tabs tabs={tabs} active={active} onChange={setActive} />
            </div>
            <div className="p-6">
                <ActiveSection token={token} apiBase={apiBase} userRole={userRole} />
            </div>
            <ControlCenterTour />
        </div>
    );
}
