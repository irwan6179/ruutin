"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const destinations = [
  { href: "/companion/today", label: "Today", icon: "☼" },
  { href: "/companion/rewards", label: "Rewards", icon: "✦" },
] as const;

function DestinationLabel({
  icon,
  label,
}: {
  icon: string;
  label: string;
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={`ruutin-bottom-nav-content${pending ? " is-pending" : ""}`}
      aria-busy={pending}
    >
      <span className="ruutin-bottom-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      {pending ? (
        <span className="sr-only" role="status">
          Loading {label}
        </span>
      ) : null}
    </span>
  );
}

export function CompanionShell({
  children,
  profile,
}: {
  children: ReactNode;
  profile: { nickname: string; emoji: string };
}) {
  const pathname = usePathname();
  return (
    <div className="ruutin-companion-shell">
      <a className="ruutin-skip-link" href="#companion-main">Skip to content</a>
      <header className="ruutin-app-header companion-header">
        <Link className="ruutin-app-brand" href="/companion/today" aria-label="Ruutin companion Today" prefetch={false}>
          <span className="ruutin-app-mark" aria-hidden="true">✦</span>
          <span>Ruutin</span>
        </Link>
        <p className="ruutin-companion-greeting" aria-label={`Signed in as ${profile.nickname}`}>
          {profile.emoji} {profile.nickname}
        </p>
      </header>
      <main id="companion-main" className="ruutin-app-main">{children}</main>
      <nav className="ruutin-bottom-nav companion-bottom-nav" aria-label="Companion navigation">
        {destinations.map((destination) => {
          const active = pathname === destination.href || pathname.startsWith(`${destination.href}/`);
          return (
            <Link
              className={`ruutin-bottom-nav-link${active ? " is-active" : ""}`}
              href={destination.href}
              aria-current={active ? "page" : undefined}
              prefetch={false}
              key={destination.href}
            >
              <DestinationLabel icon={destination.icon} label={destination.label} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
