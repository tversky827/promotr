import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { AreaChart } from '@/components/charts';
import { CampaignActions } from '@/components/brand/campaign-actions';
import { ButtonLink } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range';
import {
  Alert,
  Badge,
  Breadcrumb,
  Card,
  CardHeader,
  DescriptionList,
  Field,
  PageHeader,
} from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import {
  derive,
  fillSeries,
  granularityFor,
  presetRange,
  timeSeries,
  topPublishers,
  totals,
} from '@/lib/analytics/queries';
import { pageBrand } from '@/lib/auth/guards';
import { availableMicros } from '@/lib/billing/budget';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { prisma } from '@/lib/db';
import {
  countryName,
  describePayout,
  formatDate,
  formatNumber,
  formatPercent,
  humanize,
  statusTone,
} from '@/lib/format';
import { formatMicros, formatUnitPrice } from '@/lib/money';

export const metadata: Metadata = { title: 'Campaign' };
export const dynamic = 'force-dynamic';

export default async function BrandCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; launched?: string }>;
}) {
  const { id } = await params;
  const { range: rangeKey = '30d', launched } = await searchParams;
  const { brand, membershipRole, user } = await pageBrand();
  const csrfToken = await currentCsrfToken();

  const campaign = await prisma.campaign.findFirst({
    where: { id, brandId: brand.id },
    include: { budget: true, rules: true, _count: { select: { links: true } } },
  });
  if (!campaign) notFound();

  const range = presetRange(rangeKey);
  const granularity = granularityFor(range);
  const scope = { campaignId: campaign.id };

  const [metrics, series, publishers, conversions, pendingApplications] = await Promise.all([
    totals(scope, range).then(derive),
    timeSeries(scope, range, granularity),
    topPublishers(scope, range, 8),
    prisma.conversion.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.campaignApplication.count({ where: { campaignId: campaign.id, status: 'PENDING' } }),
  ]);

  const filled = fillSeries(series, range, granularity);
  const remaining = campaign.budget ? availableMicros(campaign.budget) : 0n;
  const funded = campaign.budget?.fundedMicros ?? 0n;
  const percentRemaining = funded > 0n ? Number((remaining * 10_000n) / funded) / 100 : 0;
  const canManage = membershipRole === 'BRAND_OWNER' || user.role === 'ADMIN';

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Campaigns', href: '/brand/campaigns' },
              { label: campaign.name },
            ]}
          />
        }
        title={campaign.name}
        description={campaign.offerSummary}
        action={
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            canManage={canManage}
            hasFunds={remaining > 0n}
            csrfToken={csrfToken}
            publicSlug={campaign.slug}
          />
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(campaign.status)}>{humanize(campaign.status)}</Badge>
        <Badge tone="neutral">{campaign.payoutModel}</Badge>
        <Badge tone="neutral">{humanize(campaign.category)}</Badge>
        {campaign.requiresApproval ? (
          <Badge tone="warning">Approval required</Badge>
        ) : (
          <Badge tone="success">Open</Badge>
        )}
        {!campaign.isPublic ? <Badge tone="neutral">Unlisted</Badge> : null}
      </div>

      {/* State-specific guidance: never a dead end. */}
      {campaign.status === 'REJECTED' ? (
        <Alert tone="danger" className="mb-6" title="This campaign was not approved">
          <div className="whitespace-pre-wrap">{campaign.moderationNotes ?? 'No reason recorded.'}</div>
          <div className="mt-3">
            <ButtonLink href={`/brand/campaigns/${campaign.id}/edit`} size="sm" variant="secondary">
              Edit and resubmit
            </ButtonLink>
          </div>
        </Alert>
      ) : null}

      {campaign.status === 'PENDING_REVIEW' ? (
        <Alert tone="info" className="mb-6" title="In review">
          We are checking the destination URL and campaign content. You will be emailed when it is
          decided — usually within a few hours. You can fund the campaign now so it is ready to go
          live immediately on approval.
        </Alert>
      ) : null}

      {launched === '1' && campaign.status === 'ACTIVE' ? (
        <Alert tone="success" className="mb-6" title="Campaign launched successfully.">
          It is live in the marketplace now, and publishers can take a tracking link for it. You
          will see clicks here as they arrive.
        </Alert>
      ) : null}

      {campaign.status === 'DRAFT' ? (
        <Alert tone="info" className="mb-6" title="This campaign is a draft">
          Submit it for review when you are ready. Nothing is visible to publishers until it is
          approved, funded and launched.
        </Alert>
      ) : null}

      {(campaign.status === 'APPROVED' || campaign.status === 'ACTIVE') && remaining <= 0n ? (
        <Alert tone="warning" className="mb-6" title="This campaign has no funds behind it">
          Publishers can see it, but no activity is billable and nothing is being earned. Add funds
          to start.
          <div className="mt-3">
            <ButtonLink href={`/brand/campaigns/${campaign.id}/funding`} size="sm">
              Add funds
            </ButtonLink>
          </div>
        </Alert>
      ) : null}

      {pendingApplications > 0 ? (
        <Alert tone="info" className="mb-6" title={`${pendingApplications} publisher application(s) waiting`}>
          <div className="mt-2">
            <ButtonLink href="/brand/publishers" size="sm" variant="secondary">
              Review applications
            </ButtonLink>
          </div>
        </Alert>
      ) : null}

      <div className="mb-4 flex items-center justify-end">
        <DateRangePicker current={rangeKey} />
      </div>

      <StatGrid columns={4} className="mb-4">
        <Stat label="Clicks" value={formatNumber(metrics.clicks)} />
        <Stat
          label="Qualified"
          value={formatNumber(metrics.qualifiedClicks)}
          hint={`${formatPercent(metrics.qualifiedRate)} passed screening`}
        />
        <Stat
          label="Conversions"
          value={formatNumber(metrics.conversions)}
          hint={formatPercent(metrics.conversionRate)}
        />
        <Stat
          label="Spend"
          value={formatMicros(metrics.grossMicros, { showSubCent: false })}
          hint={
            metrics.conversions > 0 ? `${formatUnitPrice(metrics.cpaMicros)} per conversion` : undefined
          }
        />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Performance" description={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
          <div className="mt-5">
            <AreaChart
              data={filled.map((point) => ({
                label:
                  granularity === 'hour'
                    ? `${point.bucket.getUTCHours()}:00`
                    : formatDate(point.bucket),
                value: point.qualifiedClicks,
              }))}
              ariaLabel="Qualified clicks over time"
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Budget"
            action={
              <Link
                href={`/brand/campaigns/${campaign.id}/funding`}
                className="text-sm text-primary hover:underline"
              >
                Manage
              </Link>
            }
          />
          <div className="mt-4">
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-fg">
              {formatMicros(remaining, { showSubCent: false })}
            </p>
            <p className="mt-0.5 text-sm text-fg-muted">remaining of {formatMicros(funded, { showSubCent: false })}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={
                  percentRemaining < 15 ? 'h-full rounded-full bg-warning' : 'h-full rounded-full bg-success'
                }
                style={{ width: `${Math.max(Math.min(percentRemaining, 100), 2)}%` }}
              />
            </div>
          </div>
          <dl className="mt-4 space-y-2 border-t border-border pt-4">
            <Row
              label="Committed"
              value={formatMicros(campaign.budget?.reservedMicros ?? 0n, { showSubCent: false })}
              hint="Backing pending publisher earnings"
            />
            <Row
              label="Settled spend"
              value={formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
            />
            <Row label="Publishers with links" value={formatNumber(campaign._count.links)} />
          </dl>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5">
            <CardHeader title="Top publishers" description="By spend in this period" />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Publisher</TH>
                  <TH align="right">Clicks</TH>
                  <TH align="right">Conv.</TH>
                  <TH align="right">Spend</TH>
                </TR>
              </THead>
              <TBody>
                {publishers.length === 0 ? (
                  <TableEmpty colSpan={4} message="No publisher activity in this period." />
                ) : (
                  publishers.map((publisher) => (
                    <TR key={publisher.creatorId}>
                      <TD>
                        <div className="font-medium text-fg">{publisher.displayName}</div>
                        <div className="text-2xs text-fg-subtle">@{publisher.handle}</div>
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(publisher.clicks)}
                      </TD>
                      <TD align="right" numeric>
                        {formatNumber(publisher.conversions)}
                      </TD>
                      <TD align="right" numeric className="font-medium">
                        {formatMicros(publisher.grossMicros, { showSubCent: false })}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>

        <Card padded={false}>
          <div className="p-5">
            <CardHeader title="Recent conversions" />
          </div>
          <TableWrap className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Status</TH>
                  <TH align="right">Value</TH>
                  <TH align="right">Cost</TH>
                </TR>
              </THead>
              <TBody>
                {conversions.length === 0 ? (
                  <TableEmpty
                    colSpan={4}
                    message="No conversions reported yet. Check your tracking setup."
                  />
                ) : (
                  conversions.map((conversion) => (
                    <TR key={conversion.id}>
                      <TD>
                        <div className="font-mono text-xs text-fg">{conversion.externalId}</div>
                        <div className="text-2xs text-fg-subtle">
                          {conversion.source} · {formatDate(conversion.createdAt)}
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(conversion.status)}>
                          {humanize(conversion.status)}
                        </Badge>
                      </TD>
                      <TD align="right" numeric>
                        {conversion.revenueMicros > 0n
                          ? formatMicros(conversion.revenueMicros)
                          : '—'}
                      </TD>
                      <TD align="right" numeric>
                        {formatMicros(conversion.payoutMicros + conversion.feeMicros)}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Configuration"
          action={
            canManage ? (
              <ButtonLink href={`/brand/campaigns/${campaign.id}/edit`} size="sm" variant="secondary">
                Edit
              </ButtonLink>
            ) : null
          }
        />
        <DescriptionList columns={3} className="mt-5">
          <Field label="Publisher payout">{describePayout(campaign)}</Field>
          <Field label="Destination">
            <a
              href={campaign.destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-sm text-primary hover:underline"
            >
              {campaign.destinationUrl}
            </a>
          </Field>
          <Field label="Attribution window">
            {Math.round(campaign.attributionWindowHours / 24)} days
          </Field>
          <Field label="Repeat-click window">
            {Math.round(campaign.dedupeWindowMinutes / 60)} hours
          </Field>
          <Field label="Countries">
            {campaign.allowedCountries.length > 0
              ? campaign.allowedCountries.map(countryName).join(', ')
              : 'Worldwide'}
          </Field>
          <Field label="Public campaign page">
            <Link href={`/campaigns/${campaign.slug}`} className="text-primary hover:underline">
              View as a publisher sees it
            </Link>
          </Field>
        </DescriptionList>
      </Card>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-fg-muted">{label}</dt>
        <dd className="text-sm font-medium tabular-nums text-fg">{value}</dd>
      </div>
      {hint ? <p className="mt-0.5 text-2xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
