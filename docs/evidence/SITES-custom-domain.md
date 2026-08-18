# Sites custom domain — ruutin.irwan.cc

Status: attached to the existing ChatGPT Sites project. The public CNAME now
resolves, and the provider and SSL layers are active. Sites still reports the
overall attachment as pending until the new application version is published.

- Sites project: `appgprj_6a843d7213f48191a018dcd53f819afb`
- Custom-domain ID: `appgdom_6a844757b34c8191881f0937d301d9b4`
- Hostname: `ruutin.irwan.cc`
- CNAME target: `custom-domains.chatgpt.site.`
- Provider status: active
- SSL status: active
- Public DNS observation (2026-08-19): `ruutin.irwan.cc` resolves as a CNAME to
  `custom-domains.chatgpt.site.`

Provisioning records supplied during setup:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `ruutin.irwan.cc` | `custom-domains.chatgpt.site.` |
| TXT | `_openai-site-verification.ruutin.irwan.cc` | `openai-site-verification=DM9QHrmkO2_xwFxdU1UI2OyZke9p7c5Wv7ZFKimk1To` |
| TXT | `_cf-custom-hostname.ruutin.irwan.cc` | `0c4c4b4e-46f1-4aa9-8668-b4c72d6881a9` |

The provider has accepted validation and issued SSL. After publishing, refresh
the overall status and verify HTTPS routing, canonical behavior, private cache
headers, and the remaining acceptance checks on this hostname. The Sites
deployment remains the only application host.
