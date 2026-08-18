export function OnboardingPrompt({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`ruutin-card ruutin-onboarding-prompt${compact ? " compact" : ""}`} aria-labelledby="setup-title">
      <span className="ruutin-feature-icon" aria-hidden="true">✦</span>
      <div><p className="ruutin-eyebrow">A good first step</p><h1 id="setup-title">Let&apos;s set up your household.</h1><p>Add a household name, then create a profile with just a nickname and emoji. You can return whenever you&apos;re ready.</p><a className="ruutin-button" href="/app/onboarding">Start setup <span aria-hidden="true">↗</span></a></div>
    </section>
  );
}
