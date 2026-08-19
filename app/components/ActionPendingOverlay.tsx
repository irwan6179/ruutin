"use client";

import { useCallback, useState, type MouseEvent } from "react";

export function ActionPendingOverlay({
  active,
  label,
  detail = "Keeping your family space in sync.",
}: {
  active: boolean;
  label: string;
  detail?: string;
}) {
  if (!active) return null;

  return (
    <div className="ruutin-action-pending-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="ruutin-action-pending-card">
        <div className="ruutin-action-pending-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
          <b>✦</b>
        </div>
        <p>Just a moment</p>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export function usePendingDocumentNavigation() {
  const [pendingLabel, setPendingLabel] = useState("");

  const navigate = useCallback(
    (href: string, label: string, options?: { replace?: boolean }) => {
      const destination = new URL(href, window.location.href);
      setPendingLabel(label);

      // Two frames guarantee the pending interaction paints before the
      // authenticated document navigation begins.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (options?.replace) window.location.replace(destination.href);
          else window.location.assign(destination.href);
        });
      });
    },
    [],
  );

  const beginNavigation = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string, label: string) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const destination = new URL(href, window.location.href);
      if (destination.href === window.location.href) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      navigate(destination.href, `Opening ${label}…`);
    },
    [navigate],
  );

  return { pendingLabel, beginNavigation, navigate };
}
