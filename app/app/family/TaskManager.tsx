"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ROUTINE_CATEGORIES, templateById } from "../../../shared/task-templates";
import type { ParentProfile, ParentTask, TaskOccurrence, TaskSchedule } from "../profile-contracts";
import { ActionPendingOverlay } from "../../components/ActionPendingOverlay";

const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;

type Draft = { title: string; emoji: string; stars: number; schedule: TaskSchedule };
type ReviewDraft = Draft & { templateId: string; requiresExplicitDays: boolean };

const defaultDraft: Draft = {
  title: "",
  emoji: "🌿",
  stars: 1,
  schedule: { type: "daily" },
};

async function getCsrf(): Promise<string> {
  const response = await fetch("/api/parent/csrf", { credentials: "same-origin" });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) throw new Error("Could not verify this request");
  return payload.csrfToken;
}

async function taskRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET") headers.set("x-ruutin-csrf", await getCsrf());
  const response = await fetch(path, { ...init, credentials: "same-origin", headers });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "We couldn’t save that task yet.");
  return payload;
}

function copySchedule(schedule: TaskSchedule): TaskSchedule {
  if (schedule.type === "weekdays") return { type: "weekdays", days: [...schedule.days] };
  return { ...schedule };
}

function scheduleLabel(schedule: TaskSchedule): string {
  if (schedule.type === "daily") return "Every day";
  if (schedule.type === "one_off") return `One-off · ${schedule.localDate}`;
  const labels = schedule.days.map((day) => WEEKDAYS.find(([value]) => value === day)?.[1]).filter(Boolean);
  return labels.join(" · ");
}

function templateDraft(template: { title: string; emoji: string; stars: number; schedule: TaskSchedule; scheduleMode?: "parent_selected_days" }): Draft {
  const schedule = template.scheduleMode === "parent_selected_days"
    ? { type: "weekdays" as const, days: [] }
    : copySchedule(template.schedule);
  return { title: template.title, emoji: template.emoji, stars: template.stars, schedule };
}

