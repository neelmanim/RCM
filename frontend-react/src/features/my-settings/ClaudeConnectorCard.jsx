import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, Check, KeyRound } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Modal';
import { ClaudeConnectorService } from '../../services/api';
import { toast } from './toast';

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast('Copy failed — select the text and copy it manually.', 'warning'));
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} aria-label={label}>
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : 'Never');

/**
 * v13.4.0 — connect Claude to Alternate CRM with a personal API key. Claude then
 * sees and does only what this user can in Alternate CRM (routes/mcp_routes.py).
 */
export function ClaudeConnectorCard() {
  const [info, setInfo] = useState(null);      // null = loading
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState(null);  // shown once, right after creation
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(async () => {
    try {
      setInfo(await ClaudeConnectorService.listKeys());
    } catch (err) {
      setInfo({ keys: [], connector_url: '', error: err.response?.data?.detail || 'Could not load your API keys.' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const created = await ClaudeConnectorService.createKey(name.trim() || 'Claude');
      setNewKey(created.key);
      setName('');
      await load();
    } catch (err) {
      toast(err.response?.data?.detail || 'Could not create a key — try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await ClaudeConnectorService.revokeKey(revoking.id);
      toast(`"${revoking.name}" revoked — Claude sessions using it stop working now.`, 'success');
      setRevoking(null);
      await load();
    } catch (err) {
      toast(err.response?.data?.detail || 'Could not revoke the key — try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Super Admins only until an admin opens it to everyone — anyone else just
  // doesn't see the card (no "not allowed" message). Nothing renders until we
  // know, so it never flashes up and disappears.
  if (info === null || info.available === false) return null;

  return (
    <Card data-tour="my-settings-claude">
      <CardHeader
        title={<span className="flex items-center gap-2"><Bot size={15} className="text-violet-500" /> Claude connector</span>}
        subtitle="Ask Claude about your leads, tasks, cadences and pipeline — it sees only what you can see here"
        actions={info && <Badge variant={info.write_enabled ? 'indigo' : 'default'}>{info.write_enabled ? 'Can make changes' : 'View only'}</Badge>}
      />
      <CardContent className="space-y-4">
        {info.error ? (
          <p className="text-sm text-red-600 m-0" role="alert">{info.error}</p>
        ) : (
          <>
            <ol className="text-sm text-slate-600 m-0 pl-5 space-y-2">
              <li><b>Create a key</b> below and copy it. You'll paste it in step 4.</li>
              <li>
                In Claude (claude.ai or the desktop app), go to <b>Settings → Connectors</b> and click{' '}
                <b>Add custom connector</b>. On a Team or Enterprise plan, an owner adds it once under{' '}
                <b>Admin settings → Connectors</b>, then everyone connects with their own key.
              </li>
              <li>
                Fill in the dialog:
                <ul className="mt-1 mb-0 pl-4 list-disc space-y-1">
                  <li><b>Name:</b> Alternate CRM</li>
                  <li>
                    <b>Remote MCP server URL:</b>
                    <span className="flex items-center gap-2 mt-1">
                      <code className="flex-1 min-w-0 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800">
                        {info.connector_url}
                      </code>
                      <CopyButton text={info.connector_url} label="Copy connector URL" />
                    </span>
                  </li>
                  <li><b>Advanced settings</b> (OAuth Client ID / Secret): <b>leave both empty</b> — Claude registers itself.</li>
                </ul>
                Click <b>Add</b>.
              </li>
              <li>
                Click <b>Connect</b> next to Alternate CRM. A Alternate CRM page opens — paste your key and click{' '}
                <b>Connect</b>. You'll land back in Claude, connected.
              </li>
              <li>
                In a chat, turn Alternate CRM on from the <b>Search and tools</b> menu, then ask away — e.g.
                “Which of my leads replied this week?”
                {info.write_enabled
                  ? ' Your admin has allowed Claude to make changes too (notes, tasks, status, cadence drafts).'
                  : ' Claude can read your data; your admin can also allow it to make changes.'}
              </li>
            </ol>

            {newKey && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-800 m-0">
                  Copy your key now — you won't be able to see it again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 break-all rounded border border-amber-200 bg-white px-2 py-1.5 text-xs">{newKey}</code>
                  <CopyButton text={newKey} label="Copy API key" />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>I've copied it</Button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <Input
                label="New key name"
                placeholder="e.g. Claude on my laptop"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                containerClassName="flex-1 !mb-0"
              />
              <Button size="sm" onClick={create} disabled={busy}>
                <KeyRound size={13} /> Create key
              </Button>
            </div>

            {info.keys.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 m-0 p-0 list-none">
                {info.keys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{k.name}</div>
                      <div className="text-xs text-slate-500">
                        <code>{k.key_prefix}…</code> · created {fmt(k.created_at)} · last used {fmt(k.last_used_at)}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setRevoking(k)} disabled={busy}>Revoke</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        message={revoking ? `Claude sessions connected with "${revoking.name}" will stop working immediately.` : ''}
        confirmLabel="Revoke"
        confirmVariant="danger"
        onConfirm={revoke}
        loading={busy}
      />
    </Card>
  );
}
