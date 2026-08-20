import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};
const companionManifest = JSON.parse(readFileSync("public/companion.webmanifest", "utf8")) as typeof manifest;

function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} is not PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("Ruutin manifest and required icon sizes are valid", () => {
  assert.equal(manifest.name, "Ruutin");
  assert.equal(manifest.short_name, "Ruutin");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#543881");
  assert.equal(manifest.background_color, "#fcfafc");
  assert.deepEqual(pngSize("public/icon-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/icon-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/icon-512-maskable.png"), [512, 512]);
  assert.deepEqual(pngSize("public/apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(pngSize("public/ruutin-social-card.png"), [1728, 910]);
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"));
});

test("companion installs have a distinct identity and launch inside companion scope", () => {
  assert.equal(companionManifest.name, "Ruutin Companion");
  assert.equal(companionManifest.short_name, "Ruutin");
  assert.equal(companionManifest.id, "/companion");
  assert.equal(companionManifest.start_url, "/companion/today");
  assert.equal(companionManifest.scope, "/");
  assert.equal(companionManifest.display, "standalone");
  assert.equal(companionManifest.theme_color, manifest.theme_color);
  assert.equal(companionManifest.background_color, manifest.background_color);
  assert.deepEqual(companionManifest.icons, manifest.icons);
  assert.doesNotMatch(companionManifest.start_url, /[?#]/u);
});

test("layout emits install metadata and companion guidance is standalone-aware", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const companionLayout = readFileSync("app/companion/layout.tsx", "utf8");
  const guidance = readFileSync("app/companion/InstallGuidance.tsx", "utf8");
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(companionLayout, /manifest: "\/companion\/manifest\.webmanifest"/);
  assert.match(companionLayout, /appleWebApp: \{ capable: true, title: appName/);
  const companionManifestRoute = readFileSync("app/companion/manifest.webmanifest/route.ts", "utf8");
  assert.match(companionManifestRoute, /short_name: name/);
  assert.match(companionManifestRoute, /Cache-Control.*private, no-store/);
  assert.match(companionManifestRoute, /resolveCompanionContext/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(layout, /apple: "\/apple-touch-icon\.png"/);
  assert.match(layout, /url: "\/ruutin-social-card\.png"/);
  assert.match(layout, /metadataBase: new URL\("https:\/\/ruutin\.irwan\.cc"\)/);
  assert.match(guidance, /display-mode: standalone/);
  assert.match(guidance, /if \(standalone\) return null/);
  assert.match(guidance, /<strong>iPhone:<\/strong>/);
  assert.match(guidance, /fresh six-digit code/);
  assert.match(guidance, /Add to Home Screen/);
  assert.match(guidance, /Install app/);
});

test("the app keeps the service-worker probe disposable and cache-free", () => {
  const probe = readFileSync("app/runtime-probe/ServiceWorkerProbe.tsx", "utf8");
  const worker = readFileSync("public/sw-probe.js", "utf8");
  const development = readFileSync("docs/DEVELOPMENT.md", "utf8");
  assert.match(probe, /unregister/);
  assert.match(worker, /no fetch handler/i);
  assert.doesNotMatch(worker, /caches\.(open|match|put)/);
  assert.match(development, /deliberately does not ship an application service\s+worker/);
});

test("primary surfaces expose authoritative manual and foreground refresh", () => {
  for (const path of [
    "app/app/today/TodayManager.tsx",
    "app/app/rewards/RewardsManager.tsx",
    "app/companion/today/CompanionTodayManager.tsx",
    "app/companion/rewards/CompanionRewardsManager.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /Refresh/);
    assert.match(source, /visibilitychange/);
    assert.match(source, /cache: "no-store"/);
  }
});
