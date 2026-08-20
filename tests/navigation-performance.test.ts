import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("protected app shells use reliable document navigation", () => {
  for (const path of [
    "app/app/ParentShell.tsx",
    "app/companion/CompanionShell.tsx",
  ]) {
    const contents = source(path);
    assert.match(contents, /<a\s+className=\{`ruutin-bottom-nav-link/u);
    assert.match(contents, /href=\{destination\.href\}/u);
    assert.match(contents, /usePendingDocumentNavigation\(\)/u);
    assert.match(contents, /beginNavigation\(event, destination\.href, destination\.label\)/u);
    assert.match(contents, /<ActionPendingOverlay/u);
    assert.doesNotMatch(contents, /from "next\/link"|useLinkStatus|prefetch=/u);
  }
});

test("successful email verification uses the first-time-aware app entry", () => {
  const authFlow = source("app/auth/AuthFlow.tsx");
  const appIndex = source("app/app/page.tsx");

  assert.match(authFlow, /navigate\("\/app", "Opening your family space…", \{ replace: true \}\)/u);
  assert.doesNotMatch(authFlow, /Continue to Ruutin|You&apos;re in|step === "success"/u);
  assert.match(appIndex, /getParentPageContext\(\)/u);
  assert.match(appIndex, /parent \? "\/app\/today" : "\/app\/onboarding"/u);
});

test("email sign-in submits with Enter and exposes an explicit busy state", () => {
  const authFlow = source("app/auth/AuthFlow.tsx");

  assert.match(authFlow, /enterKeyHint="send"/u);
  assert.match(authFlow, /aria-keyshortcuts="Enter"/u);
  assert.match(authFlow, /event\.currentTarget\.form\?\.requestSubmit\(\)/u);
  assert.match(authFlow, /<ActionPendingOverlay/u);
  assert.match(authFlow, /Sending your sign-in code…/u);
  assert.match(authFlow, /aria-busy=\{busy\}/u);
});

test("network-backed actions share a prominent accessible pending interaction", () => {
  for (const path of [
    "app/auth/AuthFlow.tsx",
    "app/pair/PairFlow.tsx",
    "app/app/family/FamilyManager.tsx",
    "app/app/family/PairingManager.tsx",
    "app/app/family/TaskManager.tsx",
    "app/app/onboarding/OnboardingFlow.tsx",
    "app/app/rewards/RewardsManager.tsx",
    "app/app/settings/SettingsManager.tsx",
    "app/app/settings/SignOutButton.tsx",
    "app/app/today/TodayManager.tsx",
    "app/companion/rewards/CompanionRewardsManager.tsx",
    "app/companion/today/CompanionTodayManager.tsx",
  ]) {
    assert.match(source(path), /<ActionPendingOverlay/u, path);
  }

  const pendingInteraction = source("app/components/ActionPendingOverlay.tsx");
  const styles = source("app/globals.css");
  assert.match(pendingInteraction, /role="status"/u);
  assert.match(pendingInteraction, /aria-live="polite"/u);
  assert.match(pendingInteraction, /aria-busy="true"/u);
  assert.match(pendingInteraction, /requestAnimationFrame/u);
  assert.match(styles, /animation: ruutin-pending-reveal 180ms 120ms both/u);
  assert.match(styles, /prefers-reduced-motion: reduce/u);
  assert.match(styles, /\.ruutin-action-pending-overlay \{ animation-delay: 0ms !important; \}/u);
});

test("verification code uses six accessible digit fields with paste support", () => {
  const authFlow = source("app/auth/AuthFlow.tsx");
  const styles = source("app/globals.css");

  assert.match(authFlow, /CODE_LENGTH = 6/u);
  assert.match(authFlow, /role="group" aria-label="Six-digit verification code"/u);
  assert.match(authFlow, /aria-label=\{`Digit \$\{index \+ 1\} of \$\{CODE_LENGTH\}`\}/u);
  assert.match(authFlow, /onPaste=\{handleCodePaste\}/u);
  assert.match(authFlow, /autoComplete=\{index === 0 \? "one-time-code" : "off"\}/u);
  assert.match(authFlow, /code\.length !== CODE_LENGTH/u);
  assert.match(styles, /\.br-auth-code-inputs \{[^}]*grid-template-columns: repeat\(6/u);
});

test("every protected navigation destination has a page route", () => {
  for (const target of [
    "app/app/today/page.tsx",
    "app/app/family/page.tsx",
    "app/app/rewards/page.tsx",
    "app/app/settings/page.tsx",
    "app/app/onboarding/page.tsx",
    "app/onboarding/page.tsx",
    "app/companion/today/page.tsx",
    "app/companion/rewards/page.tsx",
  ]) {
    assert.equal(existsSync(target), true, target);
  }
  assert.match(source("app/app/onboarding/OnboardingPrompt.tsx"), /href="\/onboarding"/u);
});

test("protected layouts and pages share one cached authentication context", () => {
  const parentContext = source("app/app/page-context.ts");
  const companionContext = source("app/companion/page-context.ts");
  const parentLayout = source("app/app/layout.tsx");
  const companionLayout = source("app/companion/layout.tsx");

  assert.match(parentContext, /getParentPageContext = cache\(/u);
  assert.match(parentContext, /parentContextFromSession\(session\)/u);
  assert.match(companionContext, /getCompanionPageContext = cache\(/u);
  assert.match(parentLayout, /await getParentPageContext\(\)/u);
  assert.match(companionLayout, /await getCompanionPageContext\(\)/u);
  assert.doesNotMatch(parentLayout, /resolveParentSession|headers\(/u);
  assert.doesNotMatch(companionLayout, /resolveCompanionContext|headers\(/u);
});

test("dynamic app areas expose route fallbacks and optimistic companion actions", () => {
  for (const path of ["app/app/loading.tsx", "app/companion/loading.tsx"]) {
    const contents = source(path);
    assert.match(contents, /ruutin-route-loading/u);
    assert.match(contents, /aria-busy="true"/u);
    assert.match(contents, /aria-live="polite"/u);
  }
  for (const path of [
    "app/app/family/loading.tsx",
    "app/app/onboarding/loading.tsx",
    "app/app/rewards/loading.tsx",
    "app/app/settings/loading.tsx",
    "app/companion/rewards/loading.tsx",
    "app/companion/today/loading.tsx",
  ]) {
    assert.match(source(path), /export \{ default \} from "\.\.\/loading"/u);
  }

  const companionToday = source("app/companion/today/CompanionTodayManager.tsx");
  assert.match(companionToday, /state: "waiting"/u);
  assert.ok(
    companionToday.indexOf('state: "waiting"') < companionToday.indexOf('await fetch("/api/companion/today"'),
    "companion completion should become waiting before its network request",
  );
  assert.match(
    source("app/companion/rewards/CompanionRewardsManager.tsx"),
    /optimistic-\$\{crypto\.randomUUID\(\)\}/u,
  );
});
