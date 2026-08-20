"use client";

import { useState } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../../components/ActionPendingOverlay";

export function SignOutButton() {
  const { pendingLabel, navigate } = usePendingDocumentNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const bootstrap = await fetch("/api/parent/csrf", { credentials: "same-origin" });
      const payload = await bootstrap.json() as { csrfToken?: string };
      if (!bootstrap.ok || !payload.csrfToken) throw new Error("Could not verify this request");
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", headers: { "x-ruutin-csrf": payload.csrfToken } });
      if (!response.ok) throw new Error("Could not sign out yet");
      navigate("/", "Returning to the homepage…", { replace: true });
    } catch {
      setError("We couldn’t sign out yet. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="ruutin-signout-control"><ActionPendingOverlay active={busy || Boolean(pendingLabel)} label={pendingLabel || "Signing you out…"} /><button className="ruutin-button secondary" type="button" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button>{error && <p className="ruutin-form-error" role="alert" aria-live="assertive">{error}</p>}</div>;
}
