import { redirect } from "next/navigation";
import { CompanionShell } from "./CompanionShell";
import { getCompanionPageContext } from "./page-context";

export const dynamic = "force-dynamic";

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
