'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { cn } from '@/lib/cn';
import { payoutModelLabel } from '@/lib/format';

/**
 * Marketplace filters.
 *
 * One row, not a sidebar. A publisher browsing for something to promote is
 * scanning campaigns, not running a query — so the controls that earn their
 * place are the ones that narrow a wall of cards to a shortlist: what it is
 * about, how it pays, and the order to read it in. Everything else was noise
 * around the thing people actually came for.
 *
 * Every filter writes to the URL, so results are shareable, the server does the
 * filtering, and the back button behaves.
 */

const SORTS: Array<{ value: string; label: string }> = [
  { value: 'trending', label: 'Trending' },
  { value: 'payout_high', label: 'Highest payout' },
  { value: 'newest', label: 'Newest' },
  { value: 'budget_high', label: 'Largest budget' },
  { value: 'ending_soon', label: 'Ending soon' },
];

export function MarketplaceFilterBar({
  facets,
}: {
  facets: {
    categories: Array<{ value: string; count: number }>;
    payoutModels: Array<{ value: string; count: number }>;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [queryDraft, setQueryDraft] = useState(searchParams.get('q') ?? '');

  // Keep the field in step when navigation changes the URL underneath it —
  // the back button, or the Clear button below.
  const currentQuery = searchParams.get('q') ?? '';
  useEffect(() => setQueryDraft(currentQuery), [currentQuery]);

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any filter change resets to page one; staying on page 7 of a new result
      // set would show an empty page.
      params.delete('page');
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const toggle = (key: string, value: string) =>
    update((params) => {
      const current = params.getAll(key);
      params.delete(key);
      for (const existing of current) {
        if (existing !== value) params.append(key, existing);
      }
      if (!current.includes(value)) params.append(key, value);
    });

  const categories = searchParams.getAll('category');
  const models = searchParams.getAll('model');
  const sort = searchParams.get('sort') ?? 'trending';
  const active = categories.length + models.length + (currentQuery ? 1 : 0);

  return (
    <div className={cn('space-y-3', pending && 'opacity-70 transition-opacity')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          role="search"
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            update((params) => {
              if (queryDraft.trim()) params.set('q', queryDraft.trim());
              else params.delete('q');
            });
          }}
        >
          <svg
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            name="q"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search brands and campaigns"
            aria-label="Search campaigns"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-base text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </form>

        <label className="flex shrink-0 items-center gap-2 text-sm text-fg-muted">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            value={sort}
            onChange={(event) =>
              update((params) => {
                if (event.target.value === 'trending') params.delete('sort');
                else params.set('sort', event.target.value);
              })
            }
            className="h-10 rounded-lg border border-border bg-surface px-3 pr-8 text-base text-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="scroll-x flex items-center gap-1.5 pb-0.5">
        {facets.categories.map((facet) => (
          <Chip
            key={facet.value}
            selected={categories.includes(facet.value)}
            onClick={() => toggle('category', facet.value)}
          >
            <span className="capitalize">{facet.value}</span>
            <span className="ml-1.5 tabular-nums text-fg-subtle">{facet.count}</span>
          </Chip>
        ))}

        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />

        {facets.payoutModels.map((facet) => (
          <Chip
            key={facet.value}
            selected={models.includes(facet.value)}
            onClick={() => toggle('model', facet.value)}
            title={payoutModelLabel(facet.value)}
          >
            {facet.value}
          </Chip>
        ))}

        {active > 0 ? (
          <button
            type="button"
            onClick={() =>
              update((params) => {
                params.delete('category');
                params.delete('model');
                params.delete('q');
              })
            }
            className="ml-1 shrink-0 whitespace-nowrap px-2 py-1 text-xs font-medium text-fg-subtle underline-offset-2 transition-colors hover:text-fg hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
