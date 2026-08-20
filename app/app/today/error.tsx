"use client";

export default function TodayError({ reset }: { reset: () => void }) {
  return <section className="ruutin-card ruutin-error-card" role="alert" aria-labelledby="today-error-title"><p className="ruutin-eyebrow">A small pause</p><h1 id="today-error-title">Today could not load.</h1><p className="ruutin-muted-note">Your household is safe. Try again when your connection is ready.</p><button className="ruutin-button" type="button" onClick={() => reset()}>Try again <span aria-hidden="true">↻</span></button></section>;
}
