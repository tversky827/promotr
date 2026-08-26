import { prisma } from '@/lib/db';
import { hashIp } from '@/lib/crypto/hash';
import { logger } from '@/lib/observability/logger';

/**
 * Audit logging.
 *
 * Every administrative and financial action writes a record here with actor,
 * timestamp, reason, and the before/after state. This is the trail that answers
 * "who changed this balance, when, and why" — see docs/SECURITY.md.
 *
 * Failures are logged but never propagate: an audit-write problem must not roll
 * back the action it describes, because a silently *unperformed* action is worse
 * than an unlogged one. The logger line is the backstop record.
 */

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  actorIp?: string | null;
  action: string;
  entityKind: string;
  entityId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        actorIpHash: input.actorIp ? hashIp(input.actorIp) : null,
        action: input.action,
        entityKind: input.entityKind,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        before: sanitize(input.before),
        after: sanitize(input.after),
        metadata: sanitize(input.metadata),
      },
    });
  } catch (error) {
    logger.error('audit.write_failed', {
      error: (error as Error).message,
      action: input.action,
      entityKind: input.entityKind,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
    });
  }
}

/** JSON-safe conversion: bigints become strings, secrets are dropped. */
const SENSITIVE = /^(passwordHash|tokenHash|keyHash|secret|mfaSecret|accessToken|refreshToken|csrfSecretHash)$/i;

type JsonInput = Parameters<typeof prisma.auditLog.create>[0]['data']['before'];

function sanitize(value: unknown, depth = 0): JsonInput {
  if (value === undefined || value === null) return undefined;
  return walk(value, depth) as JsonInput;
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 8) return '[depth-limit]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE.test(k)) continue;
      out[k] = walk(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Convenience wrapper capturing the shape reviewers expect for money changes. */
export async function recordFinancialAudit(params: {
  actorUserId: string;
  actorRole: string;
  actorIp?: string;
  action: string;
  entityKind: string;
  entityId: string;
  reason: string;
  beforeMicros: bigint;
  afterMicros: bigint;
  amountMicros: bigint;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordAudit({
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    actorIp: params.actorIp,
    action: params.action,
    entityKind: params.entityKind,
    entityId: params.entityId,
    reason: params.reason,
    before: { balanceMicros: params.beforeMicros.toString() },
    after: { balanceMicros: params.afterMicros.toString() },
    metadata: { amountMicros: params.amountMicros.toString(), ...params.metadata },
  });
}
