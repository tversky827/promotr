'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/cn';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'mtd', label: 'MTD' },
  { value: '12m', label: '12m' },
] as const;

/**
 * Date-range selector. Writes to the URL so a dashboard view is shareable and
 * survives a refresh, and so the server does the filtering.
 */
export function DateRangePicker({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const select = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '30d') params.delete('range');
    else params.set('range', value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
      role="group"
      aria-label="Date range"
    >
      {RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => select(range.value)}
          aria-pressed={current === range.value}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            current === range.value
              ? 'bg-primary text-primary-fg'
              : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
