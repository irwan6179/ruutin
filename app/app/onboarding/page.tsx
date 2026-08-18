import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { countOnboardingRows } from "../../../server/today";
import { listProfilesForParent } from "../../../server/profiles";
import { getParentHousehold } from "../../../server/households";
import { deriveOnboardingState } from "../../../server/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingFlow initialState={deriveOnboardingState({ hasHousehold: false, profileCount: 0, taskCount: 0, rewardCount: 0 })} initialHousehold={null} initialProfiles={[]} />;
  const db = getD1();
  const household = await getParentHousehold(db, parent);
  const [profiles, rows] = await Promise.all([listProfilesForParent(db, parent), countOnboardingRows(db, parent)]);
  return <OnboardingFlow initialState={deriveOnboardingState({ hasHousehold: true, profileCount: profiles.length, ...rows })} initialHousehold={household} initialProfiles={profiles} />;
}
