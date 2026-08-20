# BR-060–BR-068 — Claims, approvals, and append-only stars

This evidence note covers the local implementation and browser-verification
slice. It contains no session tokens, pairing values, credentials, or raw
personal data. Saved-Sites-origin checks remain part of G10 release QA.

## Implemented behavior

- `server/claims.ts` keeps balances as `SUM(point_ledger.stars_delta)` and
  exposes typed parent ledger reads. Ledger rows are append-only, attributable,
  household-local, and protected by the existing unique `(source_type,
  source_id)` constraint and append-only triggers.
- Companion claims derive household, profile, device, local date, and due state
  from the authenticated device context. A task cannot be claimed when it is
  archived, ineligible, foreign, malformed, or not due. The active occurrence
  uniqueness constraint prevents duplicate pending/approved claims.
- Companion Today presents To do, Waiting for approval, and Completed states.
  Submission opens a confirmation dialog; the POST returns an authoritative
  Today snapshot, followed by a no-store Today/rewards re-read, and duplicate
  taps are disabled while the mutation is in flight.
- Parent Today presents a household-scoped review queue with nickname, emoji,
  task, stars, household-timezone submitted time, and approve/reject actions.
  Approval transitions the pending claim and writes the one attributable
  `task_approved` row in the same D1 batch. Repeated/concurrent approval is
  idempotent. Rejection writes no ledger row and permits a later occurrence
  claim.
- Parent direct completion uses the deterministic occurrence source key and
  `parent_completed_task` event. It resolves an existing pending companion
  claim without double awarding an already-approved companion occurrence.
- Parent Today exposes compensating reversal and reasoned manual adjustment
  controls. The original ledger history is retained; actor, reason, server
  timestamp, source, and household-local date are recorded. Manual retry keys
  are namespaced server-side and cannot be used to move an adjustment across
  profiles or local dates.
- Authenticated responses are private/no-store. Protected mutations use
  parent CSRF/origin checks or companion same-origin checks. Failure copy stays
  generic at the route boundary.
- The UI adds brief transform/opacity feedback, a calm star-balance card in
  Companion Today, visible focus targets, Escape-to-cancel dialog behavior, and
  a global reduced-motion guard. Submitted times use the household IANA
  timezone on both server and browser renders to avoid hydration drift; long
  balance/reward copy wraps safely at the 360px target width.

## Local verification

```text
npx tsx --test tests/g06-claims.test.ts       PASS (11 tests)
npm run lint                                 PASS
npm run typecheck                            PASS
npm run quality                              PASS (74 unit + 2 render tests)
npm run db:generate                          PASS (no schema changes)
git diff --check                             PASS
Playwright, parent + companion, 360×800      PASS
axe WCAG 2 A/AA + 2.1 A/AA                  PASS (0 violations)
reduced-motion emulation                     PASS (10µs maximum)
```

The focused G06 tests cover append-only enforcement, ledger-derived balance,
server-derived local dates, fail-closed non-batched transitions, independent
connection idempotency, due/profile/device isolation, duplicate claims,
concurrent approval, rejection and reclaim, parent direct completion,
pending-claim resolution, compensating reversal, CSRF/origin/private headers,
ineligible companion denial, parent-route isolation, and UI contracts for
confirmation, authoritative refresh, focus/reduced motion, and retry keys.

## Browser verification

A clean parent context and a freshly paired companion context were exercised at
360×800. Companion Today exposed only the assigned profile, opened the claim
confirmation with focus on the primary action, returned focus to the trigger on
Escape, and moved To do to Waiting after a `201` private/no-store response.
Parent Today showed the household-scoped queue with household-timezone submitted
time, approved the claim once, emptied the queue, and updated both parent and
companion views to Completed with one star. The automated independent-connection
and duplicate-request tests provide the repeated/concurrent exactly-once proof.

A second claim was rejected in the parent queue; the balance remained unchanged
and the companion reloaded to To do with reclaim enabled. Parent direct
completion then created one two-star completion for another profile. Reversal
focused its primary action, returned focus on Escape, required a reason, and
added a negative compensating row without removing the original approval. A
reasoned manual adjustment followed. The private ledger query showed the
original approval, reversal, manual adjustment, and direct completion as
separate attributable rows, all with the household-local date.

Both parent and companion pages had no horizontal overflow, no console warnings
or errors, and zero axe WCAG 2 A/AA and 2.1 A/AA violations. Reduced-motion
emulation activated successfully, with all animation and transition durations
reduced to 10 microseconds. Mutation and ledger API responses were confirmed
private/no-store. Saved-Sites-origin and physical-device checks remain G10
release verification rather than G06 implementation blockers.
