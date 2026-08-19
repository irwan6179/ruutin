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
    description: "Start with one routine that fits your day.",
  },
  {
    number: "02",
    title: "Keep the rhythm",
    description: "See the next step without the fuss.",
  },
  {
    number: "03",
    title: "Celebrate progress",
    description: "Notice progress. Pick a reward.",
  },
] as const;

const trustNotes = [
  { icon: "◌", label: "Parent-led" },
  { icon: "⌁", label: "Privacy-forward" },
  { icon: "✦", label: "Made for real homes" },
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
              A gentler rhythm for home.
            </p>
            <div className="br-hero-actions">
              <a className="br-button br-button-primary" href="#sign-in">
                Sign in with email <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

          <div className="br-hero-art" aria-label="Ruutin mobile app preview">
            {/* The local collage is intentionally served as a static hero asset. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="br-hero-image"
              src="/ruutin-hero-collage.webp"
              alt="Three Ruutin mobile screens showing routines, progress, and family controls"
              width={1536}
              height={1024}
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </section>

        <section className="br-trust-bar" aria-label="Ruutin principles">
          <div className="br-container br-trust-inner">
            <p>A gentler rhythm for real homes.</p>
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
            <p className="br-eyebrow">Three small moves</p>
            <h2 id="how-title">
              Pick. Do. <em>Celebrate.</em>
            </h2>
            <p>
              Make the next good step easy to see.
            </p>
          </div>
          <div className="br-steps">
            {routineSteps.map((step) => (
              <article className="br-step" key={step.number}>
                <span className="br-step-number">{step.number}</span>
                <h3>{step.title === "Choose what matters" ? "Pick a routine" : step.title === "Keep the rhythm" ? "Do one thing" : "Celebrate progress"}</h3>
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
              <p className="br-eyebrow">Parent-led</p>
              <h2 id="privacy-title">
                Clear for kids.<br /><em>Calm for parents.</em>
              </h2>
              <p>
                Parents choose what is shared, saved, and celebrated.
              </p>
              <ul className="br-check-list">
                <li><span aria-hidden="true">🔒</span> No passwords to manage for sign-in</li>
                <li><span aria-hidden="true">🌿</span> Small, clear steps</li>
                <li><span aria-hidden="true">✨</span> Progress without pressure</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="br-cta-section br-container" id="sign-in" aria-labelledby="cta-title">
          <div className="br-cta-card">
            <div className="br-cta-copy">
              <p className="br-eyebrow">Start here</p>
              <h2 id="cta-title">
                Your home.<br /><em>Your pace.</em>
              </h2>
              <p>
                Sign in with your email. We&apos;ll send a one-time code.
              </p>
            </div>
            <AuthFlow />
          </div>
          <p className="br-footer-note">
            Made for parents, caregivers, and the little wins in between.
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
