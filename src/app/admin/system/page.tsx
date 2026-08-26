import type { Metadata } from 'next';

import { SystemActions } from '@/components/admin/system-actions';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { TBody, TD, TH, THead, TR, Table, TableEmpty, TableWrap } from '@/components/ui/table';
import { lastRollupAt } from '@/lib/analytics/rollup';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { reconcileAll, verifyGlobalBalance } from '@/lib/billing/ledger';
import { healthCheck } from '@/lib/db';
import { integrationStatus } from '@/lib/env';
import { deadLetterJobs, queueStats } from '@/lib/jobs/queue';
import { emailDeliveryStatus } from '@/lib/notify';
import { prisma } from '@/lib/db';
import { formatNumber, formatRelative, humanize } from '@/lib/format';
import { formatMicros } from '@/lib/money';
import { kv } from '@/lib/redis';
import { checkStripeHealth } from '@/lib/stripe';

export const metadata: Metadata = { title: 'System health' };
export const dynamic = 'force-dynamic';

/**
 * System health.
 *
 * The screen answers the questions an operator actually has at 3am: is the
 * ledger consistent, are jobs draining, are the integrations reachable, and is
 * anything silently broken. Integration state is reported honestly — an
 * unconfigured Stripe reads as "not configured", never as healthy.
 */
