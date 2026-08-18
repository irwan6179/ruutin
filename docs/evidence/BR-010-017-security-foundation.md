# G01 security foundation evidence

Status: implementation and local verification complete; saved Sites migration
execution remains a release-gate check.

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
