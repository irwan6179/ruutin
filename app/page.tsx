import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Ruutin | Calm routines for busy families",
  description:
    "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
};

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
          <a className="br-nav-cta" href="/signin">
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
              <a className="br-button br-button-primary" href="/signin">
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

        <section
          className="br-cta-section br-container"
          id="get-started"
          aria-labelledby="cta-title"
        >
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
            <div className="br-static-auth-cta">
              <strong>Ready when you are.</strong>
              <p>
                Use your email to sign in or create your household. We&apos;ll send a one-time code.
              </p>
              <a className="br-button br-button-light" href="/signin">
                Continue with email <span aria-hidden="true">↗</span>
              </a>
            </div>
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
