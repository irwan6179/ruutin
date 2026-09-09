# Ruutin

Ruutin is a parent-first routine and reward space for real homes. The name is a
wordplay on the Bahasa Malaysia word “rutin.” The public entry is intentionally
calm, light, and mobile-first: parents can
understand the product, review the privacy approach, and enter the email
one-time-code sign-in flow from one page.

The application runs as a native Cloudflare Worker with Static Assets and D1.
Production is served from `ruutin.irwan.cc`; staging uses a separate Worker and
database so production household data is not copied into test environments.

## Prerequisites

- Node.js `>=22.13.0`
- npm (the repository uses `package-lock.json`)

## Local development

```bash
npm ci
npm run dev
```

The local Cloudflare binding simulation is configured by `wrangler.jsonc` and
`vite.config.ts`.
The public landing page does not require secrets. Server capabilities must use
the typed loader in `server/config.ts` and fail closed when required hosted
configuration is missing.

Open `/signin` on the `Local` URL printed by the dev server
(`http://localhost:3100` by default) and choose **Enter demo parent space** for a one-click
authenticated preview with sample household data. The demo entry is enabled
only by `vite dev`, accepts loopback or the explicitly configured private
Tailnet HTTPS hostname, and is omitted from production build configuration. To
use it from another Tailnet device, add your own hostname and local-only values
to the ignored `.env.local` file; never commit that file. It does not send
email. Use the normal email-code form with real `.dev.vars` credentials when
testing delivery.

For a persistent OrbStack preview that restarts independently of the terminal:

```bash
npm run local:up
```

The container publishes `http://localhost:3100`, watches the working tree for
changes, and keeps Miniflare's local data under `.wrangler`. Use
`npm run local:logs` to follow its output and `npm run local:down` to stop it.

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

`.env.example` documents the names expected by the Worker. Copy it only for
local reference; never commit real `.env` files or values. These variables are
server-only and must never use a `NEXT_PUBLIC_` prefix:

- `EMAIL_API_URL`
- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `AUTH_HMAC_SECRET`
- `SESSION_SECRET`

The full development contract and data-minimization rules are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). Cloudflare operations and rollback
are documented in [`docs/CLOUDFLARE-DEPLOYMENT.md`](docs/CLOUDFLARE-DEPLOYMENT.md).
Work is tracked in [`TASKS.md`](TASKS.md).

## Deployment

```bash
npm run db:migrate:staging
npm run deploy:staging

npm run db:migrate:production
npm run deploy:production
```

Set `EMAIL_API_KEY`, `AUTH_HMAC_SECRET`, and `SESSION_SECRET` with
`wrangler secret put --env <environment>`; never store their values in GitHub
or Wrangler configuration. Pushes to `main` verify and deploy production after
the two Cloudflare GitHub secrets described in the deployment guide are set.
