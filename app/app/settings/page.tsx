import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { getParentHousehold } from "../../../server/households";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const household = await getParentHousehold(getD1(), parent);
  return (
    <div className="ruutin-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="settings-title"><p className="ruutin-eyebrow">Your controls</p><h1 id="settings-title">Settings</h1><p>Quiet controls for the household, privacy, and your parent session.</p></section>
      <section className="ruutin-card ruutin-settings-list" aria-label="Household settings">
        <div><span className="ruutin-settings-icon" aria-hidden="true">⌂</span><span><strong>Household timezone</strong><small>{household.timezone}</small></span></div>
        <div><span className="ruutin-settings-icon" aria-hidden="true">✉</span><span><strong>Parent account</strong><small>Signed in with your email · secure parent session active</small></span></div>
        <div><span className="ruutin-settings-icon" aria-hidden="true">⌁</span><span><strong>Privacy by design</strong><small>Profiles use nicknames, emoji, and broad age bands only.</small></span></div>
      </section>
      <section className="ruutin-card ruutin-settings-note"><h2>Need to step away?</h2><p>Sign out on this device. Your household stays safely stored for your next visit.</p><SignOutButton /></section>
    </div>
  );
}
