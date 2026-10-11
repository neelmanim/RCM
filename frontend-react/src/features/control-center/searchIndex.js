// Static index of named settings/cards per section, used by ControlCenterHub's
// search box to jump straight to a section instead of clicking through all 5
// tabs to find where something lives. Deliberately section-level, not
// sub-tab-level — sections manage their own internal tab state, which isn't
// threaded up to this level yet.
export const CONTROL_CENTER_SEARCH_INDEX = [
    { section: 'integrations', label: 'Salesforce Connection', keywords: 'salesforce sf crm connect' },
    { section: 'integrations', label: 'Data Summary', keywords: 'leads stage counts' },
    { section: 'integrations', label: 'Nylas Email Integration', keywords: 'email nylas' },
    { section: 'integrations', label: 'Public API Key', keywords: 'api key cmt bridge' },
    { section: 'integrations', label: 'Aircall Configuration', keywords: 'aircall dialer calling webhook' },
    { section: 'integrations', label: 'Alternate Messenger Conversations', keywords: 'messenger sms whatsapp messaging' },
    { section: 'integrations', label: 'What syncs with Salesforce', keywords: 'sync direction push pull two-way stage declined unreachable opportunities write back' },
    { section: 'integrations', label: 'Schedule and volume', keywords: 'auto sync daily schedule lead limit record types salesforce' },
    { section: 'integrations', label: 'Salesforce field mapping', keywords: 'salesforce field api name custom field map' },
    { section: 'integrations', label: 'Pod and call rules', keywords: 'pods multiple pod call attempts unreachable cooldown conversation seconds' },
    { section: 'integrations', label: 'Call Outcomes Configuration', keywords: 'call outcomes disposition' },
    { section: 'team-access', label: 'Users & PODs', keywords: 'users roles pods add user delete revoke' },
    { section: 'team-access', label: 'User Access', keywords: 'calling messaging capability messenger agent' },
    { section: 'automation', label: 'AI Research Configuration', keywords: 'llm groq gemini openai research' },
    { section: 'automation', label: 'Research Prompt Editor', keywords: 'prompt research template' },
    { section: 'automation', label: 'Send Windows', keywords: 'sales cadence send window schedule' },
    { section: 'data', label: 'Sandbox Data Refresh', keywords: 'sandbox staging refresh token' },
    { section: 'data', label: 'Upload Center', keywords: 'upload csv google sheet import leads' },
    { section: 'data', label: 'Export Leads', keywords: 'export download csv sdr leads' },
    { section: 'monitoring', label: 'Audit Log', keywords: 'audit activity log' },
    { section: 'monitoring', label: 'Login History', keywords: 'login logout session' },
    { section: 'monitoring', label: 'Feedback', keywords: 'feedback bug feature request' },
    { section: 'monitoring', label: 'Salesforce Sync Log', keywords: 'salesforce sync log integration' },
    { section: 'monitoring', label: 'Error Logs', keywords: 'error logs critical warning' },
    { section: 'monitoring', label: 'Perf Health', keywords: 'performance health latency p95' },
];
