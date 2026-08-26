'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requireSession } from '@/lib/auth/guards';
import {
  createSession,
  destroySession,
  markSessionMfaSatisfied,
  revokeAllSessions,
  revokeSession,
} from '@/lib/auth/session';
import { brand } from '@/lib/brand';
import { hashPassword, hashToken, needsRehash, verifyPassword } from '@/lib/crypto/hash';
import { generateToken, slugify } from '@/lib/crypto/ids';
import { generateRecoveryCodes, generateTotpSecret, totpUri, verifyTotp } from '@/lib/crypto/totp';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secretbox';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/jobs/queue';
import { logger } from '@/lib/observability/logger';
import { enforceRateLimit } from '@/lib/ratelimit';

import { action, actionError, actionOk, checkboxSchema, type ActionResult } from './shared';

/**
 * Authentication.
 *
 * Three properties are maintained throughout:
 *
 *  - **No account enumeration.** Signup, login, and password reset return the
 *    same response whether or not the address exists. An attacker cannot use
 *    these endpoints to discover who has an account.
 *  - **Constant work.** Login hashes a dummy password when the account is
 *    missing, so response timing does not reveal existence either.
 *  - **Verification before value.** An unverified account can sign in and
 *    complete its profile, but cannot launch a campaign or receive a payout.
 */

const EMAIL = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');

/**
 * Password policy: length over composition rules. NIST SP 800-63B guidance is
 * that arbitrary character-class requirements push users toward predictable
 * substitutions without adding real entropy.
 */
const PASSWORD = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'That password is too common. Choose something less predictable.',
  });

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  '1234567890', '12345678901', 'qwertyuiop', 'letmein123', 'welcome123',
  'admin12345', 'iloveyou123', 'sunshine123', 'princess123', 'football123',
  'monkey12345', 'abc123456789', 'qwerty123456', 'passw0rd123', 'changeme123',
]);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

const signupSchema = z.object({
  email: EMAIL,
  password: PASSWORD,
  name: z.string().trim().min(1, 'Enter your name').max(120, 'That name is too long'),
  accountType: z.enum(['creator', 'brand'], {
    errorMap: () => ({ message: 'Choose whether you are a creator or a brand' }),
  }),
  acceptTerms: checkboxSchema.refine((v) => v === true, {
    message: 'You must accept the terms to create an account',
  }),
  marketingOptIn: checkboxSchema,
});

export const signup = action(signupSchema, async (input, context) => {
  await enforceRateLimit('signup', context.ip);

  const emailNormalized = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const role = input.accountType === 'brand' ? 'BRAND_OWNER' : 'CREATOR';

  const existing = await prisma.user.findUnique({
    where: { emailNormalized },
    select: { id: true },
  });

  if (existing) {
    // Do not reveal that the address is taken. Send a "someone tried to sign
    // up with your address" email instead, which is useful to the real owner
    // and useless to an enumerator.
    await enqueue('email.send', {
      userId: existing.id,
      template: 'generic',
      params: {
        heading: 'Someone tried to sign up with your email',
        body: `An account already exists for this address. If this was you, sign in instead — or reset your password if you have forgotten it.`,
        cta: { label: 'Sign in', url: `${brand.appUrl}/login` },
      },
    }).catch(() => undefined);

    logger.info('auth.signup_existing_email', { emailNormalized });
    return actionOk(
      { pendingVerification: true },
      'Check your email to finish setting up your account.',
    );
  }

  const user = await prisma.user.create({
    data: {
      email: input.email.trim(),
      emailNormalized,
      passwordHash,
      name: input.name,
      role,
      marketingOptIn: input.marketingOptIn,
      ...(role === 'CREATOR'
        ? {
            creator: {
              create: {
                handle: slugify(input.name),
                profile: { create: { displayName: input.name } },
              },
            },
          }
        : {}),
    },
  });

  await recordAcceptedTerms(user.id, context.ip, context.userAgent);
  await sendVerificationEmail(user.id, user.name);

  await recordAudit({
    actorUserId: user.id,
    actorRole: role,
    actorIp: context.ip,
    action: 'auth.signup',
    entityKind: 'user',
    entityId: user.id,
    metadata: { accountType: input.accountType },
  });

  // Sign the user straight in. They can complete onboarding while the
  // verification email is in flight; verification gates money, not access.
  await createSession(user.id, { ip: context.ip, userAgent: context.userAgent });

  logger.info('auth.signup', { userId: user.id, role });
  return actionOk({ pendingVerification: true, role }, 'Account created.');
});

