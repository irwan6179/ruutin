# BR-070–BR-077 — Reward templates, requests, redemption, and UI evidence

This note records local server/security evidence for the G07 core slice. It
contains no session tokens, device tokens, credentials, or private profile
data. It covers the server core plus the parent and assigned-profile companion
surfaces; raw pairing values are intentionally omitted.

## Covered behavior

- `shared/reward-templates.ts` contains the five typed, version-controlled
  suggestions from the source brief. They are returned as application data and
  are not D1 seed rows.
- Parent reward reads and mutations are household/profile scoped. Costs are
  positive safe integers; create, edit, archive, and active-goal selection are
  guarded server-side. The existing migration trigger plus guarded insert keep
  active rewards at five per profile under independent-connection writes.
- Companion requests derive household, profile, and device scope from the
  verified companion context. The request body accepts only a reward ID;
  pending duplicates are rejected by the partial unique index and no ledger row
  is written when a request is opened.
- Parent approval/rejection verifies household ownership and pending state.
  Approval uses a D1 batch with guarded state/balance predicates and one unique
  `reward_request` source row of event type `reward_redeemed`; the row records
  actor, reason, server timestamp, and household-local date. Repeated or
  concurrent approvals are idempotent, never double-deduct, and never allow a
  negative balance. Rejection has no ledger effect.
- Parent mutations require same-origin double-submit CSRF. Companion request
  mutations require same-origin. Authenticated responses are private and
  `no-store`, and route errors remain generic/non-enumerating. Multi-statement
  archive and approval transitions fail closed when D1 batch is unavailable.
- The parent Rewards surface lets a parent choose a profile, start from any of
  the five typed suggestions, create/edit/archive ideas, select or clear one
  active goal, and review pending requests. Every mutation refetches the
  profile-scoped reward and request snapshots before showing success.
- Companion Rewards shows only the assigned profile's balance, active-goal
  progress, remaining stars, other parent-selected ideas, request status, and
  profile-level request history, including after replacement by another device
  assigned to the same profile. Copy avoids shop, gambling, or competitive
  framing.
- Parent Today and Rewards both expose the pending reward queue. Approve and
  reject actions use the guarded parent route and refetch authoritative state;
  resolved requests remain visible in Rewards history.

## Local verification

```text
npx tsx --test tests/g07-rewards.test.ts       PASS (10 tests)
npx tsx --test tests/g07-ui.test.ts            PASS (4 tests)
npm run quality                              PASS (88 unit + 2 render tests)
npm run db:generate                          PASS (no schema changes)
git diff --check                             PASS
Playwright, representative 360px redemption  PASS
axe WCAG 2 A/AA + 2.1 A/AA                  PASS (0 violations)
```

The focused tests cover exact template values and no-template-table storage,
CRUD validation and active selection, foreign household/profile isolation,
five-active creation across independent connections, companion duplicate
requests across independent connections, no-deduction request creation,
balance-derived approval, insufficient-balance and non-batched fail-closed
paths, rejection/retry, exactly-one ledger rows, independent-connection
approval idempotency, parent/companion route authorization, CSRF/origin,
private headers, generic foreign errors, under-13 denial, and retained-cookie
revocation.

Browser verification at `http://localhost:3017` covered the representative
flow: parent created a template reward for Ari, selected it as the active goal,
edited its cost, companion requested it, parent approved it, and both companion
history and parent request history updated after refetch. A second pending
request appeared in the parent Today queue and was approved through the guarded
private/no-store route. The resulting ledger-derived balance was exactly zero,
never negative, and the parent history contained both approved requests. At
360px, parent Rewards, companion Rewards, and Today reported no horizontal
overflow; console errors were zero after the deterministic UTC date label fix;
axe reported zero violations.
Sites-origin and physical QR-scan verification remain release checks for the
parent task.
