"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ActionPendingOverlay,
  usePendingDocumentNavigation,
} from "../components/ActionPendingOverlay";

const destinations = [
  { href: "/app/today", label: "Today", icon: "☼" },
  { href: "/app/family", label: "Family", icon: "⌂" },
  { href: "/app/rewards", label: "Rewards", icon: "✦" },
  { href: "/app/settings", label: "Settings", icon: "⚙" },
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

export function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onboarding = pathname === "/app/onboarding";
  const { pendingLabel, beginNavigation } = usePendingDocumentNavigation();
  return (
    <div className={`ruutin-parent-shell${onboarding ? " is-onboarding" : ""}`}>
      <ActionPendingOverlay active={Boolean(pendingLabel)} label={pendingLabel} />
      <a className="ruutin-skip-link" href="#parent-main">Skip to content</a>
      <header className="ruutin-app-header">
        {onboarding ? (
          <span className="ruutin-app-brand" aria-label="Ruutin setup">
            <span className="ruutin-app-mark" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="" width={40} height={40} />
            </span>
            <span>Ruutin</span>
          </span>
        ) : (
          <a
            className="ruutin-app-brand"
            href="/app/today"
            aria-label="Ruutin Today"
            onClick={(event) => beginNavigation(event, "/app/today", "Today")}
          >
            <span className="ruutin-app-mark" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="" width={40} height={40} />
            </span>
            <span>Ruutin</span>
          </a>
        )}
        <span className="ruutin-parent-label">{onboarding ? "Quick setup" : "Parent space"}</span>
      </header>
      <main id="parent-main" className="ruutin-app-main">{children}</main>
      {!onboarding && <nav className="ruutin-bottom-nav" aria-label="Parent navigation">
        {destinations.map((destination) => {
          const active = pathname === destination.href || (destination.href !== "/app/today" && pathname.startsWith(`${destination.href}/`));
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
      </nav>}
    </div>
  );
}
