import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ProductionShell from './components/layout/ProductionShell';
import DisqualificationReview from './features/leads-hub/DisqualificationReview';
import WorkspaceRecovery from './components/layout/WorkspaceRecovery';
import { registerHub } from './hub-entry';
import './production-shell.css';

const root = createRoot(document.getElementById('production-shell-root'));
// Legacy controllers read the shell's mount points as soon as their scripts load.
flushSync(() => root.render(<ProductionShell />));
registerHub('DisqualificationReviewHub', (props) => <DisqualificationReview {...props} />);
registerHub('WorkspaceRecoveryHub', (props) => <WorkspaceRecovery {...props} />);
