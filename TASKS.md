# Ruutin Task Tracker

Development contract: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)  
Deployment target: ChatGPT Sites exclusively  
Final custom domain: `ruutin.irwan.cc` via Sites custom-domain support  
Tracker state: G02 code complete; live Sites email validation pending; G03 implementation next

## How to use this tracker

- `[ ]` not started, `[-]` in progress, `[x]` complete, `[!]` blocked.
- Work one goal batch at a time. A goal completes only when every included task meets its acceptance and evidence requirements.
- Keep task IDs stable in commits, agent prompts, reviews, and evidence notes.
- Do not mark a task complete from an agent summary alone. Review its diff and rerun the stated checks.
- Put durable runtime/release evidence in `docs/evidence/<task-id>-<short-name>.md`; never save secrets, raw TACs, pairing codes, or tokens there.
- A saved, reviewable Sites version is the implementation target. Public Sites deployment requires a separate explicit approval.
- Do not create configuration for another hosting platform.

### Luna reasoning guide

- **Luna xhigh:** bounded scaffolding, static data, conventional UI, responsive/accessibility polish, and test implementation with settled architecture.
- **Luna max:** Sites runtime feasibility, authentication/cryptography, authorization, schema constraints, concurrency/idempotency, pairing/session security, ledger/redemption, destructive deletion, and release-security review.

## Goal sequence

| Goal | Outcome | Tasks | Luna | Depends on |
| --- | --- | --- | --- | --- |
| G00 | Sites feasibility is proven and scaffold is reviewable | BR-000–BR-006 | max | — |
| G01 | D1 and server security foundation exists | BR-010–BR-017 | max | G00 |
| G02 | Parent TAC authentication and sessions work | BR-020–BR-027 | max | G01 |
| G03 | Parent shell, onboarding foundation, and profiles work | BR-030–BR-038 | xhigh; max eligibility review | G02 |
| G04 | Template-first tasks and due dates work | BR-040–BR-047 | xhigh | G03 |
| G05 | Secure pairing and device control work | BR-050–BR-058 | max | G03 |
| G06 | Claims, approvals, and append-only stars work | BR-060–BR-068 | max | G04, G05 |
| G07 | Rewards and safe redemption work | BR-070–BR-077 | max | G06 |
| G08 | Settings, export, deletion, and privacy work | BR-080–BR-086 | max | G02, G07 |
| G09 | PWA, sync, final onboarding, design, and accessibility are complete | BR-090–BR-099 | xhigh; max cache review | G04–G08 |
| G10 | Acceptance, security, and saved Sites version pass | BR-100–BR-109 | max | G00–G09 |

## G00 — Sites runtime preflight and project foundation

- [x] **BR-000 — Maintain requirements and decision records**  
  Depends: none. Deliver: keep the development contract and tracker current; create `docs/evidence/`.  
  Accept: unresolved release decisions have owners/status and no source requirement is silently dropped.

- [x] **BR-001 — Create the ChatGPT Sites project scaffold**  
  Depends: BR-000. Deliver: Sites-generated framework scaffold, local scripts, lint/type/test configuration, `.gitignore`, and root README.  
  Accept: Sites preview/build works; framework and commands are recorded in the development contract. No alternate-host adapter exists.

- [x] **BR-002 — Prove server-side email API reachability in Sites**  
  Depends: BR-001. Deliver: minimal server-only probe using Sites-hosted configuration, then remove or lock the probe.  
  Accept: a saved/published Sites runtime reaches the selected API without exposing credentials; redacted evidence is saved. If unavailable, mark `[!]` and stop—do not change host or auth method.

- [x] **BR-003 — Prove Sites D1 binding and migration workflow**  
  Depends: BR-001. Deliver: D1 binding, base migration, local and Sites environment workflow.  
  Accept: a Sites server route performs a harmless D1 read in local and saved-version environments; commands/results are recorded.

- [x] **BR-004 — Probe service-worker support on the Sites origin**  
  Depends: BR-001. Deliver: disposable registration probe and evidence.  
  Accept: support status is recorded. Unsupported means manifest/install guidance without caching, not a hosting change.

