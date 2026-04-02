'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DropdownItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({ trigger, items, align = 'left', className }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 160;

    let left = align === 'right' ? rect.right - menuWidth : rect.left;
    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    const top = rect.bottom + 4;

    setPosition({ top, left });
  }, [align]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        menuRef.current && !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, updatePosition]);

  return (
    <div ref={triggerRef} className={cn('relative inline-block', className)} onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className={cn(
            'fixed z-[100] min-w-[160px] py-1',
            'bg-midnight-100/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-glass',
            'animate-scale-in origin-top'
          )}
          style={{ top: position.top, left: position.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, index) => {
            if (item.divider) {
              return <div key={index} className="my-1 border-t border-white/10" />;
            }

            return (
              <button
                key={index}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick();
                    setIsOpen(false);
                  }
                }}
                disabled={item.disabled}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                  'transition-colors duration-150',
                  item.disabled
                    ? 'text-white/30 cursor-not-allowed'
                    : item.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-white/80 hover:bg-white/5 hover:text-white'
                )}
              >
                {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
