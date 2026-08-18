"use client";

import { useEffect, useState } from "react";
import type { ParentDevice, ParentProfile } from "../profile-contracts";
import { PairingQr } from "../../pair/PairingQr";

type PairingChallenge = {
  id: string;
  profileId: string;
  code: string;
  token: string;
  pairingUrl: string;
  expiresAt: string;
};

async function getCsrf(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

function formatRemaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDeviceDate(value: string, timezone: string, includeTime = false): string {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: timezone,
  }).format(new Date(value));
}

export function PairingManager({
  profiles,
  initialDevices,
  timezone,
}: {
  profiles: ParentProfile[];
  initialDevices: ParentDevice[];
  timezone: string;
}) {
  const [challenge, setChallenge] = useState<PairingChallenge | null>(null);
  const [devices, setDevices] = useState(initialDevices);
  const [clock, setClock] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!challenge) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  async function createChallenge(profileId: string) {
    setBusy(`pair:${profileId}`);
    setError("");
    try {
      const csrf = await getCsrf();
      const response = await fetch("/api/parent/pairing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-ruutin-csrf": csrf },
        body: JSON.stringify({ profileId }),
      });
      const payload = await response.json() as { challenge?: PairingChallenge; message?: string };
      if (!response.ok || !payload.challenge) throw new Error(payload.message ?? "Could not create a pairing link.");
      setChallenge(payload.challenge);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a pairing link.");
    } finally {
      setBusy("");
    }
  }

  async function cancelChallenge() {
    if (!challenge) return;
    setBusy("cancel");
    setError("");
    try {
      const csrf = await getCsrf();
      const response = await fetch(`/api/parent/pairing/${encodeURIComponent(challenge.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-ruutin-csrf": csrf, Origin: window.location.origin },
      });
      if (!response.ok) throw new Error("Could not cancel this pairing link.");
      setChallenge(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel this pairing link.");
    } finally {
      setBusy("");
    }
  }

  async function renameDevice(device: ParentDevice) {
    const label = labels[device.id]?.trim();
    if (!label) return;
    setBusy(`rename:${device.id}`);
    setError("");
    try {
      const csrf = await getCsrf();
      const response = await fetch(`/api/parent/devices/${encodeURIComponent(device.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-ruutin-csrf": csrf },
        body: JSON.stringify({ deviceLabel: label }),
      });
      if (!response.ok) throw new Error("Could not rename this device.");
      setDevices((previous) => previous.map((item) => item.id === device.id ? { ...item, deviceLabel: label } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this device.");
    } finally {
      setBusy("");
    }
  }

  async function revokeDevice(device: ParentDevice) {
    setBusy(`revoke:${device.id}`);
    setError("");
    try {
      const csrf = await getCsrf();
      const response = await fetch(`/api/parent/devices/${encodeURIComponent(device.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-ruutin-csrf": csrf },
      });
      if (!response.ok) throw new Error("Could not revoke this device.");
      setDevices((previous) => previous.map((item) => item.id === device.id ? { ...item, revokedAt: new Date().toISOString() } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke this device.");
    } finally {
      setBusy("");
    }
  }

  const challengeExpired = challenge ? new Date(challenge.expiresAt).getTime() <= clock : false;
  const eligibleProfiles = profiles.filter((profile) => profile.companionAccessEligible === 1 && !profile.archivedAt);
  return (
    <>
      <section className="ruutin-card ruutin-pairing-manager" id="pairing" aria-labelledby="pairing-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent-only control</p><h2 id="pairing-title">Pair a companion device</h2></div><span className="ruutin-count-pill">{eligibleProfiles.length}</span></div>
        <p className="ruutin-muted-note">Pairing links show only the selected nickname and emoji. They expire in ten minutes and can be cancelled at any time.</p>
        {eligibleProfiles.length === 0 ? <p className="ruutin-empty-state">No profile is eligible for companion access yet.</p> : <div className="ruutin-pairing-profile-list">{eligibleProfiles.map((profile) => <div className="ruutin-pairing-profile-row" key={profile.id}><span className="ruutin-avatar small" aria-hidden="true">{profile.emoji}</span><span><strong>{profile.nickname}</strong><small>Parent confirmation is on file</small></span><button className="ruutin-button secondary" type="button" onClick={() => void createChallenge(profile.id)} disabled={busy !== ""}>{busy === `pair:${profile.id}` ? "Creating…" : challenge?.profileId === profile.id ? "Regenerate" : "Create link"}</button></div>)}</div>}
        {challenge && <div className="ruutin-pairing-challenge" aria-live="polite"><div className="ruutin-pairing-challenge-top"><div><p className="ruutin-eyebrow">Ready to pair</p><strong className="ruutin-pairing-code">{challenge.code}</strong><p className="ruutin-form-help">Manual code · expires in {formatRemaining(challenge.expiresAt, clock)}</p></div><PairingQr value={challenge.pairingUrl} /></div><label htmlFor="pairing-url">Pairing URL</label><input id="pairing-url" readOnly value={challenge.pairingUrl} onFocus={(event) => event.currentTarget.select()} /><div className="ruutin-family-actions"><a className="ruutin-button secondary" href={challenge.pairingUrl}>Open pairing page</a><button className="ruutin-text-button danger" type="button" onClick={() => void cancelChallenge()} disabled={busy !== "" || challengeExpired}>{busy === "cancel" ? "Cancelling…" : "Cancel link"}</button></div>{challengeExpired && <p className="ruutin-form-error" role="alert">This link expired. Generate a fresh one when you&apos;re ready.</p>}</div>}
        {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
      </section>
      <section className="ruutin-card ruutin-device-manager" id="devices" aria-labelledby="devices-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Linked devices</p><h2 id="devices-title">Companion access</h2></div><span className="ruutin-count-pill">{devices.length}</span></div><p className="ruutin-muted-note">Only parents can rename, revoke, or replace a linked device. Revocation takes effect on its next request.</p>{devices.length === 0 ? <p className="ruutin-empty-state">No devices linked.</p> : <ul className="ruutin-simple-list">{devices.map((device) => <li className="ruutin-device-row" key={device.id}><span className="ruutin-avatar small" aria-hidden="true">{device.profileEmoji}</span><span className="ruutin-device-summary"><strong>{device.deviceLabel}</strong><small>{device.profileNickname} · linked {formatDeviceDate(device.createdAt, timezone)} · last active {formatDeviceDate(device.lastSeenAt, timezone, true)}</small><span className={device.revokedAt ? "ruutin-state-note" : "ruutin-state-note good"}>{device.revokedAt ? `Revoked ${formatDeviceDate(device.revokedAt, timezone)}` : "Linked"}</span></span><div className="ruutin-device-actions">{!device.revokedAt && <><label className="sr-only" htmlFor={`device-label-${device.id}`}>Rename {device.deviceLabel}</label><input id={`device-label-${device.id}`} value={labels[device.id] ?? device.deviceLabel} onChange={(event) => setLabels((previous) => ({ ...previous, [device.id]: event.target.value }))} maxLength={40} /><button className="ruutin-button secondary" type="button" onClick={() => void renameDevice(device)} disabled={busy !== ""}>{busy === `rename:${device.id}` ? "Saving…" : "Rename"}</button><button className="ruutin-text-button danger" type="button" onClick={() => void revokeDevice(device)} disabled={busy !== ""}>{busy === `revoke:${device.id}` ? "Revoking…" : "Revoke"}</button></>}{device.revokedAt && <button className="ruutin-button secondary" type="button" onClick={() => void createChallenge(device.profileId)} disabled={busy !== ""}>Create replacement link</button>}</div></li>)}</ul>}</section>
    </>
  );
}
