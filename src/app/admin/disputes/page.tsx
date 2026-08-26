import Link from 'next/link';
import type { Metadata } from 'next';

import { DisputeList } from '@/components/disputes/list';
import { PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { pageAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatNumber, humanize } from '@/lib/format';
import { listDisputes } from '@/lib/disputes';

export const metadata: Metadata = { title: 'Disputes' };
export const dynamic = 'force-dynamic';

export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await pageAdmin();
  const { status } = await searchParams;

  const [disputes, counts] = await Promise.all([
    listDisputes({ status }),
    prisma.dispute.groupBy({ by: ['status'], _count: true }),
  ]);

  const map = new Map(counts.map((row) => [row.status, row._count]));

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Every dispute raised by a brand or a publisher. Only an administrator can resolve one."
      />

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Open"
          value={formatNumber(map.get('OPEN') ?? 0)}
          tone={(map.get('OPEN') ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat label="Investigating" value={formatNumber(map.get('INVESTIGATING') ?? 0)} />
        <Stat label="Awaiting information" value={formatNumber(map.get('AWAITING_INFORMATION') ?? 0)} />
        <Stat label="Resolved" value={formatNumber(map.get('RESOLVED') ?? 0)} tone="success" />
      </StatGrid>

      <div className="scroll-x mb-4 flex gap-1.5">
        <Tab href="/admin/disputes" label="All" active={!status} />
        {(['OPEN', 'INVESTIGATING', 'AWAITING_INFORMATION', 'RESOLVED', 'REJECTED'] as const).map(
          (value) => (
            <Tab
              key={value}
              href={`/admin/disputes?status=${value}`}
              label={humanize(value)}
              active={status === value}
            />
          ),
        )}
      </div>

      <DisputeList
        disputes={disputes}
        basePath="/admin/disputes"
        emptyTitle="No disputes"
        emptyDescription="Nothing matches these filters."
      />
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
