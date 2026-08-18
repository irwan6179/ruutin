# Sites custom domain — ruutin.irwan.cc

Status: attached to the existing ChatGPT Sites project; DNS and SSL validation
are pending.

- Sites project: `appgprj_6a843d7213f48191a018dcd53f819afb`
- Custom-domain ID: `appgdom_6a844757b34c8191881f0937d301d9b4`
- Hostname: `ruutin.irwan.cc`
- CNAME target: `custom-domains.chatgpt.site.`
- Provider status: pending
- SSL status: initializing

Required DNS records:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `ruutin.irwan.cc` | `custom-domains.chatgpt.site.` |
| TXT | `_openai-site-verification.ruutin.irwan.cc` | `openai-site-verification=DM9QHrmkO2_xwFxdU1UI2OyZke9p7c5Wv7ZFKimk1To` |
| TXT | `_cf-custom-hostname.ruutin.irwan.cc` | `0c4c4b4e-46f1-4aa9-8668-b4c72d6881a9` |

At G10, refresh the Sites custom-domain status and verify HTTPS routing, SSL,
redirect/canonical behavior, private cache headers, and the complete acceptance
suite on this hostname. The Sites deployment remains the only application host.
