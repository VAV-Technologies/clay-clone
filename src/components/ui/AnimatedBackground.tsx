'use client';

export function AnimatedBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
      style={{ background: '#0D0D39', isolation: 'isolate' }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ mixBlendMode: 'screen', opacity: 0.1 }}
      >
        <filter id="bg-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.45"
            numOctaves="2"
            seed="5"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.5" intercept="-0.35" />
            <feFuncG type="linear" slope="1.5" intercept="-0.35" />
            <feFuncB type="linear" slope="1.5" intercept="-0.35" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter="url(#bg-grain)" />
      </svg>
    </div>
  );
}
