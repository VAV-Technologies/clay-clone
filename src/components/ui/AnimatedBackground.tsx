'use client';

// Site-wide background is now mounted once in src/app/layout.tsx via
// <SiteBackground />. This component is kept as a no-op so existing
// per-page imports continue to compile without painting over it.
export function AnimatedBackground() {
  return null;
}
