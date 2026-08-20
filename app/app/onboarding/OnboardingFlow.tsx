"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { AGE_BAND_OPTIONS, COMPANION_CONSENT_COPY, type HouseholdRecord, type OnboardingState, type ParentProfile } from "../profile-contracts";
import { TaskManager } from "../family/TaskManager";
import { recordExperienceSignal } from "../../components/ExperiencePing";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../../components/ActionPendingOverlay";

type Props = {
  initialState: OnboardingState;
  initialHousehold: HouseholdRecord | null;
  initialProfiles: ParentProfile[];
};

const steps = [
  ["household", "Your household"],
  ["profile", "First profile"],
  ["tasks", "A few routines"],
] as const;

const ROUTINE_TARGET = 3;

async function csrfToken(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const token = await csrfToken();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-ruutin-csrf": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("We couldn’t save that yet. Please try again.");
  return response.json();
}

const subscribeToTimezone = () => () => {};
const getBrowserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const getServerTimezone = () => "UTC";

export function OnboardingFlow({ initialState, initialHousehold, initialProfiles }: Props) {
  const { pendingLabel, navigate } = usePendingDocumentNavigation();
  const [state, setState] = useState(initialState);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [householdName, setHouseholdName] = useState(initialHousehold?.name ?? "");
  const [timezone, setTimezone] = useState(initialHousehold?.timezone ?? "");
  const [nickname, setNickname] = useState("");
  const [emoji, setEmoji] = useState("🌿");
  const [ageBand, setAgeBand] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taskCount, setTaskCount] = useState(initialState.completedSteps.includes("tasks") ? ROUTINE_TARGET : 0);

  const currentIndex = Math.max(0, steps.findIndex(([value]) => value === state.activeStep));
  const progress = Math.round(((currentIndex + 1) / steps.length) * 100);
  const selectedProfile = profiles.find((profile) => !profile.archivedAt) ?? profiles[0];
  // Keep the server render and first browser render deterministic. The
  // browser's timezone is only a convenience suggestion; the server validates
  // the selected value on save.
  const detectedTimezone = useSyncExternalStore(subscribeToTimezone, getBrowserTimezone, getServerTimezone);

  function openToday(options?: { replace?: boolean }) {
    // Measurement is intentionally fire-and-forget: it must never delay the
    // parent reaching their first useful Today screen.
    void recordExperienceSignal("onboarding_completed");
    navigate("/app/today", "Opening Today…", options);
  }

  useEffect(() => {
    if (state.isComplete) {
      void recordExperienceSignal("onboarding_completed");
      navigate("/app/today", "Opening Today…", { replace: true });
    }
  }, [navigate, state.isComplete]);

  function goTo(value: OnboardingState["activeStep"]) {
    const index = steps.findIndex(([step]) => step === value);
    if (index < 0) return;
    setState((previous) => ({ ...previous, activeStep: value, progressIndex: index, canGoBack: index > 0, canSkip: false }));
  }

  async function saveHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const payload = await postJson("/api/parent/household", { name: householdName, timezone: timezone || detectedTimezone }) as { household?: HouseholdRecord };
      if (!payload.household) throw new Error("We couldn’t save your household yet. Please try again.");
      goTo("profile");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your household."); }
    finally { setBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await csrfToken();
      const response = await fetch("/api/parent/profiles", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-ruutin-csrf": token }, body: JSON.stringify({ nickname, emoji, ageBand: ageBand || null, consentConfirmed }) });
      if (!response.ok) throw new Error("We couldn’t save that profile yet. Please try again.");
      const payload = await response.json() as { profile?: ParentProfile };
      if (payload.profile) setProfiles((previous) => [...previous, payload.profile as ParentProfile]);
      goTo("tasks");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this profile."); }
    finally { setBusy(false); }
  }

  function continueToToday() {
    if (state.activeStep === "tasks") {
      if (taskCount < ROUTINE_TARGET) {
        setError(`Choose ${ROUTINE_TARGET} routines before opening Today.`);
        return;
      }
      openToday();
    }
  }

  if (state.isComplete) {
    return (
      <div className="ruutin-onboarding ruutin-onboarding-complete">
        <ActionPendingOverlay active={Boolean(pendingLabel)} label={pendingLabel || "Opening Today…"} />
        <section className="ruutin-card ruutin-onboarding-complete-card" aria-labelledby="onboarding-complete-title">
          <p className="ruutin-eyebrow">Setup complete</p>
          <h1 id="onboarding-complete-title">Your routines are ready.</h1>
          <p>Today is the place to check in, celebrate progress, and add rewards or a companion whenever they feel useful.</p>
          <button className="ruutin-button" type="button" onClick={() => openToday({ replace: true })}>Open Today <span aria-hidden="true">↗</span></button>
        </section>
      </div>
    );
  }

  return (
    <div className="ruutin-onboarding">
      <ActionPendingOverlay active={busy || Boolean(pendingLabel)} label={pendingLabel || "Saving your setup…"} />
      <section className="ruutin-onboarding-header" aria-labelledby="onboarding-title">
        <p className="ruutin-eyebrow">A calm setup, one step at a time</p>
        <h1 id="onboarding-title">Make it yours.</h1>
        <p>Just the essentials. Come back anytime.</p>
        <div className="ruutin-onboarding-progress" role="progressbar" aria-label={`Setup progress: step ${currentIndex + 1} of ${steps.length}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div>
        <p className="ruutin-progress-label">Step {currentIndex + 1} of {steps.length} · {steps[currentIndex]?.[1]}</p>
      </section>
      <ol className="ruutin-step-list" aria-label="Setup steps">
        {steps.map(([value, label], index) => <li className={index === currentIndex ? "is-current" : index < currentIndex ? "is-complete" : ""} key={value}><span aria-hidden="true">{index < currentIndex ? "✓" : index + 1}</span>{label}</li>)}
      </ol>
      <section className="ruutin-card ruutin-onboarding-card" aria-live="polite">
        {state.activeStep === "household" && (
          <form className="ruutin-form" onSubmit={saveHousehold}>
            <div><p className="ruutin-eyebrow">Step 1</p><h2>Name your household</h2><p>This is just a friendly label for your private family space.</p></div>
            <label htmlFor="household-name">Household name</label><input id="household-name" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} maxLength={80} placeholder="The Rahman home" required />
            <label htmlFor="household-timezone">Timezone</label><select id="household-timezone" value={timezone || detectedTimezone} onChange={(event) => setTimezone(event.target.value)}><option value={detectedTimezone}>{detectedTimezone} (suggested by this browser)</option><option value="UTC">UTC</option><option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur</option><option value="Asia/Singapore">Asia/Singapore</option><option value="Australia/Sydney">Australia/Sydney</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="Europe/London">Europe/London</option></select>
            <p className="ruutin-form-help">The browser suggestion is checked again on the server and used for local routine dates.</p>
            <button className="ruutin-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save household"} <span aria-hidden="true">↗</span></button>
          </form>
        )}
        {state.activeStep === "profile" && (
          <form className="ruutin-form" onSubmit={saveProfile}>
            <div><p className="ruutin-eyebrow">Step 2</p><h2>Add a first profile</h2><p>A nickname, an emoji, and an optional broad age band are enough.</p></div>
            <label htmlFor="profile-nickname">Nickname</label><input id="profile-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} placeholder="Ari" required />
            <label htmlFor="profile-emoji">Emoji</label><input id="profile-emoji" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} aria-describedby="emoji-help" required /><span id="emoji-help" className="ruutin-form-help">Choose one that feels like them.</span>
            <label htmlFor="profile-age-band">Broad age band <span>(optional)</span></label><select id="profile-age-band" value={ageBand} onChange={(event) => setAgeBand(event.target.value)}><option value="">Not provided</option>{AGE_BAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <label className="ruutin-checkbox"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>{COMPANION_CONSENT_COPY}</span></label>
            <p className="ruutin-form-help">Under 13 profiles never receive companion access. Other bands still need this explicit confirmation. No exact birth date is collected.</p>
            <button className="ruutin-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"} <span aria-hidden="true">↗</span></button>
          </form>
        )}
        {state.activeStep === "tasks" && (
          <div className="ruutin-onboarding-task-step">
            <TaskManager initialProfiles={profiles} initialProfileId={selectedProfile?.id} compact onTasksChange={setTaskCount} />
            <button className="ruutin-button" type="button" disabled={taskCount < ROUTINE_TARGET} onClick={continueToToday}>Continue to Today <span aria-hidden="true">↗</span></button>
            {taskCount < ROUTINE_TARGET && <p className="ruutin-form-help">Choose {ROUTINE_TARGET - taskCount} more {ROUTINE_TARGET - taskCount === 1 ? "routine" : "routines"}, then you can start using Today. Rewards and companion pairing can be added later.</p>}
          </div>
        )}
        {error && <p className="ruutin-form-error" role="alert">{error}</p>}
      </section>
      <div className="ruutin-onboarding-actions"><button className="ruutin-text-button" type="button" disabled={currentIndex <= 0 || busy} onClick={() => goTo(steps[currentIndex - 1]?.[0] ?? "household")}>← Back</button><span>Household and profile details are saved as you go</span></div>
    </div>
  );
}
