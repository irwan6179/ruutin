"use client";

import { useEffect, useState } from "react";
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
  const [busyTaskId, setBusyTaskId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const completedCount = today.tasks.filter((task) => task.state === "completed").length;
  const progress = today.tasks.length > 0 ? Math.round((completedCount / today.tasks.length) * 100) : 0;

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
    setBusyTaskId(task.id); setError("");
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
      // The POST includes an authoritative snapshot; re-read both private
      // views as well so a delayed balance/reward write cannot leave stale UI.
      void refreshToday().catch(() => {
        // Keep the authoritative POST snapshot; the next visibility refresh retries.
      });
    } catch (cause) {
      setToday(previousToday);
      setError(cause instanceof Error ? cause.message : "That routine could not be sent yet.");
    } finally {
      setBusyTaskId("");
    }
  }

  return (
    <div className="ruutin-page-stack companion-page-stack">
      <ActionPendingOverlay
        active={refreshing}
        label="Refreshing today…"
      />
      <section className="ruutin-page-heading companion-today-heading" aria-labelledby="companion-today-title">
        <div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">Today · {today.localDate}</p><h1 id="companion-today-title">Hi, {today.profile.nickname} {today.profile.emoji}</h1></div><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={Boolean(busyTaskId) || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
      </section>
      <section className="companion-routines" aria-labelledby="companion-tasks-title">
        <div className="ruutin-section-heading"><h2 id="companion-tasks-title">Your routines</h2><span className="ruutin-count-pill">{today.tasks.length}</span></div>
        {today.tasks.length === 0 ? <p className="ruutin-empty-state">Nothing due today.</p> : <div className="companion-task-list">{today.tasks.map((task) => <article className={`ruutin-card companion-task-row is-${task.state}`} key={task.id}><span className="ruutin-avatar small" aria-hidden="true">{task.emoji}</span><span className="companion-task-copy"><strong>{task.title}</strong><small>{task.stars}✦</small></span>{task.state === "todo" ? <button className="ruutin-button companion-done-button" type="button" aria-label={busyTaskId === task.id ? `Sending ${task.title}` : `Mark ${task.title} done`} aria-busy={busyTaskId === task.id} disabled={Boolean(busyTaskId)} onClick={() => void submitClaim(task)}>{busyTaskId === task.id ? <span className="ruutin-inline-spinner" aria-hidden="true" /> : <><span>Done</span><span aria-hidden="true">✓</span></>}</button> : <span className={`ruutin-task-state ${task.state}`} role={task.state === "waiting" ? "status" : undefined}>{task.state === "completed" ? "Done" : "Waiting"}</span>}</article>)}</div>}
      </section>
      <section className="ruutin-card companion-today-summary" aria-label="Today summary">
        <div className="companion-summary-stat"><span>Stars</span><strong>{today.balance} ✦</strong></div>
        <div className="companion-summary-progress"><div className="ruutin-card-meta"><span>Today</span><strong>{completedCount}/{today.tasks.length}</strong></div><div className="ruutin-progress" role="progressbar" aria-label="Today routine progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div></div>
        {today.activeReward && <div className="companion-summary-goal"><span aria-hidden="true">{today.activeReward.emoji}</span><span><small>Goal</small><strong>{today.activeReward.title}</strong></span></div>}
      </section>
      <InstallGuidance />
      {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
