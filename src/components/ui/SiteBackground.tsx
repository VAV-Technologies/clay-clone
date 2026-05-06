export function SiteBackground() {
  return (
    <>
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0 }}
      >
        <filter id="site-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="5" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
        </filter>
      </svg>

      <div className="site-bg" aria-hidden="true">
        <div className="site-bg-blobs" />
        <div className="site-bg-grain" />
      </div>
    </>
  );
}