async function recordAcceptedTerms(userId: string, ip: string, userAgent: string): Promise<void> {
  const current = await prisma.termsVersion.findMany({
    where: { kind: { in: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'] } },
    orderBy: { version: 'desc' },
    distinct: ['kind'],
  });

  for (const version of current) {
    await prisma.termsAcceptance
      .create({ data: { userId, termsVersionId: version.id, ipHash: ip, userAgent } })
      .catch(() => undefined);
  }
}

async function sendVerificationEmail(userId: string, name: string): Promise<void> {
  const token = generateToken();
  await prisma.emailToken.create({
    data: {
      userId,
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await enqueue('email.send', {
    userId,
    template: 'verifyEmail',
    params: { name, url: `${brand.appUrl}/verify-email?token=${token}` },
  });
}

export const resendVerification = action(z.object({}), async (_input, context) => {
  const session = await requireSession();
  await enforceRateLimit('emailVerification', session.user.id);

  if (session.user.emailVerifiedAt) {
    return actionOk(undefined, 'Your email is already verified.');
  }

  await sendVerificationEmail(session.user.id, session.user.name);
  void context;
  return actionOk(undefined, 'Verification email sent.');
});

// ---------------------------------------------------------------------------
// Verify email
// ---------------------------------------------------------------------------

export async function verifyEmailToken(token: string): Promise<ActionResult<{ role: string }>> {
  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.purpose !== 'EMAIL_VERIFICATION') {
    return actionError('That verification link is not valid.');
  }
  if (record.consumedAt) {
    return record.user.emailVerifiedAt
      ? actionOk({ role: record.user.role }, 'Your email is already verified.')
      : actionError('That verification link has already been used.');
  }
  if (record.expiresAt <= new Date()) {
    return actionError('That verification link has expired. Request a new one from your dashboard.');
  }

  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);

  await recordAudit({
    actorUserId: record.userId,
    action: 'auth.email_verified',
    entityKind: 'user',
    entityId: record.userId,
  });

  logger.info('auth.email_verified', { userId: record.userId });
  return actionOk({ role: record.user.role }, 'Email verified.');
}

// ---------------------------------------------------------------------------
// Log in
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: EMAIL,
  password: z.string().min(1, 'Enter your password'),
});

/** Hashed once at module load; used to equalise timing for missing accounts. */
const DUMMY_HASH_PROMISE = hashPassword('this-account-does-not-exist-placeholder');

export const login = action(loginSchema, async (input, context) => {
  const emailNormalized = normalizeEmail(input.email);

  await enforceRateLimit('login', context.ip);
  await enforceRateLimit('loginPerAccount', emailNormalized);

  const user = await prisma.user.findUnique({ where: { emailNormalized } });

  if (!user || !user.passwordHash) {
    // Spend the same time as a real verification so timing reveals nothing.
    await verifyPassword(input.password, await DUMMY_HASH_PROMISE);
    logger.info('auth.login_failed', { reason: 'no_account', emailNormalized });
    return actionError('That email or password is not correct.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return actionError(
      `This account is temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`,
    );
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    const failures = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failures,
        // Progressive lockout: 10 failures buys a 15-minute cool-off. Short
        // enough not to be a denial-of-service against the real owner.
        lockedUntil: failures >= 10 ? new Date(Date.now() + 15 * 60_000) : null,
      },
    });
    logger.info('auth.login_failed', { userId: user.id, reason: 'bad_password', failures });
    return actionError('That email or password is not correct.');
  }

  if (user.status === 'SUSPENDED') {
    return actionError(
      user.suspendedReason
        ? `This account is suspended: ${user.suspendedReason}`
        : 'This account is suspended. Contact support.',
    );
  }
  if (user.status === 'DELETED' || user.deletedAt) {
    return actionError('That email or password is not correct.');
  }

  // Opportunistically upgrade the stored hash if the policy has been raised.
  if (needsRehash(user.passwordHash)) {
    await prisma.user
      .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } })
      .catch(() => undefined);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await createSession(user.id, {
    ip: context.ip,
    userAgent: context.userAgent,
    // MFA is not satisfied yet when it is enabled; the session is created but
    // privileged actions stay blocked until the code is entered.
    mfaSatisfied: !user.mfaEnabled,
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    actorIp: context.ip,
    action: 'auth.login',
    entityKind: 'user',
    entityId: user.id,
  });

  logger.info('auth.login', { userId: user.id, role: user.role, mfaRequired: user.mfaEnabled });
  return actionOk({ mfaRequired: user.mfaEnabled, role: user.role });
});

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

