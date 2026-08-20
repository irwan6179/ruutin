# BR-108 — reviewable Sites version

Status: **PASS — saved and deployed**

The validated Ruutin source was saved and published to the configured ChatGPT
Sites project. Opaque provider IDs are intentionally omitted from this public
evidence record.

- Archive: tar, 196 files, 3,891,200 bytes
- Change summary: complete Ruutin parent/companion flows, secure email TAC
  authentication, profiles and age/consent rules, routine setup, pairing,
  claims, exactly-once star ledger, rewards, privacy/export/deletion,
  mobile-first PWA metadata, and playful reduced-motion-aware interactions.
- Secrets/test identities: none are present in the source archive or evidence.

## Known release gates

- `EMAIL_API_KEY` and `EMAIL_FROM` are not configured in Sites, so live email
  TAC delivery (AC-01) cannot pass yet.
- The custom domain `https://ruutin.irwan.cc` is active and serves the published
  version.

## Rollback

If a later deployment fails its smoke checks, use the Sites version history to
select the last known-good release for rollback.