- [x] **BR-005 — Establish environment validation and secret boundaries**  
  Depends: BR-001. Deliver: typed server-only configuration loader and production fail-closed validation.  
  Accept: required variables validate; client imports are prevented; test/build output contains no secret values.

- [x] **BR-006 — Add baseline quality commands**  
  Depends: BR-001. Deliver: format check, lint, typecheck, tests, build, and secret/client-bundle scan commands.  
  Accept: commands run from a clean checkout and are documented.

## G01 — D1 and server security foundation

- [x] **BR-010 — Create identity and household migration**  
  Depends: BR-003. Deliver: `users`, `households`, `household_users`, indexes, foreign keys, role checks.  
  Accept: unique normalized email and household/user membership are enforced in D1.

- [x] **BR-011 — Create authentication/session migration**  
  Depends: BR-010. Deliver: `auth_challenges`, `sessions`, expiry/lookup indexes and constraints.  
  Accept: no raw TAC/session field exists; token hashes are unique; migration tests pass.

- [x] **BR-012 — Create profiles/tasks/claims migration**  
  Depends: BR-010. Deliver: `child_profiles`, `tasks`, `task_claims` and constraints/indexes.  
  Accept: stars are limited to 1–3 and duplicate approved task occurrences are database-protected.

- [x] **BR-013 — Create ledger/rewards migration**  
  Depends: BR-012. Deliver: `point_ledger`, `rewards`, `reward_requests`.  
  Accept: one source event cannot award/deduct twice; allowed types/statuses and positive reward cost are enforced.

- [x] **BR-014 — Create pairing/device migration**  
  Depends: BR-012. Deliver: `pairing_codes`, `child_devices` with expiry, lookup, uniqueness, revocation indexes.  
  Accept: no raw pairing/device token field exists and device token hashes are unique.

- [x] **BR-015 — Implement shared validation and data conventions**  
  Depends: BR-010–BR-014. Deliver: IDs, UTC timestamps, IANA timezone/local date, email normalization, enums, schedule validation.  
  Accept: tests cover DST boundaries, invalid schedules, invalid stars/statuses, and normalized-email equivalence.

- [x] **BR-016 — Implement parent and companion authorization contexts**  
  Depends: BR-011, BR-014. Deliver: separate server helpers resolving scope from secure cookies and D1.  
  Accept: expired/revoked sessions fail; companion context returns exactly one assigned profile and ignores browser scope IDs.

- [x] **BR-017 — Add scoped data access and HTTP security controls**  
  Depends: BR-015, BR-016. Deliver: household/profile-scoped queries, private/no-store defaults, CSRF/origin defense, sanitized errors/logging.  
  Accept: protected handlers cannot use unscoped mutation helpers; cross-household and sibling identifiers are rejected in tests.

## G02 — Parent TAC authentication

- [x] **BR-020 — Implement TAC cryptography and lifecycle**  
  Depends: BR-005, BR-011, BR-015. Deliver: secure six-digit generation, protected hash, ten-minute expiry, one use, five-attempt lock, prior-code invalidation.  
  Accept: no plaintext persistence/logging; tests cover expiry, reuse, attempts, replacement, concurrency, and safe comparison.

- [x] **BR-021 — Implement layered TAC request rate limits**  
  Depends: BR-020. Deliver: limits by normalized email and request source using Sites-supported storage/data.  
  Accept: repeated requests are bounded without account enumeration; policy/reset behavior is tested and documented.

- [x] **BR-022 — Implement transactional TAC email adapter**  
  Depends: BR-002, BR-020. Deliver: provider adapter, timeout/error handling, parent-appropriate copy.  
  Accept: credentials stay server-only; failures are sanitized; deterministic test adapter exists.

- [x] **BR-023 — Implement neutral TAC request route and UI**  
  Depends: BR-021, BR-022. Deliver: mobile-first form and Sites server route.  
  Accept: valid/unknown emails receive indistinguishable public responses.

