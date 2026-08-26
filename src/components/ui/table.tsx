import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Table primitives.
 *
 * Wide tables scroll inside their own container so the page body never scrolls
 * sideways on mobile — a rule enforced by the `.scroll-x` utility rather than
 * left to each usage.
 */

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scroll-x', className)}>
      <div className="min-w-full overflow-hidden rounded-lg border border-border">{children}</div>
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn('w-full border-collapse text-left', className)}>{children}</table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-sunken">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border bg-surface">{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-surface-sunken', className)}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = 'left',
  className,
  scope = 'col',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  scope?: 'col' | 'row';
}) {
  return (
    <th
      scope={scope}
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  className,
  numeric,
  colSpan,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  numeric?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-4 py-3 text-base text-fg align-middle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        numeric && 'tnum tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Renders inside a table when a filtered query returns nothing. */
export function TableEmpty({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-fg-muted">
        {message}
      </td>
    </tr>
  );
}
