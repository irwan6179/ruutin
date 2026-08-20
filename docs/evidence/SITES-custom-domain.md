# Sites custom domain — ruutin.irwan.cc

Status: attached to the existing ChatGPT Sites project. The public CNAME now
resolves, and the provider and SSL layers are active. Sites still reports the
overall attachment as pending until the new application version is published.

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
| TXT | `_openai-site-verification.ruutin.irwan.cc` | Configured privately; verification value omitted |
| TXT | `_cf-custom-hostname.ruutin.irwan.cc` | Configured privately; provider value omitted |

The provider has accepted validation and issued SSL. After publishing, refresh
the overall status and verify HTTPS routing, canonical behavior, private cache
headers, and the remaining acceptance checks on this hostname. The Sites
deployment remains the only application host.
