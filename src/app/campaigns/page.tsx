import type { Metadata } from 'next';

import { CampaignCard } from '@/components/campaign/card';
import { MarketplaceFilters } from '@/components/campaign/filters';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';
import { marketplaceFacets, searchCampaigns, type SortOption } from '@/lib/marketplace';
import { tryParseAmount } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Browse campaigns',
  description:
    'Find performance campaigns to promote. Filter by payout, category, channel, and location — then get your tracking link instantly.',
  alternates: { canonical: '/campaigns' },
  openGraph: {
    title: `Browse campaigns · ${brand.name}`,
    description: 'Performance campaigns accepting traffic now.',
    url: `${brand.appUrl}/campaigns`,
  },
};

// Live budget and payout data, so a short revalidation window rather than static.
export const revalidate = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const filters = {
    query: single(params.q),
    categories: multi(params.category),
    payoutModels: multi(params.model),
    channels: multi(params.channel),
    country: single(params.country)?.toUpperCase(),
    minPayoutMicros: single(params.min) ? (tryParseAmount(single(params.min)!) ?? undefined) : undefined,
    openOnly: single(params.open) === '1',
    sort: (single(params.sort) as SortOption) ?? 'newest',
    page: Number(single(params.page) ?? '1') || 1,
  };

  const [result, facets] = await Promise.all([searchCampaigns(filters), marketplaceFacets()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">
          Campaigns accepting traffic
        </h1>
        <p className="mt-2 max-w-2xl text-md text-fg-muted text-pretty">
          Every campaign shows its exact payout, rules, and remaining budget before you take a link.
          Open campaigns need no application — accept the terms and start promoting.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <MarketplaceFilters facets={facets} />

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted" aria-live="polite">
              {result.total === 0
                ? 'No campaigns match these filters'
                : `${result.total.toLocaleString()} campaign${result.total === 1 ? '' : 's'}`}
            </p>
          </div>

          {result.campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns match these filters"
              description="Try widening the payout range, clearing the channel filter, or removing the country restriction."
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {result.campaigns.map((campaign) => (
                  <CampaignCard key={campaign.id} campaign={campaign} />
                ))}
              </div>

              <Pagination
                page={result.page}
                totalPages={result.totalPages}
                total={result.total}
                perPage={result.perPage}
                className="mt-8"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function multi(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
