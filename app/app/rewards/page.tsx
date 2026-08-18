import { getParentPageContext } from "../page-context";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  return (
    <div className="ruutin-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="rewards-title"><p className="ruutin-eyebrow">Celebrate what matters</p><h1 id="rewards-title">Rewards, your way.</h1><p>Keep rewards warm and real-life. Catalogue and safe redemption controls will appear here as setup grows.</p></section>
      <section className="ruutin-card ruutin-empty-panel"><span className="ruutin-feature-icon" aria-hidden="true">✦</span><h2>No rewards added yet</h2><p>Choose a small, meaningful reward during onboarding or from Family setup. Nothing here is a shop or a competition.</p><a className="ruutin-button secondary" href="/app/family">Open Family setup <span aria-hidden="true">↗</span></a></section>
    </div>
  );
}
