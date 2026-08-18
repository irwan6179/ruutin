# BR-105 — source acceptance matrix

Status: **local source/integration matrix prepared; live Sites/email gates
pending**

This matrix maps AC-01–AC-30 to the local evidence available on the current
working tree. `PASS (local)` means the D1-shaped unit/integration checks or the
bounded 360×800 browser run passed; it does not imply a production deployment
check. `PARTIAL` means the local behavior is deterministic but an external
provider/origin is still required. `PENDING` means that external check was
intentionally not performed.

| AC | Status | Source / observation |
| --- | --- | --- |
| AC-01 | PARTIAL | `tests/g02-auth.test.ts` auth-route tests and the deterministic local TAC request/verify in [BR-099 onboarding evidence](BR-099-onboarding.md); live Resend delivery and sender configuration remain pending. |
| AC-02 | PASS (local) | `tests/g02-auth.test.ts` — expired and reused TACs fail. |
| AC-03 | PASS (local) | `tests/g02-auth.test.ts` — a consumed TAC cannot be reused. |
| AC-04 | PASS (local) | `tests/g02-auth.test.ts` — exactly five wrong attempts lock the challenge. |
| AC-05 | PASS (local) | `tests/g02-auth.test.ts` — normalized identity/source request limits reset at the documented window. |
| AC-06 | PASS (local) | `tests/g02-auth.test.ts` — second-device login creates another session for the same parent household. |
| AC-07 | PASS (local) | `tests/g03-parent.test.ts` — multiple household profiles, including explicit age/consent mapping. |
| AC-08 | PASS (local + browser) | `tests/g04-tasks.test.ts` reviewed-draft persistence and the real template → schedule/stars review in [BR-099 onboarding evidence](BR-099-onboarding.md). |
| AC-09 | PASS (local + browser) | `tests/g05-pairing.test.ts` under-13 direct-route denial; the local Family card showed **Pairing unavailable for this profile**. |
| AC-10 | PASS (local) | `tests/g05-pairing.test.ts` — pairing expiry is server-authoritative at ten minutes. |
| AC-11 | PASS (local) | `tests/g05-pairing.test.ts` — concurrent challenge consumption creates one device and pairing is one-use. |
| AC-12 | PASS (local) | `tests/g05-pairing.test.ts` — Companion Today reads only its assigned profile’s due tasks. |
| AC-13 | PASS (local) | `tests/g05-pairing.test.ts` and `tests/g10-security.test.ts` — sibling/foreign companion data is rejected without disclosure. |
| AC-14 | PASS (local) | `tests/g05-pairing.test.ts` and `tests/g10-security.test.ts` — companion cookies cannot call parent-only routes. |
| AC-15 | PASS (local) | `tests/g06-claims.test.ts` — companion can submit a due completion claim and receives authoritative waiting state. |
| AC-16 | PASS (local) | `tests/g06-claims.test.ts` — duplicate claims are duplicate-safe. |
| AC-17 | PASS (local) | `tests/g06-claims.test.ts` — parent approval is one atomic ledger transition. |
| AC-18 | PASS (local) | `tests/g06-claims.test.ts` — repeated/concurrent approval awards exactly once. |
| AC-19 | PASS (local) | `tests/g06-claims.test.ts` — rejection has no ledger effect. |
| AC-20 | PASS (local) | `tests/g07-rewards.test.ts` — reward approval cannot produce a negative balance and fails closed without an atomic batch. |
| AC-21 | PASS (local) | `tests/g07-rewards.test.ts` — repeated/concurrent reward approval does not deduct twice. |
| AC-22 | PASS (local) | `tests/g05-pairing.test.ts` — revocation applies to a retained companion cookie on the next request. |
| AC-23 | PASS (local) | `tests/g10-security.test.ts` parent route matrix and scoped-service guard coverage; foreign identifiers return generic errors without data. |
| AC-24 | PASS (local + browser) | `tests/g02-auth.test.ts` session behavior plus the full reload/resume observation in [BR-099 onboarding evidence](BR-099-onboarding.md). |
| AC-25 | PASS (local) | `tests/g09-pwa.test.ts` refresh/foreground contracts and the existing Today/Rewards refetch implementations. |
| AC-26 | PENDING | `tests/g09-pwa.test.ts` validates local manifest/icon metadata, but a fresh saved-version check on the ChatGPT Sites origin was not run. |
| AC-27 | PASS (local + browser) | `tests/g09-pwa.test.ts` plus the 360×800 run: `scrollWidth=345` and no horizontal overflow. |
| AC-28 | PASS (local) | `tests/g09-pwa.test.ts` confirms the disposable capability probe has no app fetch handler or Cache Storage use. |
| AC-29 | PASS (local) | `tests/g10-security.test.ts` client source inspection and the repository secret scan; no server secret/raw credential transport is exposed in browser code. |
| AC-30 | PASS (local) | `tests/g09-pwa.test.ts`/source inspection: no R2 storage or upload feature is present. |

## Explicitly pending release gates

The following were deliberately not treated as passed from local evidence:

- Live Resend request/delivery, sender identity, provider credentials, and
  production email behavior for AC-01.
- ChatGPT Sites saved-origin verification for the manifest, icons, private
  response behavior, and final version for AC-26 and the related PWA checks.
- The custom domain `https://ruutin.irwan.cc`, DNS/HTTPS certificate, and
  custom-domain runtime behavior. No Sites deployment was made in this pass.
- The production security/runtime review, telemetry/logging review, and any
  live operational audit that depends on BR-100–BR-104 or BR-106 release work.

No release gate was silently waived, and `TASKS.md` was intentionally left
unchanged.

## Local command evidence

```text
npx tsx --test tests/g03-parent.test.ts  PASS (8 tests)
npm run quality                         PASS (109 unit + 2 render tests)
npm run db:generate                     PASS (no schema changes)
git diff --check                        PASS
```

The source matrix should only be promoted to a release claim after the
pending email/Sites/custom-domain checks are separately recorded.
