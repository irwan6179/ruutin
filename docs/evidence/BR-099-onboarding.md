# BR-099 — representative new-parent onboarding evidence

Status: **PASS locally — live email and Sites-origin checks remain release gates**

This note records one deterministic local run of the new-parent path on 2026-08-19
(Asia/Kuala_Lumpur). It does not contain an email address, TAC, session token,
pairing code, or other credential. The local auth fixture was seeded in the
SQLite D1 emulator and the request/verify endpoints returned their normal
success responses. Live Resend delivery was deliberately not awaited.

## Path exercised

The run used the signed-in parent surface through the local HTTPS proxy at
360×800. It followed the real browser UI in this order:

| Stage | Local observation |
| --- | --- |
| Auth | Deterministic TAC request/verify established a parent session. The normal public auth route and private onboarding route were then opened. |
| Household | Saved a household named `G099 Ceria Home` with `Asia/Kuala_Lumpur`; the next browser step was the profile form. |
| Profile | Saved synthetic eligible profile `Ari` (`13–15`, parent consent confirmed). The server response marked companion access eligible. |
| Templates/tasks | Opened **Morning routine**, kept the five starter suggestions, selected **Review 5**, and saw editable wording, emoji, schedule, weekdays, and 1/2-star controls. **Save reviewed routines** persisted five tasks. |
| Schedule/stars review | The review showed weekday schedules for Make the bed, Get dressed, Pack water bottle, and Be ready by the agreed time, plus an every-day schedule for Brush teeth; the configured stars were 1, 1, 1, 1, and 2. The family page reloaded those records. |
| Review boundary | **Review together** rendered and continued without a private error. This is currently a boundary screen, not a durable review record. |
| Rewards | **Something to look forward to** reused the parent reward manager. A template reward was created, persisted, and made the active goal before Continue became available. |
| Pairing | **Optional companion** reused the secure PairingManager. The eligible profile created a six-digit, ten-minute pairing challenge and local pairing URL; the parent could finish or skip without pairing a second device. |

The combined deterministic local browser interaction stayed under 90 seconds,
including household, profile, five reviewed template routines, one persisted
active reward, and generation of the optional secure pairing link. Provider
email delivery time is excluded and remains a separate production gate. The
implemented interaction path is comfortably below the three-minute budget.

## Resume and eligibility checks

- A full reload after household, profile, and task writes resumed at
  **Something to look forward to**. After the reward was persisted and made
  active, a reload resumed at **Optional companion**. Both states are derived
  from D1 rows; no browser-owned progress store is required.
- Family was reopened and a synthetic `Milo` profile was saved as **Under 13**
  without consent confirmation. The card showed **Parent-managed · under 13**
  and **Pairing unavailable for this profile**; there was no pairing link or
  code action for that profile. Existing direct-route tests also deny an
  under-13 pairing attempt without creating a challenge.
- The eligible `Ari` card alone showed **Pair companion** and **Create link**.
  This confirms the UI does not expose a pairing affordance for the ineligible
  profile, while the server remains the authoritative enforcement boundary.

## Responsive, hydration, and accessibility observations

- Browser viewport: `360×800`.
- Final `document.documentElement.scrollWidth` matched the 360-pixel viewport,
  so no horizontal overflow was present.
- Reduced-motion behavior remains covered by the existing global motion guard.
  The final onboarding/pairing pass reported no console errors and zero axe
  violations after the small contrast correction.
- The timezone suggestion now uses `useSyncExternalStore` with a deterministic
  `UTC` server snapshot and the browser timezone as the client snapshot. This
  prevents the previous hydration mismatch without a set-state-in-effect
  lint violation. The selected timezone is still validated by the server.

## BR-099 decision

The local path now proves the complete household → profile → template tasks →
schedule/stars review → persisted active reward → optional eligible pairing
journey, including durable resume and the under-13 denial. BR-099 passes
locally. Live Resend delivery, the saved ChatGPT Sites origin, and
`https://ruutin.irwan.cc` remain explicit release follow-ups and are not
claimed by this evidence.
