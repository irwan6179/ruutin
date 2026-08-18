import { PairFlow } from "./PairFlow";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };

export default function PairPage() {
  // Read the short-lived URL token in the client so it is not copied into the
  // server-rendered HTML/hydration payload. The URL remains usable for QR and
  // history handoff, while Referrer-Policy prevents it leaving this page.
  return <PairFlow />;
}
