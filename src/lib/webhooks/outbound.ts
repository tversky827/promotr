import { createHmac, timingSafeEqual } from 'node:crypto';

import { decryptSecret, encryptSecret } from '@/lib/crypto/secretbox';
import { generateToken } from '@/lib/crypto/ids';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';
import { validateDestinationUrl } from '@/lib/urlsafety';

/**
 * Outbound webhooks.
 *
 * Signing follows the scheme Stripe popularised, because it is well understood
 * and defends against the two attacks that matter:
 *
 *   Audicents-Signature: t=<unix>,v1=<hex hmac of "t.body">
 *
 * The timestamp is inside the signed payload, so a captured delivery cannot be
 * replayed later; and the signature covers the exact bytes, so the body cannot
 * be altered. Receivers should reject deliveries older than five minutes.
 *
 * Delivery is at-least-once with exponential backoff. An endpoint that fails
 * repeatedly is disabled and its owner notified, rather than being retried
 * forever.
 */

export const WEBHOOK_EVENTS = [
  'campaign.created',
  'campaign.started',
  'campaign.paused',
  'campaign.completed',
  'campaign.budget.low',
  'campaign.budget.exhausted',
  'click.created',
  'conversion.created',
  'conversion.approved',
  'conversion.rejected',
  'conversion.reversed',
  'payout.created',
  'payout.completed',
  'payout.failed',
  'publisher.joined',
  'dispute.opened',
  'dispute.resolved',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

const MAX_CONSECUTIVE_FAILURES = 15;

export async function createEndpoint(params: {
  brandId: string;
  url: string;
  events: string[];
}): Promise<{ endpointId: string; secret: string } | { error: string }> {
  const validation = validateDestinationUrl(params.url, { requireHttps: true });
  if (!validation.ok) {
    return { error: validation.errors.join(' ') };
  }

  const invalid = params.events.filter(
    (e) => !WEBHOOK_EVENTS.includes(e as WebhookEventType) && e !== '*',
  );
  if (invalid.length > 0) {
    return { error: `Unknown event types: ${invalid.join(', ')}` };
  }

  // Shown once, at creation. Only the encrypted form is stored.
  const secret = `whsec_${generateToken()}`;

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      brandId: params.brandId,
      url: validation.normalized!,
      secret: encryptSecret(secret),
      events: params.events,
    },
  });

  return { endpointId: endpoint.id, secret };
}

export function signPayload(
  secret: string,
  body: string,
  timestamp: number,
): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify a signature. Exported so the documentation can point at a real
 * implementation and so the test suite can prove the scheme round-trips.
 */
