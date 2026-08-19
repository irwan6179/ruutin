import { headers } from "next/headers";
import { cache } from "react";
import { getD1 } from "../../db";
import { getServerConfig } from "../../server/config";
import { resolveCompanionContext, type CompanionContext } from "../../server/auth-context";

export const getCompanionPageContext = cache(async (): Promise<CompanionContext> => {
  const requestHeaders = await headers();
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  const request = new Request("https://ruutin.local/companion", {
    headers: { Cookie: requestHeaders.get("cookie") ?? "" },
  });
  const context = await resolveCompanionContext(request, getD1(), {
    sessionSecret: config.SESSION_SECRET,
  });
  if (!context) throw new Error("Companion authentication required");
  return context;
});
