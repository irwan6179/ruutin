# BR-100–BR-102 — authorization, companion isolation, and secret audit

Status: complete for the locally testable server/security surface. No Sites
browser or production telemetry inspection was performed in this pass.

## BR-100 — parent household and role scope

- `tests/g10-security.test.ts` seeds two households, three profiles, tasks,
  claims, rewards, reward requests, ledger entries, devices, and a parent
  session. It exercises parent profile, task, device, pairing, Today,
  household/onboarding, claim, completion, ledger, reward, active-reward,
  reward-request, settings, and export handlers with foreign household/profile,
  task, claim, reward, request, and device identifiers.
- Parent list responses contain only the authenticated household. Foreign and
  stale identifiers return generic non-enumerating errors without names,
  household IDs, emails, or hash field names. Settings/export remain private,
  no-store, and referrer-safe; export contains no auth, pairing, or token
  material.
- Parent-only service predicates now require both `context.role === "parent"`
  and a matching parent membership for the resolved household. This covers
  profiles, tasks, devices, shared scoped reads, Today onboarding counts,
  household reads, and settings/deletion operations even if a forged or stale
  context reaches a service boundary. Existing reward, claim, and pairing
  services already had the equivalent guard.

## BR-101 — companion isolation and revocation

- A companion cookie resolves one device/profile assignment from D1. Today,
  Rewards, reward requests, and claims expose only `p1` data; sibling `p2` and
  foreign `p3` identifiers are rejected without disclosure.
- Parent cookies cannot call companion endpoints, and companion cookies cannot
  call parent Today/settings endpoints. Device revocation and expiry are
  rechecked on the next request, so a retained cookie receives `401` after
  either state change.
- The test verifies the profile assignment cannot be moved by a database
  update (the immutable trigger rejects it) and verifies `last_seen_at` is
  written once after the five-minute threshold, then remains unchanged during
  the throttle window.

## BR-102 — abuse, secrets, cookies, and headers

- Sign-in requests for known and unknown valid emails return the same neutral
  response. TACs are six digits, HMAC-bound and hash-only in D1, expire by
  server time, lock after exactly five wrong attempts, and cannot be reused.
- Pairing stores only code/token hashes, keeps the high-entropy token out of
  errors and preview responses, uses the server-authoritative expiry and
  one-use transition, and refuses to consume without D1 batch support.
  Unknown manual codes are bounded by the D1 source bucket; the test supplies
  changing `X-Forwarded-For` values without `CF-Connecting-IP` and confirms
  they remain one conservative source bucket. Pair responses use
  `Referrer-Policy: no-referrer` and private/no-store headers.
- Deletion TAC responses remain generic and do not return the code, challenge
  ID, email, or reauthentication marker. The fresh marker is Secure,
  HttpOnly, SameSite=Strict, and a consumed code cannot be verified again.
- Parent/companion session cookies are opaque `__Host-` cookies with Secure,
  HttpOnly, SameSite protection. Client-surface source inspection finds no
  server secret names, API keys, hash columns, or local-storage credential
  transport. Error mapping/log context remains sanitized by the existing
  `server/error-safety.ts` boundary.

## Verification

```text
npx tsx --test tests/g10-security.test.ts  PASS (6 tests)
npm run test:unit                         PASS (109 tests)
npm test                                   PASS (109 unit + 2 render tests)
npx tsc --noEmit                          PASS
npx eslint tests/g10-security.test.ts server/scoped-data.ts server/profiles.ts server/tasks.ts server/devices.ts server/households.ts server/settings.ts server/today.ts  PASS
npm run quality                           BLOCKED by pre-existing onboarding lint error
npm run db:generate                       PASS (no schema changes)
git diff --check                          PASS
```

The focused and full unit checks run against SQLite/D1-shaped adapters,
including batched transaction behavior. Browser/Sites verification of secure
deployment cookies, edge logging, and final production bundle inspection
remains an operational follow-up; no tracker item should be represented as
browser-verified solely from this local evidence. The quality command reached
the repository lint phase but stopped at the unrelated shared-worktree change
in `app/app/onboarding/OnboardingFlow.tsx:66` (`react-hooks/set-state-in-effect`);
the G10 files pass targeted lint and typecheck.
