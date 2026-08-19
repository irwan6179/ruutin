"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../components/ActionPendingOverlay";

type Preview = { nickname: string; emoji: string; expiresAt: string };
type PairedProfile = { nickname: string; emoji: string };
type PairPayload = { pairing?: Preview; profile?: PairedProfile };

function publicError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string") return payload.message;
  return "That pairing request is invalid or has expired. Ask the parent for a new one.";
}

async function pairRequest(body: { code?: string; token?: string; confirm?: boolean }): Promise<PairPayload> {
  const response = await fetch("/api/pair", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as PairPayload;
  if (!response.ok) throw new Error(publicError(payload));
  return payload;
}

function pairingUrlToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function formatRemaining(expiresAt: string, now: number): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function PairFlow() {
  const { pendingLabel, navigate } = usePendingDocumentNavigation();
  const [code, setCode] = useState("");
  const token = useSyncExternalStore(subscribeToLocation, pairingUrlToken, () => "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [successProfile, setSuccessProfile] = useState<PairedProfile | null>(null);
  const acceptedLinkRef = useRef("");

  useEffect(() => {
    if (!token || acceptedLinkRef.current === token) return;
    acceptedLinkRef.current = token;
    setError("");
    setBusy(true);
    void pairRequest({ token, confirm: true })
      .then((payload) => {
        if (!payload.profile) throw new Error("This device could not be linked yet.");
        setSuccessProfile(payload.profile);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not link this device."))
      .finally(() => setBusy(false));
  }, [token]);

  useEffect(() => {
    if (!successProfile) return;
    const timer = window.setTimeout(() => {
      navigate("/companion/today", "Opening your routine space…", { replace: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [navigate, successProfile]);

  function beginCountdown(expiresAt: string) {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (new Date(expiresAt).getTime() <= now) window.clearInterval(timer);
    }, 1000);
  }

  async function submit(event: FormEvent<HTMLFormElement>, forceConfirm = false) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = await pairRequest({ code: code || undefined, token: token || undefined, confirm: forceConfirm || confirming });
      if (!confirming && payload.pairing) {
        setPreview(payload.pairing);
        beginCountdown(payload.pairing.expiresAt);
        return;
      }
      navigate("/companion/today", "Opening your routine space…", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check that pairing request.");
    } finally {
      setBusy(false);
    }
  }

  function clearChallenge() {
    setPreview(null);
    setCode("");
    setError("");
    setConfirming(false);
    setSuccessProfile(null);
    acceptedLinkRef.current = "";
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/pair");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  const expired = preview ? new Date(preview.expiresAt).getTime() <= clock : false;
  const urlValue = token;
  return (
    <main className="ruutin-public-shell pair-shell">
      <ActionPendingOverlay
        active={busy || Boolean(pendingLabel)}
        label={pendingLabel || (token || confirming ? "Linking this device…" : "Checking the pairing code…")}
        detail="The selected companion space is being verified securely."
      />
      <a className="ruutin-skip-link" href="#pair-main">Skip to content</a>
      <div className="ruutin-pair-card" id="pair-main">
        {successProfile ? <section className="ruutin-pair-success" role="status" aria-live="polite">
          <span className="ruutin-pair-success-mark" aria-hidden="true">✓</span>
          <h2>Device linked</h2>
          <p>{successProfile.emoji} {successProfile.nickname}&apos;s routines are ready.</p>
        </section> : <><p className="ruutin-eyebrow">Ruutin companion</p>
          <h1>Join your routine space</h1>
          <p className="ruutin-pair-intro">Use the six-digit code from your parent, or open their pairing link. You&apos;ll see only the profile they selected.</p>
          {!preview ? <form className="ruutin-form" onSubmit={submit} aria-busy={busy}>
          <label htmlFor="pair-code">Six-digit code</label>
          <input id="pair-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))} placeholder="000000" aria-describedby="pair-code-help" />
          <p className="ruutin-form-help" id="pair-code-help">The code expires after ten minutes.</p>
          {urlValue && <p className="ruutin-pair-link-note">Pairing link received. You can continue with the link token.</p>}
          <button className="ruutin-button" type="submit" disabled={busy || (!code && !urlValue)}>{busy ? "Checking…" : "Continue"} <span aria-hidden="true">↗</span></button>
          {urlValue && error && <button className="ruutin-text-button" type="button" onClick={clearChallenge}>Use a code instead</button>}
          {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
        </form> : <section className="ruutin-pair-confirm" aria-labelledby="pair-confirm-title">
          <div className="ruutin-pair-profile"><span className="ruutin-avatar" aria-hidden="true">{preview.emoji}</span><div><p className="ruutin-eyebrow">This space is for</p><h2 id="pair-confirm-title">{preview.nickname}</h2></div></div>
          <div className="ruutin-pair-countdown" role="timer" aria-live="polite"><span>Link expires in</span><strong>{formatRemaining(preview.expiresAt, clock)}</strong></div>
          {expired ? <p className="ruutin-form-error" role="alert">This pairing link has expired. Ask the parent to generate a new one.</p> : <p className="ruutin-form-help">Confirm to link this device. The profile cannot be changed from here.</p>}
          {!expired && <form className="ruutin-form" onSubmit={(event) => { setConfirming(true); void submit(event, true); }}><button className="ruutin-button" type="submit" disabled={busy}>{busy ? "Linking…" : "Link this device"} <span aria-hidden="true">✦</span></button></form>}
          <div className="ruutin-pair-actions"><button className="ruutin-text-button" type="button" onClick={clearChallenge}>Cancel</button><button className="ruutin-text-button" type="button" onClick={() => { setPreview(null); setConfirming(false); setError(""); }}>Use another code</button></div>
          {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
        </section>}</>}
      </div>
    </main>
  );
}
