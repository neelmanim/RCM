import React, { useCallback, useEffect, useState } from 'react';

// No shared React toast exists anywhere in this codebase today — every hub
// reinvents one locally (LeadsHub.jsx, SettingsAI.jsx, AdminUsers.jsx, etc.).
// This one is driven by a 'rcm:toast' CustomEvent (not props) so
// non-React modules (dialerEngine.js) can trigger a toast without importing
// React or being coupled to a specific mounted consumer — mirrors the
// existing rcm:* event-bus convention already used for call events.

const THEMES = {
  error: { icon: '⚠️', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
  success: { icon: '✓', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  info: { icon: 'ℹ️', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  warning: { icon: '⚠️', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
};

let _nextId = 1;

export const ToastHost = () => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const { message, type = 'error', duration = 4000 } = e.detail || {};
      if (!message) return;
      const id = _nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => dismiss(id), duration);
    };
    window.addEventListener('rcm:toast', handler);
    return () => window.removeEventListener('rcm:toast', handler);
  }, [dismiss]);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 items-end pointer-events-auto">
      {toasts.map((t) => {
        const theme = THEMES[t.type] || THEMES.error;
        return (
          <div
            key={t.id}
            role="status"
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg max-w-sm ${theme.bg} ${theme.border} ${theme.text}`}
          >
            <span className="shrink-0">{theme.icon}</span>
            <span className="text-sm font-medium flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};