- [x] **BR-024 — Implement TAC verification and account creation**  
  Depends: BR-020, BR-023. Deliver: verification route/UI and atomic user creation/update.  
  Accept: first success creates account; concurrent verification cannot consume twice or duplicate the user.

- [x] **BR-025 — Implement secure parent sessions**  
  Depends: BR-024. Deliver: opaque token, hashed D1 storage, secure cookie, ~30-day expiry, rotation, last-seen throttling.  
  Accept: raw token exists only in cookie exchange; cookie is `Secure`, `HttpOnly`, `SameSite`; reload and second-device sign-in work.

- [x] **BR-026 — Implement sign-out and session revocation**  
  Depends: BR-025. Deliver: server revocation and cookie clearing.  
  Accept: revoked token fails on its next request; client-side clearing is not the enforcement mechanism.

- [-] **BR-027 — Complete authentication security tests**  
  Depends: BR-020–BR-026. Deliver: route and end-to-end tests.  
  Accept: AC-01–AC-06 and AC-24 pass, including generic errors and rate limits.

## G03 — Parent shell, onboarding foundation, and profiles

- [x] **BR-030 — Build parent shell and four-destination navigation**
  Depends: BR-025. Deliver: Today, Family, Rewards, Settings routes and safe-area bottom navigation.  
  Accept: routes require parent context; active/focus states work from 360 px to desktop.

- [x] **BR-031 — Implement household creation and one-household MVP rule**
  Depends: BR-010, BR-030. Deliver: name/timezone setup and membership transaction.  
  Accept: UI supports one household per parent while schema remains future-compatible.

- [x] **BR-032 — Finalize age/eligibility launch policy**
  Depends: BR-000. Deliver: approved age bands, consent threshold/copy, and policy evidence.  
  Accept: server has a testable mapping from parent confirmation/age band to companion eligibility; no exact birth date is collected.

- [x] **BR-033 — Implement minimized profile CRUD**
  Depends: BR-012, BR-031, BR-032. Deliver: nickname, emoji, optional age band, eligibility, archive flow.  
  Accept: prohibited fields are absent; multiple profiles work; all operations are household-scoped.

- [-] **BR-034 — Build the onboarding shell and state model**
  Depends: BR-033. Deliver: step routing/state for household → profile → tasks → review → rewards → optional eligible pairing.  
  Accept: progress, back, resume, skip-optional, and completion behavior are defined; later feature steps have typed integration boundaries without fake persistence.

- [x] **BR-035 — Build parent Today overview**
  Depends: BR-030, BR-033. Deliver: profile cards, task progress, pending queues, balances, reward progress.  
  Accept: data is household-scoped with useful empty/loading/error states.

- [x] **BR-036 — Build Family profile management UI**
  Depends: BR-033. Deliver: profile list/detail and task/device/pairing entry points.  
  Accept: archived profiles and ineligible pairing states are clear.

- [x] **BR-037 — Test onboarding/profile privacy and authorization**
  Depends: BR-030–BR-036. Deliver: integration, E2E, accessibility tests.  
  Accept: AC-07 passes; age/eligibility mapping has unit tests; prohibited data is neither requested nor returned. Pairing-route enforcement of AC-09 is completed in BR-058.

- [x] **BR-038 — Build the parent-focused public landing page**  
  Depends: BR-001. Deliver: public mobile-first entry, product explanation for parents/caregivers, privacy-forward copy, and TAC sign-in CTA.  
  Accept: messaging does not target children or imply child accounts; no prohibited data, paywall, payment, or child-directed game treatment appears.

## G04 — Template-first tasks and schedules

- [x] **BR-040 — Encode version-controlled routine templates**
  Depends: BR-001. Deliver: typed static data for all eight categories and every supplied starter task/default.  
  Accept: templates are absent from D1; schema/snapshot tests catch lost or invalid content.

- [x] **BR-041 — Build category and suggested-task picker**
  Depends: BR-040. Deliver: category selection, toggles, review step.  
  Accept: blank custom form is not first; selections create editable drafts.

