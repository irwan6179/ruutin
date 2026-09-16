"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../components/ActionPendingOverlay";

type AuthStep = "email" | "code";
type PendingAction = "email" | "code" | "demo" | null;
const CODE_LENGTH = 6;

const GENERIC_ERROR = "We couldn’t complete that just yet. Please try again.";

type ApiPayload = {
  ok?: boolean;
  csrfToken?: string;
  message?: string;
  error?: string;
  available?: boolean;
  redirectTo?: string;
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
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [demoLoginAvailable, setDemoLoginAvailable] = useState(false);
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const code = codeDigits.join("");
  const busy = pendingAction !== null;

  useEffect(() => {
    if (step === "code") codeInputRefs.current[0]?.focus();
  }, [step]);

  useEffect(() => {
    let active = true;
    void fetch("/api/dev/login", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => ({ response, payload: await readPayload(response) }))
      .then(({ response, payload }) => {
        if (!active || !response.ok || !payload.available || !payload.csrfToken) return;
        setCsrfToken(payload.csrfToken);
        setDemoLoginAvailable(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
    setPendingAction("email");
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
      setPendingAction(null);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPendingAction("code");
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
      setPendingAction(null);
    }
  }

  async function requestAnotherCode() {
    if (busy) return;
    setPendingAction("email");
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
      setPendingAction(null);
    }
  }

  async function enterDemoParentSpace() {
    if (busy) return;
    setPendingAction("demo");
    setError("");
    setStatus("");
    try {
      const token = csrfToken || (await bootstrapCsrf());
      const response = await fetch("/api/dev/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "x-ruutin-csrf": token,
        },
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setError(
          response.status === 404
            ? "Demo login isn't available at this address."
            : payload.message ?? GENERIC_ERROR,
        );
        return;
      }
      navigate(payload.redirectTo ?? "/app/today", "Opening the demo family space…", {
        replace: true,
      });
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPendingAction(null);
    }
  }

  function startOver() {
    setStep("email");
    setEmail("");
    setCodeDigits(Array(CODE_LENGTH).fill(""));
    setError("");
    setStatus("");
  }

  function focusCodeInput(index: number) {
    requestAnimationFrame(() => codeInputRefs.current[index]?.focus());
  }

  function setCodeInput(index: number, value: string) {
    const enteredDigits = value.replace(/\D/gu, "").slice(0, CODE_LENGTH - index);
    setCodeDigits((previous) => {
      const digits = [...previous];
      if (!enteredDigits) {
        digits[index] = "";
        return digits;
      }
      enteredDigits.split("").forEach((digit, offset) => {
        digits[index + offset] = digit;
      });
      return digits;
    });
    if (enteredDigits) {
      focusCodeInput(Math.min(index + enteredDigits.length, CODE_LENGTH - 1));
    }
  }

  function handleCodeKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (/^[0-9]$/u.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setCodeInput(index, event.key);
    } else if (event.key === "Backspace" && codeDigits[index]) {
      event.preventDefault();
      setCodeDigits((previous) => previous.map((digit, digitIndex) => digitIndex === index ? "" : digit));
    } else if (event.key === "Backspace" && index > 0) {
      event.preventDefault();
      setCodeDigits((previous) => previous.map((digit, digitIndex) => digitIndex === index - 1 ? "" : digit));
      focusCodeInput(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusCodeInput(index - 1);
    } else if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      focusCodeInput(index + 1);
    }
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const pastedCode = event.clipboardData.getData("text").replace(/\D/gu, "").slice(0, CODE_LENGTH);
    if (!pastedCode) return;
    event.preventDefault();
    const digits = Array(CODE_LENGTH).fill("");
    pastedCode.split("").forEach((digit, index) => { digits[index] = digit; });
    setCodeDigits(digits);
    focusCodeInput(Math.min(pastedCode.length, CODE_LENGTH) - 1);
  }

  return (
    <div className="br-auth-flow" aria-label="Parent email sign-in" aria-busy={busy}>
      <ActionPendingOverlay
        active={busy || Boolean(pendingLabel)}
        label={
          pendingLabel ||
          (pendingAction === "demo"
            ? "Preparing the demo household…"
            : step === "email"
              ? "Sending your sign-in code…"
              : "Checking your code…")
        }
        detail="Your secure parent session is being prepared."
      />
      <div className="br-sign-in-heading">
        <div>
          <strong>{step === "email" ? "Sign in with email" : "Check your inbox"}</strong>
          <p>{step === "email" ? "We’ll send a six-digit code." : `Code sent to ${email}`}</p>
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
            {pendingAction === "email" ? "Sending…" : "Send my code"}
          </button>
          {demoLoginAvailable && (
            <div className="br-demo-login">
              <span>Local preview</span>
              <button
                className="br-demo-login-button"
                type="button"
                onClick={enterDemoParentSpace}
                disabled={busy}
              >
                {pendingAction === "demo" ? "Preparing demo…" : "Enter demo parent space"}
              </button>
              <small>Uses sample family data. No email needed.</small>
            </div>
          )}
        </form>
      ) : (
        <form className="br-auth-form" onSubmit={submitCode}>
          <div className="br-auth-code-heading">
            <label htmlFor="ruutin-code-0">Verification code</label>
            <span>Enter the six-digit code sent to {email}.</span>
          </div>
          <div className="br-auth-code-inputs" role="group" aria-label="Six-digit verification code" aria-describedby="ruutin-code-help" onPaste={handleCodePaste}>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <input
                className="br-auth-code-input"
                id={`ruutin-code-${index}`}
                key={index}
                ref={(element) => { codeInputRefs.current[index] = element; }}
                name={`code-${index}`}
                type="text"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={CODE_LENGTH}
                value={codeDigits[index] ?? ""}
                onChange={(event) => setCodeInput(index, event.target.value)}
                onKeyDown={(event) => handleCodeKeyDown(index, event)}
                required
                aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
              />
            ))}
          </div>
          <span id="ruutin-code-help" className="br-auth-help">It expires in 10 minutes and works once.</span>
          <button className="br-button br-button-light" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
            {pendingAction === "code" ? "Checking…" : "Verify and continue"}
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
