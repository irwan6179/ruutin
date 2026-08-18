import { getD1 } from "../../../db";
import { getCompanionRewards } from "../../../server/companion";
import { getCompanionPageContext } from "../page-context";

export const dynamic = "force-dynamic";

export default async function CompanionRewardsPage() {
  const context = await getCompanionPageContext();
  const rewards = await getCompanionRewards(getD1(), context);
  return (
    <div className="ruutin-page-stack companion-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="companion-rewards-title">
        <p className="ruutin-eyebrow">A little something to look forward to</p>
        <h1 id="companion-rewards-title">Rewards</h1>
        <p>Your parent keeps the reward choices and approvals in their space.</p>
      </section>
      <section className="ruutin-card companion-balance-card" aria-label="Star balance">
        <span className="ruutin-eyebrow">Your stars</span>
        <strong>{rewards.balance} ✦</strong>
        {rewards.activeReward ? <p>{rewards.activeReward.emoji} Working towards {rewards.activeReward.title} · {rewards.activeReward.starCost} stars</p> : <p>No active reward yet.</p>}
      </section>
      <section aria-labelledby="reward-list-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent-selected</p><h2 id="reward-list-title">Reward ideas</h2></div><span className="ruutin-count-pill">{rewards.rewards.length}</span></div>
        {rewards.rewards.length === 0 ? <p className="ruutin-empty-state">Your parent can add a reward when the time feels right.</p> : <ul className="ruutin-simple-list companion-reward-list">{rewards.rewards.map((reward) => <li key={reward.id}><span className="ruutin-avatar small" aria-hidden="true">{reward.emoji}</span><span><strong>{reward.title}</strong><small>{reward.starCost} stars{reward.isActive ? " · active" : ""}</small></span></li>)}</ul>}
      </section>
    </div>
  );
}
