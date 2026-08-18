import assert from "node:assert/strict";
import test from "node:test";
import {
  EmailAdapterError,
  loadEmailConfig,
  sendEmail,
} from "../server/email-adapter";

const config = {
  EMAIL_API_URL: "https://api.resend.com/emails",
  EMAIL_API_KEY: "re_test_key",
  EMAIL_FROM: "Ruutin <noreply@example.test>",
};

test("builds the Resend-compatible POST without exposing response data", async () => {
  let request: { url: string; init: RequestInit } | undefined;

  const fetchImpl: typeof fetch = async (url, init) => {
    request = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({ id: "provider-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await sendEmail(
    config,
    {
      to: "probe@example.test",
      subject: "Reachability",
      text: "A temporary probe.",
    },
    { fetchImpl, timeoutMs: 100 },
  );

  assert.ok(request);
  assert.equal(request.url, config.EMAIL_API_URL);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers instanceof Headers, false);

  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("authorization"), "Bearer re_test_key");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    from: config.EMAIL_FROM,
    to: ["probe@example.test"],
    subject: "Reachability",
    text: "A temporary probe.",
  });
});

test("rejects non-HTTPS provider endpoints before fetch", () => {
  assert.throws(
    () =>
      loadEmailConfig({
        ...config,
        EMAIL_API_URL: "http://api.example.test/emails",
      }),
    (error: unknown) =>
      error instanceof EmailAdapterError && error.reason === "configuration",
  );
});

test("maps provider failures to a sanitized error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("secret provider diagnostics", { status: 403 });

  await assert.rejects(
    sendEmail(
      config,
      {
        to: "probe@example.test",
        subject: "Reachability",
        text: "A temporary probe.",
      },
      { fetchImpl, timeoutMs: 100 },
    ),
    (error: unknown) => {
      assert.ok(error instanceof EmailAdapterError);
      assert.equal(error.reason, "provider");
      assert.equal(error.message, "Email delivery failed");
      assert.doesNotMatch(error.message, /secret|diagnostics|403/);
      return true;
    },
  );
});

test("maps an aborted fetch to a timeout without retaining the cause", async () => {
  const fetchImpl: typeof fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("timed out", "AbortError"));
      });
    });

  await assert.rejects(
    sendEmail(
      config,
      {
        to: "probe@example.test",
        subject: "Reachability",
        text: "A temporary probe.",
      },
      { fetchImpl, timeoutMs: 5 },
    ),
    (error: unknown) =>
      error instanceof EmailAdapterError &&
      error.reason === "timeout" &&
      error.message === "Email delivery failed",
  );
});
