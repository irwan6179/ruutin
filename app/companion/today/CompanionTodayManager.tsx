"use client";

import { useEffect, useRef, useState } from "react";
import { InstallGuidance } from "../InstallGuidance";
import { ActionPendingOverlay } from "../../components/ActionPendingOverlay";

type CompanionTask = {
  id: string;
  title: string;
  emoji: string;
  stars: number;
  dueDate: string;
  state: "todo" | "waiting" | "completed";
  claimId: string | null;
  submittedAt: string | null;
};

type TodayData = {
  profile: { nickname: string; emoji: string };
  localDate: string;
  tasks: CompanionTask[];
  balance: number;
  activeReward: { title: string; emoji: string; starCost: number } | null;
};

export function CompanionTodayManager({ initialToday }: { initialToday: TodayData }) {
  const [today, setToday] = useState(initialToday);
  const [selectedTask, setSelectedTask] = useState<CompanionTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const completedCount = today.tasks.filter((task) => task.state === "completed").length;
  const progress = today.tasks.length > 0 ? Math.round((completedCount / today.tasks.length) * 100) : 0;

  useEffect(() => {
    if (selectedTask) confirmRef.current?.focus();
    else returnFocusRef.current?.focus();
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setSelectedTask(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, selectedTask]);

  async function refreshToday() {
    const [todayResponse, rewardsResponse] = await Promise.all([
      fetch("/api/companion/today", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/companion/rewards", { credentials: "same-origin", cache: "no-store" }),
    ]);
    const todayPayload = await todayResponse.json().catch(() => ({})) as { today?: Omit<TodayData, "balance" | "activeReward"> };
    const rewardsPayload = await rewardsResponse.json().catch(() => ({})) as { rewards?: { balance: number; activeReward: TodayData["activeReward"] } };
    if (!todayResponse.ok || !todayPayload.today || !rewardsResponse.ok || !rewardsPayload.rewards) throw new Error("Your routine could not be refreshed yet.");
    setToday({ ...todayPayload.today, balance: rewardsPayload.rewards.balance, activeReward: rewardsPayload.rewards.activeReward });
  }

  async function refreshManually() {
    if (busy || refreshing) return;
    setRefreshing(true); setError("");
    try { await refreshToday(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your routine could not be refreshed yet."); }
    finally { setRefreshing(false); }
  }

  useEffect(() => {
    async function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      try {
        await refreshToday();
      } catch {
        // The existing screen remains usable; the next navigation retries.
      }
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, []);

  async function submitClaim() {
    if (!selectedTask || busy) return;
    const task = selectedTask;
    const previousToday = today;
    setBusy(true); setError("");
    setToday((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? {
        ...item,
        state: "waiting",
        submittedAt: new Date().toISOString(),
      } : item),
    }));
    setSelectedTask(null);
    try {
      const response = await fetch("/api/companion/today", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const payload = await response.json().catch(() => ({})) as { today?: TodayData; message?: string };
      if (!response.ok || !payload.today) throw new Error(payload.message ?? "That routine could not be sent yet.");
      setToday({ ...payload.today, balance: previousToday.balance, activeReward: previousToday.activeReward });
      // The POST includes an authoritative snapshot; re-read both private
      // views as well so a delayed balance/reward write cannot leave stale UI.
      void refreshToday().catch(() => {
        // Keep the authoritative POST snapshot; the next visibility refresh retries.
      });
    } catch (cause) {
      setToday(previousToday);
      setSelectedTask(task);
      setError(cause instanceof Error ? cause.message : "That routine could not be sent yet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ruutin-page-stack companion-page-stack">
      <ActionPendingOverlay
        active={busy || refreshing}
        label={refreshing ? "Refreshing today…" : "Sending this routine for approval…"}
      />
      <section className="ruutin-page-heading" aria-labelledby="companion-today-title">
        <div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">{today.localDate} · your space</p><h1 id="companion-today-title">Hi {today.profile.nickname} {today.profile.emoji}</h1></div><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={busy || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
        <p>Pick a routine. Your parent reviews it when you&apos;re ready.</p>
      </section>
      <InstallGuidance />
      <section className="ruutin-card companion-today-balance" aria-label="Star balance">
        <div><span className="ruutin-eyebrow">Your stars</span><strong>{today.balance} ✦</strong></div>
        {today.activeReward ? <p>{today.activeReward.emoji} {today.activeReward.title} · {today.activeReward.starCost} stars</p> : <p>Your parent can add a reward goal when it feels right.</p>}
      </section>
      <section className="ruutin-card companion-progress-card" aria-label="Today progress">
        <div className="ruutin-card-meta"><span>Today&apos;s rhythm</span><strong>{completedCount} of {today.tasks.length} complete</strong></div>
        <div className="ruutin-progress" role="progressbar" aria-label="Today routine progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div>
      </section>
      <section aria-labelledby="companion-tasks-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Today</p><h2 id="companion-tasks-title">Your routines</h2></div><span className="ruutin-count-pill">{today.tasks.length}</span></div>
        {today.tasks.length === 0 ? <p className="ruutin-empty-state">Nothing is due today. Enjoy the breathing room.</p> : <div className="ruutin-task-list companion-task-list">{today.tasks.map((task) => <article className="ruutin-card ruutin-task-card companion-action-card" key={task.id}><div className="ruutin-task-card-top"><span className="ruutin-avatar small" aria-hidden="true">{task.emoji}</span><div><h3>{task.title}</h3><p>{task.stars} {task.stars === 1 ? "star" : "stars"}</p></div><span className={`ruutin-task-state${task.state === "completed" ? " completed" : task.state === "waiting" ? " waiting" : ""}`}>{task.state === "completed" ? "Completed" : task.state === "waiting" ? "Waiting for approval" : "To do"}</span></div>{task.state === "todo" && <button className="ruutin-button" type="button" onClick={(event) => { returnFocusRef.current = event.currentTarget; setError(""); setSelectedTask(task); }}>I&apos;ve done this <span aria-hidden="true">✓</span></button>}{task.state === "waiting" && <p className="ruutin-form-help" role="status">Sent to your parent — you can take a breath.</p>}</article>)}</div>}
      </section>
      {selectedTask && <div className="ruutin-inline-dialog" role="dialog" aria-modal="true" aria-labelledby="claim-confirm-title" aria-describedby="claim-confirm-description"><p className="ruutin-eyebrow">One small check</p><h2 id="claim-confirm-title">Send “{selectedTask.title}” for review?</h2><p id="claim-confirm-description">Your parent will see this routine and decide when to add its {selectedTask.stars} {selectedTask.stars === 1 ? "star" : "stars"}.</p><div className="ruutin-family-actions"><button ref={confirmRef} className="ruutin-button" type="button" disabled={busy} onClick={() => void submitClaim()}>{busy ? "Sending…" : "Send for approval"} <span aria-hidden="true">↗</span></button><button className="ruutin-text-button" type="button" disabled={busy} onClick={() => setSelectedTask(null)}>Not yet</button></div></div>}
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
