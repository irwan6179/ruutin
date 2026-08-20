import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlow } from "../auth/AuthFlow";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sign in | Ruutin",
  description: "Sign in or create your Ruutin household with a secure one-time email code.",
};

export default function SignInPage() {
  return (
    <main className="br-site br-signin-site">
      <a className="br-skip-link" href="#signin-main">
        Skip to sign in
      </a>

      <header className="br-header br-signin-header">
        <Link className="br-signin-brand" href="/" prefetch={false} aria-label="Ruutin home">
          <span className="br-signin-brand-mark" aria-hidden="true">
            {/* Keep the wordmark and app icon in sync with the installable app icon. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={40} height={40} />
          </span>
          <span className="br-signin-brand-copy">
            <strong>Ruutin</strong>
            <span>family routines</span>
          </span>
        </Link>

        <nav className="br-nav" aria-label="Sign-in navigation">
          <Link className="br-nav-cta" href="/" prefetch={false}>
            Back home
          </Link>
        </nav>
      </header>

      <section
        className="br-signin-page br-container"
        id="signin-main"
        aria-labelledby="signin-title"
      >
        <div className="br-cta-card br-signin-card">
          <div className="br-signin-preview">
            {/* This product collage is the same real UI imagery used on the landing page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ruutin-hero-collage.webp"
              alt="Ruutin family routine screens showing today, progress, and rewards"
              width={1536}
              height={1024}
              fetchPriority="high"
              decoding="async"
            />
            <div className="br-signin-preview-caption">
              <span>A calmer view of today</span>
              <strong>Small routines. Shared wins.</strong>
            </div>
          </div>

          <div className="br-signin-form-panel">
            <div className="br-signin-copy">
              <p className="br-signin-kicker">Parent access</p>
              <h1 id="signin-title">Welcome home.</h1>
              <p>See today&apos;s routines and keep the little wins moving.</p>
            </div>
            <AuthFlow />
            <p className="br-signin-privacy">No password. Your secure code works once.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
