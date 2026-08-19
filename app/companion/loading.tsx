export default function CompanionAppLoading() {
  return (
    <section
      className="ruutin-route-loading"
      aria-label="Loading the next companion view"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the next view</span>
      <div className="ruutin-route-loading-heading" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="ruutin-route-loading-grid" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}
