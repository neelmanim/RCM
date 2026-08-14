// ── phone_timezone.js — ENH-01: Live timezone badge per phone number ──────────
//
// Exported API:
//   getPhoneTimezone(phoneNumber) → { tz, countryCode, label } | null
//   renderPhoneLocalTime(phoneNumber) → HTML string (badge with live local time)
//   initPhoneTimeBadges(container)   → wires live-updating clock badges
//
// Approach: Parse the E.164 prefix (or a best-guess from 10-digit national numbers)
// and map it to an IANA timezone. Uses Intl.DateTimeFormat for formatting — no deps.
//
// India-specific: Bare 10-digit numbers default to +91 (IST).

// ── Country-code → IANA timezone map (top calling countries for B2B SDRs) ──
const CC_TZ = {
    '1':    'America/New_York',   // US/Canada — defaults to Eastern (most common)
    '1213': 'America/Los_Angeles', // LA area code
    '1212': 'America/New_York',
    '1415': 'America/Los_Angeles',
    '1650': 'America/Los_Angeles',
    '1312': 'America/Chicago',
    '1469': 'America/Chicago',
    '1972': 'America/Chicago',
    '1206': 'America/Los_Angeles',
    '1303': 'America/Denver',
    '1720': 'America/Denver',
    '1604': 'America/Vancouver',
    '1416': 'America/Toronto',
    '44':   'Europe/London',
    '49':   'Europe/Berlin',
    '33':   'Europe/Paris',
    '31':   'Europe/Amsterdam',
    '34':   'Europe/Madrid',
    '39':   'Europe/Rome',
    '46':   'Europe/Stockholm',
    '47':   'Europe/Oslo',
    '45':   'Europe/Copenhagen',
    '358':  'Europe/Helsinki',
    '41':   'Europe/Zurich',
    '43':   'Europe/Vienna',
    '32':   'Europe/Brussels',
    '351':  'Europe/Lisbon',
    '353':  'Europe/Dublin',
    '48':   'Europe/Warsaw',
    '420':  'Europe/Prague',
    '36':   'Europe/Budapest',
    '40':   'Europe/Bucharest',
    '380':  'Europe/Kiev',
    '7':    'Europe/Moscow',
    '91':   'Asia/Kolkata',     // India → IST
    '92':   'Asia/Karachi',
    '94':   'Asia/Colombo',
    '880':  'Asia/Dhaka',
    '977':  'Asia/Kathmandu',
    '975':  'Asia/Thimphu',
    '65':   'Asia/Singapore',
    '60':   'Asia/Kuala_Lumpur',
    '66':   'Asia/Bangkok',
    '84':   'Asia/Ho_Chi_Minh',
    '62':   'Asia/Jakarta',
    '63':   'Asia/Manila',
    '886':  'Asia/Taipei',
    '82':   'Asia/Seoul',
    '81':   'Asia/Tokyo',
    '852':  'Asia/Hong_Kong',
    '853':  'Asia/Macau',
    '86':   'Asia/Shanghai',
    '61':   'Australia/Sydney',
    '64':   'Pacific/Auckland',
    '27':   'Africa/Johannesburg',
    '20':   'Africa/Cairo',
    '234':  'Africa/Lagos',
    '254':  'Africa/Nairobi',
    '55':   'America/Sao_Paulo',
    '54':   'America/Argentina/Buenos_Aires',
    '52':   'America/Mexico_City',
    '57':   'America/Bogota',
    '56':   'America/Santiago',
    '51':   'America/Lima',
    '971':  'Asia/Dubai',
    '966':  'Asia/Riyadh',
    '972':  'Asia/Jerusalem',
    '98':   'Asia/Tehran',
    '90':   'Europe/Istanbul',
    '30':   'Europe/Athens',
};

/**
 * Attempt to determine IANA timezone from a phone number string.
 * @param {string} raw - Phone number (E.164 or bare national number)
 * @returns {{ tz: string, countryCode: string, label: string } | null}
 */
