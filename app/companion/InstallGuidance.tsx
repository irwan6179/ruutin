"use client";

import { useEffect, useState } from "react";

const SAVE_MESSAGE = "Save Ruutin to this device's home screen for easier access.";

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

  return (
    <section className="ruutin-card companion-install-note" aria-label="Install guidance">
      <div className="ruutin-install-heading">
        <strong>{standalone ? "Ruutin is ready to return to" : "Make it easy to return"}</strong>
        <button className="ruutin-text-button compact" type="button" aria-expanded={open} aria-controls="install-guidance-details" onClick={() => setOpen((current) => !current)}>
          {open ? "Hide guidance" : "How to save"}
        </button>
      </div>
      {!standalone && <p>{SAVE_MESSAGE}</p>}
      {standalone && <p>This app is already open from your home screen. You can reopen these steps whenever you need them.</p>}
      {open && <div className="ruutin-install-details" id="install-guidance-details">
        <p><strong>iPhone Safari:</strong> tap Share, then <em>Add to Home Screen</em>.</p>
        <p><strong>Android Chrome or another common browser:</strong> open the browser menu, then choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
      </div>}
    </section>
  );
}
