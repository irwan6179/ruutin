"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ParentProfile } from "../profile-contracts";
import { REWARD_TEMPLATES, type RewardTemplate } from "../../../shared/reward-templates";

type Reward = {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  emoji: string;
  starCost: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type RewardRequest = {
  id: string;
  profileId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt: string | null;
  nickname: string;
  profileEmoji: string;
  rewardTitle: string;
  rewardEmoji: string;
  starCost: number;
  rewardArchivedAt: string | null;
};

type EditorValues = { title: string; emoji: string; starCost: string };

async function getCsrf(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

async function parentMutation(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>): Promise<void> {
  const csrf = await getCsrf();
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), "x-ruutin-csrf": csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Ruutin could not save that reward yet.");
}

function requestLabel(status: RewardRequest["status"]): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not this time";
  return "Waiting for review";
}

function dateLabel(value: string | null): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function RewardsManager({
  initialProfiles,
  initialRewards,
  initialRequests,
}: {
  initialProfiles: ParentProfile[];
  initialRewards: Reward[];
  initialRequests: RewardRequest[];
}) {
  const activeProfiles = initialProfiles.filter((profile) => !profile.archivedAt);
  const [profileId, setProfileId] = useState(activeProfiles[0]?.id ?? "");
  const [activeRewardIds, setActiveRewardIds] = useState<Record<string, string | null>>(() => Object.fromEntries(activeProfiles.map((profile) => [profile.id, profile.activeRewardId])));
  const [rewards, setRewards] = useState(initialRewards);
  const [requests, setRequests] = useState(initialRequests);
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedProfile = activeProfiles.find((profile) => profile.id === profileId) ?? activeProfiles[0];
  const profileRewards = useMemo(() => rewards.filter((reward) => reward.profileId === selectedProfile?.id), [rewards, selectedProfile?.id]);
  const activeRewards = profileRewards.filter((reward) => !reward.archivedAt);
  const archivedRewards = profileRewards.filter((reward) => reward.archivedAt);
  const profileRequests = requests.filter((request) => request.profileId === selectedProfile?.id);
  const pendingRequests = profileRequests.filter((request) => request.status === "pending");
  const historyRequests = profileRequests.filter((request) => request.status !== "pending");

  function selectTemplate(template: RewardTemplate) {
    setTemplateId(template.id);
    setEditor({ title: template.title, emoji: template.emoji, starCost: String(template.starCost) });
  }

  function startCreate() {
    setEditingId(null); setTemplateId(""); setEditor({ title: "", emoji: "🎁", starCost: "10" }); setError("");
  }

  function startEdit(reward: Reward) {
    setEditingId(reward.id); setTemplateId(""); setEditor({ title: reward.title, emoji: reward.emoji, starCost: String(reward.starCost) }); setError("");
  }

  async function refresh(nextProfileId = profileId) {
    const [rewardResponse, requestResponse] = await Promise.all([
      fetch(`/api/parent/rewards?profileId=${encodeURIComponent(nextProfileId)}`, { credentials: "same-origin", cache: "no-store" }),
      fetch(`/api/parent/rewards/requests?profileId=${encodeURIComponent(nextProfileId)}&status=all`, { credentials: "same-origin", cache: "no-store" }),
    ]);
    const rewardPayload = await rewardResponse.json() as { rewards?: Reward[]; message?: string };
    const requestPayload = await requestResponse.json() as { requests?: RewardRequest[]; message?: string };
    if (!rewardResponse.ok || !rewardPayload.rewards || !requestResponse.ok || !requestPayload.requests) throw new Error(rewardPayload.message ?? requestPayload.message ?? "Could not refresh rewards.");
    setRewards((current) => [...current.filter((reward) => reward.profileId !== nextProfileId), ...rewardPayload.rewards as Reward[]]);
    setRequests((current) => [...current.filter((request) => request.profileId !== nextProfileId), ...requestPayload.requests as RewardRequest[]]);
  }

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible" || busy || !profileId) return;
      void refresh().catch(() => undefined);
    }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
    // The current profile and mutation key define this screen's refresh scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, profileId]);

  async function refreshManually() {
    if (busy || refreshing || !profileId) return;
    setRefreshing(true); setError("");
    try { await refresh(); setNotice("Rewards are up to date."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh rewards."); }
    finally { setRefreshing(false); }
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !selectedProfile || busy) return;
    setBusy("editor"); setError(""); setNotice("");
    try {
      if (editingId) await parentMutation(`/api/parent/rewards/${encodeURIComponent(editingId)}`, "PATCH", { title: editor.title, emoji: editor.emoji, starCost: Number(editor.starCost) });
      else await parentMutation("/api/parent/rewards", "POST", { profileId: selectedProfile.id, title: editor.title, emoji: editor.emoji, starCost: Number(editor.starCost) });
      await refresh(); setEditor(null); setNotice(editingId ? "Reward idea updated." : "Reward idea added — a small moment to look forward to.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save reward."); }
    finally { setBusy(""); }
  }

  async function chooseActive(rewardId: string | null) {
    if (!selectedProfile || busy) return;
    setBusy(`active-${rewardId ?? "none"}`); setError(""); setNotice("");
    try { await parentMutation("/api/parent/rewards/active", "POST", { profileId: selectedProfile.id, rewardId }); await refresh(); setActiveRewardIds((current) => ({ ...current, [selectedProfile.id]: rewardId })); setNotice(rewardId ? "Active goal updated." : "Active goal cleared."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the active goal."); }
    finally { setBusy(""); }
  }

  async function archive(reward: Reward) {
    if (busy) return;
    setBusy(`archive-${reward.id}`); setError(""); setNotice("");
    try { await parentMutation(`/api/parent/rewards/${encodeURIComponent(reward.id)}`, "DELETE"); await refresh(); setNotice(`${reward.title} moved to the archive.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not archive reward."); }
    finally { setBusy(""); }
  }

  async function decide(request: RewardRequest, decision: "approve" | "reject") {
    if (busy) return;
    setBusy(`request-${request.id}`); setError(""); setNotice("");
    try { await parentMutation("/api/parent/rewards/requests", "POST", { requestId: request.id, decision }); await refresh(); setNotice(decision === "approve" ? "Approved — the stars are safely recorded." : "Sent back for another try."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update that request."); }
    finally { setBusy(""); }
  }

  if (!selectedProfile) return <div className="ruutin-page-stack"><section className="ruutin-page-heading"><p className="ruutin-eyebrow">Shared moments</p><h1>Rewards, your way.</h1><p>Add a family profile before choosing a reward goal.</p></section></div>;

  return (
    <div className="ruutin-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="rewards-title"><div className="ruutin-page-heading-top"><div><p className="ruutin-eyebrow">Shared moments, gently chosen</p><h1 id="rewards-title">Rewards, your way.</h1></div><button className="ruutin-button secondary compact" type="button" onClick={() => void refreshManually()} disabled={Boolean(busy) || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div><p>Choose small, meaningful moments for each person. Ruutin keeps this parent-managed — it is not a shop or a competition.</p></section>
      <section className="ruutin-card ruutin-rewards-toolbar" aria-label="Reward profile selection"><label htmlFor="reward-profile">For</label><select id="reward-profile" value={selectedProfile.id} onChange={(event) => { setProfileId(event.target.value); setEditor(null); setError(""); void refresh(event.target.value); }}>{activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.emoji} {profile.nickname}</option>)}</select><span className="ruutin-state-note">{activeRewards.length} of 5 active ideas</span><button className="ruutin-button" type="button" onClick={startCreate} disabled={activeRewards.length >= 5}>Add reward <span aria-hidden="true">+</span></button></section>
      {editor && <form className="ruutin-card ruutin-form ruutin-reward-editor" onSubmit={(event) => void submitEditor(event)} aria-busy={busy === "editor"}><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">{editingId ? "Refine the idea" : "One small thing"}</p><h2>{editingId ? "Edit reward" : "Add a reward"}</h2></div><button className="ruutin-text-button" type="button" onClick={() => setEditor(null)} disabled={busy === "editor"}>Cancel</button></div>{!editingId && <div><label htmlFor="reward-template">Start from a gentle idea <span>(optional)</span></label><select id="reward-template" value={templateId} onChange={(event) => { const next = REWARD_TEMPLATES.find((template) => template.id === event.target.value); if (next) selectTemplate(next); }}><option value="">Write my own</option>{REWARD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.emoji} {template.title} · {template.starCost} stars</option>)}</select></div>}<div className="ruutin-reward-editor-grid"><div><label htmlFor="reward-emoji">Emoji</label><input id="reward-emoji" value={editor.emoji} onChange={(event) => setEditor({ ...editor, emoji: event.target.value })} maxLength={8} required /></div><div><label htmlFor="reward-title">Reward idea</label><input id="reward-title" value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} maxLength={120} required /></div></div><label htmlFor="reward-cost">Stars needed</label><input id="reward-cost" type="number" min={1} step={1} value={editor.starCost} onChange={(event) => setEditor({ ...editor, starCost: event.target.value })} required /><button className="ruutin-button" type="submit" disabled={busy === "editor"}>{busy === "editor" ? "Saving…" : editingId ? "Save changes" : "Add reward"} <span aria-hidden="true">↗</span></button></form>}
      <section aria-labelledby="active-rewards-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent catalogue</p><h2 id="active-rewards-title">Ideas for {selectedProfile.nickname}</h2></div><span className="ruutin-count-pill">{activeRewards.length}</span></div>{activeRewards.length === 0 ? <p className="ruutin-empty-state">No reward ideas yet. Add one small, meaningful moment to begin.</p> : <div className="ruutin-reward-catalogue">{activeRewards.map((reward) => { const isActive = (activeRewardIds[selectedProfile.id] ?? null) === reward.id; return <article className={`ruutin-card ruutin-reward-card${isActive ? " is-active" : ""}`} key={reward.id}><div className="ruutin-profile-card-top"><span className="ruutin-avatar" aria-hidden="true">{reward.emoji}</span><div><h3>{reward.title}</h3><p>{reward.starCost} {reward.starCost === 1 ? "star" : "stars"} needed{isActive ? " · active goal" : ""}</p></div>{isActive && <span className="ruutin-state-note good">Current goal</span>}</div><div className="ruutin-family-actions"><button className={`ruutin-button ${isActive ? "secondary" : ""}`} type="button" onClick={() => void chooseActive(isActive ? null : reward.id)} disabled={Boolean(busy)}>{busy === `active-${reward.id}` ? "Saving…" : isActive ? "Clear goal" : "Make active goal"}</button><button className="ruutin-button secondary" type="button" onClick={() => startEdit(reward)} disabled={Boolean(busy)}>Edit</button><button className="ruutin-text-button danger" type="button" onClick={() => void archive(reward)} disabled={Boolean(busy)}>{busy === `archive-${reward.id}` ? "Archiving…" : "Archive"}</button></div></article>; })}</div>}</section>
      {archivedRewards.length > 0 && <section className="ruutin-card ruutin-archive-panel" aria-labelledby="archived-rewards-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Kept for your records</p><h2 id="archived-rewards-title">Archived ideas</h2></div><button className="ruutin-text-button" type="button" aria-expanded={showArchived} onClick={() => setShowArchived((current) => !current)}>{showArchived ? "Hide" : "Show"}</button></div>{showArchived && <ul className="ruutin-simple-list">{archivedRewards.map((reward) => <li key={reward.id}><span className="ruutin-avatar small" aria-hidden="true">{reward.emoji}</span><span><strong>{reward.title}</strong><small>{reward.starCost} stars · archived {dateLabel(reward.archivedAt)}</small></span></li>)}</ul>}</section>}
      <section className="ruutin-card ruutin-queue-card" aria-labelledby="reward-requests-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Parent review</p><h2 id="reward-requests-title">Reward requests</h2></div><span className="ruutin-count-pill">{pendingRequests.length}</span></div>{pendingRequests.length === 0 ? <p className="ruutin-empty-state">No requests waiting. The queue will appear here when {selectedProfile.nickname} asks for a reward.</p> : <ul className="ruutin-simple-list">{pendingRequests.map((request) => <li className="ruutin-claim-row" key={request.id}><span className="ruutin-avatar small" aria-hidden="true">{request.rewardEmoji}</span><span><strong>{request.rewardTitle}</strong><small>{request.nickname} · {request.starCost} {request.starCost === 1 ? "star" : "stars"} · {dateLabel(request.requestedAt)}</small></span><span className="ruutin-claim-actions"><button className="ruutin-button compact" type="button" disabled={Boolean(busy)} onClick={() => void decide(request, "approve")}>{busy === `request-${request.id}` ? "Saving…" : "Approve"}</button><button className="ruutin-text-button danger compact" type="button" disabled={Boolean(busy)} onClick={() => void decide(request, "reject")}>Not now</button></span></li>)}</ul>}</section>
      {historyRequests.length > 0 && <section className="ruutin-card ruutin-queue-card" aria-labelledby="reward-history-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">A clear record</p><h2 id="reward-history-title">Request history</h2></div><span className="ruutin-count-pill">{historyRequests.length}</span></div><ul className="ruutin-simple-list">{historyRequests.map((request) => <li key={request.id}><span className="ruutin-avatar small" aria-hidden="true">{request.rewardEmoji}</span><span><strong>{request.rewardTitle}</strong><small>{request.nickname} · {dateLabel(request.resolvedAt ?? request.requestedAt)}</small></span><span className={`ruutin-state-note ${request.status === "approved" ? "good" : ""}`}>{requestLabel(request.status)}</span></li>)}</ul></section>}
      {notice && <p className="ruutin-form-success ruutin-live-feedback" role="status" aria-live="polite">{notice}</p>}{error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
    </div>
  );
}
