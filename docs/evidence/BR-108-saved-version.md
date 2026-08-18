# BR-108 — reviewable Sites version

Status: **PASS — saved, not deployed**

ChatGPT Sites version **11** was saved on 2026-08-19 from the exact tested and
pushed source commit `779bbf9bf75acdb99c61179c9af4fa56489b4fbe`.

- Version ID: `appgprj_6a843d7213f48191a018dcd53f819afb~appgver_8f2c3832e7608191af6035b7c94984d6`
- Archive: tar, 196 files, 3,891,200 bytes
- Content hash: `sha256:2d9a75b139069ae4c5ded748abf75166527c82fbb78fe00603d5d501b1ad1e64`
- Change summary: complete Ruutin parent/companion flows, secure email TAC
  authentication, profiles and age/consent rules, routine setup, pairing,
  claims, exactly-once star ledger, rewards, privacy/export/deletion,
  mobile-first PWA metadata, and playful reduced-motion-aware interactions.
- Secrets/test identities: none are present in the source archive or evidence.

## Known release gates

- `EMAIL_API_KEY` and `EMAIL_FROM` are not configured in Sites, so live email
  TAC delivery (AC-01) cannot pass yet.
- The custom domain is registered with Sites, but its public DNS CNAME is not
  yet visible; final custom-domain routing remains pending.
- Sites-origin verification (AC-26) requires a deployment and is intentionally
  not claimed from this saved-only checkpoint.

## Rollback

Production remains on Sites version 10. If a later deployment fails its smoke
checks, redeploy version 10 while retaining the newer saved version for repair.

Saving version 11 did not publish or change the production URL.
