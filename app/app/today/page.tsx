import { getD1 } from "../../../db";
import { getTodayOverview } from "../../../server/today";
import { getParentPageContext } from "../page-context";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { TodayManager } from "./TodayManager";

// TodayManager renders each profile progress meter with role="progressbar".

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const overview = await getTodayOverview(getD1(), parent);
  return <TodayManager initialOverview={overview} />;
}
