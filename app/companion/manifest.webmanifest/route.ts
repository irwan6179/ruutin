import { getD1 } from "../../../db";
import { resolveCompanionContext } from "../../../server/auth-context";
import { getServerConfig } from "../../../server/config";
import { companionAppId, companionAppName } from "../app-identity";

export const dynamic = "force-dynamic";

const baseManifest = {
  description: "A calm routine and reward space for families.",
  start_url: "/companion/today",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  theme_color: "#543881",
  background_color: "#fcfafc",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export async function GET(request: Request): Promise<Response> {
  let profileId: string | undefined;
  let nickname: string | undefined;
  try {
    const config = getServerConfig();
    if (config) {
      const context = await resolveCompanionContext(request, getD1(), {
        sessionSecret: config.SESSION_SECRET,
      });
      profileId = context?.profileId;
      nickname = context?.profile.nickname;
    }
  } catch {
    // A generic manifest is still valid for a browser that has not paired yet.
  }

  const name = companionAppName(nickname);
  return new Response(JSON.stringify({
    ...baseManifest,
    name,
    short_name: name,
    id: companionAppId(profileId),
  }), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json; charset=utf-8",
      Vary: "Cookie",
    },
  });
}
