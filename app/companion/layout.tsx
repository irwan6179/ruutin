import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getD1 } from "../../db";
import { getServerConfig } from "../../server/config";
import { resolveCompanionContext } from "../../server/auth-context";
import { CompanionShell } from "./CompanionShell";

export const dynamic = "force-dynamic";

export default async function CompanionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const config = getServerConfig();
  if (!config) redirect("/pair");
  const request = new Request("https://ruutin.local/companion", {
    headers: { Cookie: requestHeaders.get("cookie") ?? "" },
  });
  let context;
  try {
    context = await resolveCompanionContext(request, getD1(), {
      sessionSecret: config.SESSION_SECRET,
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;")) throw error;
    redirect("/pair");
  }
  if (!context) redirect("/pair");
  return <CompanionShell profile={context.profile}>{children}</CompanionShell>;
}
