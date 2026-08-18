# BR-038 public landing evidence

Date: 2026-08-18

The root route is a server-rendered, mobile-first parent/caregiver entry for
Ruutin. It explains the parent-led routine model, shows a realistic
routine overview, presents the privacy/data-minimization approach, and ends
with a clear “Sign in with email” one-time-code CTA. Copy does not target
children, request prohibited profile data, introduce payment/paywall treatment,
or frame the product as a child-directed game.

The page includes keyboard focus states, a skip link, semantic landmarks, large
touch-friendly controls, reduced-motion handling, and responsive layouts from
mobile through desktop. The landing route has no server-configuration import.

Verified commands:

```text
npm run build
npm test
```

The rendered HTML test passed with status 200 and asserted the product title,
parent CTA, privacy copy, prohibited-data exclusion, and removal of starter
preview markers.
