"use client";

import { useEffect, useState } from "react";
import { InstallGuidance } from "../InstallGuidance";
import { companionAppName } from "../app-identity";
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

function taskStateLabel(task: CompanionTask): string {
  // Keep the compact state for the completed badge, while giving the waiting
  // state the full next-step language companions need to understand.
  const compactState = task.state === "completed" ? "Done" : "Waiting";
  if (task.state === "waiting") return "Waiting for parent";
  return task.state === "todo" ? "To do" : compactState;
}

function taskOrder(task: CompanionTask): number {
  if (task.state === "todo") return 0;
  if (task.state === "waiting") return 1;
  return 2;
}

export function CompanionTodayManager({ initialToday }: { initialToday: TodayData }) {
  const [today, setToday] = useState(initialToday);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const orderedTasks = [...today.tasks].sort((left, right) => taskOrder(left) - taskOrder(right));
  const unfinishedTasks = orderedTasks.filter((task) => task.state !== "completed");
  const waitingTasks = orderedTasks.filter((task) => task.state === "waiting");
  const completedTasks = orderedTasks.filter((task) => task.state === "completed");
  const completedCount = today.tasks.filter((task) => task.state === "completed").length;
  const progress = today.tasks.length > 0 ? Math.round((completedCount / today.tasks.length) * 100) : 0;
  const allDone = today.tasks.length > 0 && completedCount === today.tasks.length;
  const allRoutinesSent = today.tasks.length > 0 && unfinishedTasks.every((task) => task.state === "waiting") && !allDone;
  const firstRoutineSent = today.tasks.some((task) => task.state !== "todo");

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
    if (busyTaskId || refreshing) return;
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

  async function submitClaim(task: CompanionTask) {
    if (busyTaskId) return;
    const previousToday = today;
    setBusyTaskId(task.id); setError(""); setNotice(`Marking ${task.title} done…`);
    setToday((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? {
        ...item,
        state: "waiting",
        submittedAt: new Date().toISOString(),
      } : item),
    }));
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
      const completed = payload.today.tasks.some((item) => item.id === task.id && item.state === "completed");
      setNotice(completed ? `${task.title} done — star added!` : `${task.title} sent for review.`);
      // The POST includes an authoritative snapshot; re-read both private
      // views as well so a delayed balance/reward write cannot leave stale UI.
      void refreshToday().catch(() => {
        // Keep the authoritative POST snapshot; the next visibility refresh retries.
      });
    } catch (cause) {
      setToday(previousToday);
      setNotice("");
      setError(cause instanceof Error ? cause.message : "That routine could not be sent yet.");
    } finally {
      setBusyTaskId("");
    }
  }

  function renderTask(task: CompanionTask) {
    const stateLabel = taskStateLabel(task);
    const isBusy = busyTaskId === task.id;
    return (
      <article className={`ruutin-card companion-task-row companion-task-motion-safe is-${task.state}${isBusy ? " is-busy" : ""}`} data-motion="gentle" key={task.id}>
        <span className="ruutin-avatar small" aria-hidden="true">{task.emoji}</span>
        <span className="companion-task-copy"><strong>{task.title}</strong></span>
        {task.state === "todo" ? <button className="ruutin-button companion-done-button" type="button" aria-label={isBusy ? `Sending ${task.title}` : `Mark ${task.title} done`} aria-busy={isBusy} disabled={Boolean(busyTaskId)} onClick={() => void submitClaim(task)}>{isBusy ? <span className="ruutin-inline-spinner" aria-hidden="true" /> : <><span>Done</span><span aria-hidden="true">✓</span></>}</button> : <span className={`ruutin-task-state ${task.state} companion-task-state`} role="status" aria-label={stateLabel} title={stateLabel}>{stateLabel}</span>}
      </article>
    );
  }

  return (
    <div className="ruutin-page-stack companion-page-stack">
      <ActionPendingOverlay
        active={refreshing}
        label="Refreshing today…"
      />
      <section className="ruutin-page-heading companion-today-heading" aria-labelledby="companion-today-title">
        <div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">Today · {today.localDate}</p><h1 id="companion-today-title">Hi, {today.profile.nickname}</h1></div><div className="companion-heading-actions"><a className="companion-header-balance" href="/companion/rewards#companion-balance-card" aria-label={`View rewards — ${today.balance} stars`}>{today.balance} <span aria-hidden="true">✦</span></a><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={Boolean(busyTaskId) || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div></div>
      </section>
      <section className="companion-routines" aria-labelledby="companion-tasks-title">
        <div className="ruutin-section-heading"><div><h2 id="companion-tasks-title">Your routines</h2><p className="companion-routines-hint">Tap when done.</p></div><span className="ruutin-count-pill">{today.tasks.length}</span></div>
        {today.tasks.length === 0 ? <p className="ruutin-empty-state">Nothing due today.</p> : <>
          {unfinishedTasks.length > 0 && <div className="companion-task-list companion-unfinished-routines" aria-label="Unfinished routines">{unfinishedTasks.map(renderTask)}</div>}
          {waitingTasks.length > 0 && !allRoutinesSent && <p className="companion-waiting-summary" role="status" aria-live="polite">{waitingTasks.length} {waitingTasks.length === 1 ? "routine" : "routines"} waiting for review.</p>}
          {(allDone || allRoutinesSent) && <section className="companion-all-done companion-motion-safe" data-motion="gentle" role="status" aria-live="polite"><span className="companion-all-done-mark" aria-hidden="true">✨</span><div><strong>{allDone ? "All done!" : "Sent for review."}</strong><p>{allDone ? "Great work today." : "Your parent will take a look."}</p></div></section>}
          {completedTasks.length > 0 && <details className="companion-completed-routines" open={unfinishedTasks.length === 0}><summary><span>Done today</span><span className="ruutin-count-pill">{completedTasks.length}</span></summary><div className="companion-task-list is-completed" aria-label="Completed routines">{completedTasks.map(renderTask)}</div></details>}
        </>}
      </section>
      {notice && <p className="companion-action-feedback ruutin-form-success ruutin-live-feedback" data-motion="gentle" role="status" aria-live="polite">{notice}</p>}
      {firstRoutineSent && <InstallGuidance appName={companionAppName(today.profile.nickname)} placement="after-first-completion" compact />}
      <section className="ruutin-card companion-today-summary" aria-label="Today summary">
        <div className="companion-summary-stat"><span>Stars</span><strong>{today.balance} ✦</strong></div>
        <div className="companion-summary-progress"><div className="ruutin-card-meta"><span>Today</span><strong>{completedCount}/{today.tasks.length}</strong></div><div className="ruutin-progress" role="progressbar" aria-label="Today routine progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div></div>
        {today.activeReward && <a className="companion-summary-goal companion-goal-link companion-active-goal" href="/companion/rewards#companion-balance-card" aria-label={`View active reward goal: ${today.activeReward.title}`}><span aria-hidden="true">{today.activeReward.emoji}</span><span><small>Goal</small><strong>{today.activeReward.title} <span aria-hidden="true">↗</span></strong></span></a>}
      </section>
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