export function getPhoneTimezone(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // Normalise: strip spaces, dashes, parens
    const digits = raw.replace(/[\s\-().]/g, '');

    // Bare 10-digit Indian numbers (no + prefix): default to +91
    if (/^\d{10}$/.test(digits)) {
        return { tz: 'Asia/Kolkata', countryCode: '91', label: 'India (IST)' };
    }

    // E.164 format: +<country_code><subscriber>
    const e164 = digits.startsWith('+') ? digits.slice(1) : digits;

    // Try longest prefix first (up to 4 digits for area-code level mapping)
    for (let len = 4; len >= 1; len--) {
        const prefix = e164.slice(0, len);
        if (CC_TZ[prefix]) {
            return { tz: CC_TZ[prefix], countryCode: prefix, label: _tzLabel(CC_TZ[prefix]) };
        }
    }

    return null;
}

/** Format a timezone as a readable country+offset label. */
function _tzLabel(tz) {
    try {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            timeZoneName: 'short',
        });
        const parts = fmt.formatToParts(new Date());
        const tzName = parts.find(p => p.type === 'timeZoneName')?.value || '';
        return tzName;
    } catch { return tz; }
}

/**
 * Returns an HTML badge string showing the local time at the number's timezone.
 * Designed to be injected next to a phone number display.
 * @param {string} phoneNumber
 * @param {object} opts - { compact: bool }
 * @returns {string} HTML string
 */
export function renderPhoneLocalTime(phoneNumber, opts = {}) {
    const info = getPhoneTimezone(phoneNumber);
    if (!info) return '';

    const { tz, label } = info;
    const now = new Date();
    let localTime, localHour;
    try {
        localTime = now.toLocaleTimeString('en-US', {
            timeZone: tz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
        localHour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
    } catch { return ''; }

    // Work-hours heuristic: 🟢 8-18, 🟡 7-8 or 18-20, 🔴 otherwise
    const isGreen  = localHour >= 8  && localHour < 18;
    const isYellow = (localHour >= 7 && localHour < 8) || (localHour >= 18 && localHour < 20);
    const dot      = isGreen ? '🟢' : isYellow ? '🟡' : '🔴';
    const hint     = isGreen  ? 'Business hours'
                   : isYellow ? 'Early/late — use discretion'
                   : 'Outside office hours — avoid calling';

    const badgeId = `tz-badge-${Math.random().toString(36).slice(2, 7)}`;

    return `<span class="phone-tz-badge" id="${badgeId}" data-tz="${tz}" title="${hint} · ${label}"
        style="display:inline-flex;align-items:center;gap:3px;font-size:0.72rem;
               font-weight:500;color:var(--text-muted);margin-left:6px;
               background:var(--bg-secondary);border:1px solid var(--border-color);
               border-radius:8px;padding:1px 6px;cursor:default;white-space:nowrap;">
        ${dot} <span class="tz-time">${localTime}</span>
    </span>`;
}

/**
 * Wire live-updating clock badges in a container.
 * Call once per render; clears on navigation via MutationObserver disconnect.
 * @param {Element} container
 * @returns {() => void} cleanup function
 */
export function initPhoneTimeBadges(container) {
    if (!container) return () => {};

    const tick = () => {
        container.querySelectorAll('.phone-tz-badge').forEach(badge => {
            const tz = badge.dataset.tz;
            if (!tz) return;
            try {
                const timeEl = badge.querySelector('.tz-time');
                if (!timeEl) return;
                const now = new Date();
                timeEl.textContent = now.toLocaleTimeString('en-US', {
                    timeZone: tz,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                });
                // Update dot
                const hour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
                const dot = badge.firstChild;
                const newDot = hour >= 8 && hour < 18 ? '🟢' : (hour >= 7 || hour < 20) ? '🟡' : '🔴';
                if (dot && dot.nodeType === 3) dot.textContent = `${newDot} `;
            } catch { /* silent */ }
        });
    };

    const interval = setInterval(tick, 30_000); // update every 30s

    // Auto-cleanup when the container is removed from DOM
    const observer = new MutationObserver(() => {
        if (!document.contains(container)) {
            clearInterval(interval);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: false });

    return () => { clearInterval(interval); observer.disconnect(); };
}
