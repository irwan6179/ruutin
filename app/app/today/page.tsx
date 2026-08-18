import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { getTodayOverview } from "../../../server/today";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const overview = await getTodayOverview(getD1(), parent);
  return (
    <div className="ruutin-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="today-title">
        <p className="ruutin-eyebrow">{overview.household.name} · {overview.localDate}</p>
        <h1 id="today-title">A little progress, together.</h1>
        <p>Here&apos;s the gentle overview for today. You stay in charge of every approval.</p>
      </section>
      {overview.profiles.length === 0 ? (
        <OnboardingPrompt compact />
      ) : (
        <section className="ruutin-profile-grid" aria-label="Family progress">
          {overview.profiles.map((profile) => {
            const progress = profile.taskCount > 0 ? Math.round((profile.completedTaskCount / profile.taskCount) * 100) : 0;
            return (
              <article className="ruutin-card ruutin-profile-card" key={profile.id}>
                <div className="ruutin-profile-card-top">
                  <span className="ruutin-avatar" aria-hidden="true">{profile.emoji}</span>
                  <div><h2>{profile.nickname}</h2><p>{profile.archivedAt ? "Archived" : `${progress}% of today’s rhythm`}</p></div>
                  <span className="ruutin-balance" aria-label={`${profile.balance} stars`}>{profile.balance} ✦</span>
                </div>
                <div className="ruutin-progress" role="progressbar" aria-label={`${profile.nickname}'s routine progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div>
                <div className="ruutin-card-meta"><span>{profile.completedTaskCount} of {profile.taskCount} routines</span><span>{profile.pendingClaimCount ? `${profile.pendingClaimCount} waiting` : "Nothing waiting"}</span></div>
                {profile.activeReward ? <p className="ruutin-reward-note">{profile.activeReward.emoji} {profile.activeReward.title} · {profile.activeReward.starCost} stars</p> : <p className="ruutin-muted-note">No active reward yet</p>}
              </article>
            );
          })}
        </section>
      )}
      <section className="ruutin-card ruutin-queue-card" aria-labelledby="queue-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent review</p><h2 id="queue-title">Waiting for you</h2></div><span className="ruutin-count-pill">{overview.pendingClaims.length}</span></div>
        {overview.pendingClaims.length === 0 ? <p className="ruutin-empty-state">No approvals waiting. The queue will appear here when a routine is submitted.</p> : <ul className="ruutin-simple-list">{overview.pendingClaims.map((claim) => <li key={claim.id}><span className="ruutin-avatar small" aria-hidden="true">{claim.emoji}</span><span><strong>{claim.nickname}</strong><small>{claim.taskTitle} · {claim.stars} stars</small></span><span className="ruutin-muted-note">Review soon</span></li>)}</ul>}
      </section>
    </div>
  );
}
