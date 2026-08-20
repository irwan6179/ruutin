"use client";

import { useEffect } from "react";

export type ClientExperienceEventName =
  | "parent_today_opened"
  | "companion_today_opened"
  | "onboarding_completed"
  | "install_guidance_opened";

let csrfRequest: Promise<string> | null = null;

async function experienceCsrf(): Promise<string> {
  csrfRequest ??= fetch("/api/experience", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      const payload = (await response.json()) as { csrfToken?: string };
      if (!response.ok || !payload.csrfToken) {
        throw new Error("Experience signal is unavailable");
      }
      return payload.csrfToken;
    })
    .catch((error: unknown) => {
      csrfRequest = null;
      throw error;
    });
  return csrfRequest;
}

/**
 * Send only an allow-listed event name. Failures are intentionally silent:
 * measurement must never block a family task, reward, or navigation.
 */
export async function recordExperienceSignal(
  eventName: ClientExperienceEventName,
): Promise<void> {
  try {
    const token = await experienceCsrf();
    await fetch("/api/experience", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-ruutin-csrf": token,
      },
      body: JSON.stringify({ eventName }),
    });
  } catch {
    // Product measurement is best effort and never user-facing.
  }
}

export function ExperiencePing({
  eventName,
}: {
  eventName: ClientExperienceEventName;
}) {
  useEffect(() => {
    void recordExperienceSignal(eventName);
  }, [eventName]);

  return null;
}
