"use client";

/* The QR is a local data URL, so Next image optimization would add no value. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function PairingQr({ value }: { value: string }) {
  const [generated, setGenerated] = useState<{ value: string; imageUrl: string } | null>(null);
  const [failedValue, setFailedValue] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!value) return () => { cancelled = true; };
    void QRCode.toString(value, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#17121d", light: "#ffffff" },
    }).then((svg) => {
      if (!cancelled) {
        // The SVG is generated locally by the bundled encoder. Encoding it as
        // a data URL keeps the markup inert and makes the output an ordinary
        // scannable image without an external QR service or request.
        setGenerated({
          value,
          imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        });
      }
    }).catch(() => {
      if (!cancelled) setFailedValue(value);
    });
    return () => { cancelled = true; };
  }, [value]);

  const imageUrl = generated?.value === value ? generated.imageUrl : "";
  if (failedValue === value) {
    return <p className="ruutin-form-error" role="alert">The pairing QR could not be prepared. Use the six-digit code instead.</p>;
  }
  if (!imageUrl) {
    return <div className="ruutin-pair-qr" role="img" aria-label="Preparing pairing QR code" aria-busy="true" />;
  }
  return (
    <img
      className="ruutin-pair-qr"
      src={imageUrl}
      aria-label="Pairing QR code"
      alt="Pairing QR code"
    />
  );
}
