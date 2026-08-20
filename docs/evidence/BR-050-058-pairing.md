# BR-050–BR-058 pairing and companion evidence

Local evidence for the ChatGPT Sites-targeted implementation. This note does
not contain raw pairing codes, URL tokens, device tokens, credentials, or
profile data from a runtime environment.

## Covered behavior

- Pairing creates a six-digit manual code and an independent 32-byte URL token;
  only protected HMAC values are stored in `pairing_codes`.
- Challenge creation is parent-owned and household/profile scoped. Existing
  active challenges for that profile are cancelled in the same D1 batch as the
  replacement insert.
- Preview and consumption enforce the server expiry, eligibility flag,
  non-under-13 age band, archived state, one-use transition, and five-attempt
  lock. Wrong code with a valid URL token increments the challenge atomically.
- Challenge consumption and `child_devices` creation use a D1 batch with a
  transaction-local `changes()` guard. A non-batched adapter fails closed before
  consuming a challenge; Sites D1 is the required atomic path.
- Code-only manual verification attempts consume five-attempt, ten-minute D1
  buckets for both the Cloudflare edge source and a server-issued browser
  bucket cookie. The source key uses only `CF-Connecting-IP`; browser-supplied
  `X-Forwarded-For` is never trusted. QR/token requests use the challenge's
  own one-use and wrong-attempt state. A successful code-only preview also
  mints a two-minute, signed HttpOnly handoff bound to that browser bucket so
  confirmation after the fifth permitted attempt does not become a sixth
  guess; direct confirmation without the handoff remains source-limited.
- The parent manager renders a QR generated locally by the bundled `qrcode`
  encoder as an inert SVG data URL. It contains only the short-lived pairing
  URL token; the companion page does not render a duplicate QR.
- Companion cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax, opaque,
  and profile-scoped. Every companion request re-resolves the device row and
  checks expiry/revocation before reading data; last-active writes are
  throttled.
- Companion Today and Rewards queries use only the resolved device household
  and profile scope. Parent device rename, revoke, and replacement actions
  require parent context plus same-origin double-submit CSRF.
- Authenticated API responses use private/no-store headers, pairing responses
  additionally use `Referrer-Policy: no-referrer`, and pairing errors remain
  generic.

## Checks

```text
npx tsx --test tests/g05-pairing.test.ts       PASS (16 tests)
npm run quality                              PASS
npm run db:generate                          PASS (no schema changes)
Playwright, 360 x 800                        PASS
axe WCAG 2 A/AA + 2.1 A/AA                   PASS (0 violations)
reduced-motion emulation                     PASS
```

The focused tests cover protected storage, replacement/cancel, expiry,
five-attempt challenge and source/browser locking (including unknown codes),
concurrent one-device consumption and the non-batched fail-closed path, parent
route CSRF and under-13 denial, generic profile confirmation, parent/companion
authorization boundaries, Today/Rewards sibling isolation, retained-cookie
revocation, immutable profile scope, last-seen throttling, private headers,
and the bundled QR contract.

The clean browser run created a parent-owned challenge, rendered a real local
QR image and authoritative countdown without horizontal overflow, opened the
token pairing path in a separate browser context, disclosed only the selected
nickname and emoji, and atomically linked the device. The resulting companion
session landed on Today, exposed only Today and Rewards, showed only the assigned
profile's task and balance, and had no console warnings or errors. Parent-side
rename and revoke were then exercised; the companion's next request redirected
to `/pair` while its opaque cookie was still retained. Parent and companion
pages had zero axe violations at 360 px. Reduced-motion emulation activated the
global near-zero animation/transition rule. QR camera scanning and the secure
cookie on the saved Sites origin remain release-level checks in G10 rather than
feature implementation blockers.