- [x] **BR-042 — Implement task CRUD, archive, and reorder routes**
  Depends: BR-012, BR-015, BR-017, BR-033. Deliver: household-scoped Sites server mutations.  
  Accept: title/schedule/stars validate server-side; positions are deterministic; foreign mutations fail.

- [x] **BR-043 — Build task editing/custom task UI**
  Depends: BR-041, BR-042. Deliver: wording, supported schedules, 1–3 stars, archive, reorder.  
  Accept: unsupported recurrence/reminders/timers are absent; touch and keyboard interactions work.

- [x] **BR-044 — Implement household-local due-task calculation**
  Depends: BR-015, BR-042. Deliver: due-date service for daily, selected weekdays, one-off date.  
  Accept: tests cover timezone midnight, DST, weekdays, one-off dates, archived tasks.

- [x] **BR-045 — Implement occurrence/progress reads**
  Depends: BR-044. Deliver: parent and profile-scoped queries combining tasks with claim/completion states.  
  Accept: To do/Waiting/Completed is consistent and companion reads leak no siblings.

- [x] **BR-046 — Integrate task setup into Family/onboarding**
  Depends: BR-034, BR-043, BR-045. Deliver: complete task management flow.  
  Accept: selections persist as editable D1 tasks and appear on correct local dates.

- [x] **BR-047 — Test templates, schedules, and authorization**
  Depends: BR-040–BR-046. Deliver: unit/integration/E2E tests.  
  Accept: AC-08 passes; malformed schedules and foreign identifiers cannot be stored/read.

## G05 — Companion pairing and linked devices

- [x] **BR-050 — Implement pairing challenge lifecycle**
  Depends: BR-014, BR-015, BR-020. Deliver: six-digit code plus high-entropy URL token, protected storage, ten-minute expiry, cancellation/replacement, one use, five-attempt limit.  
  Accept: plaintext never enters D1/logs; lifecycle and concurrency tests pass.

- [x] **BR-051 — Enforce eligibility and parent-owned challenge creation**
  Depends: BR-032, BR-033, BR-050. Deliver: Sites server route and Family action.  
  Accept: ineligible, archived, foreign, or unconfirmed profiles cannot generate codes through direct route calls.

- [x] **BR-052 — Generate QR/pairing URL and countdown UI**
  Depends: BR-051. Deliver: QR, manual code, ten-minute countdown, cancel/regenerate.  
  Accept: server expiry is authoritative; QR contains no ongoing credential.

- [x] **BR-053 — Build `/pair` validation and profile confirmation**
  Depends: BR-050. Deliver: manual/URL entry, nickname+emoji confirmation, generic errors.  
  Accept: no sibling/household/parent data is disclosed; attempt limits apply.

- [x] **BR-054 — Create profile-scoped companion session**
  Depends: BR-016, BR-053. Deliver: atomic challenge consumption/device creation and secure cookie.  
  Accept: token is long/random and hash-only in D1; one challenge creates at most one device; session cannot switch profiles.

- [x] **BR-055 — Build companion shell and two-destination navigation**
  Depends: BR-054. Deliver: Today and Rewards only, greeting, install-guidance hook.  
  Accept: parent settings/profile switching are absent; routes require active device context.

- [x] **BR-056 — Build linked-device management**
  Depends: BR-036, BR-054. Deliver: label/profile/linked/last-active/revoked display, rename, revoke, replacement.  
  Accept: actions are parent/household-scoped and last-active writes are throttled.

- [x] **BR-057 — Enforce server-side device revocation**
  Depends: BR-054, BR-056. Deliver: revocation check on every companion request and private/no-store responses.  
  Accept: revoked device fails on next request despite retained cookie/open tab/guessed URL.

- [x] **BR-058 — Test pairing, isolation, and revocation**
  Depends: BR-050–BR-057. Deliver: concurrency, route authorization, E2E tests.  
  Accept: AC-09–AC-14 and AC-22 pass.

## G06 — Claims, approvals, and point ledger

