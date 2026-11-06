import { useEffect, useState } from 'react';

export default function DisqualificationReview({ fetchRequests, approve, reject, formatDate }) {
  const [requests, setRequests] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetchRequests('pending').then(
      result => { if (active) setRequests(result.requests); },
      failure => { if (active) setError(failure.message || 'Could not load requests.'); },
    );
    return () => { active = false; };
  }, [fetchRequests]);

  async function decide(id, shouldReject) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = shouldReject ? await reject(id, reason.trim()) : await approve(id);
      setRequests(current => current.filter(request => request.id !== id));
      setRejecting(null);
      setNotice(result?.message || (shouldReject ? 'Request rejected.' : 'Request approved.'));
    } catch (failure) {
      setError(failure.message || 'Could not update this request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="disqualification-title">
      <header className="page-header">
        <div>
          <h1 id="disqualification-title" className="page-title">Disqualification requests</h1>
          <p className="page-subtitle">Review requests from your team before removing leads from active work.</p>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!requests && !error && <p role="status">Loading requests…</p>}
      {requests?.length === 0 && <p>No pending requests.</p>}
      {requests?.length > 0 && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>{['Company', 'Leads', 'Reason', 'Requested by', 'Date', 'Actions'].map(title => (
                <th key={title} scope="col">{title}</th>
              ))}</tr>
            </thead>
            <tbody>
              {requests.map(request => (
                <tr key={request.id}>
                  <td>{request.company}</td>
                  <td>{request.lead_ids.length}</td>
                  <td>{request.reason}</td>
                  <td>{request.requested_by_name || '—'}</td>
                  <td>{formatDate(request.requested_at)}</td>
                  <td>
                    {rejecting === request.id ? (
                      <form onSubmit={event => { event.preventDefault(); decide(request.id, true); }}>
                        <label>
                          Reason for rejecting (optional)
                          <textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} />
                        </label>
                        <button type="submit" className="btn btn-primary" disabled={busy}>Confirm rejection</button>
                        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setRejecting(null)}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(request.id, false)}>Approve</button>
                        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setReason(''); setRejecting(request.id); }}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
