import { useEffect, useState } from 'react';

const MAX_ATTEMPTS = 12;

export default function WorkspaceRecovery({ apiBase, reconnect }) {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!reconnect) return;
    const stop = new AbortController();
    let nextCheck;
    let requestTimeout;
    let tries = 0;

    async function check() {
      tries += 1;
      const request = new AbortController();
      const abort = () => request.abort();
      stop.signal.addEventListener('abort', abort, { once: true });
      requestTimeout = window.setTimeout(abort, 4500);
      try {
        const result = await fetch(`${apiBase}/api/health`, { signal: request.signal });
        if (!stop.signal.aborted && (result.ok || result.status === 404)) {
          window.location.reload();
          return;
        }
      } catch {
        // The next check can retry a temporary network failure.
      } finally {
        window.clearTimeout(requestTimeout);
        stop.signal.removeEventListener('abort', abort);
      }
      if (!stop.signal.aborted) {
        setAttempt(tries);
        if (tries < MAX_ATTEMPTS) nextCheck = window.setTimeout(check, 1500);
      }
    }

    nextCheck = window.setTimeout(check, 1500);
    return () => {
      stop.abort();
      window.clearTimeout(nextCheck);
      window.clearTimeout(requestTimeout);
    };
  }, [apiBase, reconnect]);

  const waiting = reconnect && attempt < MAX_ATTEMPTS;
  return (
    <section className="info-card" aria-labelledby="workspace-recovery-title">
      <h1 id="workspace-recovery-title" className="page-title">Could not open the workspace</h1>
      <p role="status">{waiting ? 'Checking the connection. This page will reload when it is available.' : 'Try opening the workspace again.'}</p>
      <button type="button" className="btn btn-outline" onClick={() => window.location.reload()}>Try again</button>
    </section>
  );
}
