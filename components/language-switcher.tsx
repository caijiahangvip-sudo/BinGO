'use client';

import { useState, useRef, useEffect } from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { supportedLocales, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface LanguageSwitcherProps {
  /** Called when the dropdown opens, so parent can close sibling dropdowns */
  onOpen?: () => void;
  /** Called after a locale is selected */
  onLocaleChange?: (locale: Locale) => void;
}

export function LanguageSwitcher({ onOpen, onLocaleChange }: LanguageSwitcherProps) {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentLocale = supportedLocales.find((l) => l.code === locale);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
        className="flex size-9 items-center justify-center rounded-full text-slate-500/80 transition-all hover:bg-white/[0.55] hover:text-slate-700 hover:shadow-[0_10px_30px_rgba(139,92,246,0.10)] dark:text-slate-300/75 dark:hover:bg-white/10 dark:hover:text-slate-100"
        title={currentLocale?.label ?? locale}
        aria-label={currentLocale?.label ?? locale}
      >
        <Languages className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full mt-3 right-0 z-50 min-w-[120px] overflow-hidden rounded-xl border border-white/70 bg-white/90 shadow-[0_18px_50px_rgba(87,73,120,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">
          {supportedLocales.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLocale(l.code);
                onLocaleChange?.(l.code);
                setOpen(false);
              }}
              className={cn(
                'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                locale === l.code &&
                  'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
