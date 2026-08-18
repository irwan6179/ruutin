import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getD1 } from "../../db";
import { getServerConfig } from "../../server/config";
import { resolveParentSession } from "../../server/auth-context";
import { ParentShell } from "./ParentShell";

export const dynamic = "force-dynamic";

export default async function ParentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const request = new Request("https://ruutin.local/app", { headers: { Cookie: requestHeaders.get("cookie") ?? "" } });
  try {
    const config = getServerConfig();
    if (!config) {
      redirect("/");
    }
    const session = await resolveParentSession(request, getD1(), { sessionSecret: config.SESSION_SECRET });
    if (!session) redirect("/");
  } catch (error) {
    // Preserve framework redirects; a configuration/database failure fails
    // closed at the protected boundary without exposing its cause.
    if (error && typeof error === "object" && "digest" in error && String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;")) throw error;
    redirect("/");
  }
  return <ParentShell>{children}</ParentShell>;
}
