"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskOccurrence } from "../profile-contracts";

type ProfileCard = {
  id: string;
  nickname: string;
  emoji: string;
  archivedAt: string | null;
  balance: number;
  taskCount: number;
  completedTaskCount: number;
  pendingClaimCount: number;
  activeReward: { id: string; title: string; emoji: string; starCost: number } | null;
  tasks: TaskOccurrence[];
};

type TodayData = {
  localDate: string;
  household: { id: string; name: string; timezone: string };
  profiles: ProfileCard[];
  pendingClaims: Array<{
    id: string;
    profileId: string;
    nickname: string;
    emoji: string;
    taskTitle: string;
    stars: number;
    submittedAt: string;
    dueDate: string;
  }>;
};

async function getCsrf(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

async function parentRequest(path: string, body: Record<string, unknown>): Promise<void> {
  const csrf = await getCsrf();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-ruutin-csrf": csrf },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Ruutin could not save that change yet.");
}

function taskStateLabel(task: TaskOccurrence): string {
  if (task.state === "completed") return "Completed";
  if (task.state === "waiting") return "Waiting for approval";
  return "To do";
}

function submittedLabel(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  } catch {
    return value;
  }
}

export function TodayManager({ initialOverview }: { initialOverview: TodayData }) {
  const [overview, setOverview] = useState(initialOverview);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reverseClaimId, setReverseClaimId] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [adjustProfileId, setAdjustProfileId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustRequestIds, setAdjustRequestIds] = useState<Record<string, string>>({});
  const reverseConfirmRef = useRef<HTMLButtonElement>(null);
  const reverseReturnFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (reverseClaimId) reverseConfirmRef.current?.focus();
    else reverseReturnFocusRef.current?.focus();
  }, [reverseClaimId]);

  useEffect(() => {
    if (!reverseClaimId) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyKey) setReverseClaimId("");
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busyKey, reverseClaimId]);

  useEffect(() => {
    async function refreshWhenVisible() {
      if (document.visibilityState !== "visible" || busyKey) return;
      try {
        await refresh();
      } catch {
        // Keep the current private snapshot; the next action retries.
      }
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [busyKey]);

  async function refresh() {
    const response = await fetch("/api/parent/today", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as { overview?: TodayData; message?: string };
    if (!response.ok || !payload.overview) throw new Error(payload.message ?? "Could not refresh today.");
    setOverview(payload.overview);
  }

  async function act(key: string, action: () => Promise<void>, success: string, afterSuccess?: () => void) {
    if (busyKey) return;
    setBusyKey(key); setError(""); setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
      afterSuccess?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ruutin could not save that change yet.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="ruutin-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="today-title">
        <p className="ruutin-eyebrow">{overview.household.name} · {overview.localDate}</p>
        <h1 id="today-title">A little progress, together.</h1>
        <p>Here&apos;s the gentle overview for today. You stay in charge of every approval.</p>
      </section>
      {overview.profiles.length === 0 ? <p className="ruutin-empty-state">Add a profile to begin a shared rhythm.</p> : (
        <section className="ruutin-profile-grid" aria-label="Family progress">
          {overview.profiles.map((profile) => {
            const progress = profile.taskCount > 0 ? Math.round((profile.completedTaskCount / profile.taskCount) * 100) : 0;
            return (
              <article className="ruutin-card ruutin-profile-card" key={profile.id}>
                <div className="ruutin-profile-card-top">
                  <span className="ruutin-avatar" aria-hidden="true">{profile.emoji}</span>
                  <div><h2>{profile.nickname}</h2><p>{profile.archivedAt ? "Archived" : `${progress}% of today’s rhythm`}</p></div>
                  <span className="ruutin-balance" aria-label={`${profile.balance} ${profile.balance === 1 ? "star" : "stars"}`}>{profile.balance} ✦</span>
                </div>
                <div className="ruutin-progress" role="progressbar" aria-label={`${profile.nickname}'s routine progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div>
                <div className="ruutin-card-meta"><span>{profile.completedTaskCount} of {profile.taskCount} routines</span><span>{profile.pendingClaimCount ? `${profile.pendingClaimCount} waiting` : "Nothing waiting"}</span></div>
                {profile.activeReward ? <p className="ruutin-reward-note">{profile.activeReward.emoji} {profile.activeReward.title} · {profile.activeReward.starCost} stars</p> : <p className="ruutin-muted-note">No active reward yet</p>}
                {profile.tasks.length > 0 && <div className="ruutin-today-task-list" aria-label={`${profile.nickname}'s routines`}>
                  {profile.tasks.map((task) => <div className="ruutin-today-task" key={task.id}>
                    <span className="ruutin-avatar tiny" aria-hidden="true">{task.emoji}</span>
                    <span className="ruutin-today-task-copy"><strong>{task.title}</strong><small>{task.stars} {task.stars === 1 ? "star" : "stars"}</small></span>
                    <span className={`ruutin-task-state ${task.state}`}>{taskStateLabel(task)}</span>
                    {task.state === "todo" && !profile.archivedAt && <button className="ruutin-button secondary compact" type="button" disabled={busyKey === `complete-${task.id}`} onClick={() => void act(`complete-${task.id}`, () => parentRequest("/api/parent/completions", { profileId: profile.id, taskId: task.id, dueDate: task.dueDate }), "Routine marked complete — a small win.")}>{busyKey === `complete-${task.id}` ? "Saving…" : "Mark complete"}</button>}
                    {task.state === "completed" && task.claimId && <button className="ruutin-text-button danger compact" type="button" onClick={(event) => { reverseReturnFocusRef.current = event.currentTarget; setReverseClaimId(task.claimId ?? ""); setReverseReason(""); }}>Reverse stars</button>}
                  </div>)}
                </div>}
                {!profile.archivedAt && <details className="ruutin-adjust-details" open={adjustProfileId === profile.id} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) { setAdjustProfileId(profile.id); setAdjustRequestIds((current) => current[profile.id] ? current : { ...current, [profile.id]: crypto.randomUUID() }); } else if (adjustProfileId === profile.id) setAdjustProfileId(""); }}>
                  <summary>Adjust stars</summary>
                  {adjustProfileId === profile.id && <form className="ruutin-adjust-form" onSubmit={(event) => { event.preventDefault(); const requestId = adjustRequestIds[profile.id] ?? crypto.randomUUID(); setAdjustRequestIds((current) => ({ ...current, [profile.id]: requestId })); void act(`adjust-${profile.id}`, () => parentRequest("/api/parent/ledger", { action: "adjust", profileId: profile.id, starsDelta: Number(adjustDelta), reason: adjustReason, requestId }), "Star balance updated, with history kept.", () => setAdjustRequestIds((current) => { const next = { ...current }; delete next[profile.id]; return next; })); }}>
                    <label htmlFor={`adjust-delta-${profile.id}`}>Stars (+ or −)</label><input id={`adjust-delta-${profile.id}`} type="number" min={-1000} max={1000} step={1} value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} required />
                    <label htmlFor={`adjust-reason-${profile.id}`}>Reason</label><input id={`adjust-reason-${profile.id}`} value={adjustReason} maxLength={240} onChange={(event) => setAdjustReason(event.target.value)} placeholder="e.g. Extra kindness" required />
                    <button className="ruutin-button secondary compact" type="submit" disabled={busyKey === `adjust-${profile.id}`}>{busyKey === `adjust-${profile.id}` ? "Saving…" : "Save adjustment"}</button>
                  </form>}
                </details>}
              </article>
            );
          })}
        </section>
      )}
      <section className="ruutin-card ruutin-queue-card" aria-labelledby="queue-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent review</p><h2 id="queue-title">Waiting for you</h2></div><span className="ruutin-count-pill">{overview.pendingClaims.length}</span></div>
        {overview.pendingClaims.length === 0 ? <p className="ruutin-empty-state">No approvals waiting. The queue will appear here when a routine is submitted.</p> : <ul className="ruutin-simple-list">{overview.pendingClaims.map((claim) => <li className="ruutin-claim-row" key={claim.id}><span className="ruutin-avatar small" aria-hidden="true">{claim.emoji}</span><span><strong>{claim.nickname}</strong><small>{claim.taskTitle} · {claim.stars} {claim.stars === 1 ? "star" : "stars"} · {submittedLabel(claim.submittedAt, overview.household.timezone)}</small></span><span className="ruutin-claim-actions"><button className="ruutin-button compact" type="button" disabled={busyKey !== ""} onClick={() => void act(`approve-${claim.id}`, () => parentRequest("/api/parent/claims", { claimId: claim.id, decision: "approve" }), "Approved — the stars are safely recorded.")}>Approve</button><button className="ruutin-text-button danger compact" type="button" disabled={busyKey !== ""} onClick={() => void act(`reject-${claim.id}`, () => parentRequest("/api/parent/claims", { claimId: claim.id, decision: "reject" }), "Sent back for another try.")}>Reject</button></span></li>)}</ul>}
      </section>
      {reverseClaimId && <div className="ruutin-inline-dialog" role="dialog" aria-modal="true" aria-labelledby="reverse-title" aria-describedby="reverse-description"><h2 id="reverse-title">Reverse this star award?</h2><p id="reverse-description">The original ledger entry stays in history; Ruutin adds a compensating entry.</p><label htmlFor="reverse-reason">Reason</label><input id="reverse-reason" value={reverseReason} maxLength={240} onChange={(event) => setReverseReason(event.target.value)} required /><div className="ruutin-family-actions"><button ref={reverseConfirmRef} className="ruutin-button" type="button" disabled={busyKey !== ""} onClick={() => void act(`reverse-${reverseClaimId}`, () => parentRequest("/api/parent/ledger", { action: "reverse", claimId: reverseClaimId, reason: reverseReason }), "Award reversed with a clear history.", () => setReverseClaimId(""))}>Reverse award</button><button className="ruutin-text-button" type="button" disabled={busyKey !== ""} onClick={() => setReverseClaimId("")}>Cancel</button></div></div>}
      {notice && <p className="ruutin-form-success ruutin-live-feedback" role="status" aria-live="polite">{notice}</p>}
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