- [x] **BR-060 — Implement append-only ledger and balance query**
  Depends: BR-013, BR-015, BR-017. Deliver: typed insertion, unique source, profile balance sum, progress helpers.  
  Accept: normal corrections never rewrite history; duplicate source cannot change balance twice.

- [x] **BR-061 — Implement companion completion claims**
  Depends: BR-045, BR-055. Deliver: assigned-profile pending claim for a due occurrence.  
  Accept: only due/eligible tasks can be claimed; duplicate active claims fail; browser profile IDs do not broaden scope.

- [x] **BR-062 — Build companion confirmation and task states**
  Depends: BR-061. Deliver: review explanation/dialog and To do/Waiting/Completed UI.  
  Accept: successful mutations refetch authoritative state; duplicate taps are safe.

- [x] **BR-063 — Implement parent pending-claim queue**
  Depends: BR-035, BR-061. Deliver: nickname/emoji/task/stars/time with approve/reject.  
  Accept: queue is household-scoped and stale/resolved items are safe.

- [x] **BR-064 — Implement transactional claim decisions**
  Depends: BR-060, BR-063. Deliver: pending transition plus one `task_approved` ledger row; rejection without stars.  
  Accept: repeated/concurrent approval never awards twice; balance is ledger-derived; valid rejected occurrences may be reclaimed.

- [x] **BR-065 — Implement parent direct completion**
  Depends: BR-060, BR-045. Deliver: idempotent `parent_completed_task` event and UI action.  
  Accept: it cannot double-award against an approved companion claim for the occurrence.

- [x] **BR-066 — Implement reversal/manual adjustment controls**
  Depends: BR-060, BR-065. Deliver: compensating `task_reversed` and reasoned `manual_adjustment` flows.  
  Accept: original history remains; actor/reason/source/local date are recorded.

- [x] **BR-067 — Integrate balances/progress in both interfaces**
  Depends: BR-060, BR-062, BR-064. Deliver: stars and task progress.  
  Accept: reload yields the same ledger-derived balance and profile isolation holds.

- [x] **BR-068 — Test claims and ledger idempotency**
  Depends: BR-060–BR-067. Deliver: transaction/concurrency/authorization/E2E tests.  
  Accept: AC-15–AC-19 pass with exactly-one ledger evidence.

## G07 — Rewards and redemption

- [x] **BR-070 — Encode static suggested reward templates**
  Depends: BR-001. Deliver: all five suggestions as typed version-controlled data.  
  Accept: templates are not D1 seed rows and values/content match the source.

- [x] **BR-071 — Implement reward CRUD and five-active limit**
  Depends: BR-013, BR-017, BR-033. Deliver: household/profile-scoped routes.  
  Accept: positive costs validate server-side; concurrent creation cannot exceed five active rewards per profile.

- [x] **BR-072 — Build parent reward catalogue/template picker**
  Depends: BR-070, BR-071. Deliver: create/edit/archive and active-goal selection.  
  Accept: active reward belongs to same profile; archived goals are handled.

- [x] **BR-073 — Build companion reward views**
  Depends: BR-055, BR-060, BR-072. Deliver: active/other rewards, balance, progress, remaining, status/history.  
  Accept: only assigned-profile data returns; UI avoids gambling/shop framing.

- [x] **BR-074 — Implement profile-scoped reward requests**
  Depends: BR-073. Deliver: companion request and duplicate-pending protection.  
  Accept: reward belongs to assigned profile; requests do not deduct stars.

- [x] **BR-075 — Implement transactional reward decisions**
  Depends: BR-060, BR-074. Deliver: approve/reject and exactly-one negative ledger entry.  
  Accept: ownership/pending/balance checks occur in transaction; concurrency cannot double-deduct or go negative.

- [x] **BR-076 — Integrate pending requests and history**
  Depends: BR-035, BR-075. Deliver: parent Today/Rewards queues and history.  
  Accept: actions refetch balances and stale decisions do not show false success.

- [x] **BR-077 — Test reward limits/isolation/idempotency**
  Depends: BR-070–BR-076. Deliver: integration/concurrency/E2E tests.  
  Accept: AC-20–AC-21 pass; rejection has no ledger effect; prohibited mechanics are absent.

