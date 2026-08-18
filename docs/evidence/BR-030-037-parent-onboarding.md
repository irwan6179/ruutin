# BR-030–BR-037 — Parent shell, onboarding, and profiles

Status: G03 foundation implemented and its profile/privacy browser checks pass. BR-034 remains partial until later onboarding milestones provide every durable step.

## Delivered

- Protected `/app/today`, `/app/family`, `/app/rewards`, and `/app/settings` routes use the verified parent session. The shell exposes exactly those four destinations and includes mobile safe-area padding plus reduced-motion styles.
- `POST /api/parent/household` creates the first household from the authenticated session only. The browser timezone suggestion is validated as an IANA timezone on the server, and the one-household MVP rule is enforced by a conditional insert/membership transaction boundary.
- `POST|GET /api/parent/profiles` and `GET|PATCH|DELETE /api/parent/profiles/:profileId` provide minimized, household-scoped profile CRUD. Inputs are nickname, emoji, optional broad age band, and explicit consent confirmation; unsupported fields (including exact birth dates) are rejected. Archive clears companion eligibility.
- `server/eligibility.ts` maps `under_13` to ineligible unconditionally. Every other or omitted band requires explicit parent confirmation before companion eligibility is stored.
- Onboarding derives resumable state from durable household/profile/task/reward rows for household → profile → tasks → review → rewards → optional pairing, with back/progress/skip boundaries and typed later-step integration points. Task/reward/pairing persistence remains intentionally deferred to G04/G07/G05 rather than simulated in G03.
- Today overview reads household-scoped profile progress, pending claims, ledger balances, and active-reward progress. Family includes profile management, task/schedule entry point, eligibility messaging, and linked-device display/rename/revoke API foundation without pairing challenge creation.

## Verification

- `npx tsx --test tests/g03-parent.test.ts` — 6 passing tests covering eligibility mapping, under-13 behavior, explicit confirmation, one-household creation, server timezone validation, multiple profiles, update/foreign-scope/archive state, onboarding resume boundaries, unauthorized access, private responses, prohibited-field rejection, and client semantic/source contracts.
- `npm run quality` — passing locally after G03 changes; this is not a substitute for browser E2E, automated a11y, or a real 360px viewport run.
- `npm run db:generate` — no schema changes; existing G01 tables are sufficient.
- Signed-in Playwright verification at 360×800: parent Today and Family had no horizontal overflow; the four-destination navigation exposed the correct active state; the skip link received visible keyboard focus; parent profile edit, under-13 eligibility handling, and creation of a second profile persisted through the real routes.
- Reduced-motion emulation reported `1e-05s` card animation and transition durations, with the media query active.
- Axe WCAG A/AA/2.1 AA checks passed for Family, onboarding, Rewards, Settings, and Today after semantic progress-bar and contrast fixes. The browser console reported zero errors and zero warnings.

No secrets, TACs, pairing codes, session tokens, exact birth dates, or raw profile identifiers are recorded here.