function TaskEditor({
  initial,
  onSubmit,
  onCancel,
  cancelLabel = "Cancel",
  busy,
  submitLabel,
  defaultLocalDate,
  onDraftChange,
}: {
  initial: Draft;
  onSubmit?: (draft: Draft) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  busy: boolean;
  submitLabel?: string;
  defaultLocalDate?: string;
  onDraftChange?: (draft: Draft) => void;
}) {
  const editorId = useId();
  const [draft, setDraft] = useState<Draft>(() => ({ ...initial, schedule: copySchedule(initial.schedule) }));
  const schedule = draft.schedule;

  function updateDraft(updater: (current: Draft) => Draft) {
    // Event handlers run with the current controlled draft. Notify the parent
    // after computing the next value, rather than from inside a state updater;
    // the latter is evaluated during TaskEditor render and React correctly
    // rejects a synchronous TaskManager update at that point.
    const next = updater(draft);
    setDraft(next);
    onDraftChange?.(next);
  }

  function setScheduleType(type: TaskSchedule["type"]) {
    if (type === "daily") updateDraft((current) => ({ ...current, schedule: { type: "daily" } }));
    else if (type === "one_off") updateDraft((current) => ({ ...current, schedule: { type: "one_off", localDate: defaultLocalDate ?? new Date().toISOString().slice(0, 10) } }));
    else updateDraft((current) => ({ ...current, schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] } }));
  }

  function toggleDay(day: number) {
    if (schedule.type !== "weekdays") return;
    const days = schedule.days.includes(day) ? schedule.days.filter((value) => value !== day) : [...schedule.days, day].sort((a, b) => a - b);
    updateDraft((current) => ({ ...current, schedule: { type: "weekdays", days } }));
  }

  return (
    <form className="ruutin-form ruutin-task-editor" onSubmit={(event) => { event.preventDefault(); if (onSubmit) void onSubmit(draft); }} aria-busy={busy}>
      <label htmlFor={`${editorId}-title`}>Task wording</label>
      <input id={`${editorId}-title`} value={draft.title} maxLength={120} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))} required />
      <div className="ruutin-task-editor-row">
        <div><label htmlFor={`${editorId}-emoji`}>Emoji</label><input id={`${editorId}-emoji`} value={draft.emoji} maxLength={8} onChange={(event) => updateDraft((current) => ({ ...current, emoji: event.target.value }))} required /></div>
        <div><label htmlFor={`${editorId}-stars`}>Stars</label><select id={`${editorId}-stars`} value={draft.stars} onChange={(event) => updateDraft((current) => ({ ...current, stars: Number(event.target.value) }))}><option value={1}>1 star</option><option value={2}>2 stars</option><option value={3}>3 stars</option></select></div>
      </div>
      <label htmlFor={`${editorId}-schedule`}>Schedule</label>
      <select id={`${editorId}-schedule`} value={schedule.type} onChange={(event) => setScheduleType(event.target.value as TaskSchedule["type"])}>
        <option value="daily">Every day</option>
        <option value="weekdays">Selected weekdays</option>
        <option value="one_off">One-off local date</option>
      </select>
      {schedule.type === "weekdays" && <fieldset className="ruutin-day-picker"><legend>Choose days</legend><div>{WEEKDAYS.map(([day, label]) => <label key={day} className="ruutin-day-chip"><input type="checkbox" checked={schedule.days.includes(day)} onChange={() => toggleDay(day)} /><span>{label}</span></label>)}</div></fieldset>}
      {schedule.type === "one_off" && <><label htmlFor={`${editorId}-one-off-date`}>Local date</label><input id={`${editorId}-one-off-date`} type="date" value={schedule.localDate} onChange={(event) => updateDraft((current) => ({ ...current, schedule: { type: "one_off", localDate: event.target.value } }))} required /></>}
      <div className="ruutin-family-actions">{onSubmit && submitLabel && <button className="ruutin-button" type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel} <span aria-hidden="true">↗</span></button>}{onCancel && <button className="ruutin-text-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>}</div>
    </form>
  );
}

function TaskCard({
  task,
  index,
  count,
  onEdit,
  onArchive,
  onMove,
}: {
  task: TaskOccurrence;
  index: number;
  count: number;
  onEdit: (task: TaskOccurrence) => void;
  onArchive: (task: TaskOccurrence) => void;
  onMove: (task: TaskOccurrence, direction: -1 | 1) => void;
}) {
  const stateLabel = task.state === "completed" ? "Completed" : task.state === "waiting" ? "Waiting for approval" : task.state === "not_due" ? "Not due today" : "To do";
  return <article className="ruutin-card ruutin-task-card">
    <div className="ruutin-task-card-top"><span className="ruutin-avatar small" aria-hidden="true">{task.emoji}</span><div><h3>{task.title}</h3><p>{scheduleLabel(task.schedule)} · {task.stars} {task.stars === 1 ? "star" : "stars"}</p></div><span className={`ruutin-task-state ${task.state}`}>{stateLabel}</span></div>
    <div className="ruutin-task-actions"><button className="ruutin-button secondary" type="button" onClick={() => onEdit(task)}>Edit</button><button className="ruutin-text-button danger" type="button" onClick={() => onArchive(task)}>Archive</button><span className="ruutin-task-reorder"><button className="ruutin-icon-button" type="button" aria-label={`Move ${task.title} up`} disabled={index === 0} onClick={() => onMove(task, -1)}>↑</button><button className="ruutin-icon-button" type="button" aria-label={`Move ${task.title} down`} disabled={index === count - 1} onClick={() => onMove(task, 1)}>↓</button></span></div>
  </article>;
}

