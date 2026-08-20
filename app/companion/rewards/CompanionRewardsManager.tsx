"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionPendingOverlay } from "../../components/ActionPendingOverlay";

type Reward = {
  id: string;
  title: string;
  emoji: string;
  starCost: number;
  isActive: boolean;
};

type RewardRequest = {
  id: string;
  rewardId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt: string | null;
};

type RewardsData = {
  profile: { nickname: string; emoji: string };
  balance: number;
  activeReward: Reward | null;
  rewards: Reward[];
};

async function companionRequest(path: string, body: Record<string, unknown>): Promise<RewardRequest> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { request?: RewardRequest; message?: string };
  if (!response.ok || !payload.request) throw new Error(payload.message ?? "That reward request could not be sent yet.");
  return payload.request;
}

function dateLabel(value: string): string {
  try { return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
  catch { return value; }
}

function statusLabel(status: RewardRequest["status"]): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not this time";
  return "Request pending · Waiting for parent";
}

function statusClass(status: RewardRequest["status"]): string {
  if (status === "approved") return "good";
  if (status === "pending") return "pending";
  return "";
}

export function CompanionRewardsManager({ initialRewards, initialRequests }: { initialRewards: RewardsData; initialRequests: RewardRequest[] }) {
  const [rewards, setRewards] = useState(initialRewards);
  const [requests, setRequests] = useState(initialRequests);
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingByReward = useMemo(() => new Map(requests.filter((request) => request.status === "pending").map((request) => [request.rewardId, request])), [requests]);
  const latestRequestByReward = useMemo(() => {
    const latest = new Map<string, RewardRequest>();
    for (const request of requests) {
      const previous = latest.get(request.rewardId);
      if (!previous || request.requestedAt > previous.requestedAt || (request.requestedAt === previous.requestedAt && request.id > previous.id)) {
        latest.set(request.rewardId, request);
      }
    }
    return latest;
  }, [requests]);
  // Keep pending requests in the record. A request is still meaningful while
  // a parent is deciding, and hiding it made the goal card say "Ready to ask"
  // at the same time as the request was already waiting.
  const history = useMemo(
    () => [...requests].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt) || right.id.localeCompare(left.id)),
    [requests],
  );
  const remaining = rewards.activeReward ? Math.max(0, rewards.activeReward.starCost - rewards.balance) : 0;
  const progress = rewards.activeReward ? Math.min(100, Math.round((rewards.balance / rewards.activeReward.starCost) * 100)) : 0;
  const activeRequest = rewards.activeReward ? latestRequestByReward.get(rewards.activeReward.id) : undefined;
  const activeGoalStatus = activeRequest?.status === "pending"
    ? "Request pending · Waiting for parent"
    : activeRequest?.status === "approved"
      ? "Approved"
      : remaining > 0
        ? `${remaining} more stars to go`
        : "Goal reached · Ready to ask";
  const activeGoalStatusClass = activeRequest?.status === "pending"
    ? "pending"
    : activeRequest?.status === "approved" || remaining === 0
      ? "good"
      : "";

  async function refresh() {
    const [rewardsResponse, requestsResponse] = await Promise.all([
      fetch("/api/companion/rewards", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/companion/rewards/requests", { credentials: "same-origin", cache: "no-store" }),
    ]);
    const rewardsPayload = await rewardsResponse.json() as { rewards?: RewardsData; message?: string };
    const requestsPayload = await requestsResponse.json() as { requests?: RewardRequest[]; message?: string };
    if (!rewardsResponse.ok || !rewardsPayload.rewards || !requestsResponse.ok || !requestsPayload.requests) throw new Error(rewardsPayload.message ?? requestsPayload.message ?? "Could not refresh rewards.");
    setRewards(rewardsPayload.rewards); setRequests(requestsPayload.requests);
  }

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible" || busy) return;
      void refresh().catch(() => undefined);
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [busy]);

  async function refreshManually() {
    if (busy || refreshing) return;
    setRefreshing(true); setError("");
    try { await refresh(); setNotice("Rewards are up to date."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh rewards."); }
    finally { setRefreshing(false); }
  }

  async function askFor(reward: Reward) {
    if (busy || pendingByReward.has(reward.id)) return;
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticRequest: RewardRequest = {
      id: optimisticId,
      rewardId: reward.id,
      status: "pending",
      requestedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    setBusy(reward.id); setError(""); setNotice("");
    setRequests((current) => [...current, optimisticRequest]);
    try {
      const request = await companionRequest("/api/companion/rewards/requests", { rewardId: reward.id });
      setRequests((current) => current.map((item) => item.id === optimisticId ? request : item));
      setNotice(`Asked your parent about ${reward.title}.`);
      void refresh().catch(() => undefined);
    }
    catch (cause) {
      setRequests((current) => current.filter((item) => item.id !== optimisticId));
      setError(cause instanceof Error ? cause.message : "That reward request could not be sent yet.");
    }
    finally { setBusy(""); }
  }

  function renderRewardAction(reward: Reward) {
    const pending = pendingByReward.get(reward.id);
    const latestRequest = latestRequestByReward.get(reward.id);
    const starsRemaining = Math.max(0, reward.starCost - rewards.balance);
    const canAsk = starsRemaining === 0;
    if (pending) return <p className="ruutin-form-success companion-request-status" role="status">Request pending · Waiting for parent review</p>;
    return <>
      {latestRequest?.status === "approved" && <p className="ruutin-form-success companion-request-status" role="status">Approved</p>}
      {canAsk ? <button className="ruutin-button secondary" type="button" disabled={Boolean(busy)} onClick={() => void askFor(reward)}>{busy === reward.id ? "Sending…" : latestRequest?.status === "rejected" || latestRequest?.status === "approved" ? "Ask parent again" : "Ask parent"} <span aria-hidden="true">↗</span></button> : <p className="ruutin-state-note companion-reward-unavailable" role="status">{starsRemaining} more stars needed before you can ask</p>}
    </>;
  }

  return (
    <div className="ruutin-page-stack companion-page-stack">
      <ActionPendingOverlay
        active={Boolean(busy) || refreshing}
        label={refreshing ? "Refreshing rewards…" : "Sending your reward request…"}
      />
      <section className="ruutin-page-heading" aria-labelledby="companion-rewards-title"><div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">Small wins</p><h1 id="companion-rewards-title">Rewards</h1></div><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={Boolean(busy) || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div><p>Your parent picks the ideas. You choose what to ask for.<span className="sr-only"> This is an assigned-profile space; your parent chooses, and there is no rush.</span></p></section>
      <section id={rewards.activeReward ? "companion-active-goal" : undefined} className="ruutin-card companion-balance-card companion-active-goal" aria-label="Star balance and active goal"><span className="ruutin-eyebrow">Your stars</span><strong>{rewards.balance} ✦</strong>{rewards.activeReward ? <><p>{rewards.activeReward.emoji} {rewards.activeReward.title} · {rewards.activeReward.starCost} stars</p><div className="ruutin-progress" role="progressbar" aria-label={`Progress towards ${rewards.activeReward.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span aria-hidden="true" style={{ width: `${progress}%` }} /></div><div className="ruutin-card-meta companion-goal-status"><span>{progress}% of the goal</span><strong className={`ruutin-state-note ${activeGoalStatusClass}`} aria-live="polite">{activeGoalStatus}{remaining > 0 && !activeRequest && <span className="sr-only"> ({remaining} more to go)</span>}</strong></div></> : <p>No active goal yet. Your parent can add one when the time feels right.</p>}</section>
      <section aria-labelledby="reward-list-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent-selected</p><h2 id="reward-list-title">Reward ideas</h2></div><span className="ruutin-count-pill">{rewards.rewards.length}</span></div>{rewards.rewards.length === 0 ? <p className="ruutin-empty-state">Your parent can add a reward when the time feels right.</p> : <div className="ruutin-reward-catalogue companion-reward-catalogue">{rewards.rewards.map((reward) => { const pending = pendingByReward.get(reward.id); return <article className={`ruutin-card ruutin-reward-card${reward.isActive ? " is-active" : ""}${pending ? " is-request-pending" : ""}`} key={reward.id}><div className="ruutin-profile-card-top"><span className="ruutin-avatar" aria-hidden="true">{reward.emoji}</span><div><h3>{reward.title}</h3><p>{reward.starCost} {reward.starCost === 1 ? "star" : "stars"} needed{reward.isActive ? " · active goal" : ""}</p></div></div>{renderRewardAction(reward)}</article>; })}</div>}</section>
      <section className="ruutin-card ruutin-queue-card" aria-labelledby="companion-request-history-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Your requests</p><h2 id="companion-request-history-title">A clear record</h2></div><span className="ruutin-count-pill">{history.length}</span></div>{history.length === 0 ? <p className="ruutin-empty-state">Requests you make will stay here with their outcome.</p> : <ul className="ruutin-simple-list">{history.map((request) => { const reward = rewards.rewards.find((item) => item.id === request.rewardId); return <li className={`companion-request-record is-${request.status}`} key={request.id}><span className="ruutin-avatar small" aria-hidden="true">{reward?.emoji ?? "✦"}</span><span><strong>{reward?.title ?? "Reward idea"}</strong><small>{dateLabel(request.resolvedAt ?? request.requestedAt)}</small></span><span className={`ruutin-state-note ${statusClass(request.status)}`}>{statusLabel(request.status)}</span></li>; })}</ul>}</section>
      {notice && <p className="ruutin-form-success ruutin-live-feedback" role="status" aria-live="polite">{notice}</p>}{error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
