import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Ruutin parent landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Ruutin \| Calm routines for busy families<\/title>/i);
  assert.match(html, /Small routines\./);
  assert.match(html, /Sign in with email/);
  assert.match(html, /href="\/signin"/);
  assert.doesNotMatch(
    html,
    /Three small moves|Pick\. Do\.|Parents decide|Clear for kids|No passwords to manage/i,
  );
  assert.doesNotMatch(html, /id="ruutin-email"|class="br-auth-flow"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  assert.doesNotMatch(html, /paywall|payment|leaderboard|sibling ranking/i);
});

test("server-renders the email sign-in route", async () => {
  const response = await render("/signin");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Sign in \| Ruutin<\/title>/i);
  assert.match(html, /Parent access/);
  assert.match(html, /Sign in with email/);
  assert.match(html, /id="ruutin-email"/);
  assert.match(html, /six-digit code/i);
});

test("starter preview infrastructure is removed from the finished slice", async () => {
  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});
