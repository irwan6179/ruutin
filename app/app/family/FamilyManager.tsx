"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  AGE_BAND_OPTIONS,
  COMPANION_CONSENT_COPY,
  requiresCompanionConsent,
  type ParentDevice,
  type ParentProfile,
  type ParentTask,
} from "../profile-contracts";
import { TaskManager } from "./TaskManager";
import { PairingManager } from "./PairingManager";
import { ActionPendingOverlay } from "../../components/ActionPendingOverlay";

type EditValues = {
  nickname: string;
  emoji: string;
  ageBand: string;
  consentConfirmed: boolean;
};

type FamilySection = "profiles" | "routines" | "devices";

const familySections: readonly FamilySection[] = ["profiles", "routines", "devices"];

const familySectionForHash: Record<string, FamilySection> = {
  profiles: "profiles",
  routines: "routines",
  tasks: "routines",
  devices: "devices",
  pairing: "devices",
};

async function getCsrf(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

export function FamilyManager({
  initialProfiles,
  initialDevices,
  initialTasks = [],
  initialLocalDate = "",
  initialTimezone = "UTC",
}: {
  initialProfiles: ParentProfile[];
  initialDevices: ParentDevice[];
  initialTasks?: ParentTask[];
  initialLocalDate?: string;
  initialTimezone?: string;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [showForm, setShowForm] = useState(false);
  const [nickname, setNickname] = useState("");
  const [emoji, setEmoji] = useState("🌿");
  const [ageBand, setAgeBand] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [activeSection, setActiveSection] = useState<FamilySection>("profiles");

  useEffect(() => {
    function syncSectionFromHash() {
      const hash = window.location.hash.slice(1);
      const nextSection = familySectionForHash[hash];
      if (!nextSection) return;
      setActiveSection(nextSection);
      window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  function activateSection(nextSection: FamilySection, anchor: string) {
    setActiveSection(nextSection);
    window.history.replaceState(null, "", `#${anchor}`);
    window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function goToSection(event: MouseEvent<HTMLAnchorElement>, nextSection: FamilySection, anchor: string) {
    event.preventDefault();
    activateSection(nextSection, anchor);
  }

  function moveBetweenTabs(event: KeyboardEvent<HTMLAnchorElement>, current: FamilySection) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = familySections.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? familySections.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + familySections.length) % familySections.length;
    const nextSection = familySections[nextIndex] ?? "profiles";
    activateSection(nextSection, nextSection);
    window.setTimeout(() => document.getElementById(`family-tab-${nextSection}`)?.focus(), 0);
  }

  async function addProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSavingProfileId("new");
    try {
      const token = await getCsrf();
      const response = await fetch("/api/parent/profiles", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-ruutin-csrf": token },
        body: JSON.stringify({ nickname, emoji, ageBand: ageBand || null, consentConfirmed }),
      });
      const payload = await response.json() as { profile?: ParentProfile };
      if (!response.ok || !payload.profile) throw new Error("We couldn’t add that profile yet.");
      setProfiles((previous) => [...previous, payload.profile as ParentProfile]);
      setNickname("");
      setEmoji("🌿");
      setAgeBand("");
      setConsentConfirmed(false);
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add profile.");
    } finally {
      setSavingProfileId(null);
    }
  }

  function startEditing(profile: ParentProfile) {
    setEditingProfileId(profile.id);
    setEditValues({
      nickname: profile.nickname,
      emoji: profile.emoji,
      ageBand: profile.ageBand ?? "",
      consentConfirmed: false,
    });
    setEditError("");
    setError("");
  }

  function stopEditing() {
    if (savingProfileId) return;
    setEditingProfileId(null);
    setEditValues(null);
    setEditError("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>, profileId: string) {
    event.preventDefault();
    if (!editValues || savingProfileId) return;
    setEditError("");
    setSavingProfileId(profileId);
    try {
      const token = await getCsrf();
      const response = await fetch(`/api/parent/profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-ruutin-csrf": token },
        body: JSON.stringify({
          nickname: editValues.nickname,
          emoji: editValues.emoji,
          ageBand: editValues.ageBand || null,
          consentConfirmed: editValues.consentConfirmed,
        }),
      });
      const payload = await response.json() as { profile?: ParentProfile };
      if (!response.ok || !payload.profile) throw new Error("We couldn’t save this profile yet.");
      setProfiles((previous) => previous.map((profile) => profile.id === profileId ? payload.profile as ParentProfile : profile));
      // `stopEditing` intentionally refuses while a save is active so a user
      // cannot cancel an in-flight mutation. Close explicitly after the
      // server has accepted this mutation.
      setEditingProfileId(null);
      setEditValues(null);
      setEditError("");
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Could not save this profile.");
    } finally {
      setSavingProfileId(null);
    }
  }

  async function archive(profileId: string) {
    setError("");
    setArchiveBusyId(profileId);
    try {
      const token = await getCsrf();
      const response = await fetch(`/api/parent/profiles/${encodeURIComponent(profileId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-ruutin-csrf": token },
      });
      const payload = await response.json() as { profile?: ParentProfile };
      if (!response.ok || !payload.profile) throw new Error("We couldn’t archive that profile yet.");
      setProfiles((previous) => previous.map((profile) => profile.id === profileId ? payload.profile as ParentProfile : profile));
      if (editingProfileId === profileId) stopEditing();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive profile.");
    } finally {
      setArchiveBusyId(null);
    }
  }

  return (
    <div className="ruutin-page-stack">
      <ActionPendingOverlay
        active={savingProfileId !== null || archiveBusyId !== null}
        label={archiveBusyId ? "Archiving this profile…" : "Saving family changes…"}
      />
      <section className="ruutin-page-heading" aria-labelledby="family-title">
        <p className="ruutin-eyebrow">Your people, your pace</p>
        <h1 id="family-title">Family</h1>
        <p>Choose one family job at a time: people, routines, or companion devices.</p>
      </section>
      <div className="ruutin-family-tabs" role="tablist" aria-label="Family management areas">
        <a id="family-tab-profiles" className={`ruutin-family-tab${activeSection === "profiles" ? " is-active" : ""}`} role="tab" aria-selected={activeSection === "profiles"} aria-controls="profiles" tabIndex={activeSection === "profiles" ? 0 : -1} href="#profiles" onClick={(event) => goToSection(event, "profiles", "profiles")} onKeyDown={(event) => moveBetweenTabs(event, "profiles")}>Profiles <span aria-hidden="true">{profiles.length}</span></a>
        <a id="family-tab-routines" className={`ruutin-family-tab${activeSection === "routines" ? " is-active" : ""}`} role="tab" aria-selected={activeSection === "routines"} aria-controls="routines" tabIndex={activeSection === "routines" ? 0 : -1} href="#routines" onClick={(event) => goToSection(event, "routines", "routines")} onKeyDown={(event) => moveBetweenTabs(event, "routines")}>Routines <span aria-hidden="true">›</span></a>
        <a id="family-tab-devices" className={`ruutin-family-tab${activeSection === "devices" ? " is-active" : ""}`} role="tab" aria-selected={activeSection === "devices"} aria-controls="devices" tabIndex={activeSection === "devices" ? 0 : -1} href="#devices" onClick={(event) => goToSection(event, "devices", "devices")} onKeyDown={(event) => moveBetweenTabs(event, "devices")}>Devices <span aria-hidden="true">{initialDevices.length}</span></a>
      </div>
      <section id="profiles" className={`ruutin-family-panel ruutin-family-profiles-panel${activeSection === "profiles" ? " is-active" : ""}`} role="tabpanel" aria-labelledby="family-tab-profiles" hidden={activeSection !== "profiles"}>
        <header className="ruutin-section-heading">
          <div><p className="ruutin-eyebrow">Profiles</p><h2 id="profiles-heading">Your people</h2></div>
          <button className="ruutin-button" type="button" aria-expanded={showForm} aria-controls="add-profile-form" onClick={() => setShowForm((value) => !value)}>{showForm ? "Close" : "Add profile"} <span aria-hidden="true">{showForm ? "×" : "+"}</span></button>
        </header>
        {showForm && <form className="ruutin-card ruutin-form" id="add-profile-form" onSubmit={addProfile} aria-busy={savingProfileId === "new"}>
          <h2>Add a profile</h2>
          <label htmlFor="family-nickname">Nickname</label><input id="family-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} required />
          <label htmlFor="family-emoji">Emoji</label><input id="family-emoji" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} required />
          <label htmlFor="family-age-band">Broad age band <span>(optional)</span></label><select id="family-age-band" value={ageBand} onChange={(event) => setAgeBand(event.target.value)}><option value="">Not provided</option>{AGE_BAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <label className="ruutin-checkbox"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>{COMPANION_CONSENT_COPY}</span></label>
          <p className="ruutin-form-help">Under 13 is never companion eligible. No exact birth date is requested.</p>
          <button className="ruutin-button" type="submit" disabled={savingProfileId === "new"}>{savingProfileId === "new" ? "Saving…" : "Save profile"} <span aria-hidden="true">↗</span></button>
        </form>}
        <section className="ruutin-profile-list" aria-label="Family profiles">
        {profiles.map((profile) => {
          const isEditing = editingProfileId === profile.id && editValues !== null;
          const isSaving = savingProfileId === profile.id;
          const editNeedsConsent = editValues ? requiresCompanionConsent(editValues.ageBand) : false;
          return <article className={`ruutin-card ruutin-family-card${profile.archivedAt ? " is-archived" : ""}`} key={profile.id}>
            <div className="ruutin-profile-card-top"><span className="ruutin-avatar" aria-hidden="true">{profile.emoji}</span><div><h2>{profile.nickname}</h2><p>{profile.archivedAt ? "Archived · parent records remain" : profile.companionAccessEligible ? "Companion eligible · parent confirmed" : profile.ageBand === "under_13" ? "Parent-managed · under 13" : "Parent-managed · no companion access"}</p></div></div>
            {isEditing && editValues ? <form className="ruutin-form ruutin-profile-edit" onSubmit={(event) => saveProfile(event, profile.id)} aria-busy={isSaving} aria-labelledby={`edit-profile-${profile.id}`}>
              <fieldset>
                <legend id={`edit-profile-${profile.id}`}>Edit {profile.nickname}</legend>
                <label htmlFor={`${profile.id}-edit-nickname`}>Nickname</label><input id={`${profile.id}-edit-nickname`} value={editValues.nickname} onChange={(event) => setEditValues({ ...editValues, nickname: event.target.value })} maxLength={40} required />
                <label htmlFor={`${profile.id}-edit-emoji`}>Emoji</label><input id={`${profile.id}-edit-emoji`} value={editValues.emoji} onChange={(event) => setEditValues({ ...editValues, emoji: event.target.value })} maxLength={8} required />
                <label htmlFor={`${profile.id}-edit-age-band`}>Broad age band <span>(optional)</span></label><select id={`${profile.id}-edit-age-band`} value={editValues.ageBand} onChange={(event) => { const nextAgeBand = event.target.value; setEditValues({ ...editValues, ageBand: nextAgeBand, consentConfirmed: nextAgeBand === "under_13" ? false : editValues.consentConfirmed }); }}><option value="">Not provided</option>{AGE_BAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                {editNeedsConsent ? <label className="ruutin-checkbox" htmlFor={`${profile.id}-edit-consent`}><input id={`${profile.id}-edit-consent`} type="checkbox" required checked={editValues.consentConfirmed} onChange={(event) => setEditValues({ ...editValues, consentConfirmed: event.target.checked })} /><span>{COMPANION_CONSENT_COPY}</span></label> : <p className="ruutin-form-help" id={`${profile.id}-edit-help`}>Under 13 profiles stay parent-managed; no companion-age confirmation is needed.</p>}
                {editNeedsConsent && <p className="ruutin-form-help" id={`${profile.id}-edit-help`}>This confirmation is required to save eligibility changes. No exact birth date is collected.</p>}
                <div className="ruutin-family-actions"><button className="ruutin-button" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save changes"} <span aria-hidden="true">↗</span></button><button className="ruutin-text-button" type="button" disabled={isSaving} onClick={stopEditing}>Cancel</button></div>
                {editError && <p className="ruutin-form-error" role="alert" aria-live="polite">{editError}</p>}
              </fieldset>
            </form> : <div className="ruutin-family-actions"><a className="ruutin-button secondary" href="#tasks" onClick={(event) => goToSection(event, "routines", "tasks")}>Routines</a><button className="ruutin-button secondary" type="button" aria-expanded={isEditing} onClick={() => startEditing(profile)}>Edit</button>{profile.companionAccessEligible === 1 && !profile.archivedAt ? <a className="ruutin-button secondary" href="#pairing" onClick={(event) => goToSection(event, "devices", "pairing")}>Pair device</a> : <span className="ruutin-state-note">Pairing unavailable for this profile</span>}{!profile.archivedAt && <button className="ruutin-text-button danger" type="button" disabled={archiveBusyId === profile.id} onClick={() => archive(profile.id)}>{archiveBusyId === profile.id ? "Archiving…" : "Archive"}</button>}</div>}
          </article>;
        })}
        {profiles.length === 0 && <p className="ruutin-empty-state">Your first profile will appear here after setup.</p>}
        </section>
      </section>
      <section id="routines" className={`ruutin-family-panel ruutin-family-routines-panel${activeSection === "routines" ? " is-active" : ""}`} role="tabpanel" aria-labelledby="family-tab-routines" hidden={activeSection !== "routines"}>
        <TaskManager initialProfiles={profiles} initialTasks={initialTasks} initialLocalDate={initialLocalDate} />
      </section>
      <section id="devices" className={`ruutin-family-panel ruutin-family-devices-panel${activeSection === "devices" ? " is-active" : ""}`} role="tabpanel" aria-labelledby="family-tab-devices" hidden={activeSection !== "devices"}>
        <PairingManager profiles={profiles} initialDevices={initialDevices} timezone={initialTimezone} deviceSectionId="family-device-list" />
      </section>
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
