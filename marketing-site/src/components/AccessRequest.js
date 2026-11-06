"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function restoreFocus(target) {
  if (target instanceof HTMLElement && target !== document.body && target.isConnected && target.getClientRects().length > 0 && window.getComputedStyle(target).visibility !== "hidden") target.focus();
  else document.querySelector("#main-content")?.focus();
}
export default function AccessRequest() {
  const query = useSearchParams();
  const router = useRouter();
  const dialog = useRef(null);
  const returnFocus = useRef(null);
  const doneButton = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const requested = query.get("request-access") === "1";
  useEffect(() => {
    const element = dialog.current;
    if (requested && !element.open) { returnFocus.current = document.activeElement; element.showModal(); }
    else if (!requested && element.open) { element.close(); restoreFocus(returnFocus.current); }
    if (!requested) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [requested]);
  useEffect(() => { if (submitted && dialog.current?.open) doneButton.current?.focus(); }, [submitted]);
  const close = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("request-access");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    dialog.current?.close();
    restoreFocus(returnFocus.current);
  };
  function keepFocus(event) {
    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden");
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); dialog.current.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setError(""); setSubmitting(true);
    try {
      const response = await fetch("/api/early-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values), signal: AbortSignal.timeout(12000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(typeof data.error === "string" ? data.error : "We could not save your request. Please try again.");
      form.reset(); setSubmitted(true);
    } catch (cause) {
      setError(cause.name === "TimeoutError" ? "The request timed out. We could not confirm it was saved. Please try again." : cause.message === "Failed to fetch" ? "Unable to connect. Check your connection and try again." : cause.message || "We could not save your request. Please try again.");
    } finally { setSubmitting(false); }
  }
  return <dialog ref={dialog} className="access-dialog" aria-labelledby="request-title" onKeyDown={keepFocus} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="lead-modal-header"><span className="brand">alternatecrm</span><button type="button" className="lead-modal-close-btn" aria-label="Close access request" onClick={close}>✕</button></div>
    <div className="lead-modal-body"><h2 id="request-title" className="lead-modal-title">{submitted ? "Your request is saved" : "Request early access"}</h2>
      {submitted ? <div role="status"><p className="lead-modal-sub">Thank you for your interest. We will use your email to follow up about access. No workspace has been provisioned yet.</p><button ref={doneButton} type="button" className="btn btn-primary" onClick={close}>Done</button></div> : <>
        <p className="lead-modal-sub">Tell us what your team needs. Fields marked * are required.</p>
        <form onSubmit={submit}><div className="form-grid">
          <div className="form-group"><label className="form-label" htmlFor="request-first">First name *</label><input autoFocus required maxLength={100} autoComplete="given-name" className="form-input" id="request-first" name="first_name" /></div>
          <div className="form-group"><label className="form-label" htmlFor="request-last">Last name</label><input maxLength={100} autoComplete="family-name" className="form-input" id="request-last" name="last_name" /></div>
          <div className="form-group full"><label className="form-label" htmlFor="request-email">Email *</label><input required type="email" maxLength={255} autoComplete="email" className="form-input" id="request-email" name="email" /></div>
          <div className="form-group full"><label className="form-label" htmlFor="request-company">Company</label><input maxLength={200} autoComplete="organization" className="form-input" id="request-company" name="company" /></div>
          <div className="form-group"><label className="form-label" htmlFor="request-team">Team size</label><select className="form-select" id="request-team" name="team_size" defaultValue="1-5"><option value="1-5">1–5 people</option><option value="6-20">6–20 people</option><option value="21-50">21–50 people</option><option value="50+">More than 50</option></select></div>
          <div className="form-group"><label className="form-label" htmlFor="request-interest">Main interest</label><select className="form-select" id="request-interest" name="primary_interest" defaultValue="CRM and pipeline"><option>CRM and pipeline</option><option>Pipeline analytics</option><option>Communication modules (planned)</option><option>Integrations (planned)</option></select></div>
          <div className="form-group full"><label className="form-label" htmlFor="request-notes">What would help your team?</label><textarea className="form-textarea" id="request-notes" name="notes" rows={3} maxLength={2000} /></div>
        </div>
        <div hidden aria-hidden="true"><label htmlFor="request-website">Leave blank</label><input id="request-website" name="website_hp" tabIndex={-1} autoComplete="off" /></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <p className="lead-modal-sub">We use these details to respond to your request. Please do not include sensitive customer data.</p>
        <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>{submitting ? "Saving request…" : "Send access request"}</button>
        </form>
      </>}
    </div>
  </dialog>;
}
