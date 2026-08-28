import type { Metadata } from 'next';

import { CampaignCard } from '@/components/campaign/card';
import { MarketplaceFilters } from '@/components/campaign/filters';
import { MarketingFooter, MarketingNav } from '@/components/marketing/nav';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/primitives';
import { homePathFor } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import { brand } from '@/lib/brand';
import { marketplaceFacets, searchCampaigns, type SortOption } from '@/lib/marketplace';
import { tryParseAmount } from '@/lib/money';

/**
 * The marketplace, and the front door.
 *
 * There is no brochure in front of it. The product is a wall of campaigns you
 * can promote, so that is what a visitor sees first — the offer, the payout and
 * the remaining budget, before signing up for anything.
 */

export const metadata: Metadata = {
  title: {
    absolute: `${brand.name} — ${brand.tagline}`,
  },
  description:
    'Browse performance campaigns, take a tracking link in seconds, and get paid for the traffic you send. Every campaign shows its exact payout before you take a link.',
  alternates: { canonical: '/' },
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: 'Campaigns accepting traffic now. Take a link, promote it, get paid.',
    url: brand.appUrl,
  },
};

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await getSession();

  const filters = {
    query: single(params.q),
    categories: multi(params.category),
    payoutModels: multi(params.model),
    channels: multi(params.channel),
    country: single(params.country)?.toUpperCase(),
    minPayoutMicros: single(params.min)
      ? (tryParseAmount(single(params.min)!) ?? undefined)
      : undefined,
    openOnly: single(params.open) === '1',
    sort: (single(params.sort) as SortOption) ?? 'newest',
    page: Number(single(params.page) ?? '1') || 1,
  };

  const [result, facets] = await Promise.all([searchCampaigns(filters), marketplaceFacets()]);

  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingNav
        signedIn={Boolean(session)}
        homePath={session ? homePathFor(session.user.role) : '/login'}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <header className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance sm:text-3xl">
            Campaigns accepting traffic
          </h1>
          <p className="mt-1.5 max-w-2xl text-md text-fg-muted text-pretty">
            {session
              ? 'Take a link, promote it, get paid for what it delivers.'
              : 'Pick one, take your tracking link, and get paid for the traffic you send. No application for open campaigns.'}
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          <MarketplaceFilters facets={facets} />

          <div className="min-w-0">
            <p className="mb-4 text-sm text-fg-muted" aria-live="polite">
              {result.total === 0
                ? 'No campaigns match these filters'
                : `${result.total.toLocaleString()} campaign${result.total === 1 ? '' : 's'}`}
            </p>

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
      </main>

      <MarketingFooter />
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