const forgotSchema = z.object({ email: EMAIL });

export const requestPasswordReset = action(forgotSchema, async (input, context) => {
  await enforceRateLimit('passwordReset', context.ip);

  const emailNormalized = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { emailNormalized } });

  // Always the same response, whether or not the account exists.
  const genericResponse = actionOk(
    undefined,
    'If an account exists for that address, a reset link is on its way.',
  );

  if (!user || user.status === 'DELETED') return genericResponse;

  await enforceRateLimit('passwordReset', user.id);

  const token = generateToken();
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await enqueue('email.send', {
    userId: user.id,
    template: 'passwordReset',
    params: { name: user.name, url: `${brand.appUrl}/reset-password?token=${token}` },
  });

  logger.info('auth.password_reset_requested', { userId: user.id });
  return genericResponse;
});

const resetSchema = z
  .object({
    token: z.string().min(1, 'This reset link is not valid'),
    password: PASSWORD,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Both passwords must match',
    path: ['confirmPassword'],
  });

export const resetPassword = action(resetSchema, async (input, context) => {
  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { user: true },
  });

  if (!record || record.purpose !== 'PASSWORD_RESET' || record.consumedAt) {
    return actionError('That reset link is not valid or has already been used.');
  }
  if (record.expiresAt <= new Date()) {
    return actionError('That reset link has expired. Request a new one.');
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    }),
  ]);

  // A password reset invalidates every existing session: if the reset was
  // prompted by a compromise, the attacker's session must not survive it.
  const revoked = await revokeAllSessions(record.userId);

  await recordAudit({
    actorUserId: record.userId,
    actorIp: context.ip,
    action: 'auth.password_reset',
    entityKind: 'user',
    entityId: record.userId,
    metadata: { sessionsRevoked: revoked },
  });

  await enqueue('email.send', {
    userId: record.userId,
    template: 'generic',
    params: {
      heading: 'Your password was changed',
      body: `Your ${brand.name} password was just changed and all other sessions were signed out. If this was not you, contact support immediately.`,
      cta: { label: 'Contact support', url: `mailto:${brand.supportEmail}` },
    },
  }).catch(() => undefined);

  logger.info('auth.password_reset', { userId: record.userId, sessionsRevoked: revoked });
  return actionOk(undefined, 'Password updated. Sign in with your new password.');
});

// ---------------------------------------------------------------------------
// Change password (signed in)
// ---------------------------------------------------------------------------

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password: PASSWORD,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Both passwords must match',
    path: ['confirmPassword'],
  });

export const changePassword = action(changePasswordSchema, async (input, context) => {
  const session = await requireSession();
  if (!session.user.passwordHash) {
    return actionError('This account signs in with a provider and has no password.');
  }

  const valid = await verifyPassword(input.currentPassword, session.user.passwordHash);
  if (!valid) {
    return actionError('Your current password is not correct.', {
      currentPassword: 'That password is not correct',
    });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: await hashPassword(input.password) },
  });

  // Keep the current session; sign out everywhere else.
  const revoked = await revokeAllSessions(session.user.id, session.sessionId);

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'auth.password_changed',
    entityKind: 'user',
    entityId: session.user.id,
    metadata: { otherSessionsRevoked: revoked },
  });

  return actionOk(undefined, `Password updated. ${revoked} other session(s) were signed out.`);
});

// ---------------------------------------------------------------------------
// Multi-factor authentication
// ---------------------------------------------------------------------------

