# G08 settings, privacy, and deletion evidence

## Scope

This evidence covers BR-080 through BR-086. The implementation is parent-only
and remains household-scoped from the server-resolved session; companion
requests cannot use the settings routes.

## Implemented boundaries

- `/app/settings` now exposes the parent email, editable IANA household
  timezone, privacy/minimization copy, a household JSON export, permanent
  deletion, and sign-out.
- Privacy copy says profiles marked under 13 stay parent-only and avoids
  child-directed marketing language.
- Timezone writes validate with `Intl.DateTimeFormat` on the server. Future
  occurrence calculations use the new household timezone; stored one-off
  dates and append-only `point_ledger.local_date` values are never rewritten.
- Export queries select only the target household's profiles, tasks, claims,
  rewards, reward requests, ledger rows, and safe linked-device metadata.
  They intentionally do not select users, sessions, auth challenges, pairing
  rows, token/code hashes, or device token material. Responses are
  `private, no-store`, `Vary: Cookie`, and `Referrer-Policy: no-referrer`.
- Deletion requests use the existing D1 `delete_household` TAC purpose. The
  TAC is six digits, HMAC-bound, expires after ten minutes, is one-use, locks
  after five wrong attempts, and is rate-limited by normalized email and the
  trusted `CF-Connecting-IP` source (never `X-Forwarded-For`). A successful
  verification issues a short-lived, session/household-bound signed
  HttpOnly `__Host-ruutin_delete_reauth` marker.
- The final action requires the exact `DELETE` confirmation and a D1 batch.
  The batch revokes all parent sessions and companion devices in the target
  household before deleting the household. There is no sequential fallback;
  a missing batch or failed batch leaves the database unchanged. Cascading
  foreign keys remove household app data, and retained parent/companion
  cookies fail on the next request.

## Focused evidence

`tests/g08-settings.test.ts` covers:

- IANA validation, deterministic local-date behavior, and immutable ledger
  dates;
- exact export allow-list, foreign-household exclusion, and absence of auth
  material/hash fields;
- parent-only settings scope, CSRF/origin checks, private/no-store headers,
  export disposition, and parent-email privacy;
- deletion TAC purpose binding, generic errors, five-attempt lockout,
  one-use behavior, request rate limits, and HttpOnly/SameSite marker;
- fresh session-bound deletion proof, strong confirmation, full cascade,
  parent/companion retained-cookie revocation, no-batch fail-closed behavior,
  rollback safety, and mobile-safe UI copy contracts.

Commands:

```text
npx tsx --test tests/g08-settings.test.ts
npm run lint
npm run typecheck
```

All focused checks pass locally. Browser/Sites production verification of the
destructive email delivery and final deletion confirmation remains an
operational follow-up.

The lean local browser pass at 360×800 additionally confirmed the Settings
screen has no horizontal overflow, saves the existing IANA timezone, exposes
the required privacy/deletion copy, and returns the JSON export with
`private, no-store`, the expected download disposition, only the eight allowed
top-level data classes, and no token/hash/session/pairing material. The focused
axe scan reported zero violations. The destructive button was intentionally
not completed against the shared local household; atomic deletion and retained
token behavior are proven in the isolated integration database instead.
