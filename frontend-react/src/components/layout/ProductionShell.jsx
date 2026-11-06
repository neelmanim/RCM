import { useLayoutEffect } from 'react';

function readRoute(defaultView) {
  const hash = window.location.hash.slice(1);
  if (!hash) return { view: defaultView, extra: null };
  const [view, ...segments] = hash.split('/');
  return { view, extra: segments.join('/') || null };
}

export default function ProductionShell() {
  const initialRoute = readRoute('dashboard').view || 'dashboard';

  useLayoutEffect(() => {
    let routes;

    function handleHashChange() {
      if (!routes) return;
      const { view, extra } = readRoute(routes.defaultView);
      routes.onHistoryNavigation(view, extra).catch(routes.onNavigationError);
    }

    function startRouting(event) {
      routes = event.detail;
      const { view, extra } = readRoute(routes.defaultView);
      routes.onInitialNavigation(view, extra).catch(routes.onBootError);
    }

    window.addEventListener('crm:routes-ready', startRouting, { once: true });
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('crm:routes-ready', startRouting);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);
  return (
    <>

    <div className="app-container">
        {/* NavHub React bundle — Sidebar + Topbar */}
        <div id="nav-sidebar-root"></div>

        {/* Main Content Area */}
        <main className="main-content">
            {/* NavHub React Topbar */}
        <div id="nav-topbar-root"></div>

            <div id="view-container" className="view-container">
                {/* #dashboard-react-root is the React mount point for DashboardHub.
                     It exists in HTML from parse time so style.css can pre-reserve its
                     height (min-height: 985px) before any JS runs — eliminating CLS.
                     The skeleton inside is replaced by React when getDashboardStats resolves. */}
                <div id="dashboard-react-root" hidden={initialRoute !== "dashboard"}>
                  <div id="dashboard-skeleton" style={{"padding": "20px 0", "fontFamily": "'Inter', system-ui, sans-serif"}}>

                    {/* Welcome strip skeleton */}
                    <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "marginBottom": "18px"}}>
                      <div>
                        <div className="sk-box" style={{"width": "220px", "height": "22px", "borderRadius": "6px", "marginBottom": "8px"}}></div>
                        <div className="sk-box" style={{"width": "340px", "height": "14px", "borderRadius": "4px"}}></div>
                      </div>
                      <div style={{"display": "flex", "gap": "8px"}}>
                        <div className="sk-box" style={{"width": "90px", "height": "34px", "borderRadius": "8px"}}></div>
                        <div className="sk-box" style={{"width": "110px", "height": "34px", "borderRadius": "8px"}}></div>
                      </div>
                    </div>

                    {/* KPI row skeleton — 7 cards at 125px (live DOM measured) */}
                    <div style={{"display": "grid", "gridTemplateColumns": "repeat(7,1fr)", "gap": "12px", "marginBottom": "14px"}}>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                      <div className="sk-box" style={{"height": "125px", "borderRadius": "12px"}}></div>
                    </div>

                    {/* Bento grid skeleton — 60/40 split, 660px (live DOM measured) */}
                    <div style={{"display": "grid", "gridTemplateColumns": "60fr 40fr", "gap": "12px", "minHeight": "660px"}}>
                      {/* Left: chart card + activity card */}
                      <div style={{"display": "flex", "flexDirection": "column", "gap": "10px"}}>
                        <div className="sk-box" style={{"height": "420px", "borderRadius": "12px"}}></div>
                        <div className="sk-box" style={{"height": "220px", "borderRadius": "12px"}}></div>
                      </div>
                      {/* Right: leaderboard card */}
                      <div style={{"display": "flex", "flexDirection": "column", "gap": "12px"}}>
                        <div className="sk-box" style={{"height": "660px", "borderRadius": "12px"}}></div>
                      </div>
                    </div>

                  </div>
                </div>

                

                
            </div>{/* /#view-container */}
        </main>
    </div>{/* /.app-container */}

    {/* Legacy static HTML modals deprecated in favor of React dialogs (e.g. CreateLeadModal) */}



    {/* ── Call Log Modal ──────────────────────────────────────────────── */}
    <div id="call-log-modal" className="modal">
        <div className="modal-content clm-content">

            {/* Lead Context Bar */}
            <div className="clm-lead-bar">
                <div className="clm-avatar" id="call-modal-avatar"></div>
                <div className="clm-lead-info">
                    <div className="clm-lead-name" id="call-modal-lead-name">—</div>
                    <div className="clm-lead-phone" id="call-modal-phone">—</div>
                </div>
                <button className="clm-close close-call-modal" aria-label="Close">&times;</button>
            </div>

            {/* Hidden inputs (preserved) */}
            <input type="hidden" id="call-modal-lead-id" />
            <input type="hidden" id="call-modal-attempt-count" defaultValue="0" />
            <input type="hidden" id="call-modal-min-attempts" defaultValue="3" />
            <input type="hidden" id="call-modal-max-attempts" defaultValue="5" />
            <input type="hidden" id="call-outcome-select" defaultValue="" />

            {/* Warnings */}
            <div id="call-attempt-warning" className="clm-warning" style={{"display": "none"}}></div>
            <div id="call-company-resolved-warning" className="clm-warning clm-company-warning" style={{"display": "none"}}></div>

            <div className="clm-body">
                {/* State 1: Binary question */}
                <div id="outcome-question-section">
                    <div className="clm-question">Did the call connect?</div>
                    <div className="clm-branch-row">
                        <button className="branch-pill branch-no" id="branch-no-btn">&#10007;&nbsp; No / Voicemail</button>
                        <button className="branch-pill branch-yes" id="branch-yes-btn">&#10003;&nbsp; Yes, Connected</button>
                    </div>
                </div>

                {/* State 2/3: Chips (hidden until branch picked) */}
                <div id="outcome-chips-section" style={{"display": "none"}}>
                    <div id="branch-compact-bar"></div>
                    <div id="call-outcome-picker"></div>
                </div>

                {/* Notes (shown after chip selection) */}
                <div id="call-notes-section" style={{"display": "none"}}>
                    <label htmlFor="call-notes" id="call-notes-label" className="clm-notes-label">
                        Notes <span style={{"fontSize": "0.75rem", "color": "var(--text-muted)"}}>(optional)</span>
                    </label>
                    <textarea id="call-notes" className="note-textarea clm-notes-textarea" placeholder="Add a note..."></textarea>
                </div>
            </div>

            {/* Footer */}
            <div className="clm-footer">
                <div id="aircall-sync-indicator" className="aircall-sync-indicator" style={{"display": "none"}}>
                    <span className="aircall-sync-dot"></span>
                    <span>Aircall sync active</span>
                </div>
                <div className="clm-footer-actions">
                    <button type="button" className="btn btn-outline close-call-modal" id="clm-cancel-btn">Cancel</button>
                    <button type="button" className="btn btn-primary clm-log-btn" id="submit-call-btn" disabled>Log Call &#8594;</button>
                </div>
            </div>

        </div>
    </div>

    </>
  );
}