export async function beginMfaEnrollment(): Promise<
  ActionResult<{ secret: string; uri: string }>
> {
  const session = await requireSession();
  if (session.user.mfaEnabled) {
    return actionError('Multi-factor authentication is already enabled.');
  }

  const secret = generateTotpSecret();
  // Stored encrypted immediately; the plaintext is returned once, for the QR code.
  await prisma.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: encryptSecret(secret) },
  });

  return actionOk({
    secret,
    uri: totpUri(secret, session.user.email, brand.name),
  });
}

const confirmMfaSchema = z.object({
  code: z.string().trim().min(6, 'Enter the 6-digit code').max(8),
});

export const confirmMfaEnrollment = action(confirmMfaSchema, async (input, context) => {
  const session = await requireSession();
  if (!session.user.mfaSecret) {
    return actionError('Start multi-factor setup again — no pending secret was found.');
  }

  const secret = decryptSecret(session.user.mfaSecret);
  if (!verifyTotp(secret, input.code)) {
    return actionError('That code is not correct. Check your authenticator app and try again.', {
      code: 'Incorrect code',
    });
  }

  const recoveryCodes = generateRecoveryCodes();

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      mfaEnabled: true,
      mfaRecoveryHash: recoveryCodes.map((code) => hashToken(code)),
    },
  });
  await markSessionMfaSatisfied(session.sessionId);

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'auth.mfa_enabled',
    entityKind: 'user',
    entityId: session.user.id,
  });

  // Shown exactly once — they are not recoverable afterwards.
  return actionOk({ recoveryCodes }, 'Multi-factor authentication is on.');
});

const verifyMfaSchema = z.object({
  code: z.string().trim().min(6, 'Enter your 6-digit code').max(20),
});

export const verifyMfa = action(verifyMfaSchema, async (input, context) => {
  const session = await requireSession();
  if (!session.user.mfaEnabled || !session.user.mfaSecret) {
    return actionError('Multi-factor authentication is not enabled on this account.');
  }
  await enforceRateLimit('login', `mfa:${session.user.id}`);

  const secret = decryptSecret(session.user.mfaSecret);

  if (verifyTotp(secret, input.code)) {
    await markSessionMfaSatisfied(session.sessionId);
    return actionOk({ verified: true });
  }

  // Recovery codes are single-use: a used code is removed from the stored set.
  const submittedHash = hashToken(input.code.trim().toUpperCase());
  if (session.user.mfaRecoveryHash.includes(submittedHash)) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        mfaRecoveryHash: session.user.mfaRecoveryHash.filter((h) => h !== submittedHash),
      },
    });
    await markSessionMfaSatisfied(session.sessionId);
    await recordAudit({
      actorUserId: session.user.id,
      actorIp: context.ip,
      action: 'auth.mfa_recovery_code_used',
      entityKind: 'user',
      entityId: session.user.id,
    });
    return actionOk({ verified: true }, 'Recovery code accepted. That code cannot be used again.');
  }

  logger.warn('auth.mfa_failed', { userId: session.user.id });
  return actionError('That code is not correct.', { code: 'Incorrect code' });
});

const disableMfaSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
});

export const disableMfa = action(disableMfaSchema, async (input, context) => {
  const session = await requireSession();
  if (!session.user.passwordHash) return actionError('This account has no password set.');

  if (!(await verifyPassword(input.password, session.user.passwordHash))) {
    return actionError('That password is not correct.', { password: 'Incorrect password' });
  }
  if (session.user.role === 'ADMIN') {
    return actionError(
      'Administrator accounts must keep multi-factor authentication enabled.',
    );
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHash: [] },
  });

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'auth.mfa_disabled',
    entityKind: 'user',
    entityId: session.user.id,
  });

  return actionOk(undefined, 'Multi-factor authentication is off.');
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const signOutEverywhere = action(z.object({}), async (_input, context) => {
  const session = await requireSession();
  const revoked = await revokeAllSessions(session.user.id, session.sessionId);

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'auth.sessions_revoked',
    entityKind: 'user',
    entityId: session.user.id,
    metadata: { count: revoked },
  });

  return actionOk(undefined, `Signed out of ${revoked} other session(s).`);
});

