import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Metric tile.
 *
 * The delta is rendered with an explicit direction word for screen readers,
 * because colour and an arrow glyph alone do not convey "up" or "down".
 */
export function Stat({
  label,
  value,
  delta,
  hint,
  tone = 'neutral',
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: { value: number; label?: string; invertColors?: boolean };
  hint?: ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
  className?: string;
}) {
  const valueTone = {
    neutral: 'text-fg',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <div className={cn('card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</span>
        {icon ? <span className="shrink-0 text-fg-subtle">{icon}</span> : null}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tracking-tight tnum', valueTone)}>{value}</div>
      <div className="mt-1.5 flex items-center gap-2">
        {delta ? <Delta {...delta} /> : null}
        {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
      </div>
    </div>
  );
}

function Delta({
  value,
  label,
  invertColors,
}: {
  value: number;
  label?: string;
  invertColors?: boolean;
}) {
  if (!Number.isFinite(value)) return null;
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  // For cost metrics a rise is bad, so the colour mapping can be inverted.
  const good = invertColors ? !up : up;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        flat ? 'text-fg-subtle' : good ? 'text-success' : 'text-danger',
      )}
    >
      {flat ? null : (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
          <path
            d={up ? 'M6 10V2m0 0L2.5 5.5M6 2l3.5 3.5' : 'M6 2v8m0 0 3.5-3.5M6 10 2.5 6.5'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span>
        {flat ? '—' : `${Math.abs(value).toFixed(1)}%`}
        <span className="sr-only">{flat ? ' no change' : up ? ' increase' : ' decrease'}</span>
      </span>
      {label ? <span className="font-normal text-fg-subtle">{label}</span> : null}
    </span>
  );
}

export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const cols = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-2 lg:grid-cols-5',
  };
  return <div className={cn('grid gap-3', cols[columns], className)}>{children}</div>;
}
