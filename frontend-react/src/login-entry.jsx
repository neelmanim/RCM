/**
 * login-entry.jsx
 *
 * Self-mounting entry for frontend/login.html — the standalone pre-auth
 * sign-in page. Unlike every registerHub() island (hub-entry.jsx), there's
 * no vanilla shell here calling mount()/navigate()/unmount(): this page has
 * no router, no other JS actor to coordinate with, and no reason to ever
 * re-render with new props from outside. Mounts immediately into
 * #login-root, same "deliberate exemption" reasoning as
 * messenger-widget-entry.jsx (see alternatecrm skill, hub-entry.jsx's own doc
 * comment, and src/test/hub-entry.test.jsx's EXEMPT set).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoginPage } from './features/login/LoginPage';
import './login-tailwind.css';

const container = document.getElementById('login-root');
if (container) {
  createRoot(container).render(<LoginPage />);
}
