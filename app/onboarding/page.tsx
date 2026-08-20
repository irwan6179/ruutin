import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Keep the short setup URL compatible with links shared from the first-login prompt. */
export default function OnboardingEntry() {
  redirect("/app/onboarding");
}