export function verifySignature(params: {
  secret: string;
  body: string;
  header: string;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
  const parts = Object.fromEntries(
    params.header.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim() ?? '', v?.trim() ?? ''];
    }),
  );

  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) {
    return { valid: false, reason: 'Malformed signature header' };
  }

  const tolerance = params.toleranceSeconds ?? 300;
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > tolerance) {
    return { valid: false, reason: `Timestamp is ${age}s old, outside the ${tolerance}s tolerance` };
  }

  const expected = createHmac('sha256', params.secret)
    .update(`${timestamp}.${params.body}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return { valid: false, reason: 'Signature mismatch' };
  return timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: 'Signature mismatch' };
}

/** Queue an event for every endpoint of a brand subscribed to it. */
export async function dispatch(params: {
  brandId: string;
  eventType: WebhookEventType | string;
  data: Record<string, unknown>;
}): Promise<number> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { brandId: params.brandId, active: true },
  });

  const subscribed = endpoints.filter(
    (e) => e.events.includes('*') || e.events.includes(params.eventType),
  );
  if (subscribed.length === 0) return 0;

  const eventId = `evt_${generateToken().slice(0, 24)}`;
  const payload = {
    id: eventId,
    type: params.eventType,
    created: Math.floor(Date.now() / 1000),
    data: params.data,
  };

  for (const endpoint of subscribed) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventType: params.eventType,
        eventId,
        payload: payload as never,
        nextAttemptAt: new Date(),
      },
    });
    await enqueue(
      'webhook.retry',
      { deliveryId: delivery.id },
      { idempotencyKey: `webhook:${delivery.id}` },
    );
  }

  return subscribed.length;
}

/** Attempt one delivery. Returns true when it succeeded. */
export async function attemptDelivery(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return false;
  if (delivery.status === 'delivered') return true;
  if (!delivery.endpoint.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', errorMessage: 'Endpoint is disabled' },
    });
    return false;
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);

  let secret: string;
  try {
    secret = decryptSecret(delivery.endpoint.secret);
  } catch {
    logger.error('webhook.secret_undecryptable', { endpointId: delivery.endpointId });
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'dead', errorMessage: 'Endpoint secret could not be decrypted' },
    });
    return false;
  }

  const attempt = delivery.attempt + 1;

  try {
    const response = await fetch(delivery.endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Audicents-Webhooks/1.0',
        'Audicents-Signature': signPayload(secret, body, timestamp),
        'Audicents-Event-Id': delivery.eventId,
        'Audicents-Event-Type': delivery.eventType,
        'Audicents-Delivery-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    });

    const responseBody = await response.text().catch(() => '');
    const ok = response.status >= 200 && response.status < 300;

    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempt,
        status: ok ? 'delivered' : delivery.attempt + 1 >= delivery.maxAttempts ? 'dead' : 'pending',
        responseCode: response.status,
        responseBody: responseBody.slice(0, 1000),
        deliveredAt: ok ? new Date() : null,
        nextAttemptAt: ok ? null : new Date(Date.now() + backoffMs(attempt)),
      },
    });

    if (ok) {
      await prisma.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: { failureCount: 0 },
      });
      return true;
    }

    await registerFailure(delivery.endpointId);
    if (attempt < delivery.maxAttempts) {
      await enqueue(
        'webhook.retry',
        { deliveryId },
        { runAt: new Date(Date.now() + backoffMs(attempt)), idempotencyKey: `webhook:${deliveryId}:${attempt}` },
      );
    }
    return false;
  } catch (error) {
    const message = (error as Error).message;
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempt,
        status: attempt >= delivery.maxAttempts ? 'dead' : 'pending',
        errorMessage: message.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
      },
    });
    await registerFailure(delivery.endpointId);
    if (attempt < delivery.maxAttempts) {
      await enqueue(
        'webhook.retry',
        { deliveryId },
        { runAt: new Date(Date.now() + backoffMs(attempt)), idempotencyKey: `webhook:${deliveryId}:${attempt}` },
      );
    }
    return false;
  }
}

/** 1m, 5m, 25m, 2h, 6h, 12h, 24h — then the delivery is dead. */
function backoffMs(attempt: number): number {
  const schedule = [60, 300, 1500, 7200, 21_600, 43_200, 86_400];
  return (schedule[Math.min(attempt - 1, schedule.length - 1)] ?? 86_400) * 1000;
}

async function registerFailure(endpointId: string): Promise<void> {
  const endpoint = await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { failureCount: { increment: 1 } },
  });

  if (endpoint.failureCount >= MAX_CONSECUTIVE_FAILURES && endpoint.active) {
    await prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { active: false, disabledAt: new Date() },
    });
    logger.warn('webhook.endpoint_disabled', {
      endpointId,
      failureCount: endpoint.failureCount,
    });
    const { notifyBrand } = await import('@/lib/notify');
    await notifyBrand(endpoint.brandId, {
      type: 'generic',
      title: 'A webhook endpoint was disabled',
      body: `${endpoint.url} failed ${endpoint.failureCount} consecutive deliveries and has been disabled. Re-enable it once the endpoint is healthy.`,
      actionPath: '/brand/developers/webhooks',
    });
  }
}

/** Redeliver a specific event — exposed in the brand's webhook log UI. */
export async function redeliver(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return false;
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'pending', attempt: 0, nextAttemptAt: new Date(), errorMessage: null },
  });
  await enqueue('webhook.retry', { deliveryId }, { idempotencyKey: `webhook:redeliver:${deliveryId}:${Date.now()}` });
  return true;
}

export async function revealSecret(endpointId: string, brandId: string): Promise<string | null> {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, brandId } });
  if (!endpoint) return null;
  try {
    return decryptSecret(endpoint.secret);
  } catch {
    return null;
  }
}
