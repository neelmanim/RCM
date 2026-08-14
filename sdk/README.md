# RCM Dialer SDK

> Drop-in embeddable dialer widget. One `<script>` tag. No framework, no bundler.

---

## Quick Start (5 minutes)

### 1 · Add to your page

```html
<!-- In <head> -->
<link  rel="stylesheet" href="https://your-cdn.com/rcm-dialer-sdk.css"/>
<script src="https://your-cdn.com/rcm-dialer-sdk.js"></script>

<!-- Optional: LiveKit (only needed for browser audio calls) -->
<script src="https://cdn.jsdelivr.net/npm/livekit-client@2.9.1/dist/livekit-client.umd.min.js"></script>
```

### 2 · Mount the widget

```js
RCMDialer.mount({
  callStartUrl:  '/dialer/call/start',  // your proxy endpoint
  callActionUrl: '/dialer/call/action',
  disconnectUrl: '/dialer/call/end',
  eventsUrl:     '/dialer/events',      // SSE endpoint
});
```

### 3 · Call from anywhere

```js
// Opens the dialer + calls the number immediately
RCMDialer.call({
  phone:       '+919876543210',
  contactName: 'Priya Sharma',
  callMode:    'browser',   // 'browser' | 'bridge'
});
```

---

## API Reference

### `RCMDialer.mount(config)`

Mounts the widget. Must be called before `.call()`.

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `callStartUrl` | string | ✅ | — | `POST` → initiates call |
| `callActionUrl` | string | ✅ | — | `POST` → mute/hold/resume |
| `disconnectUrl` | string | ✅ | — | `POST` → ends call |
| `eventsUrl` | string | — | — | `GET` → SSE stream for real-time status |
| `container` | string | — | `document.body` | CSS selector for host element |
| `theme` | `'light'` \| `'dark'` | — | `'light'` | Widget colour scheme |
| `position` | `'bottom-right'` \| `'bottom-left'` | — | `'bottom-right'` | FAB position |
| `headers` | object | — | `{}` | Extra HTTP headers on all proxy calls |

---

### `RCMDialer.call(opts)`

Starts a call programmatically (opens widget + dials).

| Option | Type | Required | Default |
|--------|------|----------|---------|
| `phone` | string | ✅ | — |
| `contactName` | string | — | `''` |
| `callMode` | `'browser'` \| `'bridge'` | — | `'browser'` |

---

### `RCMDialer.on(event, handler)`

Subscribe to SDK events.

| Event | Payload | When |
|-------|---------|------|
| `call.started` | `{ callId, phone, contactName, callMode }` | Backend confirmed call started |
| `call.answered` | `{ callId }` | Remote party answered |
| `call.ended` | `{ phone, contactName, duration }` | Call finished |
| `call.error` | `{ error, phone }` | Call failed to start or connect |

```js
RCMDialer.on('call.ended', ({ phone, duration }) => {
  console.log(`Call to ${phone} lasted ${duration}s`);
  showOutcomeModal();
});
```

---

### `RCMDialer.off(event, handler)`

Unsubscribe from an event.

---

### `RCMDialer.unmount()`

Removes the widget from the DOM and disconnects all active calls.

---

## Backend Proxy Setup

The SDK **never talks to RCM directly** — all API calls go through your backend proxy. This keeps your RCM API key secure.

### Deploy the reference proxy

```bash
cd sdk/proxy-reference
pip install -r requirements.txt
cp .env.example .env    # fill in your RCM credentials
uvicorn main:app --host 0.0.0.0 --port 8001
```

### Proxy routes summary

| Method | Path | Action |
|--------|------|--------|
| `POST` | `/dialer/call/start` | Initiate call → returns `{ call_id, livekit_token, livekit_url, room_name }` |
| `POST` | `/dialer/call/action` | Mute / hold / resume |
| `POST` | `/dialer/call/end` | Disconnect call |
| `POST` | `/dialer/webhook` | RCM status webhook (optional) |
| `GET`  | `/dialer/events` | SSE stream for browser |

### Proxy response contract (`POST /dialer/call/start`)

The SDK reads these fields from the response:

```json
{
  "call_id":       "rcm-call-uuid",
  "livekit_token": "eyJ...",
  "livekit_url":   "wss://livekit.bercm.com",
  "room_name":     "room-uuid"
}
```

> **`livekit_token` / `livekit_url`** are only required for Browser Call mode. Phone Bridge mode works without them.

---

## Real-time Status Delivery

The SDK receives call status updates via **SSE (`eventsUrl`)**.

Two delivery mechanisms are available — use whichever fits your setup:

### Option A — Background Poller (default, no config needed)
The reference proxy polls RCM's `GET /calls/{id}/status` every 2 seconds and pushes events into the SSE broker. Works out of the box. ≈2s latency.

### Option B — RCM Webhooks (instant, requires onboarding)
Ask RCM support to configure `POST /dialer/webhook` as the webhook URL for your account. The webhook receiver validates the signature and fans the event to all SSE subscribers instantly.

> **Note:** RCM webhooks require a one-time configuration with RCM's support team. If your account does not have webhooks configured, the background poller provides equivalent delivery.

---

## CSS Customisation

Override CSS custom properties to match your brand:

```css
:root {
  --cd-primary:    #4f46e5;   /* active tab underline, FAB, timer, focus ring */
  --cd-primary-h:  #4338ca;   /* hover shade */
  --cd-bg:         #ffffff;   /* panel background */
  --cd-surface:    #f8fafc;   /* mode button background */
  --cd-border:     #e2e8f0;   /* borders */
  --cd-text:       #0f172a;   /* body text */
  --cd-text-muted: #64748b;   /* labels, hints */
  --cd-radius:     16px;      /* panel corner radius */
}
```

---

## Architecture Diagram

```
Browser                   Your Backend Proxy          RCM API
───────                   ──────────────────          ──────────────
RCMDialer.call()
  │
  ├─── POST /dialer/call/start ──────────────► POST /calls/initiate
  │                              ◄───────────  { call_id, lk_token, lk_url }
  │
  ├─── EventSource /dialer/events ──────────── (SSE, persists)
  │                                │
  │                                │  RCM webhook ──► /dialer/webhook
  │                                │  OR poller polls GET /calls/{id}/status
  │                                └────────────────────────► SSE fan-out
  │
  ├─── (browser audio)
  │    wss://livekit.bercm.com ──────── (direct — LiveKit CDN)
  │
  └─── POST /dialer/call/end ───────────────► POST /calls/disconnect
```

---

## Security

| Concern | Mitigated by |
|---------|-------------|
| API key exposure | Key lives only on your proxy — never sent to browser |
| CORS | Set `ALLOWED_ORIGINS` in proxy `.env` to your frontend domain |
| Webhook tampering | HMAC signature validation via `RCM_WEBHOOK_SECRET` |
| Replay attacks | Signature covers full request body |

---

## Files

```
sdk/
├── rcm-dialer-sdk.js    ← Main SDK bundle (RCMDialer global)
├── rcm-dialer-sdk.css   ← Widget styles
├── proxy-reference/
│   ├── main.py                 ← FastAPI proxy (5 routes)
│   ├── sse_broker.py           ← In-memory SSE pub/sub
│   ├── poller.py               ← Background call status polling
│   ├── requirements.txt
│   └── .env.example
├── demo/
│   └── index.html              ← Standalone demo (open in browser)
└── tests/
    └── test_sdk_proxy.py       ← Proxy test suite (18 tests)
```

---

## Changelog

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | 2026-05-29 | Initial release — light theme, RCM palette |
