# BR-006 quality command evidence

Date: 2026-08-18

The root scripts expose format, lint, typecheck, tests, build, secret scan,
database generation, and an aggregate quality command. The commands are
documented in `README.md` and this development contract.

Verified command:

```text
npm run quality
```

Result: passed. This ran `format:check`, `lint`, `typecheck`, `npm test`, and
`scan:secrets`. The test step built the Worker bundle and passed both
server-rendered landing-page tests.
