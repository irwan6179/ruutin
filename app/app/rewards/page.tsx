import { getD1 } from "../../../db";
import { listProfilesForParent } from "../../../server/profiles";
import { listRewardsForParent, listRewardRequestsForParent } from "../../../server/rewards";
import { getParentPageContext } from "../page-context";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { RewardsManager } from "./RewardsManager";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const db = getD1();
  const [profiles, rewards, requests] = await Promise.all([
    listProfilesForParent(db, parent),
    listRewardsForParent(db, parent),
    listRewardRequestsForParent(db, parent),
  ]);
  return <RewardsManager initialProfiles={profiles} initialRewards={rewards} initialRequests={requests} />;
}
