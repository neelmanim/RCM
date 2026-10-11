import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ msg }) {
  const outbound = msg.dir === 'outbound';
  return (
    <div className={`flex flex-col ${outbound ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-snug ${
          outbound
            ? 'bg-gradient-to-br from-indigo-600 to-indigo-500 text-white rounded-br-sm'
            : 'bg-white/10 text-white/90 rounded-bl-sm'
        }`}
      >
        {msg.text}
      </div>
      <div className="text-[10px] text-white/35 mt-0.5 px-1">{formatTime(msg.time)}</div>
    </div>
  );
}

export function MessageTab({ ui, messaging }) {
  const {
    channel, setChannel, sessionState, sessionLoading, messages,
    templates, selectedTemplate, setSelectedTemplate, sending, sendMessage,
    messagingConfigured = true,
  } = messaging;
  const [composeText, setComposeText] = useState('');
  const historyRef = useRef(null);
  const caps = ui.capabilities || { sms: false, whatsapp: false };

  // Land on a channel this SDR holds. Without this a WhatsApp-only SDR would
  // open on the store's default and send against a channel the API refuses.
  useEffect(() => {
    if (channel === 'whatsapp' && !caps.whatsapp && caps.sms) setChannel('sms');
    else if (channel === 'sms' && !caps.sms && caps.whatsapp) setChannel('whatsapp');
  }, [channel, caps.sms, caps.whatsapp, setChannel]);

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages]);

  if (!ui.leadId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center flex-1">
        <MessageSquare size={26} className="text-white/30" />
        <div className="text-sm font-semibold text-white/75">No lead selected</div>
        <div className="text-xs text-white/40 max-w-[220px]">
          Open a lead and click <strong>Message</strong> to send &amp; receive messages.
        </div>
      </div>
    );
  }

  if (messagingConfigured === false) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center flex-1">
        <MessageSquare size={26} className="text-white/30" />
        <div className="text-sm font-semibold text-white/75">Messaging isn't set up</div>
        <div className="text-xs text-white/40 max-w-[220px]">
          This workspace hasn't configured Alternate Messenger Conversations yet. Ask your admin to set it up in Settings.
        </div>
      </div>
    );
  }

  if (!ui.leadPhone) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center flex-1">
        <span className="text-2xl">📵</span>
        <div className="text-sm font-semibold text-white/75">No phone number</div>
        <div className="text-xs text-white/40 max-w-[220px]">
          Add a phone number to this lead to enable messaging.
        </div>
      </div>
    );
  }

  const requiresTemplate = channel === 'whatsapp' && sessionState?.requires_template;

  const onSend = async () => {
    // sessionLoading means we don't yet know requires_template for sure —
    // sending now could take the free-text path when the real answer is
    // "template required," which Alternate Messenger rejects with a bare 400.
    if (sessionLoading) return;
    if (requiresTemplate && !selectedTemplate) return;
    const ok = await sendMessage(composeText);
    if (ok && !requiresTemplate) setComposeText('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* v11.10.0: SMS and WhatsApp are granted separately, so only offer the
          channels this SDR actually holds. With one channel there's nothing to
          switch between, so the picker is hidden entirely. */}
      {caps.sms && caps.whatsapp && (
        <div className="flex gap-1.5 px-3 pt-2 pb-1 border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => setChannel('whatsapp')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              channel === 'whatsapp' ? 'bg-indigo-500/25 border-indigo-500 text-indigo-200' : 'border-white/15 text-white/55 hover:border-white/30'
            }`}
          >
            WhatsApp
          </button>
          <button
            type="button"
            onClick={() => setChannel('sms')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              channel === 'sms' ? 'bg-indigo-500/25 border-indigo-500 text-indigo-200' : 'border-white/15 text-white/55 hover:border-white/30'
            }`}
          >
            SMS
          </button>
        </div>
      )}

      {sessionLoading && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-200 text-xs flex items-center gap-2 shrink-0">
          <Spinner size={12} tone="light" />
          Checking session…
        </div>
      )}
      {!sessionLoading && requiresTemplate && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-200 text-xs shrink-0">
          ⚠️ Session expired — select a WhatsApp template to start
        </div>
      )}

      <div ref={historyRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-white/30">
            <MessageSquare size={20} />
            <span className="text-xs">No messages yet</span>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
      </div>

      {requiresTemplate ? (
        <div className="flex flex-col gap-2 p-3 border-t border-white/10 shrink-0">
          <label className="text-[10px] font-bold uppercase tracking-wide text-white/40">Select template</label>
          <select
            value={selectedTemplate?.id ?? ''}
            onChange={(e) => {
              const t = templates.find((tpl) => String(tpl.id) === e.target.value);
              setSelectedTemplate(t || null);
            }}
            className="w-full px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 text-white/90 text-sm outline-none"
          >
            <option value="">— choose a template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name.replace(/_/g, ' ')}</option>
            ))}
          </select>
          {selectedTemplate && (
            <div className="px-2.5 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-xs text-white/75 whitespace-pre-wrap max-h-24 overflow-y-auto">
              {(selectedTemplate.template_text || '').replace(/\$\{contacts\.first_name\}/g, ui.leadName || '')}
            </div>
          )}
          <button
            type="button"
            disabled={!selectedTemplate || sending || sessionLoading}
            onClick={onSend}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-semibold text-white"
          >
            <Send size={14} /> Send
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 p-2.5 border-t border-white/10 shrink-0">
          <textarea
            rows={1}
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (composeText.trim()) onSend(); } }}
            placeholder="Type a message…"
            className="flex-1 resize-none max-h-20 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/90 text-sm outline-none focus:border-focus-ring"
          />
          <button
            type="button"
            disabled={!composeText.trim() || sending || sessionLoading}
            onClick={onSend}
            aria-label="Send message"
            className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-500 disabled:opacity-40 text-white"
          >
            <Send size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
