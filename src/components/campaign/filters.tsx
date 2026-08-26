'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { channelLabel, humanize, payoutModelLabel } from '@/lib/format';

/**
 * Marketplace filters.
 *
 * Every filter writes to the URL, which means results are shareable and the
 * server does the filtering — no client-side dataset, no stale state.
 */

const SORTS: Array<{ value: string; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'payout_high', label: 'Highest payout' },
  { value: 'payout_low', label: 'Lowest payout' },
  { value: 'trending', label: 'Trending' },
  { value: 'ending_soon', label: 'Ending soon' },
  { value: 'budget_high', label: 'Largest budget' },
];

const CHANNELS = [
  'TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'FACEBOOK', 'WEBSITE',
  'NEWSLETTER', 'PODCAST', 'COMMUNITY', 'PAID_SEARCH', 'PAID_SOCIAL',
];

export function MarketplaceFilters({
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [queryDraft, setQueryDraft] = useState(searchParams.get('q') ?? '');

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any filter change resets to page one; staying on page 7 of a new
      // result set would show an empty page.
      params.delete('page');
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const toggle = useCallback(
    (key: string, value: string) => {
      update((params) => {
        const current = params.getAll(key);
        params.delete(key);
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        for (const item of next) params.append(key, item);
      });
    },
    [update],
  );

  const activeCount =
    searchParams.getAll('category').length +
    searchParams.getAll('model').length +
    searchParams.getAll('channel').length +
    (searchParams.get('country') ? 1 : 0) +
    (searchParams.get('min') ? 1 : 0) +
    (searchParams.get('open') ? 1 : 0);

  const isActive = (key: string, value: string) => searchParams.getAll(key).includes(value);

  return (
    <>
      {/* Search and sort sit above results on every viewport. */}
      <div className="lg:hidden">
        <SearchBox
          value={queryDraft}
          onChange={setQueryDraft}
          onSubmit={() =>
            update((params) => {
              if (queryDraft.trim()) params.set('q', queryDraft.trim());
              else params.delete('q');
            })
          }
        />
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
          >
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
          <SortSelect
            value={searchParams.get('sort') ?? 'newest'}
            onChange={(value) =>
              update((params) => {
                if (value === 'newest') params.delete('sort');
                else params.set('sort', value);
              })
            }
          />
        </div>
      </div>

      <aside
        className={cn(
          'space-y-6 lg:block',
          mobileOpen ? 'mt-4 block rounded-lg border border-border bg-surface p-4' : 'hidden',
        )}
        aria-label="Filters"
      >
        <div className="hidden lg:block">
          <SearchBox
            value={queryDraft}
            onChange={setQueryDraft}
            onSubmit={() =>
              update((params) => {
                if (queryDraft.trim()) params.set('q', queryDraft.trim());
                else params.delete('q');
              })
            }
          />
        </div>

        <div className="hidden lg:block">
          <FilterHeading>Sort by</FilterHeading>
          <SortSelect
            value={searchParams.get('sort') ?? 'newest'}
            onChange={(value) =>
              update((params) => {
                if (value === 'newest') params.delete('sort');
                else params.set('sort', value);
              })
            }
          />
        </div>

        <div>
          <FilterHeading>Availability</FilterHeading>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={searchParams.get('open') === '1'}
              onChange={(event) =>
                update((params) => {
                  if (event.target.checked) params.set('open', '1');
                  else params.delete('open');
                })
              }
              className="size-3.5 rounded border-border-strong accent-[hsl(var(--primary))]"
            />
            Instant link, no approval
          </label>
        </div>

        {facets.payoutModels.length > 0 ? (
          <div>
            <FilterHeading>Payout model</FilterHeading>
            <ul className="space-y-1.5">
              {facets.payoutModels.map((model) => (
                <li key={model.value}>
                  <FilterCheckbox
                    checked={isActive('model', model.value)}
                    onChange={() => toggle('model', model.value)}
                    label={payoutModelLabel(model.value)}
                    count={model.count}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {facets.categories.length > 0 ? (
          <div>
            <FilterHeading>Category</FilterHeading>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {facets.categories.map((category) => (
                <li key={category.value}>
                  <FilterCheckbox
                    checked={isActive('category', category.value)}
                    onChange={() => toggle('category', category.value)}
                    label={humanize(category.value)}
                    count={category.count}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <FilterHeading>Traffic channel</FilterHeading>
          <ul className="space-y-1.5">
            {CHANNELS.map((channel) => (
              <li key={channel}>
                <FilterCheckbox
                  checked={isActive('channel', channel)}
                  onChange={() => toggle('channel', channel)}
                  label={channelLabel(channel)}
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <FilterHeading>Minimum payout</FilterHeading>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              defaultValue={searchParams.get('min') ?? ''}
              placeholder="0.00"
              onBlur={(event) =>
                update((params) => {
                  const value = event.target.value.trim();
                  if (value) params.set('min', value);
                  else params.delete('min');
                })
              }
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-6 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              aria-label="Minimum payout"
            />
          </div>
        </div>

        <div>
          <FilterHeading>Audience country</FilterHeading>
          <input
            type="text"
            maxLength={2}
            defaultValue={searchParams.get('country') ?? ''}
            placeholder="US"
            onBlur={(event) =>
              update((params) => {
                const value = event.target.value.trim().toUpperCase();
                if (value.length === 2) params.set('country', value);
                else params.delete('country');
              })
            }
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm uppercase text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            aria-label="Two-letter country code"
          />
          <p className="mt-1 text-2xs text-fg-subtle">
            Two-letter code. Shows campaigns that accept traffic from there.
          </p>
        </div>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" fullWidth onClick={() => router.push(pathname)}>
            Clear all filters
          </Button>
        ) : null}
      </aside>
    </>
  );
}

function FilterHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{children}</h2>
  );
}

function FilterCheckbox({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count?: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted transition-colors hover:text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3.5 shrink-0 rounded border-border-strong accent-[hsl(var(--primary))]"
      />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{count}</span>
      ) : null}
    </label>
  );
}

function SearchBox({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      role="search"
    >
      <div className="relative">
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search campaigns"
          aria-label="Search campaigns"
          className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      </div>
    </form>
  );
}

function SortSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Sort campaigns"
      className="w-full cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
    >
      {SORTS.map((sort) => (
        <option key={sort.value} value={sort.value}>
          {sort.label}
        </option>
      ))}
    </select>
  );
}