export function TaskManager({
  initialProfiles,
  initialProfileId,
  initialTasks = [],
  initialLocalDate = "",
  compact = false,
  onTasksChange,
}: {
  initialProfiles: ParentProfile[];
  initialProfileId?: string;
  initialTasks?: ParentTask[];
  initialLocalDate?: string;
  compact?: boolean;
  onTasksChange?: (count: number) => void;
}) {
  const activeProfiles = useMemo(() => initialProfiles.filter((profile) => !profile.archivedAt), [initialProfiles]);
  const [profileId, setProfileId] = useState(initialProfileId ?? activeProfiles[0]?.id ?? "");
  const [tasks, setTasks] = useState<TaskOccurrence[]>(initialTasks as TaskOccurrence[]);
  const [localDate, setLocalDate] = useState(initialLocalDate);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<ReviewDraft[]>([]);
  const [showPicker, setShowPicker] = useState(initialTasks.length === 0);
  const [showReview, setShowReview] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const effectiveProfileId = profileId || initialProfileId || activeProfiles[0]?.id || "";
  const selectedProfile = activeProfiles.find((profile) => profile.id === effectiveProfileId);
  const selectedCategory = ROUTINE_CATEGORIES.find((category) => category.id === selectedCategoryId);

  async function refresh(nextProfileId = effectiveProfileId) {
    if (!nextProfileId) return;
    setError("");
    const payload = await taskRequest(`/api/parent/tasks?profileId=${encodeURIComponent(nextProfileId)}&view=management`) as { tasks?: TaskOccurrence[]; localDate?: string };
    const nextTasks = payload.tasks ?? [];
    setTasks(nextTasks);
    onTasksChange?.(nextTasks.length);
    setLocalDate(payload.localDate ?? "");
  }

  useEffect(() => {
    if (!effectiveProfileId || effectiveProfileId === initialProfileId && initialTasks.length > 0) return;
    // The fetch is the synchronization boundary when a parent switches profiles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(effectiveProfileId).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load tasks."));
    // Initial data is intentionally used once for the server-rendered first profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProfileId]);

  function chooseCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    const category = ROUTINE_CATEGORIES.find((item) => item.id === categoryId);
    setSelectedTemplateIds(category?.templates.map((template) => template.id) ?? []);
    setShowPicker(true);
    setShowReview(false);
    setReviewDrafts([]);
    setNotice("");
  }

  function toggleTemplate(templateId: string) {
    setSelectedTemplateIds((current) => current.includes(templateId) ? current.filter((id) => id !== templateId) : [...current, templateId]);
  }

  function beginReview() {
    const drafts = selectedTemplateIds.flatMap((templateId): ReviewDraft[] => {
      const template = templateById(templateId);
      if (!template) return [];
      return [{
        ...templateDraft(template),
        templateId,
        requiresExplicitDays: template.scheduleMode === "parent_selected_days",
      }];
    });
    setReviewDrafts(drafts);
    setShowReview(drafts.length > 0);
    setShowPicker(false);
    setError("");
    setNotice("");
  }

  async function saveReviewedDrafts() {
    if (!effectiveProfileId || reviewDrafts.length === 0 || busy || reviewDrafts.some((draft) => draft.requiresExplicitDays && (draft.schedule.type !== "weekdays" || draft.schedule.days.length === 0))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await taskRequest("/api/parent/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: effectiveProfileId, drafts: reviewDrafts.map(({ title, emoji, stars, schedule }) => ({ title, emoji, stars, schedule })) }),
      });
      await refresh();
      setSelectedTemplateIds([]);
      setReviewDrafts([]);
      setShowReview(false);
      setNotice("Your reviewed routines are tucked in together.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save those routines."); }
    finally { setBusy(false); }
  }

  async function saveTask(draft: Draft, taskId?: string) {
    if (!effectiveProfileId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = { profileId: effectiveProfileId, title: draft.title, emoji: draft.emoji, stars: draft.stars, schedule: draft.schedule };
      await taskRequest(taskId ? `/api/parent/tasks/${encodeURIComponent(taskId)}` : "/api/parent/tasks", { method: taskId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(taskId ? { title: draft.title, emoji: draft.emoji, stars: draft.stars, schedule: draft.schedule } : payload) });
      await refresh();
      setEditingTaskId(null); setShowCustom(false);
      setNotice(taskId ? "Task updated — nice and tidy." : "Custom task added.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this task."); }
    finally { setBusy(false); }
  }

  async function archive(task: TaskOccurrence) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await taskRequest(`/api/parent/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      await refresh();
      setNotice("Task archived. Your history stays safe.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not archive this task."); }
    finally { setBusy(false); }
  }

  async function move(task: TaskOccurrence, direction: -1 | 1) {
    const next = [...tasks];
    const index = next.findIndex((item) => item.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length || busy) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTasks(next);
    setBusy(true); setError("");
    try {
      const payload = await taskRequest("/api/parent/tasks/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: effectiveProfileId, taskIds: next.map((item) => item.id) }) }) as { tasks?: TaskOccurrence[] };
      setTasks(payload.tasks ?? next);
    } catch (cause) { setTasks(tasks); setError(cause instanceof Error ? cause.message : "Could not reorder tasks."); }
    finally { setBusy(false); }
  }

  function onProfileChange(nextProfileId: string) {
    setProfileId(nextProfileId); setEditingTaskId(null); setShowCustom(false); setSelectedCategoryId(""); setSelectedTemplateIds([]); setReviewDrafts([]); setShowReview(false); setNotice("");
  }

  return <section className={`ruutin-card ruutin-task-manager${compact ? " is-compact" : ""}`} id={compact ? undefined : "tasks"} aria-labelledby="task-manager-title">
    <ActionPendingOverlay active={busy} label="Updating your routines…" />
    <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Routine setup</p><h2 id="task-manager-title">Tasks that fit your rhythm</h2><p className="ruutin-muted-note">Start with a cheerful suggestion, then make it yours. {localDate && `Today is ${localDate} in your household.`}</p></div>{!compact && <span className="ruutin-count-pill">{tasks.length}</span>}</div>
    {activeProfiles.length > 1 && <div className="ruutin-task-profile-picker"><label htmlFor="task-profile">Set routines for</label><select id="task-profile" value={effectiveProfileId} onChange={(event) => onProfileChange(event.target.value)}>{activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.emoji} {profile.nickname}</option>)}</select></div>}
    {!selectedProfile ? <p className="ruutin-empty-state">Add a profile first, then we’ll make a routine together.</p> : <>
      <div className="ruutin-category-picker" aria-label="Routine categories">{ROUTINE_CATEGORIES.map((category) => <button key={category.id} className={`ruutin-category-chip${selectedCategoryId === category.id ? " is-selected" : ""}`} type="button" aria-pressed={selectedCategoryId === category.id} onClick={() => chooseCategory(category.id)}><span aria-hidden="true">{category.emoji}</span><span>{category.label}</span></button>)}</div>
      {showPicker && !showReview && selectedCategory && <div className="ruutin-suggestion-panel" aria-labelledby="suggestions-title"><div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">{selectedCategory.label}</p><h3 id="suggestions-title">Pick the pieces you want</h3></div><span className="ruutin-muted-note">{selectedCategory.templates.length} ideas</span></div>{selectedCategory.templates.length === 0 ? <p className="ruutin-empty-state">This category is ready for your own words. Try a custom task below.</p> : <div className="ruutin-suggestion-list">{selectedCategory.templates.map((template) => <label className="ruutin-suggestion-row" key={template.id}><input type="checkbox" checked={selectedTemplateIds.includes(template.id)} onChange={() => toggleTemplate(template.id)} /><span className="ruutin-avatar small" aria-hidden="true">{template.emoji}</span><span><strong>{template.title}</strong><small>{scheduleLabel(template.schedule)} · {template.stars} {template.stars === 1 ? "star" : "stars"}</small></span></label>)}</div>}<div className="ruutin-family-actions"><button className="ruutin-button" type="button" disabled={busy || selectedTemplateIds.length === 0} onClick={beginReview}>{`Review ${selectedTemplateIds.length || "selected"}`} <span aria-hidden="true">✦</span></button><button className="ruutin-text-button" type="button" onClick={() => setShowPicker(false)}>Not now</button></div></div>}
      {!showPicker && !showReview && <button className="ruutin-button secondary" type="button" onClick={() => setShowPicker(true)}>Choose routine ideas <span aria-hidden="true">✦</span></button>}
      {showReview && <div className="ruutin-review-panel" aria-labelledby="review-routines-title"><div><p className="ruutin-eyebrow">Before saving</p><h3 id="review-routines-title">Review your routine ideas</h3><p className="ruutin-muted-note">Tune the wording, schedule, and stars for every selected task. Changes stay in this draft until you choose Save reviewed routines.</p></div>{reviewDrafts.map((draft, index) => <div className="ruutin-review-draft" key={draft.templateId}><p className="ruutin-review-source">{templateById(draft.templateId)?.title === draft.title ? "Suggested routine" : "Edited routine"}</p>{draft.requiresExplicitDays && <p className="ruutin-form-help">This starter says “selected days.” Choose at least one weekday before saving.</p>}<TaskEditor initial={draft} defaultLocalDate={localDate} busy={busy} onDraftChange={(next) => setReviewDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...next, requiresExplicitDays: item.requiresExplicitDays && (next.schedule.type === "weekdays" && next.schedule.days.length === 0) } : item))} cancelLabel="Remove from review" onCancel={() => setReviewDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} /></div>)}<div className="ruutin-family-actions"><button className="ruutin-button" type="button" disabled={busy || reviewDrafts.length === 0 || reviewDrafts.some((draft) => draft.requiresExplicitDays && (draft.schedule.type !== "weekdays" || draft.schedule.days.length === 0))} onClick={() => void saveReviewedDrafts()}>{busy ? "Saving…" : "Save reviewed routines"} <span aria-hidden="true">✓</span></button><button className="ruutin-text-button" type="button" disabled={busy} onClick={() => { setShowReview(false); setShowPicker(true); }}>Back to suggestions</button></div></div>}
      <div className="ruutin-task-list" aria-live="polite">{tasks.length === 0 ? <p className="ruutin-empty-state">No tasks yet. Choose a category above to get a kind head start.</p> : tasks.map((task, index) => editingTaskId === task.id ? <div className="ruutin-card ruutin-task-edit-card" key={task.id}><TaskEditor initial={{ title: task.title, emoji: task.emoji, stars: task.stars, schedule: task.schedule }} defaultLocalDate={localDate} busy={busy} submitLabel="Save task" onSubmit={(draft) => saveTask(draft, task.id)} onCancel={() => setEditingTaskId(null)} /></div> : <TaskCard key={task.id} task={task} index={index} count={tasks.length} onEdit={(item) => { setShowCustom(false); setEditingTaskId(item.id); }} onArchive={(item) => void archive(item)} onMove={(item, direction) => void move(item, direction)} />)}</div>
      {!showReview && (showCustom ? <div className="ruutin-card ruutin-task-edit-card"><p className="ruutin-eyebrow">Make it yours</p><h3>Add a custom task</h3><TaskEditor initial={defaultDraft} defaultLocalDate={localDate} busy={busy} submitLabel="Add task" onSubmit={(draft) => saveTask(draft)} onCancel={() => setShowCustom(false)} /></div> : <button className="ruutin-text-button" type="button" onClick={() => { setEditingTaskId(null); setShowCustom(true); }}>+ Add a custom task</button>)}
    </>}
    {notice && <p className="ruutin-form-success" role="status" aria-live="polite">{notice}</p>}
    {error && <p className="ruutin-form-error" role="alert" aria-live="polite">{error}</p>}
  </section>;
}
