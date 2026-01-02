'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react';

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg
                   text-white placeholder-white/30 focus:outline-none focus:border-lavender/50
                   focus:ring-1 focus:ring-lavender/50 transition-all pr-12"
          autoFocus
          disabled={isLoading}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={isLoading || !password}
        className="w-full py-3 bg-lavender/20 border border-lavender/30 rounded-lg
                 text-white font-medium hover:bg-lavender/30 transition-all
                 disabled:opacity-50 disabled:cursor-not-allowed
                 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Authenticating...
          </>
        ) : (
          'Unlock'
        )}
      </button>
    </form>
  );
}

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-midnight-200 relative overflow-hidden flex items-center justify-center">
      <AnimatedBackground />

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Glass Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          {/* Lock Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-lavender/20 border border-lavender/30 flex items-center justify-center">
              <Lock className="w-8 h-8 text-lavender" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white text-center mb-2">
            DataFlow
          </h1>
          <p className="text-white/50 text-center mb-8">
            Enter password to access
          </p>

          {/* Form wrapped in Suspense */}
          <Suspense fallback={
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-white/50" />
            </div>
          }>
            <AuthForm />
          </Suspense>
        </div>

        {/* Footer */}
        <p className="text-white/30 text-center text-sm mt-6">
          This device will be remembered
        </p>
      </div>
    </div>
  );
}
