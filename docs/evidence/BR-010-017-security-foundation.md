# G01 security foundation evidence

Status: implementation, local verification, and saved Sites migration execution
complete.

The versioned D1 sequence is:

- `0001_cool_lake.sql`: identity, households, authentication challenges,
  sessions, profiles, tasks, pairing/device records, claims, ledger, rewards,
  reward requests, and durable rate-limit buckets.
- `0002_old_ben_parker.sql`: active task-occurrence uniqueness.
- `0003_g01_integrity.sql`: cross-household/profile ownership triggers, state
  transitions, five-active-reward limit, immutable device assignment, and
  append-only ledger protection.

The server foundation is split into validation/data conventions,
cookie-derived parent and companion contexts, scoped D1 reads/mutations, CSRF
and origin checks, private response headers, sanitized error mapping, and a
key-serialized rate-limit store with a D1 adapter. Companion contexts expose
only the profile joined from the verified device row.

Verification run locally:

```text
npm run db:generate
npm run typecheck
npx tsx --test tests/g01-*.test.ts
```

The G01 tests cover D1 foreign keys/checks/unique indexes/triggers, hash-only
challenge/session/device columns, email normalization, IANA/DST local dates,
schedule and enum validation, expired/revoked session rejection, sibling and
cross-household scope rejection, CSRF/origin failures, private/no-store
headers, neutral error mapping, and concurrent rate-limit accounting.

No raw TAC, pairing code, session token, secret, or parent email is written to
this evidence file.

## Sites D1 verification

- Saved Sites version: 10
- Deployment: `appgdep_6a844f5e952c8191b8fae6c3e95a1289`
- Completed: 2026-08-18 12:26 UTC
- Binding: `DB`
- Result: all 15 expected tables are visible in the deployed D1 database:
  `auth_challenges`, `child_devices`, `child_profiles`, `household_users`,
  `households`, `pairing_codes`, `point_ledger`, `rate_limit_buckets`,
  `reward_requests`, `rewards`, `runtime_metadata`, `sessions`, `task_claims`,
  `tasks`, and `users`.

The Sites database overview reported no omitted or truncated identifiers. No
production rows or authentication material were read.