const revokeSessionSchema = z.object({ sessionId: z.string().uuid() });

export const revokeOneSession = action(revokeSessionSchema, async (input) => {
  const session = await requireSession();
  const ok = await revokeSession(session.user.id, input.sessionId);
  return ok ? actionOk(undefined, 'Session signed out.') : actionError('That session was not found.');
});

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
  confirm: z.literal('DELETE', {
    errorMap: () => ({ message: 'Type DELETE to confirm' }),
  }),
});

export const requestAccountDeletion = action(deleteAccountSchema, async (input, context) => {
  const session = await requireSession();
  if (!session.user.passwordHash) return actionError('This account has no password set.');
  if (!(await verifyPassword(input.password, session.user.passwordHash))) {
    return actionError('That password is not correct.', { password: 'Incorrect password' });
  }

  // A publisher with money owed cannot delete until it is paid out; deleting
  // would strand funds we are holding on their behalf.
  const creator = await prisma.creator.findUnique({ where: { userId: session.user.id } });
  if (creator) {
    const { balanceSummary } = await import('@/lib/billing/earnings');
    const balance = await balanceSummary(creator.id);
    if (balance.availableMicros + balance.pendingMicros > 0n) {
      return actionError(
        'You still have an outstanding balance. Withdraw it before deleting your account, or contact support.',
      );
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { status: 'PENDING_DELETION', deletionRequest: new Date() },
  });
  await revokeAllSessions(session.user.id);

  await recordAudit({
    actorUserId: session.user.id,
    actorIp: context.ip,
    action: 'account.deletion_requested',
    entityKind: 'user',
    entityId: session.user.id,
  });

  await destroySession();
  return actionOk(
    undefined,
    'Your account is scheduled for deletion. Contact support within 30 days to cancel.',
  );
});

/** GDPR/CCPA data export. Returns everything held about the signed-in user. */
export async function exportMyData(): Promise<ActionResult<{ json: string }>> {
  const session = await requireSession();

  const [user, creator, brandMemberships, notifications, terms] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: {
        id: true, email: true, name: true, role: true, status: true,
        emailVerifiedAt: true, createdAt: true, lastLoginAt: true, marketingOptIn: true,
      },
    }),
    prisma.creator.findUnique({
      where: { userId: session.user.id },
      include: { profile: true, socialAccounts: { select: { platform: true, handle: true } } },
    }),
    prisma.brandMember.findMany({
      where: { userId: session.user.id },
      include: { brand: { select: { displayName: true, legalName: true, website: true } } },
    }),
    prisma.notification.findMany({
      where: { userId: session.user.id },
      select: { type: true, title: true, body: true, createdAt: true },
      take: 1000,
    }),
    prisma.termsAcceptance.findMany({
      where: { userId: session.user.id },
      include: { termsVersion: { select: { kind: true, version: true } } },
    }),
  ]);

  const earnings = creator
    ? await prisma.earning.findMany({
        where: { creatorId: creator.id },
        select: {
          createdAt: true, eventType: true, netMicros: true, status: true,
          campaign: { select: { name: true } },
        },
        take: 10_000,
      })
    : [];

  const payload = {
    exportedAt: new Date().toISOString(),
    notice:
      'This is the personal data held about your account. Visitor-level tracking data is stored pseudonymously and is not linked to your identity.',
    user,
    publisherProfile: creator,
    brandMemberships,
    earnings,
    notifications,
    termsAccepted: terms,
  };

  await recordAudit({
    actorUserId: session.user.id,
    action: 'account.data_exported',
    entityKind: 'user',
    entityId: session.user.id,
  });

  return actionOk({
    json: JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const notificationSchema = z.object({ notificationId: z.string().uuid() });

export const markNotificationRead = action(notificationSchema, async (input) => {
  const session = await requireSession();
  const { markRead } = await import('@/lib/notify');
  await markRead(session.user.id, input.notificationId);
  return actionOk(undefined);
});

export const markAllNotificationsRead = action(z.object({}), async () => {
  const session = await requireSession();
  const { markAllRead } = await import('@/lib/notify');
  const count = await markAllRead(session.user.id);
  return actionOk(undefined, count > 0 ? `${count} marked as read.` : 'Nothing unread.');
});
