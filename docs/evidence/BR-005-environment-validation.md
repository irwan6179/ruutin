# BR-005 environment validation evidence

Date: 2026-08-18

`server/runtime-config.ts` contains the typed, framework-independent
validation rules for `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`,
`AUTH_HMAC_SECRET`, and `SESSION_SECRET`. It validates non-empty values, HTTP(S)
API URLs, and sender email shape. Strict mode throws a sanitized error listing
only missing/invalid variable names. `server/config.ts` is the Cloudflare
Workers/Sites adapter and always resolves the server boundary in strict mode;
the public landing page does not import it.

The client boundary is checked by `scripts/scan-secrets.mjs`, which rejects
secret-key references or server-config imports in `app/` and scans built output
for configured secret values. `.env.example` contains placeholders only and is
the sole committed environment template.

Verified command:

```text
npm run scan:secrets
Secret/client-bundle scan passed (no configured secret values found).
```
