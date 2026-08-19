"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../components/ActionPendingOverlay";

type AuthStep = "email" | "code";
const CODE_LENGTH = 6;

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
  const { pendingLabel, navigate } = usePendingDocumentNavigation();
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [codeDigits, setCodeDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const [csrfToken, setCsrfToken] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const code = codeDigits.join("");

  useEffect(() => {
    if (step === "code") codeInputRefs.current[0]?.focus();
  }, [step]);

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
      // The protected entry chooses onboarding for a brand-new parent and
      // Today for an existing household.
      navigate("/app", "Opening your family space…", { replace: true });
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
      setCodeDigits(Array(CODE_LENGTH).fill(""));
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
    setCodeDigits(Array(CODE_LENGTH).fill(""));
    setError("");
    setStatus("");
  }

  function setCodeDigit(index: number, value: string) {
    const digit = value.replace(/\D/gu, "").slice(-1);
    setCodeDigits((previous) => {
      const digits = [...previous];
      digits[index] = digit;
      return digits;
    });
    if (digit && index < CODE_LENGTH - 1) codeInputRefs.current[index + 1]?.focus();
  }

  function handleCodeKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !codeDigits[index] && index > 0) {
      event.preventDefault();
      codeInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      codeInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pastedCode = event.clipboardData.getData("text").replace(/\D/gu, "").slice(0, CODE_LENGTH);
    if (!pastedCode) return;
    event.preventDefault();
    const digits = Array(CODE_LENGTH).fill("");
    pastedCode.split("").forEach((digit, index) => { digits[index] = digit; });
    setCodeDigits(digits);
    codeInputRefs.current[Math.min(pastedCode.length, CODE_LENGTH) - 1]?.focus();
  }

  return (
    <div className="br-auth-flow" aria-label="Parent email sign-in" aria-busy={busy}>
      <ActionPendingOverlay
        active={busy || Boolean(pendingLabel)}
        label={pendingLabel || (step === "email" ? "Sending your sign-in code…" : "Checking your code…")}
        detail="Your secure parent session is being prepared."
      />
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
            enterKeyHint="send"
            aria-keyshortcuts="Enter"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder="you@example.com"
            required
          />
          <button className="br-button br-button-light" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send my code"} <span aria-hidden="true">↗</span>
          </button>
        </form>
      ) : (
        <form className="br-auth-form" onSubmit={submitCode}>
          <div className="br-auth-code-heading">
            <label htmlFor="ruutin-code-0">Verification code</label>
            <span>Enter the six-digit code sent to {email}.</span>
          </div>
          <div className="br-auth-code-inputs" role="group" aria-label="Six-digit verification code" aria-describedby="ruutin-code-help">
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <input
                className="br-auth-code-input"
                id={`ruutin-code-${index}`}
                key={index}
                name={`code-${index}`}
                type="text"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                inputMode="numeric"
                pattern="[0-9]"
                maxLength={1}
                value={codeDigits[index] ?? ""}
                onChange={(event) => setCodeDigit(index, event.target.value)}
                onKeyDown={(event) => handleCodeKeyDown(index, event)}
                onPaste={handleCodePaste}
                required
                aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
              />
            ))}
          </div>
          <span id="ruutin-code-help" className="br-auth-help">It expires in 10 minutes and works once.</span>
          <button className="br-button br-button-light" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
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
