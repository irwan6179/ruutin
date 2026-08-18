import type { Metadata } from "next";
import { AuthFlow } from "./auth/AuthFlow";

export const metadata: Metadata = {
  title: "Ruutin | Calm routines for busy families",
  description:
    "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
};

const routineSteps = [
  {
    number: "01",
    title: "Choose what matters",
    description:
      "Start with a few everyday routines that fit your household, then make them your own.",
  },
  {
    number: "02",
    title: "Keep the rhythm",
    description:
      "Everyone can see what is next, with a simple view that stays kind and easy to follow.",
  },
  {
    number: "03",
    title: "Celebrate progress",
    description:
      "Parents stay in control of approvals, stars, rewards, and every connected device.",
  },
] as const;

const trustNotes = [
  { icon: "◌", label: "Parent-led" },
  { icon: "⌁", label: "Privacy-forward" },
  { icon: "✦", label: "Made for real homes" },
] as const;

const sampleRoutines = [
  { icon: "☼", title: "Morning routine", detail: "5 routines · weekdays", tone: "sun" },
  { icon: "⌂", title: "Home reset", detail: "3 routines · today", tone: "lilac" },
  { icon: "☾", title: "Bedtime wind-down", detail: "4 routines · daily", tone: "plum" },
] as const;

export default function Home() {
  return (
    <main className="br-site">
      <a className="br-skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="br-header">
        <a className="br-brand" href="#main-content" aria-label="Ruutin home">
          <span className="br-brand-mark" aria-hidden="true">
            <span>✦</span>
          </span>
          <span className="br-brand-name">
            <strong>Ruutin</strong>
          </span>
        </a>

        <nav className="br-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Our approach</a>
          <a className="br-nav-cta" href="#sign-in">
            Sign in
          </a>
        </nav>
      </header>

      <div id="main-content">
        <section className="br-hero br-container" aria-labelledby="hero-title">
          <div className="br-hero-copy">
            <p className="br-eyebrow">
              <span className="br-eyebrow-dot" aria-hidden="true" /> A calmer rhythm for home
            </p>
            <h1 id="hero-title">
              Small routines.
              <br />
              <em>More ease.</em>
            </h1>
            <p className="br-hero-description">
              Ruutin gives parents a warm, clear place to shape everyday routines,
              notice progress, and celebrate the things that keep a home moving.
            </p>
            <div className="br-hero-actions">
              <a className="br-button br-button-primary" href="#sign-in">
                Sign in with email <span aria-hidden="true">↗</span>
              </a>
              <a className="br-text-link" href="#how-it-works">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="br-hero-note">
              One-time code sign-in. No password to remember.
            </p>
          </div>

          <div className="br-hero-art" aria-label="A preview of a parent routine view">
            <div className="br-orbit br-orbit-one" aria-hidden="true" />
            <div className="br-orbit br-orbit-two" aria-hidden="true" />
            <div className="br-doodle br-doodle-star" aria-hidden="true">
              ✦
            </div>
            <div className="br-doodle br-doodle-spark" aria-hidden="true">
              ·
            </div>
            <article className="br-routine-card">
              <div className="br-card-topline">
                <div>
                  <p className="br-card-kicker">Your home rhythm</p>
                  <h2>This week</h2>
                </div>
                <span className="br-card-avatar" aria-hidden="true">
                  A
                </span>
              </div>
              <div className="br-progress-row">
                <span>Steady progress</span>
                <strong>68%</strong>
              </div>
              <div className="br-progress-track" aria-hidden="true">
                <span />
              </div>
              <div className="br-routine-list">
                {sampleRoutines.map((routine) => (
                  <div className="br-routine-item" key={routine.title}>
                    <span className={`br-routine-icon br-routine-icon-${routine.tone}`} aria-hidden="true">
                      {routine.icon}
                    </span>
                    <span className="br-routine-copy">
                      <strong>{routine.title}</strong>
                      <small>{routine.detail}</small>
                    </span>
                    <span className="br-routine-check" aria-label="On track">
                      ✓
                    </span>
                  </div>
                ))}
              </div>
              <div className="br-card-footer">
                <span className="br-mini-avatars" aria-hidden="true">
                  <span>A</span>
                  <span>M</span>
                  <span>+</span>
                </span>
                <span>3 people keeping the rhythm</span>
              </div>
            </article>
            <div className="br-floating-note br-floating-note-top">
              <span aria-hidden="true">✿</span>
              <span>Room for real life</span>
            </div>
            <div className="br-floating-note br-floating-note-bottom">
              <span className="br-floating-check" aria-hidden="true">✓</span>
              <span>One thing at a time</span>
            </div>
          </div>
        </section>

        <section className="br-trust-bar" aria-label="Ruutin principles">
          <div className="br-container br-trust-inner">
            <p>Designed around the people who hold a home together.</p>
            <div className="br-trust-notes">
              {trustNotes.map((note) => (
                <span key={note.label}>
                  <b aria-hidden="true">{note.icon}</b> {note.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="br-section br-container" id="how-it-works" aria-labelledby="how-title">
          <div className="br-section-heading">
            <p className="br-eyebrow">A little structure, a lot more breathing room</p>
            <h2 id="how-title">
              Built for the <em>everyday</em> version of family life.
            </h2>
            <p>
              Routines change. Plans wobble. Ruutin keeps the useful part simple,
              so progress can feel encouraging instead of demanding.
            </p>
          </div>
          <div className="br-steps">
            {routineSteps.map((step) => (
              <article className="br-step" key={step.number}>
                <span className="br-step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="br-privacy-section" id="privacy" aria-labelledby="privacy-title">
          <div className="br-container br-privacy-grid">
            <div className="br-privacy-art" aria-hidden="true">
              <div className="br-privacy-sun">✦</div>
              <div className="br-privacy-card br-privacy-card-back" />
              <div className="br-privacy-card br-privacy-card-front">
                <span className="br-privacy-lock">⌁</span>
                <strong>Parents decide</strong>
                <span>What is shared, saved, and celebrated.</span>
              </div>
            </div>
            <div className="br-privacy-copy">
              <p className="br-eyebrow">A thoughtful starting point</p>
              <h2 id="privacy-title">
                Useful for families.<br /><em>Respectful by design.</em>
              </h2>
              <p>
                You stay in charge of the household. Ruutin is built around
                parent-selected information, broad settings, and clear control over
                profiles, routines, rewards, and connected devices.
              </p>
              <ul className="br-check-list">
                <li><span aria-hidden="true">✓</span> No passwords to manage for sign-in</li>
                <li><span aria-hidden="true">✓</span> No exact birth dates or open-ended profiles</li>
                <li><span aria-hidden="true">✓</span> No pressure to make every day perfect</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="br-cta-section br-container" id="sign-in" aria-labelledby="cta-title">
          <div className="br-cta-card">
            <div className="br-cta-copy">
              <p className="br-eyebrow">Your next good step</p>
              <h2 id="cta-title">
                Make space for what <em>matters.</em>
              </h2>
              <p>
                Sign in with your email and we&apos;ll send a one-time code. Your home,
                your pace, your call.
              </p>
            </div>
            <AuthFlow />
          </div>
          <p className="br-footer-note">
            Ruutin is for parents and caregivers. Set up what works for your household,
            then let the small wins add up.
          </p>
        </section>
      </div>

      <footer className="br-footer br-container">
        <a className="br-brand br-brand-footer" href="#main-content">
          <span className="br-brand-mark" aria-hidden="true"><span>✦</span></span>
          <span className="br-brand-name"><strong>Ruutin</strong></span>
        </a>
        <p>Calmer routines for real homes.</p>
        <span className="br-footer-year">© 2026</span>
      </footer>
    </main>
  );
}
