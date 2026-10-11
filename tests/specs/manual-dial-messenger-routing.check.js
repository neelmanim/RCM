// Static regression check — no browser/backend required. Run: node tests/specs/manual-dial-messenger-routing.check.js
//
// Guards against re-introducing the "two dialer UIs" bug: Manual Dial for
// Alternate Messenger users must route through AlternateMessenger (messenger_dialer.js),
// never through the Aircall-only DialerMachine/showDialerWidget path in
// dialer_widget.js. See docs/AGENT_PROTOCOL.md Rule 18 case study (2026-07-16).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'js', 'views', 'dialer_widget.js'),
    'utf8'
);

const fnStart = src.indexOf('export function showManualDialWidget');
assert(fnStart !== -1, 'showManualDialWidget() not found');
const messengerBranchStart = src.indexOf("provider === 'messenger'", fnStart);
const messengerBranchEnd = src.indexOf('// ── Standalone manual dial widget', messengerBranchStart);
const messengerBranch = src.slice(messengerBranchStart, messengerBranchEnd);

assert(
    !/showDialerWidget\(/.test(messengerBranch),
    'Alternate Messenger branch of showManualDialWidget must not call showDialerWidget() — ' +
    'that drives the Aircall-only DialerMachine and renders a second, desynced call UI'
);
assert(
    /window\.AlternateMessengerDialer\.activate\(/.test(messengerBranch),
    'Alternate Messenger branch of showManualDialWidget must call window.AlternateMessengerDialer.activate()'
);

const guardStart = src.indexOf('export function showManualDialWidget');
const guardEnd = src.indexOf('// v6.2.0: Alternate Messenger SDRs', guardStart);
const guard = src.slice(guardStart, guardEnd);
assert(
    /provider === 'messenger'\s*\n?\s*\?\s*window\.AlternateMessengerDialer\?\.\s*isActive\(\)/.test(guard),
    "showManualDialWidget's duplicate-call guard must check AlternateMessenger.isActive() " +
    "for Alternate Messenger, not the Aircall-only isWidgetActive()/DialerMachine"
);
assert(
    /:\s*isWidgetActive\(\)/.test(guard),
    'Aircall branch of the guard must still fall back to isWidgetActive() — do not regress Aircall'
);

console.log('OK: Manual Dial Alternate Messenger routing check passed');
