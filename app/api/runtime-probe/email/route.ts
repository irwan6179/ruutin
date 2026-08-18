import { env } from "cloudflare:workers";
import {
  EmailAdapterError,
  loadEmailConfig,
  sendEmail,
} from "../../../../server/email-adapter";
import {
  hasBearerProbeSecret,
  readEmailProbeConfig,
} from "../../../../server/email-probe";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function jsonResponse(
  body: Record<string, boolean | string>,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function unavailableResponse(): Response {
  return jsonResponse({ error: "unavailable" }, 503);
}

/**
 * Temporary BR-002-only server-side email reachability probe.
 *
 * This route deliberately has no GET handler that sends mail. A POST is
 * accepted only when both temporary server-only probe variables are present
 * and the request carries the exact bearer secret. It sends a static message,
 * never a TAC or any caller-supplied content.
 */
export async function POST(request: Request): Promise<Response> {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const probeConfig = readEmailProbeConfig(runtimeEnv);

  // A missing temporary recipient or probe secret disables the route and
  // prevents even an attempted provider call.
  if (!probeConfig) {
    return jsonResponse({ error: "probe_disabled" }, 503);
  }

  if (!hasBearerProbeSecret(request, probeConfig.RUNTIME_PROBE_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let emailConfig;
  try {
    emailConfig = loadEmailConfig(runtimeEnv);
  } catch {
    // Keep configuration state and provider details out of the response.
    return jsonResponse({ error: "configuration_unavailable" }, 503);
  }

  try {
    await sendEmail(emailConfig, {
      to: probeConfig.EMAIL_PROBE_TO,
      subject: "Bintang Rumah email API probe",
      text:
        "Temporary server-side reachability probe. This message contains no authentication code or application secret.",
    });
  } catch (error) {
    // A sanitized provider rejection proves the Sites runtime completed an
    // outbound HTTPS exchange with the selected API. It exposes no provider
    // body, status, credential, recipient, or message content.
    if (error instanceof EmailAdapterError && error.reason === "provider") {
      return jsonResponse({ error: "provider_rejected" }, 502);
    }

    if (
      error instanceof EmailAdapterError &&
      (error.reason === "network" || error.reason === "timeout")
    ) {
      return jsonResponse({ error: "transport_unavailable" }, 503);
    }

    return unavailableResponse();
  }

  return jsonResponse({ ok: true }, 200);
}

// Explicitly reject browser-friendly reads so the probe is POST-only and all
// responses retain the same no-store policy.
export async function GET(): Promise<Response> {
  return jsonResponse({ error: "method_not_allowed" }, 405);
}
