# BR-002 — Server-side email API reachability

Status: complete. The public Sites runtime reached the selected Resend API,
the temporary probe was removed, and BR-002 is checked in `TASKS.md`.

## Implementation

- `server/email-adapter.ts` is a server-only Web Platform adapter for the
  Resend HTTPS API contract. It reads only `EMAIL_API_URL`, `EMAIL_API_KEY`,
  and `EMAIL_FROM`, sends a `POST` with `Authorization: Bearer ...`, JSON
  `from`/`to`/`subject`/`text`, and an `AbortController` timeout. The Sites
  runtime supplies its outbound `User-Agent`; application code does not try to
  override that runtime-controlled header. It does not import a Node SDK or log credentials,
  message content, recipient addresses, provider response bodies, or error
  causes.
- The existing `.openai/hosting.json` project ID and logical `DB` binding were
  not changed. TAC authentication was not implemented by this preflight task.

The request shape follows Resend's documented direct HTTP API: HTTPS endpoint,
Bearer authorization, required `from`/`to`/`subject`, and plain-text `text`.
See [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
and [Resend API authentication/User-Agent requirements](https://resend.com/docs/api-reference/introduction).

## Local checks

These checks use a fake `fetch` implementation for the retained adapter:

```text
npx tsc --noEmit
npx tsx --test tests/email-adapter.test.ts
npm run lint
npm run build
```

Final cleanup results are a clean typecheck, four passing adapter unit tests,
clean lint, a successful Sites/Cloudflare Worker build, and no temporary email
probe route. The local tests assert the POST method, Bearer header, JSON shape,
HTTPS-only configuration, timeout mapping, and sanitized errors.

## Hosted verification

- Public origin: `https://ruutin.irwan.cc`
- Saved/deployed version: 8, deployment
  `appgdep_6a8445d1210c8191b5aaad9bba4126eb`
- Deployment completed: 2026-08-18 11:44 UTC
- Probe result: HTTP 502 with the sanitized category
  `{"error":"provider_rejected"}` and no provider body, status, credential,
  recipient, or message content.

The probe used a deliberately invalid temporary credential. Resend's provider
rejection proves the Sites Worker completed the outbound HTTPS exchange; a
pure transport failure would instead have returned the distinct sanitized
`transport_unavailable` category. No real authentication message was sent.

## Cleanup

- Deleted the temporary route and its probe guards.
- Removed temporary production probe variables and the deliberately invalid
  provider configuration from Sites.
- Retained only `server/email-adapter.ts` for BR-022.
- Re-ran build, tests, lint, typecheck, formatting, and the secret/client-bundle
  scan; all pass and no probe route remains.
