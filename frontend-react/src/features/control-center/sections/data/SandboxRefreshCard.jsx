import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, Lock, KeyRound, Trash2, RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { SkeletonText } from '../../../../components/ui/Skeleton';
import { ConfirmDialog } from '../../../../components/ui/Modal';
import { SandboxService } from '../../../../services/api';
import { toast } from '../../notify';


// Ported from frontend/js/views/settings.js's `sandbox` tab panel
// (data-panel="sandbox", ~L949-995) and `_initSandboxTab()` + its
// `_renderProdUI` / `_renderStagingUI` helpers (~L1141-1466).
export function DataSectionSandboxCard() {
    const [env, setEnv] = useState(null); // { is_staging, self_test_enabled }
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        SandboxService.getEnv()
            .then((d) => { if (alive) setEnv(d); })
            .catch(() => { if (alive) setEnv({ is_staging: false, environment: 'unknown' }); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const isStaging = !!env?.is_staging;
    const badgeVariant = isStaging ? 'warning' : 'default';
    const badgeLabel = isStaging ? 'Staging' : env ? 'Production' : 'Detecting…';

    return (
        <Card>
            <CardHeader
                title="Sandbox Data Refresh"
                subtitle={
                    loading
                        ? 'Detecting environment...'
                        : isStaging
                            ? 'Pull anonymized data from production or generate synthetic leads'
                            : 'Generate a sandbox access token for staging environments'
                }
                actions={
                    <Badge variant={badgeVariant} className="gap-1">
                        {isStaging ? <FlaskConical size={12} /> : <Lock size={12} />}
                        {badgeLabel}
                    </Badge>
                }
            />
            <CardContent>
                {loading ? (
                    <SkeletonText lines={3} />
                ) : isStaging ? (
                    <div className="space-y-6">
                        <StagingPanel onToast={toast} />
                        {env.self_test_enabled && (
                            <>
                                <div className="border-t border-dashed border-slate-200" />
                                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">
                                    Self-test mode: generate a token below and use it with this same
                                    server's URL to exercise the full refresh pipeline.
                                </div>
                                <ProdTokenPanel onToast={toast} />
                            </>
                        )}
                    </div>
                ) : (
                    <ProdTokenPanel onToast={toast} />
                )}
            </CardContent>
        </Card>
    );
}

// ── PRODUCTION: token generate/revoke ──────────────────────────────────────
function ProdTokenPanel({ onToast }) {
    const [status, setStatus] = useState(null); // { configured }
    const [token, setToken] = useState(null);
    const [busy, setBusy] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // 'generate' | 'revoke' | null

    const loadStatus = () => SandboxService.getTokenStatus().then(setStatus).catch(() => setStatus(null));
    useEffect(() => { loadStatus(); }, []);

    const doGenerate = async () => {
        setBusy(true);
        try {
            const d = await SandboxService.generateToken();
            if (d.success && d.token) {
                setToken(d.token);
                onToast('Sandbox token generated successfully!');
                await loadStatus();
            } else {
                onToast(d.detail || d.error || 'Token generation failed.', 'error');
            }
        } catch {
            onToast('Network error generating token.', 'error');
        } finally { setBusy(false); setConfirmAction(null); }
    };

    const doRevoke = async () => {
        setBusy(true);
        try {
            await SandboxService.revokeToken();
            setToken(null);
            onToast('Sandbox token revoked.');
            await loadStatus();
        } catch {
            onToast('Failed to revoke token.', 'error');
        } finally { setBusy(false); setConfirmAction(null); }
    };

    return (
        <div>
            {status && (
                <div className={`rounded-lg px-3 py-2.5 mb-4 text-sm font-medium ${
                    status.configured ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-orange-50 text-orange-700 border border-orange-200'
                }`}>
                    {status.configured
                        ? 'Sandbox token is active. Staging can pull anonymized data.'
                        : 'No sandbox token configured. Generate one to allow staging access.'}
                </div>
            )}
            {token && (
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4">
                    <div className="text-xs font-bold text-green-800 mb-2">Token generated — copy it now!</div>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 bg-white border border-green-200 rounded-lg px-3 py-2 text-xs break-all">{token}</code>
                        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(token)}>Copy</Button>
                    </div>
                    <div className="text-xs text-green-700 mt-2">This token will not be shown again. Store it securely.</div>
                </div>
            )}
            <div className="flex items-center gap-3 mb-4">
                <Button size="sm" onClick={() => setConfirmAction('generate')} disabled={busy}>
                    <KeyRound size={14} /> Generate Sandbox Token
                </Button>
                {status?.configured && (
                    <Button size="sm" variant="outline" onClick={() => setConfirmAction('revoke')} disabled={busy}>
                        <Trash2 size={14} /> Revoke Token
                    </Button>
                )}
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="text-xs font-bold text-amber-800 mb-1.5">How Sandbox Refresh works</div>
                <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
                    <li>Generate a token here on production</li>
                    <li>On staging, go to this same section and paste the token + production URL</li>
                    <li>Refresh on staging pulls anonymized data from production via API</li>
                    <li>All customer PII is anonymized before it leaves production</li>
                </ul>
            </div>

            <ConfirmDialog
                open={confirmAction === 'generate'}
                onClose={() => setConfirmAction(null)}
                title="Generate new API key?"
                message="Any existing token will be invalidated immediately. The new token will be shown once — store it securely."
                confirmLabel="Generate"
                onConfirm={doGenerate}
                loading={busy}
            />
            <ConfirmDialog
                open={confirmAction === 'revoke'}
                onClose={() => setConfirmAction(null)}
                title="Revoke sandbox token?"
                message="Staging will lose access immediately. You can generate a new token at any time."
                confirmLabel="Revoke"
                confirmVariant="danger"
                onConfirm={doRevoke}
                loading={busy}
            />
        </div>
    );
}

// ── STAGING: connect + refresh + synthetic + clear ─────────────────────────
function StagingPanel({ onToast }) {
    const [conn, setConn] = useState(null);
    const [prodUrl, setProdUrl] = useState('');
    const [prodToken, setProdToken] = useState('');
    const [connError, setConnError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // 'disconnect' | 'refresh' | 'clear' | 'synthetic'
    const [syntheticCount, setSyntheticCount] = useState(100);
    const [progress, setProgress] = useState(null); // { step, percent, detail }
    const pollRef = useRef(null);

    const loadConn = () => SandboxService.getConnection().then(setConn).catch(() => setConn({ connected: false }));
    useEffect(() => {
        loadConn();
        // Stop polling refresh status if the user navigates off this tab mid-refresh.
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    const doConnect = async () => {
        if (!prodUrl.trim() || !prodToken.trim()) { setConnError('Both fields are required.'); return; }
        setBusy(true); setConnError('');
        try {
            const d = await SandboxService.saveConnection(prodUrl.trim(), prodToken.trim());
            if (d.success) { onToast('Connected to production!'); setProdToken(''); await loadConn(); }
            else setConnError(d.detail || 'Connection failed');
        } catch (e) {
            setConnError(e.response?.data?.detail || 'Network error');
        } finally { setBusy(false); }
    };

    const doDisconnect = async () => {
        setBusy(true);
        try { await SandboxService.clearConnection(); await loadConn(); onToast('Disconnected from production.'); }
        finally { setBusy(false); setConfirmAction(null); }
    };

    const doRefresh = async () => {
        setBusy(true);
        try {
            const d = await SandboxService.refresh();
            if (d.success) { pollStatus(); }
            else { onToast(d.detail || 'Failed to start refresh', 'error'); setBusy(false); }
        } catch (e) {
            onToast(e.response?.data?.detail || 'Failed to start refresh', 'error');
            setBusy(false);
        } finally { setConfirmAction(null); }
    };

    const pollStatus = () => {
        setProgress({ step: 'Starting...', percent: 0, detail: '' });
        pollRef.current = setInterval(async () => {
            try {
                const d = await SandboxService.getRefreshStatus();
                setProgress({ step: d.step || '', percent: d.percent || 0, detail: d.detail || '' });
                if (d.status === 'done') {
                    clearInterval(pollRef.current);
                    onToast(`Refresh complete! ${d.lead_count ?? 0} leads loaded.`);
                    setTimeout(() => { setProgress(null); setBusy(false); loadConn(); }, 1200);
                } else if (d.status === 'failed') {
                    clearInterval(pollRef.current);
                    onToast(`Refresh failed: ${d.error || 'Unknown error'}`, 'error');
                    setProgress(null); setBusy(false);
                }
            } catch { /* keep polling */ }
        }, 2000);
    };

    const doSynthetic = async () => {
        setBusy(true);
        try {
            const d = await SandboxService.generateSynthetic(syntheticCount);
            if (d.success) onToast(`Generated ${d.count} leads!`);
            else onToast(d.detail || 'Failed', 'error');
        } catch { onToast('Network error', 'error'); }
        finally { setBusy(false); setConfirmAction(null); }
    };

    const doClear = async () => {
        setBusy(true);
        try {
            const d = await SandboxService.clearStagingData();
            if (d.success) onToast(`Cleared ${d.tables?.length || 0} tables.`);
            else onToast(d.detail || 'Failed', 'error');
        } catch { onToast('Network error', 'error'); }
        finally { setBusy(false); setConfirmAction(null); }
    };

    if (!conn) return <SkeletonText lines={3} />;

    return (
        <div className="space-y-5">
            <div>
                <h4 className="text-sm font-bold text-slate-800 mb-2">Production Connection</h4>
                <div className={`rounded-lg px-3 py-2.5 text-sm font-medium mb-3 ${
                    conn.connected ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-orange-50 text-orange-700 border border-orange-200'
                }`}>
                    {conn.connected
                        ? <>Connected to <strong>{conn.prod_url || 'production'}</strong></>
                        : 'Not connected. Enter your production URL and sandbox token below.'}
                </div>
                {!conn.connected ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <Input label="Production URL" placeholder="https://api.alternatecrm.com"
                            value={prodUrl} onChange={(e) => setProdUrl(e.target.value)} containerClassName="mb-0" />
                        <Input label="Sandbox Token" type="password" placeholder="sb_live_xxxxx"
                            value={prodToken} onChange={(e) => setProdToken(e.target.value)} containerClassName="mb-0" />
                        <div className="sm:col-span-2 flex items-center gap-3">
                            <Button size="sm" onClick={doConnect} disabled={busy}>Connect to Production</Button>
                            {connError && <span className="text-xs font-semibold text-red-600">{connError}</span>}
                        </div>
                    </div>
                ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirmAction('disconnect')} disabled={busy}>Disconnect</Button>
                )}
            </div>

            {conn.last_refresh_at && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
                    Last refresh: <strong>{new Date(conn.last_refresh_at).toLocaleString()}</strong> — {conn.last_refresh_lead_count || 0} leads — status: <strong>{conn.last_refresh_status || 'unknown'}</strong>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                    <div className="text-sm font-bold text-green-800 mb-1">Mirror Refresh</div>
                    <div className="text-xs text-green-700 mb-3">Pull anonymized real data from production</div>
                    <Button size="sm" className="w-full" disabled={!conn.connected || busy} onClick={() => setConfirmAction('refresh')}>
                        <RefreshCw size={14} /> Refresh from Production
                    </Button>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <div className="text-sm font-bold text-blue-800 mb-1">Synthetic Data</div>
                    <div className="text-xs text-blue-700 mb-3">Generate fake leads for testing (no prod needed)</div>
                    <div className="flex gap-2">
                        <select
                            className="flex-1 rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm"
                            value={syntheticCount} onChange={(e) => setSyntheticCount(Number(e.target.value))}
                        >
                            {[100, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n.toLocaleString()} leads</option>)}
                        </select>
                        <Button size="sm" disabled={busy} onClick={() => setConfirmAction('synthetic')}>
                            <Sparkles size={14} /> Generate
                        </Button>
                    </div>
                </div>
            </div>

            {progress && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex justify-between mb-2 text-sm">
                        <span className="font-semibold text-slate-800">{progress.step}</span>
                        <span className="font-bold text-amber-600">{progress.percent}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
                    </div>
                    {progress.detail && <div className="text-xs text-slate-400 mt-1.5">{progress.detail}</div>}
                </div>
            )}

            <div className="border-t border-slate-200 pt-4">
                <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setConfirmAction('clear')} disabled={busy}>
                    <Trash2 size={14} /> Clear All Staging Data
                </Button>
            </div>

            <ConfirmDialog
                open={confirmAction === 'disconnect'} onClose={() => setConfirmAction(null)}
                title="Disconnect from production?"
                message="The staging sandbox will no longer be able to pull data from production until reconnected."
                confirmLabel="Disconnect" confirmVariant="danger" onConfirm={doDisconnect} loading={busy}
            />
            <ConfirmDialog
                open={confirmAction === 'refresh'} onClose={() => setConfirmAction(null)}
                title="Replace staging data?"
                message="This will REPLACE all staging data with anonymized production data. This action cannot be undone."
                confirmLabel="Yes, Refresh" confirmVariant="danger" onConfirm={doRefresh} loading={busy}
            />
            <ConfirmDialog
                open={confirmAction === 'synthetic'} onClose={() => setConfirmAction(null)}
                title="Generate synthetic leads?"
                message={`Generate ${syntheticCount} fake leads for testing purposes. No production data is involved.`}
                confirmLabel="Generate" onConfirm={doSynthetic} loading={busy}
            />
            <ConfirmDialog
                open={confirmAction === 'clear'} onClose={() => setConfirmAction(null)}
                title="Clear all staging data?"
                message="This will permanently delete ALL leads, notes, calls, and activity from staging. This cannot be undone."
                confirmLabel="Yes, Clear Everything" confirmVariant="danger" onConfirm={doClear} loading={busy}
            />
        </div>
    );
}
