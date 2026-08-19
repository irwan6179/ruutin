import { redirect } from "next/navigation";
import { getParentPageContext } from "./page-context";

export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const { parent } = await getParentPageContext();
  redirect(parent ? "/app/today" : "/app/onboarding");
}
