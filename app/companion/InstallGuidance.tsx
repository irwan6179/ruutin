"use client";

import { useEffect, useState } from "react";

function readStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

export function InstallGuidance() {
  const [standalone, setStandalone] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(readStandalone());
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  if (standalone) return null;

  return (
    <section className="ruutin-card companion-install-note" aria-label="Install guidance">
      <div className="ruutin-install-heading">
        <strong>Add to home screen</strong>
        <button className="ruutin-text-button compact" type="button" aria-expanded={open} aria-controls="install-guidance-details" onClick={() => setOpen((current) => !current)}>
          {open ? "Close" : "How"}
        </button>
      </div>
      {open && <div className="ruutin-install-details" id="install-guidance-details">
        <p><strong>iPhone:</strong> Share → <em>Add to Home Screen</em>.</p>
        <p><strong>Android:</strong> Menu → <em>Install app</em>.</p>
        <p>If asked to link again, use a fresh six-digit code.</p>
      </div>}
    </section>
  );
}
