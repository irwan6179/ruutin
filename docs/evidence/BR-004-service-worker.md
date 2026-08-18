# BR-004 — Service-worker capability probe

Status: disposable local probe implemented; Sites-origin support is unverified.

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

## Sites verification still required

On the saved/published Sites origin, open `/runtime-probe` in a supported
browser and record the displayed state (supported, unsupported, or registration
failure), timestamp, and origin here. Confirm that registration is scoped to
`/runtime-probe/`, is unregistered after the probe, and that no new Cache
Storage entry appears. If the Sites origin reports unsupported, retain the
manifest/icons/install guidance and do not add offline caching or change hosts.
