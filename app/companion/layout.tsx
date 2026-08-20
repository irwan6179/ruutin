import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanionShell } from "./CompanionShell";
import { companionAppName } from "./app-identity";
import { getCompanionPageContext } from "./page-context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  let nickname: string | undefined;
  try {
    nickname = (await getCompanionPageContext()).profile.nickname;
  } catch {
    // The generic name keeps the manifest useful before pairing or after expiry.
  }
  const appName = companionAppName(nickname);
  return {
    manifest: "/companion/manifest.webmanifest",
    title: appName,
    appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
  };
}

function isFrameworkRedirect(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;"),
  );
}

export default async function CompanionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let context;
  try {
    context = await getCompanionPageContext();
  } catch (error) {
    if (isFrameworkRedirect(error)) throw error;
    redirect("/pair");
  }
  return <CompanionShell profile={context.profile}>{children}</CompanionShell>;
}
