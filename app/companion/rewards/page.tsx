import { getD1 } from "../../../db";
import { getCompanionRewards } from "../../../server/companion";
import { listRewardRequestsForCompanion } from "../../../server/rewards";
import { getCompanionPageContext } from "../page-context";
import { CompanionRewardsManager } from "./CompanionRewardsManager";

export const dynamic = "force-dynamic";

export default async function CompanionRewardsPage() {
  const context = await getCompanionPageContext();
  const db = getD1();
  const [rewards, requests] = await Promise.all([
    getCompanionRewards(db, context),
    listRewardRequestsForCompanion(db, context),
  ]);
  return <CompanionRewardsManager initialRewards={rewards} initialRequests={requests} />;
}
