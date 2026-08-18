# G02 parent TAC authentication evidence

Status: local implementation and security verification complete. A real
provider credential and verified sender are still required before a saved Sites
version can send production sign-in mail; no public deployment was performed.

## Implemented boundary

- `server/tac.ts` generates a uniform six-digit TAC with Web Crypto, binds its
  HMAC to purpose/email/challenge id, stores only the protected value, expires
  it after ten minutes, invalidates the previous active challenge, increments
  failed attempts atomically, locks on attempt five, and consumes once.
- `server/auth-service.ts` applies three D1-backed buckets: five requests per
  normalized email per hour, three per normalized email/source pair per 15
  minutes, and twenty per source per 15 minutes. The public request body stays
  neutral for registered and unregistered addresses.
- `server/email-adapter.ts` retains the server-only Resend HTTP adapter and now
  exposes an injectable deterministic adapter for tests. Provider responses,
  credentials, raw TACs, and recipient data are not logged or returned.
- `/api/auth/request` bootstraps CSRF on `GET` and requests a TAC on `POST`.
  `/api/auth/verify` verifies it and sets a parent session. The sign-out route
  revokes the D1 session before clearing the cookie. State-changing routes
  enforce the existing same-origin/double-submit CSRF policy and private
  no-store response headers.
- Parent sessions use a random opaque token, only its HMAC in D1, a `__Host-`
  Secure/HttpOnly/SameSite cookie, a 30-day expiry, conditional last-seen
  writes, and server-side revocation. `resolveParentSession` supports the
  authenticated-but-not-yet-onboarded account state without granting a
  household scope.
- The landing page includes a mobile-first email/code flow with numeric input,
  live feedback, focus-visible controls, a success state, and reduced-motion
  support. Browser email/code values are never authorization evidence.

## Local verification

```text
npm run quality
npm run db:generate
```

The G02 unit suite (`tests/g02-auth.test.ts`) covers protected storage,
normalization and context binding, expiry, one-use/replacement behavior, five
failed attempts and locking, concurrent verification, second-device household
resolution, neutral route responses, rate-limit reset, CSRF/origin checks,
session cookie flags, reload resolution, and server revocation.

The parent auth panel was also exercised in a real Chromium browser at a
360×800 viewport. Its semantic snapshot exposed labeled email and TAC controls,
the document width matched the viewport with no horizontal overflow, and
`prefers-reduced-motion: reduce` reduced animation duration to effectively
zero. With production credentials intentionally absent locally, the submit
path failed closed and displayed a generic parent-safe error.

Request-source rate limiting trusts only Cloudflare's edge-owned
`CF-Connecting-IP` header. Browser-supplied `X-Forwarded-For` values are ignored
and collapse into the conservative `unknown` bucket when the edge header is
absent.

## Required live Sites validation

Before accepting a saved version as production-ready, configure these exact
server-only variables in Sites: `EMAIL_API_URL=https://api.resend.com/emails`,
`EMAIL_API_KEY` as a real Resend API key with email-send permission, and
`EMAIL_FROM` as the exact sender address/domain verified in the Resend account.
Keep `AUTH_HMAC_SECRET` and `SESSION_SECRET` as independently generated,
high-entropy Sites secrets. From the saved Sites origin, submit a test TAC to a
controlled parent address and verify that Resend returns a successful send and
the message arrives; then verify a real code, confirm reload/session behavior,
and confirm sign-out rejects the old cookie. Record only status/timestamps and
redacted provider metadata—never a code, token, recipient address, or secret.
