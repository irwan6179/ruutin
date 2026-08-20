# BR-103, BR-104, BR-106 — release security audit

Status: complete locally; no TASKS or other G10 evidence files changed.

## BR-103 — ledger and reward concurrency

- The existing G06 claim suite proves repeated and parallel parent approval
  produces one award source, rejection produces no ledger row, direct parent
  completion is idempotent, and reversal adds one compensating entry without
  rewriting history.
- The existing G07 reward suite proves independent-connection approval races
  produce one `reward_redeemed` row, repeated approval is idempotent, rejection
  leaves the ledger unchanged, insufficient balance keeps the request pending,
  and the derived balance never goes negative.
- `tests/g10-release-audit.test.ts` locks the presence of those focused release
  scenarios alongside the schema/source inventory.

All award and redemption balances remain derived from the append-only ledger;
source uniqueness and D1 batches provide the exactly-once boundary.

## BR-104 — migrations, foreign keys, and deletion

- The forward sequence is `0000` through `0004`. The G10 audit applies it to
  two fresh SQLite/D1-shaped databases and compares the schema dumps, required
  lookup/unique indexes, foreign keys, and integrity triggers.
- The same audit upgrades a populated `0000`–`0003` database through `0004`,
  confirms an existing reward request survives the table rebuild, and then
  confirms household deletion cascades it.
- Migration `0004_sleepy_power_pack.sql` changes reward-request references to
  cascade with household app deletion. The previous `RESTRICT` references to
  rewards and child devices could block permanent household deletion when a
  request history row existed. Because the migration rebuilds that table, it
  also recreates the G01 reward-request triggers after the rebuild.
- Household deletion is a D1 batch: parent sessions and companion devices are
  revoked first, then household-owned profiles, tasks, claims, rewards,
  requests, ledger rows, and pairing codes cascade away. The other household
  remains untouched. Account-level auth challenges are not household export
  data and are not exposed by export; retained parent cookies fail because
  their sessions are revoked.

## BR-106 — prohibited-scope audit

- `.openai/hosting.json` retains the existing Sites project and has `r2: null`.
- The dependency inventory contains no payment, analytics, AI, push, or
  alternate-auth provider. Sites-required Cloudflare/Vinext packages remain
  implementation dependencies of the exclusive Sites runtime.
- App/server/shared source contains no uploads/R2, password login, ChatGPT
  sign-in, WebSockets, background queue, payment, analytics, AI, or push
  capability. Reward copy and routes remain parent-managed, purposeful, and
  free of cash, shop, gambling, loot-box, virtual-currency, leaderboard, or
  sibling-ranking mechanics.

## Verification

```text
npx tsx --test tests/g10-release-audit.test.ts  PASS (4 tests)
npm run db:generate                                  PASS (0004 generated; no further changes)
npm run quality                                      PASS
git diff --check                                     PASS
```

The saved Sites/custom-domain and production runtime gates remain G10
operational follow-up; this audit performs no save, deploy, or external write.
