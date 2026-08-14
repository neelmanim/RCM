/**
 * useEmails.js
 *
 * Fetches and polls emails for a given lead.
 * - Fetches on mount and on leadId change.
 * - Polls every 30 seconds while the component is mounted.
 * - Cleans up the interval on unmount.
 * - Exposes a refetch() function for manual refresh (e.g. after send).
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL_MS = 30_000;

export function useEmails(leadId, token, apiBase) {
  const [emails, setEmails]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const mountedRef            = useRef(true);

  const fetchEmails = useCallback(async (showLoader = false) => {
    if (!leadId || !token) return;
    if (showLoader) setLoading(true);

    const base = apiBase || window.__CRM_API_BASE__ || '';
    try {
      const resp = await fetch(`${base}/api/email/lead/${leadId}/emails`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      if (mountedRef.current) {
        setEmails(data.emails || []);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) setError(e.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [leadId, token, apiBase]);

  useEffect(() => {
    mountedRef.current = true;
    fetchEmails(true);
    const id = setInterval(() => fetchEmails(false), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchEmails]);

  return { emails, loading, error, refetch: () => fetchEmails(false) };
}
