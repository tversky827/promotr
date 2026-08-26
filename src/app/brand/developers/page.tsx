import Link from 'next/link';
import type { Metadata } from 'next';

import {
  ApiKeysPanel,
  WebhooksPanel,
  type ApiKeyView,
  type DeliveryView,
  type EndpointView,
} from '@/components/brand/developer-panels';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { API_SCOPES } from '@/lib/api/apikey';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { WEBHOOK_EVENTS } from '@/lib/webhooks/outbound';

export const metadata: Metadata = { title: 'Developers' };
export const dynamic = 'force-dynamic';

export default async function BrandDevelopersPage() {
  const { brand, membershipRole } = await pageBrand();
  const csrfToken = await currentCsrfToken();
  const canManage = membershipRole === 'BRAND_OWNER';

  const [keys, endpoints] = await Promise.all([
    prisma.apiKey.findMany({
      where: { brandId: brand.id },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      // Note the absent field: `keyHash` is never selected, so a key's hash
      // cannot leak into a server-component payload.
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
    prisma.webhookEndpoint.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        failureCount: true,
        disabledAt: true,
        createdAt: true,
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            eventType: true,
            status: true,
            attempt: true,
            responseCode: true,
            errorMessage: true,
            createdAt: true,
            deliveredAt: true,
          },
        },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Developers"
        description="API keys and webhook endpoints for your integration."
      />

      <div className="space-y-6">
        <ApiKeysPanel
          csrfToken={csrfToken}
          canManage={canManage}
          scopes={API_SCOPES}
          keys={keys.map(
            (key): ApiKeyView => ({
              id: key.id,
              name: key.name,
              prefix: key.prefix,
              scopes: key.scopes,
              lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
              revokedAt: key.revokedAt?.toISOString() ?? null,
              createdAt: key.createdAt.toISOString(),
            }),
          )}
        />

        <WebhooksPanel
          csrfToken={csrfToken}
          canManage={canManage}
          events={WEBHOOK_EVENTS}
          endpoints={endpoints.map(
            (endpoint): EndpointView => ({
              id: endpoint.id,
              url: endpoint.url,
              events: endpoint.events,
              active: endpoint.active,
              failureCount: endpoint.failureCount,
              disabledAt: endpoint.disabledAt?.toISOString() ?? null,
              createdAt: endpoint.createdAt.toISOString(),
              deliveries: endpoint.deliveries.map(
                (delivery): DeliveryView => ({
                  id: delivery.id,
                  eventType: delivery.eventType,
                  status: delivery.status,
                  attempt: delivery.attempt,
                  responseCode: delivery.responseCode,
                  errorMessage: delivery.errorMessage,
                  createdAt: delivery.createdAt.toISOString(),
                  deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
                }),
              ),
            }),
          )}
        />

        <Card>
          <CardHeader
            title="Documentation"
            description="Reference for every endpoint, the four ways to report a conversion, and the webhook signature scheme."
          />
          <ul className="mt-4 space-y-1.5 text-sm">
            <li>
              <Link href="/docs/tracking" className="font-medium text-primary hover:underline">
                Conversion tracking
              </Link>
              <span className="text-fg-muted"> — SDK, pixel, postback and REST</span>
            </li>
            <li>
              <Link href="/docs/api" className="font-medium text-primary hover:underline">
                API reference
              </Link>
              <span className="text-fg-muted"> — authentication, endpoints, errors</span>
            </li>
            <li>
              <Link href="/docs/webhooks" className="font-medium text-primary hover:underline">
                Webhooks
              </Link>
              <span className="text-fg-muted"> — event payloads and signature verification</span>
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
