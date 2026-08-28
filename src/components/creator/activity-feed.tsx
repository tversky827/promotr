import { BrandMark } from '@/components/identity/brand-mark';
import { Card, CardHeader } from '@/components/ui/primitives';
import { prisma } from '@/lib/db';
import { formatRelative } from '@/lib/format';
import { formatMicros } from '@/lib/money';

/**
 * Recent activity.
 *
 * The dashboard's totals answer "how am I doing"; this answers "what just
 * happened", which is the question that brings a publisher back to the page.
 * Every row is an earning that exists in the ledger — there is nothing here
 * that is not money already accounted for.
 */
export async function ActivityFeed({ creatorId, limit = 6 }: { creatorId: string; limit?: number }) {
  const earnings = await prisma.earning.findMany({
    where: { creatorId, status: { notIn: ['REJECTED', 'REVERSED'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      netMicros: true,
      quantity: true,
      status: true,
      createdAt: true,
      eventType: true,
      campaign: {
        select: {
          name: true,
          brand: { select: { displayName: true, logoUrl: true } },
        },
      },
    },
  });

  return (
    <Card>
      <CardHeader title="Recent activity" description="Your latest earnings, newest first" />

      {earnings.length === 0 ? (
        <p className="mt-5 text-sm text-fg-muted text-pretty">
          Nothing yet. Once traffic through one of your links qualifies, it shows up here within a
          few minutes.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {earnings.map((earning) => (
            <li key={earning.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
              <BrandMark
                name={earning.campaign.brand.displayName}
                logoUrl={earning.campaign.brand.logoUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">
                  {earning.campaign.brand.displayName}
                </p>
                <p className="truncate text-xs text-fg-subtle">
                  {earning.campaign.name}
                  {earning.quantity > 1 ? ` · ${earning.quantity} events` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    earning.status === 'PENDING' || earning.status === 'UNDER_REVIEW'
                      ? 'text-fg-muted'
                      : 'text-primary'
                  }`}
                >
                  +{formatMicros(earning.netMicros, { showSubCent: false })}
                </p>
                <p className="text-2xs text-fg-subtle">{formatRelative(earning.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
