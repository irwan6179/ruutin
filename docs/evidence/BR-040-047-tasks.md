# BR-040–BR-047 — Template-first tasks and schedules

Status: parent task implementation, unit/integration checks, and the core signed-in browser flow pass. Companion reads and saved Sites verification remain partial.

Implemented:

- `shared/task-templates.ts` contains all eight version-controlled categories and 26 supplied starter rows. Personal care and Weekend responsibilities remain valid empty categories for custom tasks.
- Starter rows never become D1 template records. Selecting suggestions creates an in-memory editable review draft; the reviewed set is persisted through the atomic bulk task route.
- “Parent-selected days” rows are marked `scheduleMode: "parent_selected_days"`. The review editor starts those drafts with no selected weekdays and blocks persistence until the parent chooses at least one weekday. “Tidy the bedroom” uses the explicitly specified weekend schedule.
- `server/tasks.ts` provides parent-scoped create/read/update/archive/reorder operations and occurrence reads. Reorder uses a temporary position range before deterministic zero-based positions; Sites D1 uses the atomic batch path.
- `GET /api/parent/tasks?profileId=…&view=management` returns every active task for editing/reordering; future/non-due rows are explicitly marked `not_due` rather than incorrectly labelled To do. The default read returns only due occurrences with To do/Waiting/Completed state.
- `POST /api/parent/tasks/bulk` validates the entire reviewed set, confirms parent/profile scope, and sends all inserts through the Sites D1 batch transaction. A failing batch cannot leave a partial set.
- `server/today.ts` derives progress from due occurrences in the household timezone, not from all active task rows.
- Family and onboarding use the same category picker/editor, with purposeful short transform/opacity feedback and reduced-motion CSS inherited from the parent shell.
- No companion task route is present in this goal; BR-045 remains partial until G05 supplies and verifies the profile-scoped companion read.

Verification:

- `tests/g04-tasks.test.ts`: template category/count snapshot, D1 absence check, selected-days review requirement, D1 batch atomicity/rollback, timezone midnight/DST/weekday/one-off due checks, CRUD/archive/reorder/foreign scope, private CSRF-protected bulk-route checks, management visibility regression, and UI contract checks.
- The neutral task-state badge uses the darker `#6a5a73` token on `#f0eaf4` (5.35:1 contrast), and the amber waiting badge uses `#86633b` on `#fbf1df` (4.86:1); source assertions guard both small-text combinations.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run db:generate` pass locally.
- A fresh signed-in Playwright run at 360×800 selected Mia, narrowed Helping at home to one suggestion, confirmed that the review action was disabled until a weekday was explicitly chosen, changed the wording to “Help set our table together,” selected Monday, and saved through the atomic parent bulk route. Reloading and reselecting Mia recovered the edited D1 task as `Not due today`. This proves AC-08 and the parent half of BR-045.
- The current Family state has `scrollWidth === innerWidth === 360`, zero console errors/warnings, and zero Axe violations for WCAG 2 A/AA and WCAG 2.1 A/AA. Reduced-motion behavior is covered by the UI contract test and the parent-shell browser evidence.

Open verification:

- Saved Sites-origin due-date behavior and the complete onboarding sequence remain release-gate checks. Companion reads remain partial in BR-045 until G05 supplies and verifies the profile-scoped route.
