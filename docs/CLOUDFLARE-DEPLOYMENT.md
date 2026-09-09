# Cloudflare deployment

Ruutin uses native Cloudflare Workers with Static Assets and D1.

| Environment | Worker | D1 database | Public endpoint |
| --- | --- | --- | --- |
| Staging | `ruutin-staging` | `ruutin-staging` | `https://ruutin-staging.m-irwan.workers.dev` |
| Production | `ruutin` | `ruutin-production` | `https://ruutin.irwan.cc` |

Production household data must never be copied to staging. The legacy Sites
project remains the rollback source until the migration has been accepted.

## Required configuration

Non-secret variables live in `wrangler.jsonc`. Set each secret separately in
both environments:

```bash
npx wrangler secret put EMAIL_API_KEY --env staging
npx wrangler secret put AUTH_HMAC_SECRET --env staging
npx wrangler secret put SESSION_SECRET --env staging

npx wrangler secret put EMAIL_API_KEY --env production
npx wrangler secret put AUTH_HMAC_SECRET --env production
npx wrangler secret put SESSION_SECRET --env production
```

Reusing the previous `AUTH_HMAC_SECRET` and `SESSION_SECRET` preserves valid
authentication material. Rotating either value intentionally invalidates the
corresponding outstanding codes or sessions.

## Manual release

Use Node.js 22 or newer. Apply migrations before deployment:

```bash
npm ci
npm run quality
npm run db:migrate:production
npm run deploy:production
```

Verify `/`, `/api/health/d1`, static assets, authentication, one authorized
database write/read flow, private `Cache-Control` headers, and Worker logs.

## GitHub Actions

Add repository secrets `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. The token should be scoped to this account with only
the permissions needed to deploy Workers, upload Static Assets, and apply D1
migrations. Pull requests run verification only; pushes to `main` deploy.

## Rollback

Cloudflare Worker deployments retain version history for code rollback. During
the migration window, the original Sites project and database are left intact.
If rollback is required, restore the previous Worker version or reattach the
custom domain to Sites. Reconcile any writes accepted after cutover before
switching databases; do not overwrite either copy blindly.
