import Link from 'next/link';

import { BrandMark } from '@/components/identity/brand-mark';
import { Badge } from '@/components/ui/primitives';
import { countryName, describePayout, formatCompact, payoutModelLabel } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import type { MarketplaceCampaign } from '@/lib/marketplace';

/**
 * Campaign card.
 *
 * Everything a publisher needs to decide whether this is worth their audience:
 * who the brand is, what the campaign is, what it pays, who it is meant to
 * reach, where the traffic has to come from, and whether the campaign can still
 * afford to pay. The payout is set in the largest type on the card, because it
 * is the one number that decides whether anyone reads the rest.
 *
 * The whole card is not a single link: it carries two distinct actions, and a
 * button nested inside a link is neither valid nor navigable by keyboard. The
 * title is the link; a pseudo-element stretches its hit area over the card, so
 * pointer users still get the whole surface.
 */
export function CampaignCard({ campaign }: { campaign: MarketplaceCampaign }) {
  const percentRemaining =
    campaign.budgetFundedMicros > 0n
      ? Number((campaign.budgetRemainingMicros * 10_000n) / campaign.budgetFundedMicros) / 100
      : 0;

  const endingSoon =
    campaign.endsAt !== null && campaign.endsAt.getTime() - Date.now() < 7 * 86_400_000;

  const href = `/campaigns/${campaign.slug}`;

  return (
    <article className="card group relative isolate flex flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-within:border-border-strong">
      <header className="flex items-start gap-3">
        <BrandMark name={campaign.brandName} logoUrl={campaign.brandLogoUrl} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium text-fg-muted">{campaign.brandName}</p>
            {campaign.brandVerified ? <VerifiedTick /> : null}
          </div>
          <h3 className="mt-0.5 line-clamp-2 text-md font-semibold leading-snug tracking-tight text-fg">
            <Link
              href={href}
              className="outline-none transition-colors before:absolute before:inset-0 before:content-[''] group-hover:text-primary focus-visible:text-primary"
            >
              {campaign.name}
            </Link>
          </h3>
        </div>

        {campaign.requiresApproval ? (
          <Badge tone="warning" className="shrink-0">
            Approval
          </Badge>
        ) : (
          <Badge tone="success" dot className="shrink-0">
            Open
          </Badge>
        )}
      </header>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed text-fg-muted text-pretty">
        {campaign.offerSummary}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-fg">
            {campaign.payoutModel === 'REVSHARE'
              ? `${(campaign.revshareBps / 100).toFixed(campaign.revshareBps % 100 === 0 ? 0 : 1)}%`
              : formatMicros(campaign.payoutMicros)}
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-muted">{describePayout(campaign)}</div>
        </div>
        <Badge tone="neutral" className="shrink-0" title={payoutModelLabel(campaign.payoutModel)}>
          {campaign.payoutModel}
        </Badge>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <Fact label="Audience">
          <span className="capitalize">{campaign.category}</span>
          {campaign.allowedChannels.length > 0 ? (
            <span className="text-fg-subtle">
              {' · '}
              {channelSummary(campaign.allowedChannels)}
            </span>
          ) : null}
        </Fact>
        <Fact label="Where">{geoSummary(campaign.allowedCountries)}</Fact>
      </dl>

      <div className="mt-4">
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
                ? 'h-full rounded-full bg-warning transition-all'
                : 'h-full rounded-full bg-primary transition-all'
            }
            style={{ width: `${Math.max(Math.min(percentRemaining, 100), 2)}%` }}
          />
        </div>
      </div>

      {endingSoon || campaign.recentClicks > 100 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {endingSoon ? <Badge tone="warning">Ending soon</Badge> : null}
          {campaign.recentClicks > 100 ? (
            <Badge tone="neutral">{formatCompact(campaign.recentClicks)} clicks this week</Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1" />

      {/* Raised above the title's stretched hit area so both stay clickable. */}
      <div className="relative z-10 mt-5 flex items-center gap-2 pt-1">
        {/* Outlined until the card is hovered: a grid of solid green buttons
            competes with the payouts, which are what should draw the eye. */}
        <Link
          href={`${href}#get-link`}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-primary/45 px-3 text-sm font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg hover:!bg-primary hover:!text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Get link
        </Link>
        <Link
          href={href}
          className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
        >
          View campaign
        </Link>
      </div>
    </article>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-fg-muted">{children}</dd>
    </div>
  );
}

function VerifiedTick() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-3.5 shrink-0 text-primary"
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
  );
}

/** Channel names as a publisher would say them, not as the enum spells them. */
function channelSummary(channels: string[]): string {
  const names = channels.slice(0, 3).map((channel) =>
    channel
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' '),
  );
  const extra = channels.length - names.length;
  return extra > 0 ? `${names.join(', ')} +${extra}` : names.join(', ');
}

function geoSummary(countries: string[]): string {
  if (countries.length === 0) return 'Worldwide';
  if (countries.length <= 2) return countries.map((c) => countryName(c)).join(", ");
  return `${countries.slice(0, 2).join(', ')} +${countries.length - 2} more`;
}