export default async function AdminSystemPage() {
  await pageAdmin();
  const csrfToken = await currentCsrfToken();

  const [database, stripe, ledger, reconciliation, queues, dead, rollupAt, partitions, webhookFails] =
    await Promise.all([
      healthCheck(),
      checkStripeHealth(),
      verifyGlobalBalance(),
      reconcileAll(),
      queueStats(),
      deadLetterJobs(20),
      lastRollupAt(),
      prisma.$queryRaw<Array<{ parent: string; partitions: bigint }>>`
        SELECT p.relname AS parent, COUNT(*)::bigint AS partitions
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname IN ('clicks', 'impressions')
        GROUP BY 1
      `,
      prisma.webhookDelivery.count({ where: { status: { in: ['failed', 'dead'] } } }),
    ]);

  const integrations = integrationStatus();
  const email = emailDeliveryStatus();
  const queued = queues.filter((q) => q.status === 'QUEUED').reduce((n, q) => n + q.count, 0);
  const running = queues.filter((q) => q.status === 'RUNNING').reduce((n, q) => n + q.count, 0);

  return (
    <>
      <PageHeader
        title="System health"
        description="Dependencies, background work, and ledger integrity."
        action={<SystemActions csrfToken={csrfToken} />}
      />

      {!ledger.balanced ? (
        <Alert tone="danger" className="mb-6" title="Ledger is out of balance">
          Global debits are {formatMicros(ledger.debits)} and credits are{' '}
          {formatMicros(ledger.credits)}. Every posting balances by construction, so a difference
          means something wrote to the ledger tables outside the posting API. Stop payouts and
          investigate.
        </Alert>
      ) : null}

      {reconciliation.drifted.length > 0 ? (
        <Alert
          tone="danger"
          className="mb-6"
          title={`${reconciliation.drifted.length} account balance(s) disagree with their entries`}
        >
          <ul className="mt-2 space-y-1">
            {reconciliation.drifted.slice(0, 10).map((account) => (
              <li key={account.accountId} className="font-mono text-xs">
                {account.type} {account.ownerId || '(platform)'}: cached{' '}
                {formatMicros(account.cachedMicros)}, derived {formatMicros(account.derivedMicros)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <StatGrid columns={4} className="mb-6">
        <Stat
          label="Database"
          value={database.ok ? 'Healthy' : 'Down'}
          tone={database.ok ? 'success' : 'danger'}
          hint={`${database.latencyMs}ms`}
        />
        <Stat
          label="Ledger"
          value={ledger.balanced && reconciliation.drifted.length === 0 ? 'Consistent' : 'Drift'}
          tone={ledger.balanced && reconciliation.drifted.length === 0 ? 'success' : 'danger'}
          hint={`${reconciliation.checked} accounts checked`}
        />
        <Stat
          label="Jobs queued"
          value={formatNumber(queued)}
          tone={queued > 500 ? 'warning' : 'neutral'}
          hint={`${running} running`}
        />
        <Stat
          label="Dead-letter"
          value={formatNumber(dead.length)}
          tone={dead.length > 0 ? 'danger' : 'success'}
        />
      </StatGrid>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Integrations"
            description="Unconfigured integrations disable their features rather than failing silently."
          />
          <ul className="mt-4 space-y-2.5">
            <IntegrationRow
              name="Payments (Stripe)"
              configured={integrations.stripe.configured}
              detail={
                !integrations.stripe.configured
                  ? 'STRIPE_SECRET_KEY is not set — funding and payouts are disabled'
                  : !stripe.reachable
                    ? `Configured but unreachable: ${stripe.error ?? 'unknown error'}`
                    : `${integrations.stripe.liveMode ? 'Live mode' : 'Test mode'}${
                        integrations.stripe.webhookConfigured ? '' : ' · webhook secret missing'
                      }`
              }
              healthy={integrations.stripe.configured && stripe.reachable}
              warning={integrations.stripe.configured && !integrations.stripe.webhookConfigured}
            />
            <IntegrationRow
              name="Email"
              configured={integrations.email.configured}
              detail={email.note}
              healthy={integrations.email.configured && integrations.email.provider !== 'console'}
              warning={integrations.email.provider === 'console'}
            />
            <IntegrationRow
              name="Cache and rate limiting"
              configured={integrations.redis.configured}
              detail={
                kv.isDistributed
                  ? 'Redis connected — limits are shared across instances'
                  : 'In-memory fallback — correct for one instance, NOT safe across several'
              }
              healthy={kv.isDistributed}
              warning={!kv.isDistributed}
            />
            <IntegrationRow
              name="Object storage"
              configured={integrations.storage.configured}
              detail={
                integrations.storage.configured
                  ? `Bucket ${integrations.storage.bucket}`
                  : 'Not configured — exports are served inline and uploads are rejected'
              }
              healthy={integrations.storage.configured}
              warning={!integrations.storage.configured}
            />
            <IntegrationRow
              name="Error monitoring"
              configured={integrations.sentry.configured}
              detail={
                integrations.sentry.configured
                  ? 'Exceptions are reported'
                  : 'SENTRY_DSN not set — exceptions go to logs only'
              }
              healthy={integrations.sentry.configured}
              warning={!integrations.sentry.configured}
            />
            <IntegrationRow
              name="URL safety screening"
              configured={integrations.safeBrowsing.configured}
              detail={
                integrations.safeBrowsing.configured
                  ? 'Campaign destinations are screened'
                  : 'Not configured — campaigns are flagged for manual review instead of being screened'
              }
              healthy={integrations.safeBrowsing.configured}
              warning={!integrations.safeBrowsing.configured}
            />
          </ul>
        </Card>

        <Card>
          <CardHeader title="Background work" />
          <div className="mt-4 space-y-3">
            <Row
              label="Analytics rollup"
              value={rollupAt ? formatRelative(rollupAt) : 'Never run'}
              warning={!rollupAt || Date.now() - rollupAt.getTime() > 15 * 60_000}
            />
            <Row
              label="Failed webhook deliveries"
              value={formatNumber(webhookFails)}
              warning={webhookFails > 0}
            />
            {partitions.map((row) => (
              <Row
                key={row.parent}
                label={`${row.parent} partitions`}
                value={formatNumber(Number(row.partitions))}
                warning={Number(row.partitions) < 3}
              />
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Queue depth
            </h3>
            <div className="mt-2 space-y-1.5">
              {queues.length === 0 ? (
                <p className="text-sm text-fg-subtle">No jobs.</p>
              ) : (
                queues.map((queue) => (
                  <div
                    key={`${queue.queue}-${queue.status}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-fg-muted">
                      {queue.queue} · {humanize(queue.status)}
                    </span>
                    <span className="tabular-nums text-fg">{formatNumber(queue.count)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {!rollupAt || Date.now() - (rollupAt?.getTime() ?? 0) > 15 * 60_000 ? (
            <Alert tone="warning" className="mt-4">
              Dashboards are stale. Check that a worker process is running (`npm run worker`).
            </Alert>
          ) : null}
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-5">
          <CardHeader
            title="Dead-letter queue"
            description="Jobs that exhausted their retries. Nothing is lost — inspect and re-queue."
          />
        </div>
        <TableWrap className="border-t border-border">
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Error</TH>
                <TH align="right">Attempts</TH>
                <TH align="right">Failed</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {dead.length === 0 ? (
                <TableEmpty colSpan={5} message="Nothing in the dead-letter queue." />
              ) : (
                dead.map((job) => (
                  <TR key={job.id}>
                    <TD>
                      <span className="font-mono text-xs text-fg">{job.type}</span>
                      <div className="text-2xs text-fg-subtle">{job.queue}</div>
                    </TD>
                    <TD>
                      <div className="max-w-md truncate text-xs text-danger">{job.lastError}</div>
                    </TD>
                    <TD align="right" numeric>
                      {job.attempts}
                    </TD>
                    <TD align="right" className="text-fg-muted">
                      {job.completedAt ? formatRelative(job.completedAt) : '—'}
                    </TD>
                    <TD align="right">
                      <SystemActions csrfToken={csrfToken} retryJobId={job.id} compact />
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

function IntegrationRow({
  name,
  configured,
  detail,
  healthy,
  warning,
}: {
  name: string;
  configured: boolean;
  detail: string;
  healthy: boolean;
  warning?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{name}</p>
        <p className="mt-0.5 text-xs text-fg-muted text-pretty">{detail}</p>
      </div>
      <Badge
        tone={healthy ? 'success' : warning ? 'warning' : configured ? 'danger' : 'neutral'}
        className="shrink-0"
      >
        {healthy ? 'Ready' : configured ? (warning ? 'Degraded' : 'Error') : 'Not configured'}
      </Badge>
    </li>
  );
}

function Row({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className={`text-sm tabular-nums ${warning ? 'font-medium text-warning' : 'text-fg'}`}>
        {value}
      </span>
    </div>
  );
}
