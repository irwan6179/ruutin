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

      <header className="br-header">
        <Link className="br-brand" href="/" prefetch={false} aria-label="Ruutin home">
          <span className="br-brand-mark" aria-hidden="true">
            <span>✦</span>
          </span>
          <span className="br-brand-name">
            <strong>Ruutin</strong>
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
          <div className="br-cta-copy">
            <p className="br-eyebrow">Parent access</p>
            <h1 id="signin-title">
              A calm way <em>in.</em>
            </h1>
            <p>
              Enter your email and we&apos;ll send a secure six-digit code. New parents can create
              their household after signing in.
            </p>
          </div>
          <AuthFlow />
        </div>
        <p className="br-signin-note">
          No password to remember. Your code expires in 10 minutes and works once.
        </p>
      </section>
    </main>
  );
}
