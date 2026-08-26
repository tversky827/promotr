import Link from 'next/link';
import type { Metadata } from 'next';

import { ApplicationActions } from '@/components/brand/application-actions';
import { DateRangePicker } from '@/components/ui/date-range';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import { presetRange, topPublishers } from '@/lib/analytics/queries';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatNumber, formatPercent, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Publishers' };
export const dynamic = 'force-dynamic';

/**
 * Follower counts are self-declared until a social account is connected, so
 * they are summed only across accounts that actually report one, and described
 * as a stated reach rather than a verified metric.
 */
function describeAudience(
  channels: string[],
  socials: Array<{ platform: string; followers: number | null }>,
): string {
  const parts: string[] = [];
  if (channels.length > 0) parts.push(channels.slice(0, 3).map(humanize).join(', '));

  const stated = socials.reduce((sum, account) => sum + (account.followers ?? 0), 0);
  if (stated > 0) parts.push(`${formatNumber(stated)} stated reach`);

  return parts.length > 0 ? parts.join(' · ') : 'No channels listed';
}

/**
 * The publishers promoting this brand.
 *
 * Performance is shown net of what the publisher earned, not gross of platform
 * fee, because that is the number a brand uses to decide whether to keep a
 * publisher. Applications waiting on a decision are at the top: a publisher
 * left waiting is a publisher promoting someone else.
 */
export default async function BrandPublishersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { brand } = await pageBrand();
  const { range: rangeKey = '30d' } = await searchParams;
  const range = presetRange(rangeKey);
  const csrfToken = await currentCsrfToken();

  const [performers, applications, activeLinks, totalPublishers] = await Promise.all([
    topPublishers({ brandId: brand.id }, range, 50),
    prisma.campaignApplication.findMany({
      where: { campaign: { brandId: brand.id }, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        message: true,
        createdAt: true,
        campaign: { select: { id: true, name: true } },
        creator: {
          select: {
            id: true,
            handle: true,
            verification: true,
            profile: { select: { displayName: true, channels: true, categories: true, bio: true } },
            socialAccounts: { select: { platform: true, followers: true }, take: 5 },
          },
        },
      },
    }),
    prisma.trackingLink.count({
      where: { campaign: { brandId: brand.id }, active: true },
    }),
    prisma.trackingLink
      .findMany({
        where: { campaign: { brandId: brand.id } },
        select: { creatorId: true },
        distinct: ['creatorId'],
      })
      .then((rows) => rows.length),
  ]);

  const converting = performers.filter((publisher) => publisher.conversions > 0).length;

  return (
    <>
      <PageHeader
        title="Publishers"
        description="Everyone promoting your campaigns, and how they are performing."
        action={<DateRangePicker current={rangeKey} />}
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Publishers with links" value={formatNumber(totalPublishers)} />
        <Stat label="Active links" value={formatNumber(activeLinks)} />
        <Stat
          label="Converting in range"
          value={formatNumber(converting)}
          hint="Publishers with at least one conversion"
        />
        <Stat
          label="Awaiting your decision"
          value={formatNumber(applications.length)}
          tone={applications.length > 0 ? 'warning' : 'neutral'}
        />
      </StatGrid>

      {applications.length > 0 ? (
        <Card padded={false} className="mb-6">
          <div className="p-5">
            <CardHeader
              title="Applications"
              description="Publishers asking to promote a campaign that requires approval."
            />
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {applications.map((application) => (
              <li
                key={application.id}
                className="flex flex-col gap-3 p-5 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/campaigns/${application.campaign.id}`}
                      className="text-sm font-medium text-fg hover:text-primary"
                    >
                      {application.creator.profile?.displayName ?? application.creator.handle}
                    </Link>
                    <Badge tone={application.creator.verification === 'VERIFIED' ? 'success' : 'neutral'}>
                      {humanize(application.creator.verification)}
                    </Badge>
                    <span className="text-xs text-fg-subtle">
                      for {application.campaign.name} · applied{' '}
                      {formatDateTime(application.createdAt)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-fg-subtle">
                    {describeAudience(
                      application.creator.profile?.channels ?? [],
                      application.creator.socialAccounts,
                    )}
                  </p>

                  {application.message ? (
                    <p className="mt-2 rounded-md border border-border bg-surface-sunken p-2.5 text-sm text-fg-muted text-pretty">
                      {application.message}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0">
                  <ApplicationActions applicationId={application.id} csrfToken={csrfToken} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padded={false}>
        <div className="p-5">
          <CardHeader
            title="Performance"
            description="Publishers ranked by what your campaigns paid out to them in this period."
          />
        </div>

        {performers.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="No publisher activity yet"
              description="Once a publisher takes a link and drives traffic, they appear here with their results."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Publisher</TH>
                  <TH align="right">Clicks</TH>
                  <TH align="right">Conversions</TH>
                  <TH align="right">Conv. rate</TH>
                  <TH align="right">Paid out</TH>
                  <TH align="right">EPC</TH>
                </TR>
              </THead>
              <TBody>
                {performers.length === 0 ? (
                  <TableEmpty colSpan={6} message="No data in this range." />
                ) : (
                  performers.map((publisher) => (
                    <TR key={publisher.creatorId}>
                      <TD>
                        <span className="font-medium text-fg">{publisher.displayName}</span>
                        <span className="ml-2 text-xs text-fg-subtle">@{publisher.handle}</span>
                      </TD>
                      <TD align="right">{formatNumber(publisher.clicks)}</TD>
                      <TD align="right">{formatNumber(publisher.conversions)}</TD>
                      <TD align="right">{formatPercent(publisher.conversionRate)}</TD>
                      <TD align="right">{formatMicros(publisher.netMicros)}</TD>
                      <TD align="right">{formatMicros(publisher.epcMicros, { showSubCent: true })}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
