"use client";

import { FormEvent, useCallback, useState } from "react";

type AuthStep = "email" | "code";

const GENERIC_ERROR = "We couldn’t complete that just yet. Please try again.";

type ApiPayload = {
  ok?: boolean;
  csrfToken?: string;
  message?: string;
  error?: string;
};

async function readPayload(response: Response): Promise<ApiPayload> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null ? (payload as ApiPayload) : {};
  } catch {
    return {};
  }
}

export function AuthFlow() {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const bootstrapCsrf = useCallback(async () => {
    const response = await fetch("/api/auth/request", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await readPayload(response);
    if (!response.ok || !payload.csrfToken) throw new Error(GENERIC_ERROR);
    setCsrfToken(payload.csrfToken);
    return payload.csrfToken;
  }, []);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const token = csrfToken || (await bootstrapCsrf());
      const response = await fetch("/api/auth/request", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-ruutin-csrf": token,
        },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Please wait a little before requesting another code."
            : GENERIC_ERROR,
        );
        return;
      }
      setStep("code");
      setStatus("If that email can receive Ruutin sign-in mail, a six-digit code is on its way.");
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const token = csrfToken || (await bootstrapCsrf());
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-ruutin-csrf": token,
        },
        body: JSON.stringify({ email, code }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setError(payload.message ?? "That code is invalid or has expired. Request a new code and try again.");
        return;
      }
      window.location.replace("/app/today");
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function requestAnotherCode() {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const token = csrfToken || (await bootstrapCsrf());
      const response = await fetch("/api/auth/request", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-ruutin-csrf": token,
        },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Please wait a little before requesting another code."
            : GENERIC_ERROR,
        );
        return;
      }
      setCode("");
      setStatus("A fresh code is on its way. Only the newest code will work.");
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep("email");
    setEmail("");
    setCode("");
    setError("");
    setStatus("");
  }

  return (
    <div className="br-auth-flow" aria-label="Parent email sign-in">
      <div className="br-sign-in-heading">
        <div className="br-sign-in-icon" aria-hidden="true">✦</div>
        <div>
          <strong>Parent sign-in</strong>
          <p>{step === "email" ? "One-time code · no password" : `Code sent to ${email}`}</p>
        </div>
      </div>

      {step === "email" ? (
        <form className="br-auth-form" onSubmit={submitEmail}>
          <label htmlFor="ruutin-email">Your email</label>
          <input
            id="ruutin-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
          <button className="br-button br-button-light" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send my code"} <span aria-hidden="true">↗</span>
          </button>
        </form>
      ) : (
        <form className="br-auth-form" onSubmit={submitCode}>
          <label htmlFor="ruutin-code">Six-digit code</label>
          <input
            className="br-auth-code-input"
            id="ruutin-code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
            placeholder="000000"
            required
            aria-describedby="ruutin-code-help"
          />
          <span id="ruutin-code-help" className="br-auth-help">It expires in 10 minutes and works once.</span>
          <button className="br-button br-button-light" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Verify and continue"} <span aria-hidden="true">↗</span>
          </button>
          <button className="br-auth-back" type="button" onClick={requestAnotherCode} disabled={busy}>
            Send a new code
          </button>
          <button className="br-auth-back" type="button" onClick={startOver} disabled={busy}>
            Use a different email
          </button>
        </form>
      )}

      <p className="br-auth-feedback" aria-live="polite" role={error ? "alert" : undefined}>
        {error || status}
      </p>
    </div>
  );
}
