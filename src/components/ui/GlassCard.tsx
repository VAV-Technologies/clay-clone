'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'solid' | 'interactive';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = 'default', padding = 'md', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-2xl border backdrop-blur-xl',
          'transition-all duration-300',

          // Variant styles
          {
            'bg-midnight/60 border-white/10': variant === 'default',
            'bg-midnight-100/90 border-white/10': variant === 'solid',
            'bg-midnight/60 border-white/10 hover:border-white/20 hover:bg-midnight/70 cursor-pointer':
              variant === 'interactive',
          },

          // Padding styles
          {
            'p-0': padding === 'none',
            'p-3': padding === 'sm',
            'p-4': padding === 'md',
            'p-6': padding === 'lg',
          },

          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassCard.displayName = 'GlassCard';
