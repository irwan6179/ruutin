"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { AGE_BAND_OPTIONS, COMPANION_CONSENT_COPY, type HouseholdRecord, type OnboardingState, type ParentDevice, type ParentProfile } from "../profile-contracts";
import { TaskManager } from "../family/TaskManager";
import { PairingManager } from "../family/PairingManager";
import { RewardsManager, type Reward, type RewardRequest } from "../rewards/RewardsManager";

type Props = {
  initialState: OnboardingState;
  initialHousehold: HouseholdRecord | null;
  initialProfiles: ParentProfile[];
  initialRewards: Reward[];
  initialRewardRequests: RewardRequest[];
  initialDevices: ParentDevice[];
};

const steps = [
  ["household", "Your household"],
  ["profile", "First profile"],
  ["tasks", "A few routines"],
  ["review", "Review together"],
  ["rewards", "Something to look forward to"],
  ["pairing", "Optional companion"],
] as const;

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

export function OnboardingFlow({ initialState, initialHousehold, initialProfiles, initialRewards, initialRewardRequests, initialDevices }: Props) {
  const [state, setState] = useState(initialState);
  const [household, setHousehold] = useState(initialHousehold);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [householdName, setHouseholdName] = useState(initialHousehold?.name ?? "");
  const [timezone, setTimezone] = useState(initialHousehold?.timezone ?? "");
  const [nickname, setNickname] = useState("");
  const [emoji, setEmoji] = useState("🌿");
  const [ageBand, setAgeBand] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taskCount, setTaskCount] = useState(initialState.completedSteps.includes("tasks") ? 1 : 0);
  const [rewardReady, setRewardReady] = useState(() => Boolean(initialProfiles.find((profile) => !profile.archivedAt)?.activeRewardId));

  const currentIndex = steps.findIndex(([value]) => value === state.activeStep);
  const progress = Math.round(((currentIndex + 1) / steps.length) * 100);
  const selectedProfile = profiles.find((profile) => !profile.archivedAt) ?? profiles[0];
  const canPair = profiles.some((profile) => profile.companionAccessEligible === 1 && profile.archivedAt === null);
  const eligibleProfiles = profiles.filter((profile) => profile.companionAccessEligible === 1 && profile.archivedAt === null);
  // Keep the server render and first browser render deterministic. The
  // browser's timezone is only a convenience suggestion; the server validates
  // the selected value on save.
  const detectedTimezone = useSyncExternalStore(subscribeToTimezone, getBrowserTimezone, getServerTimezone);

  function goTo(value: OnboardingState["activeStep"]) {
    const index = steps.findIndex(([step]) => step === value);
    if (index < 0) return;
    setState((previous) => ({ ...previous, activeStep: value, progressIndex: index, canGoBack: index > 0, canSkip: value === "pairing" }));
  }

  async function saveHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const payload = await postJson("/api/parent/household", { name: householdName, timezone: timezone || detectedTimezone }) as { household?: HouseholdRecord };
      if (!payload.household) throw new Error("We couldn’t save your household yet. Please try again.");
      setHousehold(payload.household);
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

  function continueBoundary() {
    if (state.activeStep === "tasks") {
      if (taskCount < 1) {
        setError("Choose at least one routine before reviewing your setup.");
        return;
      }
      goTo("review");
    }
    else if (state.activeStep === "review") goTo("rewards");
    else if (state.activeStep === "rewards") {
      if (!rewardReady) {
        setError("Choose one active reward before finishing this step.");
        return;
      }
      if (canPair) goTo("pairing");
      else window.location.assign("/app/today");
    }
    else if (state.activeStep === "pairing") window.location.assign("/app/today");
  }

  return (
    <div className="ruutin-onboarding">
      <section className="ruutin-onboarding-header" aria-labelledby="onboarding-title">
        <p className="ruutin-eyebrow">A calm setup, one step at a time</p>
        <h1 id="onboarding-title">Make Ruutin feel like your home.</h1>
        <p>We only ask for the essentials. You can pause and come back at any point.</p>
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
            <button className="ruutin-button" type="button" disabled={taskCount < 1} onClick={continueBoundary}>Review routines <span aria-hidden="true">↗</span></button>
          </div>
        )}
        {state.activeStep === "review" && (
          <div className="ruutin-boundary-step">
            <p className="ruutin-eyebrow">Step {currentIndex + 1}</p>
            <h2>Review together</h2>
            <p>Review will bring your routines together in one clear summary before anything starts.</p>
            <div className="ruutin-boundary-note"><strong>{household?.name ?? "Your household"}</strong><span>{selectedProfile ? `${selectedProfile.emoji} ${selectedProfile.nickname} is ready for a routine plan.` : "Your profile is ready for a routine plan."}</span></div>
            <button className="ruutin-button" type="button" onClick={continueBoundary}>Continue <span aria-hidden="true">↗</span></button>
          </div>
        )}
        {state.activeStep === "rewards" && (
          <div className="ruutin-onboarding-integrated-step">
            <p className="ruutin-eyebrow">Step {currentIndex + 1}</p>
            <h2>Something to look forward to</h2>
            <p>Choose one small, meaningful reward for {selectedProfile?.nickname ?? "your first profile"}. It stays parent-managed — never a shop or a competition.</p>
            <RewardsManager
              initialProfiles={selectedProfile ? [selectedProfile] : []}
              initialRewards={initialRewards}
              initialRequests={initialRewardRequests}
              onActiveRewardChange={(rewardId) => setRewardReady(Boolean(rewardId))}
              embedded
            />
            <button className="ruutin-button" type="button" disabled={!rewardReady} onClick={continueBoundary}>Continue to pairing <span aria-hidden="true">↗</span></button>
            {!rewardReady && <p className="ruutin-form-help">Add a reward, then make it the active goal to continue.</p>}
          </div>
        )}
        {state.activeStep === "pairing" && (
          <div className="ruutin-onboarding-integrated-step">
            <p className="ruutin-eyebrow">Step {currentIndex + 1}</p>
            <h2>Optional companion</h2>
            {canPair ? <>
              <p>Pair an eligible profile when it feels useful. Links expire in ten minutes and can be cancelled at any time.</p>
              <PairingManager profiles={eligibleProfiles} initialDevices={initialDevices} timezone={initialHousehold?.timezone ?? "UTC"} />
            </> : <>
              <p>Companion access is not available for this household yet. Under 13 and unconfirmed profiles stay parent-managed.</p>
              <div className="ruutin-boundary-note"><strong>All set</strong><span>You can start your routines without pairing a device.</span></div>
            </>}
            <button className="ruutin-button" type="button" onClick={continueBoundary}>Finish setup <span aria-hidden="true">↗</span></button>
            {canPair && <button className="ruutin-text-button" type="button" onClick={() => window.location.assign("/app/today")}>Skip for now</button>}
          </div>
        )}
        {error && <p className="ruutin-form-error" role="alert">{error}</p>}
      </section>
      <div className="ruutin-onboarding-actions"><button className="ruutin-text-button" type="button" disabled={currentIndex <= 0 || busy} onClick={() => goTo(steps[currentIndex - 1]?.[0] ?? "household")}>← Back</button><span>Household and profile details are saved as you go</span></div>
    </div>
  );
}
