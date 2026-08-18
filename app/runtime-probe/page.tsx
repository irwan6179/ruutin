import type { Metadata } from "next";
import { ServiceWorkerProbe } from "./ServiceWorkerProbe";

export const metadata: Metadata = {
  title: "Runtime capability probe",
  description: "Disposable service-worker capability probe for the Sites origin.",
};

export default function RuntimeProbePage() {
  return (
    <main>
      <h1>Service-worker capability probe</h1>
      <p>
        This disposable check only tests whether the current Sites origin
        accepts a service worker. It does not cache pages, API responses, or
        authenticated data.
      </p>
      <ServiceWorkerProbe />
    </main>
  );
}
