"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const destinations = [
  { href: "/app/today", label: "Today", icon: "☼" },
  { href: "/app/family", label: "Family", icon: "⌂" },
  { href: "/app/rewards", label: "Rewards", icon: "✦" },
  { href: "/app/settings", label: "Settings", icon: "⚙" },
] as const;

export function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="ruutin-parent-shell">
      <a className="ruutin-skip-link" href="#parent-main">Skip to content</a>
      <header className="ruutin-app-header">
        <a className="ruutin-app-brand" href="/app/today" aria-label="Ruutin Today">
          <span className="ruutin-app-mark" aria-hidden="true">✦</span>
          <span>Ruutin</span>
        </a>
        <span className="ruutin-parent-label">Parent space</span>
      </header>
      <main id="parent-main" className="ruutin-app-main">{children}</main>
      <nav className="ruutin-bottom-nav" aria-label="Parent navigation">
        {destinations.map((destination) => {
          const active = pathname === destination.href || (destination.href !== "/app/today" && pathname.startsWith(`${destination.href}/`));
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
