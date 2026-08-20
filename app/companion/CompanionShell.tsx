"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../components/ActionPendingOverlay";

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
  return (
    <span className="ruutin-bottom-nav-content">
      <span className="ruutin-bottom-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
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
  const { pendingLabel, beginNavigation } = usePendingDocumentNavigation();
  return (
    <div className="ruutin-companion-shell">
      <ActionPendingOverlay active={Boolean(pendingLabel)} label={pendingLabel} />
      <a className="ruutin-skip-link" href="#companion-main">Skip to content</a>
      <header className="ruutin-app-header companion-header">
        <a
          className="ruutin-app-brand"
          href="/companion/today"
          aria-label="Ruutin companion Today"
          onClick={(event) => beginNavigation(event, "/companion/today", "Today")}
        >
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
              onClick={(event) =>
                beginNavigation(event, destination.href, destination.label)
              }
              key={destination.href}
            >
              <DestinationLabel icon={destination.icon} label={destination.label} />
            </a>
          );
        })}
      </nav>
    </div>
  );
}
