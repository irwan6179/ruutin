# BR-004 — Service-worker capability probe

Status: complete; the public ChatGPT Sites origin supports service workers.

## Implementation

- `app/runtime-probe/page.tsx` exposes a small `/runtime-probe` page for the
  saved-origin check without changing the landing page.
- `app/runtime-probe/ServiceWorkerProbe.tsx` registers the probe script only in
  the `/runtime-probe/` scope, reports whether registration was accepted, and
  unregisters it in `finally`.
- `public/sw-probe.js` has install/activate handlers only. It has no `fetch`
  handler and never opens Cache Storage, so authenticated HTML, private API
  responses, TAC/pairing responses, and mutations are not cached.

## Local checks

```text
npm run lint   -> passed
npm run build  -> passed; route listed as ? /runtime-probe
GET http://localhost:3000/runtime-probe -> HTTP 200
GET http://localhost:3000/sw-probe.js   -> HTTP 200, text/javascript
```

The local command-line checks confirm that the disposable page and script are
served. They do not establish browser service-worker support.

## Sites verification

Verified with a real Chromium session on 2026-08-18 at approximately 11:30 UTC:

```text
Origin: https://bintang-rumah.irwan-katsana.chatgpt.site
Page: /runtime-probe
Result: Supported
Accepted scope: /runtime-probe/
Registrations after probe cleanup: 0
Cache Storage names after probe: []
```

The disposable worker was accepted and then unregistered. It created no cache.
BR-092 may therefore implement immutable-static-asset caching later, subject to
the private-response exclusions in the development contract.