## G08 — Settings, export, deletion, and privacy

- [ ] **BR-080 — Build Settings screen**  
  Depends: BR-030. Deliver: email, timezone, privacy, export, delete, sign-out.  
  Accept: parent email never reaches companion routes; timezone implications are explained.

- [ ] **BR-081 — Implement timezone update behavior**  
  Depends: BR-044, BR-080. Deliver: validated IANA mutation and occurrence policy.  
  Accept: historical ledger local dates remain unchanged; due behavior is deterministic/tested.

- [ ] **BR-082 — Implement household JSON export**  
  Depends: BR-017, BR-080. Deliver: allowed household application data and safe device metadata.  
  Accept: no challenge/session/device/pairing hashes, raw tokens, secrets, or foreign rows; private/no-store response.

- [ ] **BR-083 — Require fresh authentication for deletion**  
  Depends: BR-020, BR-025, BR-080. Deliver: recent-session check or purpose-bound fresh TAC.  
  Accept: stale session cannot delete; challenge remains generic, expiring, one-time, rate-limited.

- [ ] **BR-084 — Implement permanent household deletion**  
  Depends: BR-082, BR-083. Deliver: strong confirmation, reviewed cascade/order, all parent/device session revocation.  
  Accept: no household application data remains; sessions fail next request; failure rolls back safely.

- [ ] **BR-085 — Add privacy and deletion copy**  
  Depends: BR-032, BR-080. Deliver: data minimization, eligibility, export, permanent-deletion information.  
  Accept: approved policy is accurate and no child-directed marketing is introduced.

- [ ] **BR-086 — Test settings/export/deletion isolation**  
  Depends: BR-080–BR-085. Deliver: schema, authorization, E2E, retained-token tests.  
  Accept: export contains only allowed classes; deletion/revocation works after reload.

## G09 — PWA, synchronization, final onboarding, design, accessibility

- [ ] **BR-090 — Create manifest and icon set**  
  Depends: BR-001. Deliver: required name/short name/display/theme/background, 192, 512, maskable, Apple touch assets, viewport metadata.  
  Accept: assets load on Sites origin and manifest validation passes.

- [ ] **BR-091 — Implement install/standalone guidance**  
  Depends: BR-055, BR-090. Deliver: required post-pairing message, standalone detection, iPhone Safari/Android guidance.  
  Accept: exact message appears after pairing and guidance can be reopened.

- [ ] **BR-092 — Implement service worker only if Sites gate passed**  
  Depends: BR-004, BR-090. Deliver: immutable-static-only cache or documented no-worker decision.  
  Accept: authenticated HTML, API, TAC, pairing, mutations never enter cache; old workers cannot preserve revoked access.

- [ ] **BR-093 — Implement authoritative refetch strategy**  
  Depends: BR-035, BR-055. Deliver: post-mutation, foreground, manual/pull refresh; optional low-frequency approval refresh.  
  Accept: no WebSockets/background queue; stale tabs converge; polling stops off approval screen.

- [ ] **BR-094 — Apply joyful responsive design system and micro-interactions**  
  Depends: functional screens. Deliver: light base, soft purple, cards, type, touch targets, icons, progress, safe areas, and purposeful press/completion/approval/navigation/success motion.  
  Accept: interactions feel playful and pleasurable while the parent UI remains trustworthy; motion is brief, performant, and fully disabled or simplified by `prefers-reduced-motion`; companion UI is cheerful without prohibited styling.

- [ ] **BR-095 — Complete accessibility pass**  
  Depends: BR-094. Deliver: semantics, labels, focus, keyboard, contrast, reduced motion, error announcements.  
  Accept: automated checks and documented manual keyboard/screen-reader checks pass.

- [ ] **BR-096 — Verify 360 px through desktop**  
  Depends: BR-094, BR-095. Deliver: responsive evidence for auth/onboarding/parent/companion/pairing states.  
  Accept: no horizontal overflow at 360 px; nav/dialogs honor safe areas.

