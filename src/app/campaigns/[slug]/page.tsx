import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { GetLinkPanel } from '@/components/campaign/get-link';
import { Badge, Card, CardHeader, DescriptionList, Field, Separator } from '@/components/ui/primitives';
import { availableMicros } from '@/lib/billing/budget';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { brand } from '@/lib/brand';
import { prisma } from '@/lib/db';
import {
  channelLabel,
  countryName,
  describePayout,
  formatDate,
  formatNumber,
  humanize,
  payoutModelLabel,
} from '@/lib/format';
import { campaignBySlug } from '@/lib/marketplace';
import { formatMicros } from '@/lib/money';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await campaignBySlug(slug).catch(() => null);

  if (!campaign) return { title: 'Campaign not found' };

  // A campaign the brand marked private must not be indexed even though the
  // page itself is reachable by direct link.
  const indexable = campaign.isPublic && campaign.status === 'ACTIVE';
  const payout = describePayout(campaign);

  return {
    title: `${campaign.name} — ${payout}`,
    description: `${campaign.offerSummary} Earn ${payout} promoting ${campaign.name} from ${campaign.brand.displayName}.`,
    alternates: { canonical: `/campaigns/${campaign.slug}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: `${campaign.name} — ${payout}`,
      description: campaign.offerSummary,
      url: `${brand.appUrl}/campaigns/${campaign.slug}`,
      type: 'website',
    },
  };
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await campaignBySlug(slug);
  if (!campaign) notFound();

  const session = await getSession();
  const csrfToken = await currentCsrfToken();

  const creator = session
    ? await prisma.creator.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      })
    : null;

  const application =
    creator && campaign.requiresApproval
      ? await prisma.campaignApplication.findUnique({
          where: { campaignId_creatorId: { campaignId: campaign.id, creatorId: creator.id } },
          select: { status: true },
        })
      : null;

  const budget = campaign.budget;
  const remaining = budget
    ? availableMicros({
        fundedMicros: budget.fundedMicros,
        reservedMicros: budget.reservedMicros,
        spentMicros: budget.spentMicros,
      })
    : 0n;
  const percentRemaining =
    budget && budget.fundedMicros > 0n
      ? Number((remaining * 10_000n) / budget.fundedMicros) / 100
      : 0;

  const allowedRules = campaign.rules.filter((rule) => rule.kind === 'ALLOWED');
  const prohibitedRules = campaign.rules.filter((rule) => rule.kind === 'PROHIBITED');
  const requirementRules = campaign.rules.filter((rule) => rule.kind === 'REQUIREMENT');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <li>
            <Link href="/" className="transition-colors hover:text-fg">
              Campaigns
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-fg-muted">{campaign.name}</li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{humanize(campaign.category)}</Badge>
              <Badge tone="neutral" title={payoutModelLabel(campaign.payoutModel)}>
                {campaign.payoutModel}
              </Badge>
              {campaign.status === 'ACTIVE' ? (
                <Badge tone="success" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="warning">{humanize(campaign.status)}</Badge>
              )}
              {campaign.requiresApproval ? (
                <Badge tone="warning">Approval required</Badge>
              ) : (
                <Badge tone="success">Instant link</Badge>
              )}
            </div>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg text-balance">
              {campaign.name}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-md text-fg-muted">
              <span>by</span>
              <span className="font-medium text-fg">{campaign.brand.displayName}</span>
              {campaign.brand.verification === 'VERIFIED' ? (
                <Badge tone="info">Verified</Badge>
              ) : null}
            </div>

            <p className="mt-4 max-w-2xl text-md text-fg-muted text-pretty">
              {campaign.offerSummary}
            </p>
          </header>

          <Separator className="my-7" />

          <section aria-labelledby="payout-heading">
            <h2 id="payout-heading" className="text-lg font-semibold tracking-tight text-fg">
              What you earn
            </h2>

            <div className="mt-4 rounded-lg border border-primary/25 bg-primary-soft/40 p-5">
              <div className="text-3xl font-semibold tabular-nums tracking-tight text-fg">
                {campaign.payoutModel === 'REVSHARE'
                  ? `${(campaign.revshareBps / 100).toFixed(campaign.revshareBps % 100 === 0 ? 0 : 2)}%`
                  : formatMicros(campaign.payoutMicros)}
              </div>
              <div className="mt-1 text-md text-fg-muted">{describePayout(campaign)}</div>
              <p className="mt-3 text-sm text-fg-muted text-pretty">
                This is what lands in your balance. The platform commission is charged to the brand
                on top of it, not deducted from your payout.
              </p>
            </div>

            <DescriptionList columns={3} className="mt-5">
              <Field label="Attribution window" hint="How long after a click a conversion still counts">
                {campaign.attributionWindowHours >= 24
                  ? `${Math.round(campaign.attributionWindowHours / 24)} days`
                  : `${campaign.attributionWindowHours} hours`}
              </Field>
              <Field label="Cookie duration">
                {campaign.cookieDurationHours >= 24
                  ? `${Math.round(campaign.cookieDurationHours / 24)} days`
                  : `${campaign.cookieDurationHours} hours`}
              </Field>
              <Field
                label="Repeat-click window"
                hint="Repeat visits from one device inside this window are not separately billable"
              >
                {campaign.dedupeWindowMinutes >= 60
                  ? `${Math.round(campaign.dedupeWindowMinutes / 60)} hours`
                  : `${campaign.dedupeWindowMinutes} minutes`}
              </Field>
            </DescriptionList>
          </section>

          <Separator className="my-7" />

          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-lg font-semibold tracking-tight text-fg">
              About this campaign
            </h2>
            <div className="mt-3 whitespace-pre-wrap text-md leading-relaxed text-fg-muted text-pretty">
              {campaign.description}
            </div>

            {campaign.conversionRules ? (
              <div className="mt-5 rounded-md border border-border bg-surface-sunken/50 p-4">
                <h3 className="text-sm font-semibold text-fg">What counts as a conversion</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-muted text-pretty">
                  {campaign.conversionRules}
                </p>
              </div>
            ) : null}
          </section>

          <Separator className="my-7" />

          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="text-lg font-semibold tracking-tight text-fg">
              Traffic rules
            </h2>
            <p className="mt-1.5 text-sm text-fg-muted text-pretty">
              Traffic outside these rules is not billable — you would not be paid for it, so it is
              worth reading before you promote.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <RuleList
                title="Allowed channels"
                tone="success"
                items={
                  campaign.allowedChannels.length > 0
                    ? campaign.allowedChannels.map(channelLabel)
                    : ['Any channel not listed as prohibited']
                }
                extra={allowedRules.map((rule) => rule.label)}
              />

              <RuleList
                title="Prohibited"
                tone="danger"
                items={[
                  ...campaign.prohibitedChannels.map(channelLabel),
                  ...prohibitedRules.map((rule) => rule.label),
                  'Spam and unsolicited messaging',
                  'Misleading or unsubstantiated claims',
                  'Incentivised or bot-generated traffic',
                ]}
              />
            </div>

            {requirementRules.length > 0 ? (
              <div className="mt-5">
                <RuleList
                  title="Requirements"
                  tone="info"
                  items={requirementRules.map((rule) =>
                    rule.detail ? `${rule.label} — ${rule.detail}` : rule.label,
                  )}
                />
              </div>
            ) : null}

            <DescriptionList columns={2} className="mt-6">
              <Field label="Geographic availability">
                {campaign.allowedCountries.length > 0
                  ? campaign.allowedCountries.map(countryName).join(', ')
                  : 'Worldwide'}
                {campaign.blockedCountries.length > 0 ? (
                  <span className="mt-1 block text-sm text-fg-muted">
                    Excluding: {campaign.blockedCountries.map(countryName).join(', ')}
                  </span>
                ) : null}
              </Field>
              {campaign.minAge ? (
                <Field label="Audience age restriction">{campaign.minAge}+ only</Field>
              ) : null}
            </DescriptionList>
          </section>

          {campaign.creatives.length > 0 ? (
            <>
              <Separator className="my-7" />
              <section aria-labelledby="creatives-heading">
                <h2 id="creatives-heading" className="text-lg font-semibold tracking-tight text-fg">
                  Approved creative assets
                </h2>
                <p className="mt-1.5 text-sm text-fg-muted text-pretty">
                  Copy and assets the brand has cleared for use.
                </p>

                <div className="mt-4 space-y-3">
                  {campaign.creatives.map((creative) => (
                    <div key={creative.id} className="rounded-md border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-fg">{creative.title}</h3>
                        <Badge
                          tone={
                            creative.usage === 'REQUIRED'
                              ? 'danger'
                              : creative.usage === 'APPROVED'
                                ? 'success'
                                : 'neutral'
                          }
                        >
                          {humanize(creative.usage)}
                        </Badge>
                      </div>
                      {creative.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted text-pretty">
                          {creative.body}
                        </p>
                      ) : null}
                      {creative.assetUrl ? (
                        <a
                          href={creative.assetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-sm text-primary hover:underline"
                        >
                          Download asset
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <Separator className="my-7" />

          <section aria-labelledby="terms-heading">
            <h2 id="terms-heading" className="text-lg font-semibold tracking-tight text-fg">
              Campaign terms
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">Version {campaign.termsVersion}</p>
            <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-surface-sunken/50 p-4 text-sm leading-relaxed text-fg-muted">
              {campaign.termsBody}
            </div>
          </section>
        </div>

        {/* Sticky action rail */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-4">
            <GetLinkPanel
              campaignId={campaign.id}
              campaignName={campaign.name}
              brandName={campaign.brand.displayName}
              payoutDescription={describePayout(campaign)}
              requiresApproval={campaign.requiresApproval}
              applicationStatus={application?.status ?? null}
              disclosureRequirement={campaign.disclosureRequirement}
              termsBody={campaign.termsBody}
              csrfToken={csrfToken}
              signedIn={Boolean(session)}
              isCreator={Boolean(creator)}
              budgetExhausted={remaining <= 0n}
            />

            <Card>
              <CardHeader title="Campaign budget" />
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold tabular-nums text-fg">
                    {formatMicros(remaining, { showSubCent: false })}
                  </span>
                  <span className="text-sm text-fg-muted">remaining</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={
                      percentRemaining < 15
                        ? 'h-full rounded-full bg-warning'
                        : 'h-full rounded-full bg-success'
                    }
                    style={{ width: `${Math.max(Math.min(percentRemaining, 100), 2)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-fg-subtle">
                  of {formatMicros(budget?.fundedMicros ?? 0n, { showSubCent: false })} funded.
                  When the budget runs out, traffic still reaches the advertiser but stops earning.
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader title="Performance" description="Last 30 days" />
              <dl className="mt-4 space-y-3">
                <StatRow
                  label="Qualified clicks"
                  value={formatNumber(campaign.stats.qualifiedClicks30d)}
                />
                <StatRow label="Conversions" value={formatNumber(campaign.stats.conversions30d)} />
                <StatRow
                  label="Active publishers"
                  value={formatNumber(campaign.stats.activePublishers)}
                />
              </dl>
              <p className="mt-3 border-t border-border pt-3 text-2xs text-fg-subtle">
                Aggregated across all publishers. Past performance does not predict your results.
              </p>
            </Card>

            <Card>
              <CardHeader title="Advertiser" />
              <dl className="mt-4 space-y-3">
                <StatRow label="Business" value={campaign.brand.displayName} />
                <StatRow label="Category" value={humanize(campaign.brand.category)} />
                <StatRow
                  label="Verification"
                  value={
                    <Badge tone={campaign.brand.verification === 'VERIFIED' ? 'success' : 'neutral'}>
                      {humanize(campaign.brand.verification)}
                    </Badge>
                  }
                />
                <StatRow label="On platform since" value={formatDate(campaign.brand.createdAt)} />
              </dl>
            </Card>

            {campaign.endsAt ? (
              <Card>
                <CardHeader title="Campaign window" />
                <dl className="mt-4 space-y-3">
                  {campaign.startsAt ? (
                    <StatRow label="Starts" value={formatDate(campaign.startsAt)} />
                  ) : null}
                  <StatRow label="Ends" value={formatDate(campaign.endsAt)} />
                </dl>
              </Card>
            ) : null}
          </div>
        </div>
      </div>

      {/* Structured data for the campaign offer. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Offer',
            name: campaign.name,
            description: campaign.offerSummary,
            category: campaign.category,
            seller: { '@type': 'Organization', name: campaign.brand.displayName },
            availability:
              campaign.status === 'ACTIVE' && remaining > 0n
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            url: `${brand.appUrl}/campaigns/${campaign.slug}`,
          }),
        }}
      />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function RuleList({
  title,
  tone,
  items,
  extra = [],
}: {
  title: string;
  tone: 'success' | 'danger' | 'info';
  items: string[];
  extra?: string[];
}) {
  const all = [...items, ...extra];
  const colors = {
    success: 'text-success',
    danger: 'text-danger',
    info: 'text-info',
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <ul className="mt-2.5 space-y-1.5">
        {all.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-fg-muted">
            <span className={`mt-0.5 shrink-0 ${colors[tone]}`} aria-hidden="true">
              {tone === 'danger' ? '✕' : tone === 'info' ? '!' : '✓'}
            </span>
            <span className="text-pretty">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
