"use client";

import { useEffect, useState } from "react";
import { recordExperienceSignal } from "../components/ExperiencePing";

function readStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

export function InstallGuidance({ appName = "Ruutin Companion", placement = "bottom", compact = false }: { appName?: string; placement?: "top" | "after-first-completion" | "bottom"; compact?: boolean }) {
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
    <section className={`ruutin-card companion-install-note companion-install-note-${placement}${compact ? " companion-install-note-compact" : ""}`} aria-label="Install guidance">
      <div className="ruutin-install-heading">
        <strong>Add {appName} to home screen</strong>
        <button className="ruutin-text-button compact" type="button" aria-expanded={open} aria-controls="install-guidance-details" onClick={() => { setOpen((current) => !current); if (!open) void recordExperienceSignal("install_guidance_opened"); }}>
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
