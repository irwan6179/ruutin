"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskOccurrence } from "../profile-contracts";
import { ActionPendingOverlay } from "../../components/ActionPendingOverlay";

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
  rhythm: {
    completedThisWeek: number;
    activeDaysThisWeek: number;
    tomorrowTaskCount: number;
    rewardsCelebratedThisWeek: number;
  };
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
  pendingRewardRequests: Array<{
    id: string;
    profileId: string;
    status: "pending" | "approved" | "rejected";
    requestedAt: string;
    nickname: string;
    profileEmoji: string;
    rewardTitle: string;
    rewardEmoji: string;
    starCost: number;
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
  if (task.awardReversed) return "Award reversed";
  if (task.state === "completed") return "Completed";
  if (task.state === "waiting") return "Waiting for approval";
  return "To do";
}

function taskStateGlyph(task: TaskOccurrence): string {
  if (task.awardReversed) return "↩";
  if (task.state === "completed") return "✓";
  if (task.state === "waiting") return "⏳";
  return "→";
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
  const [refreshing, setRefreshing] = useState(false);
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
  const pendingReviewCount = overview.pendingClaims.length + overview.pendingRewardRequests.length;
  const todoRoutineCount = overview.profiles.reduce(
    (count, profile) => count + profile.tasks.filter((task) => task.state === "todo").length,
    0,
  );
  const hasRoutineToLog = todoRoutineCount > 0;
  const primaryReviewHref = overview.pendingClaims.length > 0 ? "#today-claims" : "#today-reward-requests";
  const completingTask = busyKey.startsWith("complete-");

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

  async function refreshManually() {
    if (busyKey || refreshing) return;
    setRefreshing(true); setError("");
    try { await refresh(); setNotice("Today is up to date."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh today."); }
    finally { setRefreshing(false); }
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
    <div className="ruutin-page-stack ruutin-today-page">
      <ActionPendingOverlay
        active={(Boolean(busyKey) && !completingTask) || refreshing}
        label={refreshing ? "Refreshing today…" : "Saving today’s progress…"}
      />
      <section className="ruutin-page-heading ruutin-today-heading" aria-labelledby="today-title">
        <div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">{overview.household.name} · {overview.localDate}</p><h1 id="today-title">Today, together. ✨</h1></div><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={Boolean(busyKey) || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
        <p>Choose one small next step for the family.</p>
      </section>
      {pendingReviewCount > 0 && <section className="ruutin-today-action-rail" aria-label="Quick actions">
        <div className="ruutin-today-action-summary">
          <span className="ruutin-today-action-emoji" aria-hidden="true">👋</span>
          <span><strong>Review {pendingReviewCount} pending {pendingReviewCount === 1 ? "request" : "requests"}</strong><small>Approve routine claims or reward requests so stars can move forward.</small></span>
        </div>
        <div className="ruutin-today-action-links">
          <a className="ruutin-button ruutin-today-primary-action" href={primaryReviewHref}>Review now <span aria-hidden="true">→</span></a>
          {overview.pendingClaims.length > 0 && <a className="ruutin-today-action-link task" href="#today-claims"><span aria-hidden="true">✓</span> Task · {overview.pendingClaims.length}</a>}
          {overview.pendingRewardRequests.length > 0 && <a className="ruutin-today-action-link reward" href="#today-reward-requests"><span aria-hidden="true">🎁</span> Reward · {overview.pendingRewardRequests.length}</a>}
        </div>
      </section>}
      {pendingReviewCount === 0 && <section className="ruutin-today-next-action-rail" aria-labelledby="today-next-action-title">
        <div className="ruutin-today-action-summary">
          <span className="ruutin-today-action-emoji" aria-hidden="true">{hasRoutineToLog ? "🌱" : "✅"}</span>
          <span><strong id="today-next-action-title">{hasRoutineToLog ? "Log a routine" : "Today is logged"}</strong><small>{hasRoutineToLog ? `${todoRoutineCount} ${todoRoutineCount === 1 ? "routine is" : "routines are"} ready when you are.` : overview.rhythm.tomorrowTaskCount > 0 ? "Nothing else needs a tap today. Tomorrow is already lined up." : "Nothing else needs a tap today — enjoy the small win."}</small></span>
        </div>
        {hasRoutineToLog ? <a className="ruutin-button ruutin-today-primary-action" href="#today-routines">Log a routine <span aria-hidden="true">→</span></a> : <span className="ruutin-state-note good ruutin-today-all-done" role="status">All done for today</span>}
      </section>}
      {overview.profiles.length === 0 ? <p id="today-routines" className="ruutin-empty-state">Add a profile to begin a shared rhythm.</p> : (
        <section id="today-routines" className="ruutin-profile-grid" aria-label="Family progress and routines">
          {overview.profiles.map((profile, profileIndex) => {
            const progress = profile.taskCount > 0 ? Math.round((profile.completedTaskCount / profile.taskCount) * 100) : 0;
            return (
              <article className={`ruutin-card ruutin-profile-card ruutin-profile-card-tone-${profileIndex % 4}`} key={profile.id}>
                <div className="ruutin-profile-card-top">
                  <span className="ruutin-avatar" aria-hidden="true">{profile.emoji}</span>
                  <div><h2>{profile.nickname}</h2><p>{profile.archivedAt ? "Archived" : `${progress}% of today’s rhythm`}</p></div>
                  <span className="ruutin-balance" aria-label={`${profile.balance} ${profile.balance === 1 ? "star" : "stars"}`}><strong>{profile.balance}</strong><span aria-hidden="true">✦</span></span>
                </div>
                <div className="ruutin-progress" role="progressbar" aria-label={`${profile.nickname}'s routine progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div>
                <div className="ruutin-profile-stat-row" aria-label={`${profile.completedTaskCount} of ${profile.taskCount} routines complete${profile.pendingClaimCount ? `, ${profile.pendingClaimCount} waiting` : ", nothing waiting"}`}>
                  <span><strong>{profile.completedTaskCount}/{profile.taskCount}</strong><small>done</small></span>
                  <span><strong>{profile.pendingClaimCount || "✓"}</strong><small>{profile.pendingClaimCount ? "waiting" : "clear"}</small></span>
                  {profile.activeReward ? <span className="ruutin-goal-chip" aria-label={`${profile.activeReward.title}, ${profile.activeReward.starCost} stars needed`}><span aria-hidden="true">{profile.activeReward.emoji}</span><small>{profile.activeReward.starCost}✦</small></span> : <span className="ruutin-goal-chip is-empty" aria-label="No active reward"><span aria-hidden="true">☆</span><small>goal</small></span>}
                </div>
                {profile.tasks.length > 0 && <div className="ruutin-today-task-list" aria-label={`${profile.nickname}'s routines`}>
                  {profile.tasks.map((task) => <div className="ruutin-today-task" key={task.id}>
                    <span className="ruutin-avatar tiny" aria-hidden="true">{task.emoji}</span>
                    <span className="ruutin-today-task-copy"><strong>{task.title}</strong><small>{task.stars} {task.stars === 1 ? "star" : "stars"}</small></span>
                    <span className={`ruutin-task-state ${task.state}`} aria-label={taskStateLabel(task)} title={taskStateLabel(task)}><span aria-hidden="true">{taskStateGlyph(task)}</span></span>
                    {task.state === "todo" && !profile.archivedAt && <button className="ruutin-icon-action task" type="button" aria-label={busyKey === `complete-${task.id}` ? `Logging ${task.title} for ${profile.nickname}` : `Log ${task.title} for ${profile.nickname}`} aria-busy={busyKey === `complete-${task.id}`} title={busyKey === `complete-${task.id}` ? "Saving…" : "Log routine"} disabled={busyKey !== ""} onClick={() => void act(`complete-${task.id}`, () => parentRequest("/api/parent/completions", { profileId: profile.id, taskId: task.id, dueDate: task.dueDate }), `Logged for ${profile.nickname} — ${task.stars} ${task.stars === 1 ? "star" : "stars"} added to their balance.`)}>{busyKey === `complete-${task.id}` ? <span className="ruutin-inline-spinner" aria-hidden="true" /> : "✓"}</button>}
                  </div>)}
                </div>}
                {!profile.archivedAt && <details className="ruutin-advanced-ledger-details">
                  <summary>Advanced star history</summary>
                  <div className="ruutin-advanced-ledger-content">
                    <p className="ruutin-form-help">Use these corrections only when an award needs fixing. Routine logging above is the everyday action.</p>
                    {profile.tasks.some((task) => task.state === "completed" && task.claimId) && <ul className="ruutin-advanced-award-list" aria-label={`Completed awards for ${profile.nickname}`}>
                      {profile.tasks.filter((task) => task.state === "completed" && task.claimId).map((task) => <li key={task.id}><span><strong>{task.title}</strong><small>{task.stars} {task.stars === 1 ? "star" : "stars"} {task.awardReversed ? "reversed" : "awarded"}</small></span>{task.awardReversed ? <span className="ruutin-state-note" role="status">Reversed</span> : <button className="ruutin-button secondary compact" type="button" aria-label={`Reverse stars for ${task.title}`} onClick={(event) => { reverseReturnFocusRef.current = event.currentTarget; setReverseClaimId(task.claimId ?? ""); setReverseReason(""); }}>Reverse stars</button>}</li>)}
                    </ul>}
                    <details className="ruutin-adjust-details" open={adjustProfileId === profile.id} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) { setAdjustProfileId(profile.id); setAdjustRequestIds((current) => current[profile.id] ? current : { ...current, [profile.id]: crypto.randomUUID() }); } else if (adjustProfileId === profile.id) setAdjustProfileId(""); }}>
                      <summary>Adjust stars</summary>
                      {adjustProfileId === profile.id && <form className="ruutin-adjust-form" onSubmit={(event) => { event.preventDefault(); const requestId = adjustRequestIds[profile.id] ?? crypto.randomUUID(); setAdjustRequestIds((current) => ({ ...current, [profile.id]: requestId })); void act(`adjust-${profile.id}`, () => parentRequest("/api/parent/ledger", { action: "adjust", profileId: profile.id, starsDelta: Number(adjustDelta), reason: adjustReason, requestId }), "Star balance updated, with history kept.", () => setAdjustRequestIds((current) => { const next = { ...current }; delete next[profile.id]; return next; })); }}>
                        <label htmlFor={`adjust-delta-${profile.id}`}>Stars (+ or −)</label><input id={`adjust-delta-${profile.id}`} type="number" min={-1000} max={1000} step={1} value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} required />
                        <label htmlFor={`adjust-reason-${profile.id}`}>Reason</label><input id={`adjust-reason-${profile.id}`} value={adjustReason} maxLength={240} onChange={(event) => setAdjustReason(event.target.value)} placeholder="e.g. Extra kindness" required />
                        <button className="ruutin-button secondary compact" type="submit" disabled={busyKey === `adjust-${profile.id}`}>{busyKey === `adjust-${profile.id}` ? "Saving…" : "Save adjustment"}</button>
                      </form>}
                    </details>
                  </div>
                </details>}
              </article>
            );
          })}
        </section>
      )}
      <section id="today-claims" className="ruutin-card ruutin-queue-card ruutin-today-queue task-queue" aria-labelledby="queue-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent review</p><h2 id="queue-title">Waiting for you</h2></div><span className="ruutin-count-pill">{overview.pendingClaims.length}</span></div>
        {overview.pendingClaims.length === 0 ? <p className="ruutin-empty-state">Nothing waiting. ✨</p> : <ul className="ruutin-simple-list">{overview.pendingClaims.map((claim) => <li className="ruutin-claim-row" key={claim.id}><span className="ruutin-avatar small" aria-hidden="true">{claim.emoji}</span><span><strong>{claim.nickname}</strong><small>{claim.taskTitle} · {claim.stars}✦ · {submittedLabel(claim.submittedAt, overview.household.timezone)}</small></span><span className="ruutin-claim-actions"><button className="ruutin-icon-action queue-approve" type="button" aria-label={`Approve ${claim.nickname}'s ${claim.taskTitle}`} title="Approve" disabled={busyKey !== ""} onClick={() => void act(`approve-${claim.id}`, () => parentRequest("/api/parent/claims", { claimId: claim.id, decision: "approve" }), "Approved — the stars are safely recorded.")}>✓</button><button className="ruutin-icon-action danger" type="button" aria-label={`Reject ${claim.nickname}'s ${claim.taskTitle}`} title="Reject" disabled={busyKey !== ""} onClick={() => void act(`reject-${claim.id}`, () => parentRequest("/api/parent/claims", { claimId: claim.id, decision: "reject" }), "Sent back for another try.")}>×</button></span></li>)}</ul>}
      </section>
      <section id="today-reward-requests" className="ruutin-card ruutin-queue-card ruutin-today-queue reward-queue" aria-labelledby="reward-queue-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Reward review</p><h2 id="reward-queue-title">Small requests</h2></div><span className="ruutin-count-pill">{overview.pendingRewardRequests.length}</span></div>
        {overview.pendingRewardRequests.length === 0 ? <p className="ruutin-empty-state">Nothing waiting. ✨</p> : <ul className="ruutin-simple-list">{overview.pendingRewardRequests.map((request) => <li className="ruutin-claim-row" key={request.id}><span className="ruutin-avatar small" aria-hidden="true">{request.rewardEmoji}</span><span><strong>{request.rewardTitle}</strong><small>{request.nickname} · {request.starCost}✦ · {submittedLabel(request.requestedAt, overview.household.timezone)}</small></span><span className="ruutin-claim-actions"><button className="ruutin-icon-action queue-approve" type="button" aria-label={`Approve ${request.rewardTitle} for ${request.nickname}`} title="Approve" disabled={busyKey !== ""} onClick={() => void act(`reward-approve-${request.id}`, () => parentRequest("/api/parent/rewards/requests", { requestId: request.id, decision: "approve" }), "Approved — the stars are safely recorded.")}>✓</button><button className="ruutin-icon-action danger" type="button" aria-label={`Do not approve ${request.rewardTitle} for ${request.nickname}`} title="Not now" disabled={busyKey !== ""} onClick={() => void act(`reward-reject-${request.id}`, () => parentRequest("/api/parent/rewards/requests", { requestId: request.id, decision: "reject" }), "Sent back for another try.")}>×</button></span></li>)}</ul>}
      </section>
      <section className="ruutin-card ruutin-today-rhythm-card" aria-labelledby="today-rhythm-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Small wins together</p><h2 id="today-rhythm-title">Your week is taking shape</h2></div><span className="ruutin-rhythm-note">No streaks, just progress</span></div>
        <div className="ruutin-rhythm-stats" aria-label="This week’s family rhythm">
          <div><strong>{overview.rhythm.completedThisWeek}</strong><span>routines completed</span></div>
          <div><strong>{overview.rhythm.activeDaysThisWeek}</strong><span>days with a small win</span></div>
          <div><strong>{overview.rhythm.rewardsCelebratedThisWeek}</strong><span>rewards celebrated</span></div>
        </div>
        <div className="ruutin-tomorrow-cue"><span aria-hidden="true">🌤️</span><p><strong>{overview.rhythm.tomorrowTaskCount > 0 ? "Tomorrow is ready." : "Tomorrow can be gentle too."}</strong><small>{overview.rhythm.tomorrowTaskCount > 0 ? `${overview.rhythm.tomorrowTaskCount} ${overview.rhythm.tomorrowTaskCount === 1 ? "routine is" : "routines are"} already lined up.` : "There are no routines lined up yet — take the day as it comes."}</small></p></div>
      </section>
      {reverseClaimId && <form className="ruutin-inline-dialog" role="dialog" aria-modal="true" aria-labelledby="reverse-title" aria-describedby="reverse-description" onSubmit={(event) => { event.preventDefault(); void act(`reverse-${reverseClaimId}`, () => parentRequest("/api/parent/ledger", { action: "reverse", claimId: reverseClaimId, reason: reverseReason }), "Award reversed with a clear history.", () => setReverseClaimId("")); }}><h2 id="reverse-title">Reverse this star award?</h2><p id="reverse-description">The original ledger entry stays in history; Ruutin adds a compensating entry.</p><label htmlFor="reverse-reason">Reason</label><input id="reverse-reason" value={reverseReason} maxLength={240} onChange={(event) => setReverseReason(event.target.value)} placeholder="e.g. Logged by mistake" required /><div className="ruutin-family-actions"><button ref={reverseConfirmRef} className="ruutin-button" type="submit" disabled={busyKey !== "" || reverseReason.trim().length === 0}>Reverse award</button><button className="ruutin-text-button" type="button" disabled={busyKey !== ""} onClick={() => setReverseClaimId("")}>Cancel</button></div></form>}
      {notice && <p className="ruutin-form-success ruutin-live-feedback" role="status" aria-live="polite">{notice}</p>}
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
