import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parentUi = readFileSync("app/app/rewards/RewardsManager.tsx", "utf8");
const companionUi = readFileSync("app/companion/rewards/CompanionRewardsManager.tsx", "utf8");
const todayUi = readFileSync("app/app/today/TodayManager.tsx", "utf8");
const pageCss = readFileSync("app/globals.css", "utf8");

test("parent rewards UI exposes catalogue, templates, active goal, archive, and authoritative request refresh", () => {
  assert.match(parentUi, /REWARD_TEMPLATES/);
  assert.match(parentUi, /Start from a gentle idea/);
  assert.match(parentUi, /Make active goal/);
  assert.match(parentUi, /Archive/);
  assert.match(parentUi, /status=all/);
  assert.match(parentUi, /await refresh\(\)/);
  assert.match(parentUi, /not a shop or a competition/);
});

test("companion rewards UI remains assigned-profile friendly and shows progress, requests, and history", () => {
  assert.match(companionUi, /Progress towards/);
  assert.match(companionUi, /more to go/);
  assert.match(companionUi, /Ask parent/);
  assert.match(companionUi, /Waiting for parent review/);
  assert.match(companionUi, /A clear record/);
  assert.match(companionUi, /api\/companion\/rewards\/requests/);
  assert.match(companionUi, /assigned-profile|parent chooses|no rush/i);
});

test("Today includes a reward request queue and uses the same guarded decision route", () => {
  assert.match(todayUi, /pendingRewardRequests/);
  assert.match(todayUi, /reward-queue-title/);
  assert.match(todayUi, /api\/parent\/rewards\/requests/);
  assert.match(todayUi, /Approved — the stars are safely recorded/);
  assert.match(todayUi, /pendingReviewCount > 0 && <section className="ruutin-today-action-rail"/);
  assert.doesNotMatch(todayUi, /All caught up|Nice work, family/);
  assert.match(todayUi, /active=\{\(Boolean\(busyKey\) && !completingTask\) \|\| refreshing\}/);
  assert.match(todayUi, /className="ruutin-inline-spinner"/);
  assert.match(pageCss, /\.ruutin-inline-spinner \{/);
});

test("reward UI motion is brief and reduced-motion safe", () => {
  assert.match(pageCss, /ruutin-reward-card/);
  assert.match(pageCss, /prefers-reduced-motion/);
  assert.match(pageCss, /transition: transform 160ms ease/);
});
