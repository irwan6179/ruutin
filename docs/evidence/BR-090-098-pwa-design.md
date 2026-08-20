# BR-090–BR-098 — PWA, synchronization, design, and accessibility evidence

This note records the bounded G09 release checks. It contains no session,
pairing, device, or parent identity values.

## Manifest and install metadata

- `public/manifest.webmanifest` declares the parent/product install identity as
  `/`, uses `standalone` display, portrait orientation, the Ruutin theme and
  background colors, and starts at `/`.
- `public/companion.webmanifest` declares a separate `/companion` install
  identity and starts at `/companion/today`. Companion routes override the
  root manifest through nested metadata. Its `/` scope keeps the safe `/pair`
  fallback inside standalone mode when an iPhone does not transfer the
  existing companion cookie.
- The manifest references valid PNG assets at 192×192, 512×512, and 512×512
  maskable sizes. `public/apple-touch-icon.png` is 180×180 for iPhone Safari.
- `app/layout.tsx` emits the manifest, PNG icon links, Apple touch icon,
  `viewport-fit=cover`, device-width metadata, and the theme color.

## Install guidance and service-worker decision

- After pairing, `/companion/today` renders the exact message: “Save Ruutin to
  this device's home screen for easier access.” The companion can reopen the
  iPhone Safari/Chrome and common Android browser steps with “How to save”;
  the guidance tells users to remove an older icon before reinstalling and to
  pair with a fresh code inside the saved app if cookie transfer is unavailable.
- `InstallGuidance` detects `display-mode: standalone` and iPhone Safari's
  `navigator.standalone` signal without changing the server-rendered snapshot.
- The Sites origin accepted the disposable capability probe in BR-004, but
  Ruutin deliberately ships no application service worker or offline cache.
  The probe worker is scoped to `/runtime-probe/`, has no fetch handler or
  Cache Storage access, and unregisters in `finally`. No stale app worker is
  present to preserve revoked access. Authenticated HTML/API/TAC/pairing and
  mutation responses therefore stay on the normal private network path.

## Synchronization and UI checks

- Parent Today, Parent Rewards, Companion Today, and Companion Rewards refetch
  after mutations, refresh on foreground return, and expose a manual Refresh
  action. No WebSocket, background queue, or always-on polling was added.
- All existing mutation feedback uses brief transform/opacity motion and the
  global `prefers-reduced-motion` guard. The install guidance and refresh
  action preserve keyboard focus and safe-area padding.

## Verification

```text
Manifest/assets validation                         PASS
npm run quality                                   PASS
npm run db:generate                               PASS (no schema changes)
git diff --check                                  PASS
```

Lean browser matrix on the local Ruutin flow:

| Surface | Viewport | Result |
| --- | --- | --- |
| Companion Today after pairing | 360×800 | exact save message, reopenable guidance, no overflow |
| Companion Rewards | 360×800 | Refresh action, request/history state, no overflow |
| Parent Today | 360×800 | Refresh action, approvals, no overflow |
| Parent Rewards | 360×800 | Refresh action, catalogue/history, no overflow |
| Pairing page | 360×800 | existing URL/manual flow remains usable |

Sites-origin-only gates remaining for G10 are a fresh saved-version manifest
and custom-domain check on `https://ruutin.irwan.cc`, plus production runtime
configuration/email delivery. No PWA offline behavior is a release gate for
this online-first Sites decision.