- [ ] **BR-097 — Audit caching and foreground behavior**  
  Depends: BR-092, BR-093. Deliver: Sites-origin network/cache evidence.  
  Accept: AC-25 and AC-28 pass; revoked open tabs cannot recover private cache data.

- [ ] **BR-098 — Complete PWA/design release checks**  
  Depends: BR-090–BR-097. Deliver: Sites-origin PWA/UI report.  
  Accept: AC-26–AC-27 pass and behavior matches the Sites runtime decision.

- [ ] **BR-099 — Complete and time the end-to-end onboarding flow**  
  Depends: BR-034, BR-046, BR-052, BR-072, BR-094. Deliver: fully integrated household → profile → template tasks → schedule/stars review → rewards → optional eligible pairing flow.  
  Accept: a representative new parent completes first setup in under three minutes; ineligible profiles never see or reach pairing; partial/resumed state remains correct.

## G10 — Security, acceptance, and saved Sites version

- [ ] **BR-100 — Run cross-household authorization matrix**  
  Depends: all feature routes. Deliver: every parent read/mutation with foreign household/profile/task/claim/reward/device IDs.  
  Accept: AC-23 passes; denials disclose no foreign record details.

- [ ] **BR-101 — Run companion isolation/role matrix**  
  Depends: all companion routes. Deliver: sibling injection, parent-route, revoked/expired-device, parent-email tests.  
  Accept: companion capability never exceeds assigned profile.

- [ ] **BR-102 — Run auth/pairing abuse and secret audit**  
  Depends: BR-027, BR-058. Deliver: enumeration, expiry, attempts, reuse, rate-limit, log, client-bundle, cookie/header tests.  
  Accept: AC-29 passes; no plaintext challenge/token or secret is persisted/exposed.

- [ ] **BR-103 — Run ledger/reward concurrency audit**  
  Depends: BR-068, BR-077. Deliver: repeated/parallel approval, reversal, redemption tests.  
  Accept: exactly-once sources hold and redemption cannot create negative balance.

- [ ] **BR-104 — Review D1 migrations/deletion semantics**  
  Depends: BR-010–BR-014, BR-084. Deliver: schema dump, indexes, foreign keys, forward migration, deletion report.  
  Accept: Sites migration sequence is repeatable and auth/token data is not exported/orphaned.

- [ ] **BR-105 — Execute all 30 source acceptance cases**  
  Depends: BR-100–BR-104. Deliver: `docs/evidence/BR-105-acceptance.md` with AC-01…AC-30 results.  
  Accept: every case passes or is explicitly blocked; no release blocker is silently waived.

- [ ] **BR-106 — Confirm prohibited-scope audit**  
  Depends: feature complete. Deliver: dependency/code/UI review for non-Sites hosting, R2/uploads, ChatGPT sign-in, passwords, analytics, payments, AI, push, WebSockets, background queues, prohibited reward mechanics.  
  Accept: AC-30 passes and prohibited features/data/configuration are absent.

- [ ] **BR-107 — Run full clean quality suite**  
  Depends: BR-105, BR-106. Deliver: format, lint, typecheck, unit/integration/E2E, build, migration, secret, accessibility, responsive checks.  
  Accept: outputs are recorded; failures/flakes are not ignored.

- [ ] **BR-108 — Create a reviewable saved Sites version**  
  Depends: BR-107. Deliver: saved Sites version and revision ID, change summary, known limitations, rollback notes.  
  Accept: reviewers can open it without public deployment; secrets/test identities are not disclosed.

- [ ] **BR-109 — Public Sites deployment approval gate**  
  Depends: BR-002, BR-058, BR-104, BR-105, BR-108. Deliver: explicit user approval only.  
  Accept: required security/runtime evidence exists. Keep `[ ]` until the user separately authorizes public deployment.

## Source acceptance checklist

