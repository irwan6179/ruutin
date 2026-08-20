"use client";

import { useEffect, useState } from "react";

type ProbeState =
  | "checking"
  | "unsupported"
  | "registered"
  | "registration-failed";

type ProbeResult = {
  state: ProbeState;
  detail: string;
};

const PROBE_SCRIPT = "/sw-probe.js";
const PROBE_SCOPE = "/runtime-probe/";

export async function probeServiceWorker(): Promise<ProbeResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return {
      state: "unsupported",
      detail: "This origin does not expose the ServiceWorker API.",
    };
  }

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.register(PROBE_SCRIPT, {
      scope: PROBE_SCOPE,
    });

    // The script has no fetch handler and opens no Cache Storage entries. It
    // only proves that this origin accepts a service-worker registration.
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (worker?.state === "installing") {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1500);
        worker.addEventListener(
          "statechange",
          () => {
            if (worker.state !== "installing") {
              window.clearTimeout(timeout);
              resolve();
            }
          },
          { once: true },
        );
      });
    }

    return {
      state: "registered",
      detail: `Registration accepted for ${registration.scope}`,
    };
  } catch {
    return {
      state: "registration-failed",
      detail: "The origin rejected service-worker registration.",
    };
  } finally {
    // The probe is disposable and never leaves a worker controlling the app.
    try {
      await registration?.unregister();
    } catch {
      // Registration support is still useful evidence if cleanup is rejected.
    }
  }
}

export function ServiceWorkerProbe() {
  const [result, setResult] = useState<ProbeResult>({
    state: "checking",
    detail: "Checking this origin…",
  });

  useEffect(() => {
    let mounted = true;
    void probeServiceWorker().then((nextResult) => {
      if (mounted) setResult(nextResult);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <p aria-live="polite" data-probe-state={result.state}>
      <strong>{result.state === "registered" ? "Supported" : result.state}</strong>{" "}
      — {result.detail}
    </p>
  );
}
