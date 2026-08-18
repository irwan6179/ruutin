import { getD1 } from "../../../db";
import { getServerConfig } from "../../../server/config";
import { handlePairing } from "../../../server/pairing-routes";
import { publicErrorResponse } from "../../../server/error-safety";

export const dynamic = "force-dynamic";

function dependencies() {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    authHmacSecret: config.AUTH_HMAC_SECRET,
    sessionSecret: config.SESSION_SECRET,
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePairing(request, dependencies());
  } catch (error) {
    const response = publicErrorResponse(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}
