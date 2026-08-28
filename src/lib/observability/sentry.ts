import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Minimal Sentry client speaking the envelope API directly over fetch.
 *
 * Using the wire protocol rather than @sentry/nextjs keeps ~400KB of
 * instrumentation out of the bundle and avoids the build-time plugin. What it
 * gives up is auto-instrumentation and performance tracing; what it keeps is
 * the part that matters operationally — exceptions, with context, in Sentry.
 * DEPLOYMENT.md documents how to swap in the full SDK if tracing is wanted.
 */

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
      projectId,
    };
  } catch {
    return null;
  }
}

export interface ErrorContext {
  userId?: string;
  requestId?: string;
  route?: string;
  method?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Report an exception. Never throws and never blocks the caller's response —
 * a monitoring outage must not become an application outage.
 */
export function captureException(error: unknown, context: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));

  logger.error('exception', {
    message: err.message,
    stack: err.stack,
    ...context,
  });

  if (!integrations.sentry.configured) return;
  const dsn = parseDsn(integrations.sentry.dsn);
  if (!dsn) {
    logger.warn('sentry.invalid_dsn');
    return;
  }

  const eventId = crypto.randomUUID().replace(/-/g, '');
  const timestamp = new Date().toISOString();

  const event = {
    event_id: eventId,
    timestamp,
    platform: 'node',
    level: 'error',
    environment: integrations.sentry.environment,
    server_name: undefined,
    transaction: context.route,
    tags: { ...context.tags, ...(context.method ? { method: context.method } : {}) },
    user: context.userId ? { id: context.userId } : undefined,
    extra: { requestId: context.requestId, ...context.extra },
    exception: {
      values: [
        {
          type: err.name,
          value: err.message,
          stacktrace: { frames: parseStack(err.stack) },
        },
      ],
    },
  };

  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: integrations.sentry.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  void fetch(dsn.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': [
        'Sentry sentry_version=7',
        `sentry_key=${dsn.publicKey}`,
        'sentry_client=audicents/1.0',
      ].join(', '),
    },
    body: envelope,
    // Fire-and-forget; a slow Sentry must not slow the request.
    signal: AbortSignal.timeout(5000),
  }).catch((cause) => {
    logger.warn('sentry.delivery_failed', { error: (cause as Error)?.message });
  });
}

/** Sentry expects frames oldest-first, the reverse of V8's stack order. */
function parseStack(stack?: string): Array<Record<string, unknown>> {
  if (!stack) return [];
  const frames: Array<Record<string, unknown>> = [];
  for (const line of stack.split('\n').slice(1, 41)) {
    const match = /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!match) continue;
    frames.push({
      function: match[1] ?? '<anonymous>',
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !String(match[2]).includes('node_modules'),
    });
  }
  return frames.reverse();
}

export function captureMessage(message: string, context: ErrorContext = {}): void {
  logger.warn('captured_message', { message, ...context });
}
