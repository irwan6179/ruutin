import { getD1 } from "../../../db";
import { getCompanionToday } from "../../../server/companion";
import { getServerConfig } from "../../../server/config";
import { getCompanionPageContext } from "../page-context";

export const dynamic = "force-dynamic";

export default async function CompanionTodayPage() {
  const context = await getCompanionPageContext();
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  const today = await getCompanionToday(getD1(), context);
  return (
    <div className="ruutin-page-stack companion-page-stack">
      <section className="ruutin-page-heading" aria-labelledby="companion-today-title">
        <p className="ruutin-eyebrow">{today.localDate} · your space</p>
        <h1 id="companion-today-title">Hi {today.profile.nickname} {today.profile.emoji}</h1>
        <p>Here&apos;s your gentle list for today. Your parent reviews each routine when you&apos;re ready.</p>
      </section>
      <section className="ruutin-card companion-install-note" aria-label="Install guidance">
        <strong>Make it easy to return</strong>
        <p>Save Ruutin to this device&apos;s home screen for easier access.</p>
      </section>
      <section aria-labelledby="companion-tasks-title">
        <div className="ruutin-section-heading"><div><p className="ruutin-eyebrow">Today</p><h2 id="companion-tasks-title">Your routines</h2></div><span className="ruutin-count-pill">{today.tasks.length}</span></div>
        {today.tasks.length === 0 ? <p className="ruutin-empty-state">Nothing is due today. Enjoy the breathing room.</p> : <div className="ruutin-task-list companion-task-list">{today.tasks.map((task) => <article className="ruutin-card ruutin-task-card" key={task.id}><div className="ruutin-task-card-top"><span className="ruutin-avatar small" aria-hidden="true">{task.emoji}</span><div><h3>{task.title}</h3><p>{task.stars} {task.stars === 1 ? "star" : "stars"}</p></div><span className={`ruutin-task-state${task.state === "completed" ? " completed" : task.state === "waiting" ? " waiting" : ""}`}>{task.state === "completed" ? "Completed" : task.state === "waiting" ? "Waiting for approval" : "To do"}</span></div></article>)}</div>}
      </section>
    </div>
  );
}
