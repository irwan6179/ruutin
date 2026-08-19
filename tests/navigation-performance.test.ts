import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("app shells use private soft navigation with accessible pending feedback", () => {
  for (const path of [
    "app/app/ParentShell.tsx",
    "app/companion/CompanionShell.tsx",
  ]) {
    const contents = source(path);
    assert.match(contents, /import Link, \{ useLinkStatus \} from "next\/link"/u);
    assert.match(contents, /prefetch=\{false\}/u);
    assert.match(contents, /aria-busy=\{pending\}/u);
    assert.match(contents, /Loading \{label\}/u);
    assert.doesNotMatch(contents, /<a\s+className=\{`ruutin-bottom-nav-link/u);
  }
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

  assert.match(
    source("app/companion/today/CompanionTodayManager.tsx"),
    /state: "waiting"[\s\S]*setSelectedTask\(null\)/u,
  );
  assert.match(
    source("app/companion/rewards/CompanionRewardsManager.tsx"),
    /optimistic-\$\{crypto\.randomUUID\(\)\}/u,
  );
});
