import type { UserRole } from '@prisma/client';

/**
 * Role-based permissions.
 *
 * Permissions are named capabilities rather than role checks scattered through
 * the code, so "what can a brand member do?" has exactly one answer, here, and
 * adding a role is a table edit rather than an audit of every call site.
 */

export const PERMISSIONS = [
  // Brand surface
  'brand:read',
  'brand:update',
  'brand:members:manage',
  'brand:billing:manage',
  'campaign:create',
  'campaign:update',
  'campaign:delete',
  'campaign:launch',
  'campaign:fund',
  'campaign:pause',
  'campaign:read',
  'campaign:applications:decide',
  'brand:analytics:read',
  'brand:export',
  'brand:apikeys:manage',
  'brand:webhooks:manage',
  'brand:dispute:create',
  'brand:creators:discover',

  // Publisher surface
  'creator:read',
  'creator:update',
  'creator:links:create',
  'creator:earnings:read',
  'creator:payout:request',
  'creator:payout:settings',
  'creator:export',
  'creator:dispute:create',

  // Marketplace
  'marketplace:browse',

  // Administration
  'admin:users:read',
  'admin:users:manage',
  'admin:brands:manage',
  'admin:creators:manage',
  'admin:campaigns:moderate',
  'admin:fraud:review',
  'admin:disputes:manage',
  'admin:ledger:adjust',
  'admin:payouts:manage',
  'admin:refunds:issue',
  'admin:settings:manage',
  'admin:audit:read',
  'admin:reports:read',
  'admin:system:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BRAND_MEMBER_PERMISSIONS: Permission[] = [
  'brand:read',
  'campaign:create',
  'campaign:update',
  'campaign:read',
  'campaign:pause',
  'campaign:applications:decide',
  'brand:analytics:read',
  'brand:export',
  'brand:dispute:create',
  'brand:creators:discover',
  'marketplace:browse',
];

/**
 * A brand owner is a superset of a member, plus everything that spends money or
 * changes the account. Members deliberately cannot fund campaigns, manage
 * billing, delete campaigns, or mint API keys.
 */
const BRAND_OWNER_PERMISSIONS: Permission[] = [
  ...BRAND_MEMBER_PERMISSIONS,
  'brand:update',
  'brand:members:manage',
  'brand:billing:manage',
  'campaign:delete',
  'campaign:launch',
  'campaign:fund',
  'brand:apikeys:manage',
  'brand:webhooks:manage',
];

const CREATOR_PERMISSIONS: Permission[] = [
  'creator:read',
  'creator:update',
  'creator:links:create',
  'creator:earnings:read',
  'creator:payout:request',
  'creator:payout:settings',
  'creator:export',
  'creator:dispute:create',
  'marketplace:browse',
];

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  BRAND_OWNER: BRAND_OWNER_PERMISSIONS,
  BRAND_MEMBER: BRAND_MEMBER_PERMISSIONS,
  CREATOR: CREATOR_PERMISSIONS,
};

const ROLE_PERMISSION_SETS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(ROLE_PERMISSIONS.ADMIN),
  BRAND_OWNER: new Set(ROLE_PERMISSIONS.BRAND_OWNER),
  BRAND_MEMBER: new Set(ROLE_PERMISSIONS.BRAND_MEMBER),
  CREATOR: new Set(ROLE_PERMISSIONS.CREATOR),
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSION_SETS[role].has(permission);
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function isBrandRole(role: UserRole): boolean {
  return role === 'BRAND_OWNER' || role === 'BRAND_MEMBER';
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have permission to perform this action') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}
