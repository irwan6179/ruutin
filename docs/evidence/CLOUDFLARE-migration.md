# Cloudflare migration evidence

Date: 2026-09-09

## Result

- Production Worker: `ruutin`
- Staging Worker: `ruutin-staging`
- Production domain: `https://ruutin.irwan.cc`
- Production D1: `ruutin-production`
- Staging D1: `ruutin-staging`
- Legacy Sites project and database retained without the custom domain for rollback

The final Sites database snapshot was copied to production D1 after writes to
the legacy custom domain were stopped. A two-hash canonical comparison found
all 152 rows exact across all 16 application tables, with no foreign-key
violations. Production data was not copied to staging.

## Verification

- `npm run quality`: passed (127 unit tests and 3 render tests)
- Local clean migration replay: passed
- Remote staging and production migrations: passed
- Staging and production `/api/health/d1`: HTTP 200, base migration applied
- Production homepage and static asset: HTTP 200
- Protected `/app` without a session: redirects as expected
- Live-domain TAC email request: HTTP 202 through the verified Resend domain
- Live-domain TAC verification and authenticated `/app/today`: HTTP 200
- Representative profiles, tasks, and rewards reads: HTTP 200
- Private API caching: `no-store, must-revalidate`
- Production D1 write/read/delete probe: passed with no retained probe row
- Secret/client bundle scan: passed
- Fresh pre-cutover production D1 SQL export created outside the repository
- Scoped Cloudflare API token and Resend sending key installed without storing
  their values in the repository
- GitHub Actions repository secrets configured for Wrangler deployments

## Cutover state

The Sites custom-domain attachment and its obsolete DNS verification records
were removed. Cloudflare Workers now owns `ruutin.irwan.cc`; the Sites project
and source database remain available as a rollback source.
