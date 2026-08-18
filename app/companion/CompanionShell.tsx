"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const destinations = [
  { href: "/companion/today", label: "Today", icon: "☼" },
  { href: "/companion/rewards", label: "Rewards", icon: "✦" },
] as const;

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
        <a className="ruutin-app-brand" href="/companion/today" aria-label="Ruutin companion Today">
          <span className="ruutin-app-mark" aria-hidden="true">✦</span>
          <span>Ruutin</span>
        </a>
        <p className="ruutin-companion-greeting" aria-label={`Signed in as ${profile.nickname}`}>
          {profile.emoji} {profile.nickname}
        </p>
      </header>
      <main id="companion-main" className="ruutin-app-main">{children}</main>
      <nav className="ruutin-bottom-nav companion-bottom-nav" aria-label="Companion navigation">
        {destinations.map((destination) => {
          const active = pathname === destination.href || pathname.startsWith(`${destination.href}/`);
          return (
            <a
              className={`ruutin-bottom-nav-link${active ? " is-active" : ""}`}
              href={destination.href}
              aria-current={active ? "page" : undefined}
              key={destination.href}
            >
              <span className="ruutin-bottom-nav-icon" aria-hidden="true">{destination.icon}</span>
              <span>{destination.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
