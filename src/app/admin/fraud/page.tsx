import Link from 'next/link';
import type { Metadata } from 'next';

import { FraudActions } from '@/components/admin/fraud-actions';
import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatNumber, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';

import type { Prisma } from '@prisma/client';

export const metadata: Metadata = { title: 'Fraud console' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 25;

interface SignalRecord {
  code: string;
  severity: string;
  weight: number;
  explanation: string;
  detail: string | null;
}

/**
 * Fraud console.
 *
 * Built around one principle: an administrator must be able to see *why* an
 * event was flagged before deciding, and a publisher must be able to be told
 * the same thing. Every flag therefore renders its full signal list with
 * weights and evidence, not just a score.
 */
export default async function FraudConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; band?: string; resolution?: string; creator?: string }>;
}) {
  await pageAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const csrfToken = await currentCsrfToken();

  const where: Prisma.FraudEventWhereInput = {
    ...(params.band ? { band: params.band } : {}),
    ...(params.creator ? { creatorId: params.creator } : {}),
    ...(params.resolution === 'resolved'
      ? { resolution: { not: null } }
      : params.resolution === 'all'
        ? {}
        : { resolution: null }),
  };

  const [events, total, bandCounts, heldValue, last24h] = await Promise.all([
    prisma.fraudEvent.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        creator: {
          select: {
            id: true,
            handle: true,
            riskScore: true,
            verification: true,
            payoutHold: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.fraudEvent.count({ where }),
    prisma.fraudEvent.groupBy({ by: ['band'], where: { resolution: null }, _count: true }),
    prisma.earning.aggregate({
      where: { status: 'UNDER_REVIEW' },
      _sum: { netMicros: true },
      _count: true,
    }),
    prisma.fraudEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);

  const bandMap = new Map(bandCounts.map((row) => [row.band, row._count]));

  // Campaign names for the flagged events, resolved in one query.
  const campaignIds = [...new Set(events.map((e) => e.campaignId).filter(Boolean))] as string[];
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds } },
        select: { id: true, name: true },
      })
    : [];
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Fraud console"
        description="Flagged traffic awaiting a decision. Every flag shows the signals that produced it."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="High risk"
          value={formatNumber(bandMap.get('HIGH') ?? 0)}
          tone={(bandMap.get('HIGH') ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="Suspicious"
          value={formatNumber(bandMap.get('SUSPICIOUS') ?? 0)}
          tone={(bandMap.get('SUSPICIOUS') ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat label="Flags in 24h" value={formatNumber(last24h)} />
        <Stat
          label="Earnings held"
          value={formatMicros(heldValue._sum.netMicros ?? 0n)}
          hint={`${heldValue._count} earning(s) awaiting a decision`}
        />
      </StatGrid>

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/fraud" label="Unresolved" active={!params.resolution} />
        <Tab
          href="/admin/fraud?resolution=resolved"
          label="Resolved"
          active={params.resolution === 'resolved'}
        />
        <Tab href="/admin/fraud?resolution=all" label="All" active={params.resolution === 'all'} />
        <span className="mx-1 w-px bg-border" aria-hidden="true" />
        {(['HIGH', 'SUSPICIOUS', 'REVIEW'] as const).map((band) => (
          <Tab
            key={band}
            href={`/admin/fraud?band=${band}`}
            label={humanize(band)}
            active={params.band === band}
          />
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="No flagged events match these filters. Traffic that passes screening does not appear here."
        />
      ) : (
        <>
          <div className="space-y-3">
            {events.map((event) => {
              const signals = (event.signals as unknown as SignalRecord[]) ?? [];
              return (
                <Card key={event.id} padded={false}>
                  <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            event.band === 'HIGH'
                              ? 'danger'
                              : event.band === 'SUSPICIOUS'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {humanize(event.band)} · score {event.score}
                        </Badge>
                        <Badge tone="neutral">{event.entityKind}</Badge>
                        {event.resolution ? (
                          <Badge tone={event.resolution === 'approved' ? 'success' : 'danger'}>
                            {humanize(event.resolution)}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-fg-subtle">
                          {formatRelative(event.createdAt)} · {formatDateTime(event.createdAt)}
                        </span>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        {event.creator ? (
                          <Link
                            href={`/admin/creators/${event.creator.id}`}
                            className="font-medium text-fg hover:text-primary"
                          >
                            {event.creator.profile?.displayName ?? event.creator.handle}
                          </Link>
                        ) : (
                          <span className="text-fg-muted">Unknown publisher</span>
                        )}
                        {event.creator ? (
                          <span className="text-xs text-fg-subtle">
                            account risk {event.creator.riskScore} ·{' '}
                            {humanize(event.creator.verification)}
                            {event.creator.payoutHold ? ' · payout held' : ''}
                          </span>
                        ) : null}
                        {event.campaignId ? (
                          <span className="text-xs text-fg-subtle">
                            {campaignNames.get(event.campaignId) ?? event.campaignId}
                          </span>
                        ) : null}
                      </div>

                      {/* The reasons. Without these a decision is a coin flip. */}
                      <ul className="mt-4 space-y-2">
                        {signals.map((signal, index) => (
                          <li key={`${signal.code}-${index}`} className="flex gap-2.5">
                            <span
                              className={`mt-1 size-1.5 shrink-0 rounded-full ${severityColor(signal.severity)}`}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <p className="text-sm text-fg">
                                <span className="font-medium">{humanize(signal.code)}</span>
                                <span className="ml-2 text-xs text-fg-subtle">
                                  +{signal.weight} · {signal.severity.toLowerCase()}
                                </span>
                              </p>
                              <p className="mt-0.5 text-sm text-fg-muted text-pretty">
                                {signal.explanation}
                              </p>
                              {signal.detail ? (
                                <p className="mt-0.5 text-xs text-fg-subtle">{signal.detail}</p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {event.resolutionNote ? (
                        <p className="mt-3 rounded-md border border-border bg-surface-sunken/50 p-2.5 text-xs text-fg-muted text-pretty">
                          <span className="font-medium text-fg">Resolution note:</span>{' '}
                          {event.resolutionNote}
                        </p>
                      ) : null}
                    </div>

                    {!event.resolution ? (
                      <div className="shrink-0 lg:w-64">
                        <FraudActions
                          fraudEventId={event.id}
                          creatorId={event.creator?.id ?? null}
                          csrfToken={csrfToken}
                        />
                      </div>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>

          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            perPage={PER_PAGE}
            className="mt-6"
          />
        </>
      )}

      <Card className="mt-6">
        <CardHeader
          title="How to read these"
          description="A flag holds earnings for review. It does not remove them."
        />
        <div className="mt-4 space-y-2 text-sm text-fg-muted">
          <p className="text-pretty">
            <span className="font-medium text-fg">Approve</span> releases the held earnings to the
            publisher and settles the brand&apos;s spend. Use this when the traffic looks legitimate
            on review — being flagged is not proof of anything.
          </p>
          <p className="text-pretty">
            <span className="font-medium text-fg">Reject</span> reverses the earnings and returns the
            brand&apos;s budget. The publisher is told the reason and can dispute it.
          </p>
          <p className="text-pretty">
            <span className="font-medium text-fg">Hold payouts</span> stops withdrawals for that
            publisher while a pattern is investigated, without touching their balance.
          </p>
        </div>
      </Card>
    </>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'whitespace-nowrap rounded-md bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary'
          : 'whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg'
      }
    >
      {label}
    </Link>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'bg-danger';
    case 'MEDIUM':
      return 'bg-warning';
    case 'LOW':
      return 'bg-info';
    default:
      return 'bg-fg-subtle';
  }
}
