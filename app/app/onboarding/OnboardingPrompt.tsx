"use client";

import { ActionPendingOverlay, usePendingDocumentNavigation } from "../../components/ActionPendingOverlay";

export function OnboardingPrompt({ compact = false }: { compact?: boolean }) {
  const { pendingLabel, beginNavigation } = usePendingDocumentNavigation();

  return (
    <>
      <ActionPendingOverlay
        active={Boolean(pendingLabel)}
        label={pendingLabel}
        detail="Preparing the first steps for your household."
      />
      <section className={`ruutin-card ruutin-onboarding-prompt${compact ? " compact" : ""}`} aria-labelledby="setup-title">
        <span className="ruutin-feature-icon" aria-hidden="true">✦</span>
        <div><p className="ruutin-eyebrow">A good first step</p><h1 id="setup-title">Let&apos;s set up your household.</h1><p>Add a household name, then create a profile with just a nickname and emoji. You can return whenever you&apos;re ready.</p><a className="ruutin-button" href="/onboarding" onClick={(event) => beginNavigation(event, "/onboarding", "household setup")}>Start setup <span aria-hidden="true">↗</span></a></div>
      </section>
    </>
  );
}
