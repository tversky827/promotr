import Link from 'next/link';
import type { Metadata } from 'next';

import { NotificationActions } from '@/components/app/notification-actions';
import { Pagination } from '@/components/ui/pagination';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageSession } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatDateTime, formatRelative, humanize } from '@/lib/format';
import { emailDeliveryStatus } from '@/lib/notify';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

/**
 * Notifications.
 *
 * One page for every account type: a notification belongs to a person, not to
 * a role. Everything that emails a user also lands here, so a deployment with
 * no email provider configured still tells people what happened — which is why
 * the delivery state is stated at the bottom rather than left to be guessed.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const session = await pageSession();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const unreadOnly = params.filter === 'unread';
  const csrfToken = await currentCsrfToken();

  const where = { userId: session.user.id, ...(unreadOnly ? { readAt: null } : {}) };

  const [notifications, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
  ]);

  const email = emailDeliveryStatus();

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread` : 'Everything that has happened on your account.'
        }
        action={
          unread > 0 ? <NotificationActions csrfToken={csrfToken} markAll /> : undefined
        }
      />

      <div className="mb-4 flex gap-1.5">
        <Tab href="/notifications" label="All" active={!unreadOnly} />
        <Tab href="/notifications?filter=unread" label="Unread" active={unreadOnly} />
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
          description={
            unreadOnly
              ? 'You are up to date.'
              : 'Earnings, payouts, campaign decisions and disputes will appear here.'
          }
        />
      ) : (
        <>
          <Card padded={false}>
            <ul className="divide-y divide-border">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={
                    notification.readAt
                      ? 'flex flex-wrap items-start gap-3 p-4'
                      : 'flex flex-wrap items-start gap-3 bg-primary-soft/30 p-4'
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-fg">{notification.title}</p>
                      {!notification.readAt ? <Badge tone="info">New</Badge> : null}
                      <span className="text-xs text-fg-subtle" title={formatDateTime(notification.createdAt)}>
                        {formatRelative(notification.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-fg-muted text-pretty">{notification.body}</p>
                    <p className="mt-1 text-xs text-fg-subtle">{humanize(notification.type)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {notification.actionUrl ? (
                      <Link
                        href={internalPath(notification.actionUrl)}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Open
                      </Link>
                    ) : null}
                    {!notification.readAt ? (
                      <NotificationActions csrfToken={csrfToken} notificationId={notification.id} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
            total={total}
            perPage={PER_PAGE}
            className="mt-6"
          />
        </>
      )}

      {!email.configured ? (
        <p className="mt-6 text-xs text-fg-subtle text-pretty">
          {email.note} Notifications still appear here in full.
        </p>
      ) : null}
    </>
  );
}

/**
 * Notifications store an absolute URL so the same value can be used in an
 * email. Inside the application, navigate by path instead — a full-origin href
 * would force a document load, and a row written before the app URL changed
 * would otherwise send someone to the old host.
 */
function internalPath(actionUrl: string): string {
  try {
    const url = new URL(actionUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return actionUrl.startsWith('/') ? actionUrl : '/';
  }
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-md bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary'
          : 'rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg'
      }
    >
      {label}
    </Link>
  );
}
