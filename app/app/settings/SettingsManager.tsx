"use client";

import { FormEvent, useState } from "react";
import { SignOutButton } from "./SignOutButton";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../../components/ActionPendingOverlay";

type SettingsData = Readonly<{
  account: { email: string };
  household: { id: string; name: string; timezone: string; createdAt: string };
}>;

type DeleteStage = "idle" | "code" | "confirm";

async function csrfToken(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Request could not be verified");
  return payload.csrfToken;
}

async function sendJson(path: string, body: Record<string, unknown>): Promise<Response> {
  const token = await csrfToken();
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-ruutin-csrf": token,
    },
    body: JSON.stringify(body),
  });
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown };
    return typeof payload.message === "string" ? payload.message : fallback;
  } catch {
    return fallback;
  }
}

export function SettingsManager({ initialSettings }: { initialSettings: SettingsData }) {
  const { pendingLabel, navigate } = usePendingDocumentNavigation();
  const [timezone, setTimezone] = useState(initialSettings.household.timezone);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneMessage, setTimezoneMessage] = useState("");
  const [timezoneError, setTimezoneError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [deleteStage, setDeleteStage] = useState<DeleteStage>("idle");
  const [deleteCode, setDeleteCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState("");
  const [deletionError, setDeletionError] = useState("");

  async function saveTimezone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingTimezone) return;
    setSavingTimezone(true);
    setTimezoneError("");
    setTimezoneMessage("");
    try {
      const token = await csrfToken();
      const response = await fetch("/api/parent/settings", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-ruutin-csrf": token },
        body: JSON.stringify({ timezone }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "We couldn’t save that timezone yet."));
      setTimezoneMessage("Timezone saved. Future due dates will use it; recorded star dates stay unchanged.");
    } catch (error) {
      setTimezoneError(error instanceof Error ? error.message : "We couldn’t save that timezone yet.");
    } finally {
      setSavingTimezone(false);
    }
  }

  async function downloadExport() {
    if (exporting) return;
    setExporting(true);
    setExportMessage("");
    try {
      const response = await fetch("/api/parent/settings/export", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response, "We couldn’t prepare your export yet."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ruutin-household-export.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportMessage("Your household export is ready.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "We couldn’t prepare your export yet.");
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletionCode() {
    if (deletionBusy) return;
    setDeletionBusy(true);
    setDeletionError("");
    setDeletionMessage("");
    try {
      const response = await sendJson("/api/parent/settings/deletion/challenge", {});
      if (!response.ok) throw new Error(await responseMessage(response, "We couldn’t send a confirmation code yet."));
      setDeleteStage("code");
      setDeletionMessage("If your parent email can receive it, a one-use code is on its way.");
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : "We couldn’t send a confirmation code yet.");
    } finally {
      setDeletionBusy(false);
    }
  }

  async function verifyDeletionCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletionBusy) return;
    setDeletionBusy(true);
    setDeletionError("");
    setDeletionMessage("");
    try {
      const response = await sendJson("/api/parent/settings/deletion/verify", { code: deleteCode });
      if (!response.ok) throw new Error(await responseMessage(response, "That code is invalid or has expired."));
      setDeleteStage("confirm");
      setDeleteCode("");
      setDeletionMessage("Fresh confirmation accepted. Type DELETE to continue.");
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : "That code is invalid or has expired.");
    } finally {
      setDeletionBusy(false);
    }
  }

  async function permanentlyDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletionBusy) return;
    setDeletionBusy(true);
    setDeletionError("");
    setDeletionMessage("");
    try {
      const response = await sendJson("/api/parent/settings/deletion", { confirmation });
      if (!response.ok) throw new Error(await responseMessage(response, "We couldn’t delete this household yet."));
      navigate("/", "Returning to the homepage…", { replace: true });
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : "We couldn’t delete this household yet.");
      setDeletionBusy(false);
    }
  }

  return (
    <div className="ruutin-page-stack">
      <ActionPendingOverlay
        active={savingTimezone || exporting || deletionBusy || Boolean(pendingLabel)}
        label={pendingLabel || (savingTimezone ? "Saving your timezone…" : exporting ? "Preparing your download…" : deleteStage === "confirm" ? "Deleting this household…" : deleteStage === "code" ? "Checking the confirmation code…" : "Sending a confirmation code…")}
      />
      <section className="ruutin-page-heading" aria-labelledby="settings-title">
        <p className="ruutin-eyebrow">Your controls</p>
        <h1 id="settings-title">Settings</h1>
        <p>Household controls and privacy, in one calm place.</p>
      </section>

      <section className="ruutin-card ruutin-settings-panel" aria-labelledby="account-title">
        <div className="ruutin-settings-section-heading"><div><p className="ruutin-eyebrow">Account</p><h2 id="account-title">Parent access</h2></div><span className="ruutin-settings-icon" aria-hidden="true">✉</span></div>
        <p className="ruutin-settings-value">{initialSettings.account.email}</p>
        <p className="ruutin-form-help">This address is for parent access and household recovery. It is never shown in the companion space.</p>
      </section>

      <section className="ruutin-card ruutin-settings-panel" aria-labelledby="timezone-title">
        <div className="ruutin-settings-section-heading"><div><p className="ruutin-eyebrow">Household time</p><h2 id="timezone-title">Timezone</h2></div><span className="ruutin-settings-icon" aria-hidden="true">⌁</span></div>
        <form className="ruutin-form" onSubmit={saveTimezone}>
          <label htmlFor="household-timezone">IANA timezone</label>
          <input id="household-timezone" list="ruutin-timezone-suggestions" value={timezone} onChange={(event) => setTimezone(event.target.value)} autoComplete="off" spellCheck={false} />
          <datalist id="ruutin-timezone-suggestions">
            <option value="UTC" />
            <option value="Asia/Kuala_Lumpur" />
            <option value="Asia/Singapore" />
            <option value="Asia/Tokyo" />
            <option value="Australia/Sydney" />
            <option value="Europe/London" />
            <option value="Europe/Berlin" />
            <option value="America/Los_Angeles" />
            <option value="America/New_York" />
            <option value="Pacific/Auckland" />
          </datalist>
          <p className="ruutin-form-help">Future daily and weekday due dates follow this household clock. One-off dates and historical ledger local dates are calendar facts and do not move.</p>
          <div className="ruutin-settings-actions"><button className="ruutin-button" type="submit" disabled={savingTimezone}>{savingTimezone ? "Saving…" : "Save timezone"}</button>{timezoneMessage && <p className="ruutin-form-success" role="status">{timezoneMessage}</p>}{timezoneError && <p className="ruutin-form-error" role="alert">{timezoneError}</p>}</div>
        </form>
      </section>

      <section className="ruutin-card ruutin-settings-panel" aria-labelledby="privacy-title">
        <div className="ruutin-settings-section-heading"><div><p className="ruutin-eyebrow">Privacy</p><h2 id="privacy-title">Keep only what helps</h2></div><span className="ruutin-settings-icon" aria-hidden="true">♡</span></div>
        <p className="ruutin-settings-copy">Ruutin keeps household routines, broad age bands, nicknames, emoji, progress, and linked-device labels. Companion access is parent-managed; profiles marked under 13 stay parent-only. We do not need a child’s full name, exact birthday, contacts, or precise location.</p>
        <div className="ruutin-settings-export"><div><strong>Download your household data</strong><p>JSON includes your household routines, profiles, claims, rewards, ledger history, and safe linked-device metadata. It never includes passwords, TACs, session tokens, pairing secrets, or hashes.</p></div><button className="ruutin-button secondary" type="button" onClick={downloadExport} disabled={exporting}>{exporting ? "Preparing…" : "Download JSON"}</button></div>
        {exportMessage && <p className="ruutin-form-success" role="status" aria-live="polite">{exportMessage}</p>}
      </section>

      <section className="ruutin-card ruutin-settings-panel ruutin-settings-danger" aria-labelledby="delete-title">
        <div className="ruutin-settings-section-heading"><div><p className="ruutin-eyebrow">Permanent action</p><h2 id="delete-title">Delete this household</h2></div><span className="ruutin-settings-icon" aria-hidden="true">!</span></div>
        <p className="ruutin-settings-copy">This permanently deletes <strong>{initialSettings.household.name}</strong>, including profiles, tasks, claims, rewards, requests, star history, and linked-device records. It cannot be undone. Parent and companion access is revoked when deletion completes.</p>
        {deleteStage === "idle" && <button className="ruutin-button danger" type="button" onClick={requestDeletionCode} disabled={deletionBusy}>{deletionBusy ? "Sending…" : "Start permanent deletion"}</button>}
        {deleteStage === "code" && <form className="ruutin-form" onSubmit={verifyDeletionCode}><label htmlFor="deletion-code">One-use email code</label><input id="deletion-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={deleteCode} onChange={(event) => setDeleteCode(event.target.value)} autoComplete="one-time-code" required /><p className="ruutin-form-help">For safety, this code expires soon and cannot be reused.</p><div className="ruutin-settings-actions"><button className="ruutin-button danger" type="submit" disabled={deletionBusy}>{deletionBusy ? "Checking…" : "Continue"}</button><button className="ruutin-text-button" type="button" onClick={() => setDeleteStage("idle")} disabled={deletionBusy}>Cancel</button></div></form>}
        {deleteStage === "confirm" && <form className="ruutin-form" onSubmit={permanentlyDelete}><label htmlFor="delete-confirmation">Type DELETE to permanently remove this household</label><input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} required /><p className="ruutin-form-help">This is a final confirmation. Sign out instead if you only want to leave this device.</p><div className="ruutin-settings-actions"><button className="ruutin-button danger" type="submit" disabled={deletionBusy || confirmation !== "DELETE"}>{deletionBusy ? "Deleting…" : "Permanently delete"}</button><button className="ruutin-text-button" type="button" onClick={() => setDeleteStage("idle")} disabled={deletionBusy}>Cancel</button></div></form>}
        {deletionMessage && <p className="ruutin-form-success" role="status" aria-live="polite">{deletionMessage}</p>}
        {deletionError && <p className="ruutin-form-error" role="alert" aria-live="assertive">{deletionError}</p>}
      </section>

      <section className="ruutin-card ruutin-settings-note" aria-labelledby="signout-title"><h2 id="signout-title">Need to step away?</h2><p>Sign out on this device. Your household stays safely stored for your next visit.</p><SignOutButton /></section>
    </div>
  );
}
