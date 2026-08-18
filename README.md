# Ruutin

Ruutin is a parent-first routine and reward space for real homes. The name is a
wordplay on the Bahasa Malaysia word “rutin.” The public entry is intentionally
calm, light, and mobile-first: parents can
understand the product, review the privacy approach, and enter the email
one-time-code sign-in flow from one page.

The site runs on ChatGPT Sites using the Sites-compatible vinext framework and
Cloudflare Worker output. ChatGPT Sites is the only supported deployment
target; do not add another hosting adapter.

## Prerequisites

- Node.js `>=22.13.0`
- npm (the repository uses `package-lock.json`)

## Local development

```bash
npm ci
npm run dev
```

The Sites starter's local binding simulation is configured in `vite.config.ts`.
The public landing page does not require secrets. Server capabilities must use
the typed loader in `server/config.ts` and fail closed when required hosted
configuration is missing.

## Quality commands

Run individual checks while iterating:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run scan:secrets
```

Run the baseline suite with one command:

```bash
npm run quality
```

`npm test` builds the Worker bundle and server-renders the parent landing
page. `npm run scan:secrets` checks client source and built output for
configured secret values and server-only configuration references. Formatting
is checked by the repository's dependency-free `scripts/check-format.mjs`.

## Configuration boundary

`.env.example` documents the names expected from ChatGPT Sites. Copy it only
for local reference; never commit real `.env` files or values. These variables
are server-only and must never use a `NEXT_PUBLIC_` prefix:

- `EMAIL_API_URL`
- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `AUTH_HMAC_SECRET`
- `SESSION_SECRET`

The full development contract, data minimization rules, and Sites runtime
gates are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). Work is tracked in
[`TASKS.md`](TASKS.md).