- [ ] **AC-01** New parent can request and verify email TAC. *(Local deterministic flow passes; live Resend delivery pending.)*
- [x] **AC-02** TAC expires after ten minutes.
- [x] **AC-03** TAC cannot be reused.
- [x] **AC-04** More than five incorrect TAC attempts are blocked.
- [x] **AC-05** Repeated TAC requests are rate limited.
- [x] **AC-06** Same parent on a second device sees the same household.
- [x] **AC-07** Parent can create multiple profiles.
- [x] **AC-08** Template selections create editable tasks.
- [x] **AC-09** Under-threshold profile cannot generate a pairing code.
- [x] **AC-10** Pairing code expires after ten minutes.
- [x] **AC-11** Pairing code is one-time use.
- [x] **AC-12** Linked device sees only its assigned profile.
- [x] **AC-13** Companion cannot read sibling information.
- [x] **AC-14** Companion cannot call parent-only routes.
- [x] **AC-15** Companion can submit a completion claim.
- [x] **AC-16** Duplicate claims do not create duplicate stars.
- [x] **AC-17** Parent approval creates exactly one ledger entry.
- [x] **AC-18** Repeated approval does not create more stars.
- [x] **AC-19** Rejection creates no stars.
- [x] **AC-20** Redemption cannot produce a negative balance.
- [x] **AC-21** Repeated reward approval cannot deduct twice.
- [x] **AC-22** Revoking a device removes access.
- [ ] **AC-23** Cross-household identifiers expose no data.
- [x] **AC-24** Reload preserves sessions correctly.
- [ ] **AC-25** Foreground return refreshes current data.
- [ ] **AC-26** Manifest and icons exist on Sites origin.
- [ ] **AC-27** App works at 360 px without horizontal overflow.
- [ ] **AC-28** No private API response is in service-worker cache.
- [ ] **AC-29** No application secret appears in browser code.
- [ ] **AC-30** No R2 storage or upload feature exists.

## Luna coding delegation prompt

Use one prompt per goal or a smaller coherent subset. Do not delegate several security-critical goals in one oversized run.

```text
You are the coding delegate for Ruutin in <absolute-repo-path>.

Work only on task IDs: <BR-...>.
Use docs/DEVELOPMENT.md as the implementation contract and TASKS.md as the tracker.
The exclusive build and deployment target is ChatGPT Sites; do not add another host.
Reasoning level: <xhigh|max>.

Before editing:
1. Read the relevant specification and tracker sections completely.
2. Inspect the worktree, Sites-generated framework conventions, tests, and AGENTS.md.
3. Report a conflict that would change the product/security contract; otherwise proceed.

Implementation rules:
- Preserve unrelated user changes.
- Enforce auth, authorization, validation, and mutations in Sites server routes.
- Scope protected queries from the resolved session, never browser-provided IDs.
- Never log or persist raw TACs, pairing codes, or session tokens.
- Add D1 constraints and transaction/idempotency tests when required.
- Implement a joyful, playful visual experience with purposeful, brief
  micro-animations that make interactions fun and pleasurable. Keep the parent
  UI calm and trustworthy, avoid game-like overstimulation, prefer
  transform/opacity, and fully honor `prefers-reduced-motion`.
- Do not add prohibited scope from docs/DEVELOPMENT.md.
- Do not publicly deploy.

Completion requirements:
1. Implement every listed acceptance criterion.
2. Run narrow relevant checks, then standard repo quality commands.
3. Update only listed tracker items when evidence supports completion.
4. Return summary, exact changed files, commands/results, security assumptions,
   and remaining risks/blockers.
```

## Goal review prompt

Use Luna max after a security-sensitive delegation.

```text
Review goal <Gxx> and task IDs <BR-...> against docs/DEVELOPMENT.md and TASKS.md.
Inspect the actual diff and tests; do not rely on the implementer summary.
Prioritize authorization leaks, privacy violations, missing D1 constraints,
non-atomic mutations, idempotency failures, secret/token exposure, private-cache
leaks, non-Sites deployment assumptions, and incomplete acceptance criteria.
Run relevant checks. Fix only defects within the listed goal scope, then report
findings, fixes, commands/results, and whether each task can remain checked.
```
