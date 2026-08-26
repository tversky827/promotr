import { redirect } from 'next/navigation';

import { getSession, type SessionContext } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { AuthenticationError, AuthorizationError, can, type Permission } from '@/lib/rbac';

import type { Brand, Creator, User } from '@prisma/client';

/**
 * Authorization guards.
 *
 * Every guard resolves scope from the database using the *session's* identity,
 * never from a client-supplied id. A brand id in a URL is only ever used as a
 * filter against the memberships the session already proves — which is what
 * stops one brand reading another brand's data.
 */

export interface BrandContext extends SessionContext {
  brand: Brand;
  membershipRole: User['role'];
}

export interface CreatorContext extends SessionContext {
  creator: Creator;
}

/** Throwing variants, for server actions and route handlers. */

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new AuthenticationError();
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.user.role, permission)) {
    throw new AuthorizationError();
  }
  // Administrators must have completed MFA in this session before any
  // privileged action, not merely have MFA enabled on the account.
  if (permission.startsWith('admin:') && session.user.mfaEnabled && !session.mfaSatisfied) {
    throw new AuthorizationError('Multi-factor authentication is required for this action');
  }
  return session;
}

export async function requireAdmin(permission: Permission = 'admin:system:read') {
  const session = await requirePermission(permission);
  if (session.user.role !== 'ADMIN') throw new AuthorizationError();
  return session;
}

/**
 * Resolve the brand the session acts for. When `brandId` is supplied it is
 * checked against the session's memberships; a non-member gets 403, never data.
 */
export async function requireBrand(
  permission: Permission = 'brand:read',
  brandId?: string,
): Promise<BrandContext> {
  const session = await requireSession();

  if (session.user.role === 'ADMIN') {
    // An admin acting on a specific brand must name it explicitly.
    if (!brandId) throw new AuthorizationError('A brand must be specified');
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new AuthorizationError('Brand not found');
    return { ...session, brand, membershipRole: 'BRAND_OWNER' };
  }

  if (!can(session.user.role, permission)) throw new AuthorizationError();

  const membership = await prisma.brandMember.findFirst({
    where: { userId: session.user.id, ...(brandId ? { brandId } : {}) },
    include: { brand: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) throw new AuthorizationError('You are not a member of this brand');
  if (!can(membership.role, permission)) throw new AuthorizationError();

  if (membership.brand.verification === 'SUSPENDED') {
    throw new AuthorizationError('This brand account is suspended');
  }

  return { ...session, brand: membership.brand, membershipRole: membership.role };
}

export async function requireCreator(
  permission: Permission = 'creator:read',
): Promise<CreatorContext> {
  const session = await requireSession();
  if (!can(session.user.role, permission)) throw new AuthorizationError();

  const creator = await prisma.creator.findUnique({ where: { userId: session.user.id } });
  if (!creator) throw new AuthorizationError('No publisher profile exists for this account');
  if (creator.verification === 'SUSPENDED') {
    throw new AuthorizationError('This publisher account is suspended');
  }
  return { ...session, creator };
}

/** Redirecting variants, for page components. */

export async function pageSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function pageBrand(brandId?: string): Promise<BrandContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  try {
    return await requireBrand('brand:read', brandId);
  } catch {
    // A signed-in user with no brand is mid-onboarding, not unauthorized.
    if (session.user.role === 'CREATOR') redirect('/creator');
    redirect('/onboarding/brand');
  }
}

export async function pageCreator(): Promise<CreatorContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  try {
    return await requireCreator();
  } catch {
    if (session.user.role === 'BRAND_OWNER' || session.user.role === 'BRAND_MEMBER') {
      redirect('/brand');
    }
    redirect('/onboarding/creator');
  }
}

export async function pageAdmin(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/');
  if (session.user.mfaEnabled && !session.mfaSatisfied) redirect('/login/mfa');
  return session;
}

/** Where a user lands after signing in. */
export function homePathFor(role: User['role']): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'BRAND_OWNER':
    case 'BRAND_MEMBER':
      return '/brand';
    case 'CREATOR':
    default:
      return '/creator';
  }
}
