'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, children, disabled, onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // Base styles
          'relative overflow-hidden font-medium transition-all duration-300',
          'border backdrop-blur-md',
          'focus:outline-none focus:ring-2 focus:ring-lavender/50',
          'active:scale-[0.98]',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',

          // Variant styles
          {
            'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20':
              variant === 'default',
            'bg-lavender/20 border-lavender/30 text-white hover:bg-lavender/30 hover:shadow-lg hover:shadow-lavender/20':
              variant === 'primary',
            'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/5':
              variant === 'ghost',
            'bg-red-500/20 border-red-500/30 text-red-400 hover:bg-red-500/30 hover:text-red-300':
              variant === 'danger',
          },

          // Size styles
          {
            'px-2 py-1 text-xs': size === 'xs',
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2 text-sm': size === 'md',
            'px-6 py-3 text-base': size === 'lg',
          },

          className
        )}
        disabled={disabled || loading}
        onClick={onClick}
        {...props}
      >
        {/* Content */}
        <span className={cn('relative z-10 flex items-center justify-center gap-2', loading && 'opacity-0')}>
          {children}
        </span>

        {/* Loading spinner */}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        )}
      </button>
    );
  }
);

GlassButton.displayName = 'GlassButton';
