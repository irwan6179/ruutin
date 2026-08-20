import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Ruutin | Calm routines for busy families",
  description:
    "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
};

const trustNotes = [
  { icon: "◌", label: "Parents stay in control" },
  { icon: "⌁", label: "Link a companion device" },
  { icon: "✦", label: "No rankings or pressure" },
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
              <span className="br-eyebrow-dot" aria-hidden="true" /> Parent-led routines and rewards
            </p>
            <h1 id="hero-title">
              Small routines.
              <br />
              <em>More ease.</em>
            </h1>
            <p className="br-hero-description">
              Plan a few routines, celebrate progress with stars, and keep every
              reward calmly parent-controlled.
            </p>
            <div className="br-hero-actions">
              <a className="br-button br-button-primary" href="/signin">
                Sign in with email <span aria-hidden="true">↗</span>
              </a>
              <p className="br-hero-note">
                New here? Your private household is created after sign-in.
              </p>
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
            <p>Shared wins without turning home into a competition.</p>
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
                Start with a profile and three routines. Add rewards or a companion
                device whenever your family is ready.
              </p>
            </div>
            <div className="br-static-auth-cta">
              <strong>Ready when you are.</strong>
              <p>
                Use your email to sign in or create your household. We&apos;ll send a
                one-time code—there is no password to remember.
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
