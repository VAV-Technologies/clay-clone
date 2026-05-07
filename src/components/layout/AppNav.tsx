'use client';

// Shared top-of-page navigation. Logo on the left, Agent X / Tables tabs in
// the centre, a small settings gear on the right. Used by /, /tables, and
// any future top-level pages. The agent chat (/agent/[id]) has its own
// sidebar layout and intentionally doesn't show this nav.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppNav() {
  const pathname = usePathname() || '/';

  // /agent/* and / both light up the Agent X tab. The user enters the agent
  // from / and stays inside the agent surface area at /agent/[id].
  const isAgent = pathname === '/' || pathname.startsWith('/agent');
  const isTables =
    pathname === '/tables' ||
    pathname.startsWith('/tables') ||
    pathname.startsWith('/workbook') ||
    pathname.startsWith('/projects');

  return (
    <header className="relative z-10 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        {/* Logo (also a home link) */}
        <Link href="/" className="flex items-center flex-shrink-0">
          <h1 className="text-2xl font-display text-white tracking-tight">Dataflow</h1>
        </Link>

        {/* Tabs */}
        <nav className="flex items-center gap-2">
          <Link
            href="/"
            className={cn(
              'px-4 py-1.5 text-sm border transition',
              isAgent
                ? 'border-lavender/40 bg-lavender/10 text-white'
                : 'border-white/10 text-white/65 hover:border-white/30 hover:text-white',
            )}
          >
            Agent X
          </Link>
          <Link
            href="/tables"
            className={cn(
              'px-4 py-1.5 text-sm border transition',
              isTables
                ? 'border-lavender/40 bg-lavender/10 text-white'
                : 'border-white/10 text-white/65 hover:border-white/30 hover:text-white',
            )}
          >
            Tables
          </Link>
        </nav>

        {/* Settings (gear icon — links to API docs for now) */}
        <a
          href="/api-docs"
          className="p-2 text-white/50 hover:text-white border border-white/10 hover:border-white/30 transition flex-shrink-0"
          title="Settings & API Docs"
        >
          <Settings className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
}
