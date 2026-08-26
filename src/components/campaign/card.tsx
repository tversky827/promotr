import Link from 'next/link';

import { Badge } from '@/components/ui/primitives';
import { describePayout, formatCompact, payoutModelLabel } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import type { MarketplaceCampaign } from '@/lib/marketplace';

/**
 * Campaign card.
 *
 * Everything a publisher needs to decide whether to click through: what they
 * earn, whether the campaign can still pay, whether they can start immediately,
 * and where the traffic must come from.
 */
export function CampaignCard({ campaign }: { campaign: MarketplaceCampaign }) {
  const percentRemaining =
    campaign.budgetFundedMicros > 0n
      ? Number((campaign.budgetRemainingMicros * 10_000n) / campaign.budgetFundedMicros) / 100
      : 0;

  const endingSoon =
    campaign.endsAt !== null &&
    campaign.endsAt.getTime() - Date.now() < 7 * 86_400_000;

  return (
    <Link
      href={`/campaigns/${campaign.slug}`}
      className="card group flex flex-col p-5 transition-all hover:border-border-strong hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {campaign.brandName}
            </p>
            {campaign.brandVerified ? (
              <svg
                viewBox="0 0 20 20"
                className="size-3.5 shrink-0 text-info"
                fill="currentColor"
                aria-label="Verified brand"
                role="img"
              >
                <path d="M10 1.5l2.1 1.6 2.6-.3 1 2.4 2.3 1.2-.7 2.5.7 2.5-2.3 1.2-1 2.4-2.6-.3L10 18.5l-2.1-1.6-2.6.3-1-2.4-2.3-1.2.7-2.5-.7-2.5 2.3-1.2 1-2.4 2.6.3z" />
                <path
                  d="m6.8 10 2.1 2.1 4.3-4.3"
                  stroke="hsl(var(--surface))"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            ) : null}
          </div>
          <h3 className="mt-1 line-clamp-2 text-md font-semibold text-fg transition-colors group-hover:text-primary">
            {campaign.name}
          </h3>
        </div>

        {campaign.requiresApproval ? (
          <Badge tone="warning">Approval</Badge>
        ) : (
          <Badge tone="success" dot>
            Open
          </Badge>
        )}
      </div>

      <p className="mt-2 line-clamp-2 flex-1 text-sm text-fg-muted text-pretty">
        {campaign.offerSummary}
      </p>

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold tabular-nums tracking-tight text-fg">
              {campaign.payoutModel === 'REVSHARE'
                ? `${(campaign.revshareBps / 100).toFixed(campaign.revshareBps % 100 === 0 ? 0 : 1)}%`
                : formatMicros(campaign.payoutMicros)}
            </div>
            <div className="mt-0.5 truncate text-xs text-fg-muted">
              {describePayout(campaign)}
            </div>
          </div>
          <Badge tone="neutral" className="shrink-0" title={payoutModelLabel(campaign.payoutModel)}>
            {campaign.payoutModel}
          </Badge>
        </div>

        <div className="mt-3.5">
          <div className="flex items-center justify-between text-2xs text-fg-subtle">
            <span>Budget remaining</span>
            <span className="tabular-nums">
              {formatMicros(campaign.budgetRemainingMicros, { showSubCent: false })}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={
                percentRemaining < 15
                  ? 'h-full rounded-full bg-warning'
                  : 'h-full rounded-full bg-success'
              }
              style={{ width: `${Math.max(Math.min(percentRemaining, 100), 2)}%` }}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{campaign.category}</Badge>
          {campaign.allowedCountries.length > 0 ? (
            <Badge tone="neutral">
              {campaign.allowedCountries.length <= 3
                ? campaign.allowedCountries.join(', ')
                : `${campaign.allowedCountries.length} countries`}
            </Badge>
          ) : (
            <Badge tone="neutral">Worldwide</Badge>
          )}
          {endingSoon ? <Badge tone="warning">Ending soon</Badge> : null}
          {campaign.recentClicks > 100 ? (
            <Badge tone="info">{formatCompact(campaign.recentClicks)} clicks / 7d</Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
