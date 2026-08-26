import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Layout and content primitives shared across every surface of the product. */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn('card', padded && 'p-5', className)}>{children}</div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold tracking-tight text-fg">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-fg-muted text-pretty">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-md text-fg-muted text-pretty">{description}</p>
          ) : null}
        </div>
        {/* Wraps on narrow screens: a range picker plus a button is wider than
            a phone, and `shrink-0` alone pushed the button off the edge. */}
        {action ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-fg-muted border-border',
  primary: 'bg-primary-soft text-primary border-primary/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
  /** Hover text expanding an abbreviated label, e.g. "CPC" → "Cost per click". */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * Empty state. Every list in the product uses this rather than rendering
 * nothing — a blank table is indistinguishable from a broken one.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-fg-subtle">{icon}</div> : null}
      <h3 className="text-md font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-fg-muted text-pretty">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'bg-info-soft border-info/25 text-info',
    success: 'bg-success-soft border-success/25 text-success',
    warning: 'bg-warning-soft border-warning/30 text-warning',
    danger: 'bg-danger-soft border-danger/25 text-danger',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3', tones[tone], className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title ? <div className="text-sm font-semibold">{title}</div> : null}
          {children ? (
            <div className={cn('text-sm text-pretty opacity-90', title ? 'mt-1' : null)}>{children}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} role="separator" />;
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-fg transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className="text-fg-muted">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** Small label/value pair used throughout detail pages. */
export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-base text-fg">{children}</dd>
      {hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function DescriptionList({
  children,
  columns = 2,
  className,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
  };
  return <dl className={cn('grid gap-x-6 gap-y-5', cols[columns], className)}>{children}</dl>;
}
