'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Pagination.
 *
 * Page state lives in the URL so a result page is shareable, bookmarkable, and
 * survives a refresh — and so the back button does what the user expects.
 */
export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const goTo = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: true });
  };

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <nav
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
      aria-label="Pagination"
    >
      <p className="text-sm text-fg-muted tabular-nums">
        Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Previous
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {pageNumbers(page, totalPages).map((item, index) =>
            item === '…' ? (
              <span key={`gap-${index}`} className="px-1.5 text-sm text-fg-subtle">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => goTo(item)}
                aria-current={item === page ? 'page' : undefined}
                className={cn(
                  'min-w-8 rounded-md px-2 py-1.5 text-sm font-medium tabular-nums transition-colors',
                  item === page
                    ? 'bg-primary text-primary-fg'
                    : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
                )}
              >
                {item}
              </button>
            ),
          )}
        </div>

        <span className="text-sm text-fg-muted tabular-nums sm:hidden">
          {page} / {totalPages}
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => goTo(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Windowed page list: 1 … 4 5 [6] 7 8 … 20 */
function pageNumbers(page: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages: Array<number | '…'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < totalPages - 1) pages.push('…');
  pages.push(totalPages);

  return pages;
}
