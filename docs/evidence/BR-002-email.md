# BR-002 — Server-side email API reachability

Status: bounded server-side scaffolding is present; hosted credentials and
Sites-runtime verification are still pending. BR-002 remains unchecked in
`TASKS.md`.

## Implementation

- `server/email-adapter.ts` is a server-only Web Platform adapter for the
  Resend HTTPS API contract. It reads only `EMAIL_API_URL`, `EMAIL_API_KEY`,
  and `EMAIL_FROM`, sends a `POST` with `Authorization: Bearer ...`, JSON
  `from`/`to`/`subject`/`text`, and an `AbortController` timeout. The Sites
  runtime supplies its outbound `User-Agent`; application code does not try to
  override that runtime-controlled header. It does not import a Node SDK or log credentials,
  message content, recipient addresses, provider response bodies, or error
  causes.
- `server/email-probe.ts` contains framework-free guards for the temporary
  probe configuration and exact Bearer-secret check.
- `app/api/runtime-probe/email/route.ts` exposes the temporary probe as a
  `POST` route. It sends only a static reachability message and is disabled
  with a generic no-store response unless both server-only
  `EMAIL_PROBE_TO` and `RUNTIME_PROBE_SECRET` are present. Missing provider
  configuration, timeouts, and network errors produce generic responses. A
  guarded `provider_rejected` category contains no provider body/status or
  request data and exists only to prove the Sites runtime reached Resend.
- The existing `.openai/hosting.json` project ID and logical `DB` binding were
  not changed. No deployment was performed, and TAC authentication was not
  implemented.

The request shape follows Resend's documented direct HTTP API: HTTPS endpoint,
Bearer authorization, required `from`/`to`/`subject`, and plain-text `text`.
See [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
and [Resend API authentication/User-Agent requirements](https://resend.com/docs/api-reference/introduction).

## Local checks

These checks use a fake `fetch` implementation for the adapter and do not send
email or prove hosted reachability:

```text
npx tsc --noEmit
npx tsx --test tests/email-adapter.test.ts
npm run lint
npm run build
```

Expected results are a clean typecheck, six passing adapter/probe unit tests,
clean lint, and a successful Sites/Cloudflare Worker build with the temporary
route included. The local tests assert the POST method, Bearer header, JSON
shape, HTTPS-only configuration, timeout mapping, sanitized errors,
fail-closed probe variables, and exact Bearer-secret guard.

## Exact hosted verification still required

Do these steps only when a parent agent/user authorizes a saved Sites-version
runtime check. Do not paste secrets into this evidence file, shell history,
browser URLs, request bodies, screenshots, or logs.

1. Save the current source in the existing Sites project
   `appgprj_6a843d7213f48191a018dcd53f819afb`; retain the logical D1 binding
   `DB`. Do not create another project or change `.openai/hosting.json`.
2. In Sites server-only runtime configuration, set
   `EMAIL_API_URL=https://api.resend.com/emails`, a Resend `EMAIL_API_KEY`, and
   a verified `EMAIL_FROM`. For this disposable check only, set a controlled
   `EMAIL_PROBE_TO` recipient and a high-entropy `RUNTIME_PROBE_SECRET`.
3. From a controlled HTTPS client, issue one `POST` to
   `/api/runtime-probe/email` with `Authorization: Bearer <temporary-secret>`.
   Do not include a request body. Record only timestamp, saved-origin host,
   HTTP status, and redacted response/cache headers. A delivery-capable result
   is HTTP 200 with `{"ok":true}`. For the narrower runtime reachability gate,
   a 502 `{"error":"provider_rejected"}` produced with a deliberately invalid
   temporary credential proves that Sites completed an HTTPS exchange with
   Resend without exposing the credential. Both responses must include
   `Cache-Control: no-store, private`.
4. Verify fail-closed behavior without sending mail: omit the Authorization
   header, use a wrong Bearer value, use `GET`, and repeat with either probe
   variable removed. Responses must remain generic/no-store, and none of
   these requests may reach the email provider. Do not record the secret or
   recipient address in evidence.
5. If the provider call fails in the saved Sites runtime, record the redacted
   status/category as a blocked BR-002 result and stop. Do not move hosting,
   add another provider, or substitute Sign in with ChatGPT.
6. Immediately after verification (success or failure), remove the temporary
   `EMAIL_PROBE_TO` and `RUNTIME_PROBE_SECRET` values. Disable the probe route
   by deleting `app/api/runtime-probe/email/route.ts` and
   `server/email-probe.ts` after preserving the redacted evidence; remove any
   adapter code that is not needed by the later BR-022 transactional adapter,
   or explicitly hand it forward to BR-022 after review. Rebuild the saved
   version and confirm no probe route remains.
7. Re-run the secret/client-bundle audit and confirm no provider key,
   temporary secret, raw TAC, or probe recipient appears in source, built
   assets, HTML, logs, or evidence. Only then may the parent agent review the
   BR-002 checkbox; this scaffolding does not mark it complete by itself.
