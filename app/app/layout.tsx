import { redirect } from "next/navigation";
import { ParentShell } from "./ParentShell";
import { getParentPageContext } from "./page-context";

export const dynamic = "force-dynamic";

function isFrameworkRedirect(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT;"),
  );
}

export default async function ParentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    await getParentPageContext();
  } catch (error) {
    if (isFrameworkRedirect(error)) throw error;
    // A configuration, authentication, or database failure fails closed at
    // the protected boundary without exposing its cause.
    redirect("/");
  }
  return <ParentShell>{children}</ParentShell>;
}
