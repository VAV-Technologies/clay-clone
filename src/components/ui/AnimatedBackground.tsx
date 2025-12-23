'use client';

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d0d39] via-[#16164d] to-[#1a1a5e]" />

      {/* Animated gradient overlay */}
      <div className="absolute inset-0 opacity-50">
        <div className="absolute top-0 -left-1/4 w-1/2 h-1/2 bg-gradient-radial from-lavender/20 to-transparent rounded-full blur-3xl animate-blob" />
        <div className="absolute top-1/4 -right-1/4 w-1/2 h-1/2 bg-gradient-radial from-lavender-dark/15 to-transparent rounded-full blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute -bottom-1/4 left-1/4 w-1/2 h-1/2 bg-gradient-radial from-lavender-darker/10 to-transparent rounded-full blur-3xl animate-blob animation-delay-4000" />
      </div>

      {/* Floating orbs */}
      <div className="absolute top-20 left-20 w-32 h-32 rounded-full bg-gradient-radial from-lavender/10 to-transparent animate-float" />
      <div className="absolute bottom-40 right-32 w-24 h-24 rounded-full bg-gradient-radial from-lavender-dark/8 to-transparent animate-float animation-delay-1000" />
      <div className="absolute top-1/2 left-1/3 w-16 h-16 rounded-full bg-gradient-radial from-lavender/5 to-transparent animate-float animation-delay-2000" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />
    </div>
  );
}
