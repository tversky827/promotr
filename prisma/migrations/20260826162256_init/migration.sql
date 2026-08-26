-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BRAND_OWNER', 'BRAND_MEMBER', 'CREATOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'RESTRICTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MAGIC_LINK', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PayoutModel" AS ENUM ('CPC', 'CPL', 'CPA', 'CPM', 'REVSHARE', 'HYBRID');

-- CreateEnum
CREATE TYPE "BillableEvent" AS ENUM ('CLICK', 'IMPRESSION', 'LEAD', 'SALE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'FACEBOOK', 'LINKEDIN', 'REDDIT', 'PINTEREST', 'SNAPCHAT', 'TWITCH', 'WEBSITE', 'BLOG', 'NEWSLETTER', 'PODCAST', 'COMMUNITY', 'APP', 'PAID_SEARCH', 'PAID_SOCIAL', 'DISPLAY', 'NATIVE_ADS', 'SMS', 'EMAIL_LIST', 'OTHER');

-- CreateEnum
CREATE TYPE "ClickEligibility" AS ENUM ('ELIGIBLE', 'DUPLICATE', 'REVIEW', 'REJECTED', 'BUDGET_EXHAUSTED', 'CAMPAIGN_INACTIVE', 'GEO_BLOCKED', 'CHANNEL_BLOCKED', 'SUSPENDED_PUBLISHER');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'APPROVED', 'AVAILABLE', 'REJECTED', 'UNDER_REVIEW', 'REVERSED', 'PAID');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'UNDER_REVIEW', 'REVERSED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('BRAND_DEPOSIT', 'CAMPAIGN_ESCROW', 'PUBLISHER_PENDING', 'PUBLISHER_AVAILABLE', 'PUBLISHER_PAID', 'PLATFORM_REVENUE', 'PAYOUT_CLEARING', 'EXTERNAL_SETTLEMENT', 'ROUNDING');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('BRAND_DEPOSIT', 'CAMPAIGN_FUND', 'CAMPAIGN_DEFUND', 'EARNING_ACCRUAL', 'EARNING_APPROVAL', 'EARNING_REVERSAL', 'PLATFORM_FEE', 'PAYOUT_INITIATED', 'PAYOUT_SETTLED', 'PAYOUT_FAILED', 'REFUND', 'CHARGEBACK', 'MANUAL_ADJUSTMENT', 'FRAUD_HOLD', 'FRAUD_RELEASE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'AWAITING_INFORMATION', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeKind" AS ENUM ('FRAUDULENT_CLICKS', 'FRAUDULENT_CONVERSIONS', 'DUPLICATE_CONVERSION', 'INVALID_TRAFFIC', 'REJECTED_EARNING', 'PAYOUT_DECISION', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeOpenedBy" AS ENUM ('BRAND', 'PUBLISHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CreativeKind" AS ENUM ('IMAGE', 'VIDEO', 'LOGO', 'COPY', 'HEADLINE', 'DESCRIPTION', 'CLAIM');

-- CreateEnum
CREATE TYPE "CreativeUsage" AS ENUM ('REQUIRED', 'APPROVED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "TermsKind" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'COOKIE_POLICY', 'CREATOR_AGREEMENT', 'BRAND_AGREEMENT', 'ACCEPTABLE_USE', 'CAMPAIGN_TERMS');

-- CreateEnum
CREATE TYPE "FraudSignalSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaRecoveryHash" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "deletionRequest" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecretHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "payload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "taxId" TEXT,
    "logoUrl" TEXT,
    "description" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationNotes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "defaultFeeBps" INTEGER,
    "autoRefillEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRefillThreshMicros" BIGINT,
    "autoRefillAmountMicros" BIGINT,
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_members" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_payment_methods" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brandLabel" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_deposits" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL,
    "failureMessage" TEXT,
    "refundedMicros" BIGINT NOT NULL DEFAULT 0,
    "campaignId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_domains" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creators" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "publisherType" TEXT NOT NULL DEFAULT 'CREATOR',
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationNotes" TEXT,
    "country" TEXT,
    "taxFormKind" TEXT,
    "taxFormStatus" TEXT,
    "taxFormSubmittedAt" TIMESTAMP(3),
    "stripeAccountId" TEXT,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeRequirementsDue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payoutHold" BOOLEAN NOT NULL DEFAULT false,
    "payoutHoldReason" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "suspendedReason" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "feeBpsOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_profiles" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "website" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" "ChannelType"[] DEFAULT ARRAY[]::"ChannelType"[],
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "searchVector" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "platform" "ChannelType" NOT NULL,
    "handle" TEXT NOT NULL,
    "profileUrl" TEXT,
    "followers" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpires" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "offerSummary" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "payoutModel" "PayoutModel" NOT NULL,
    "payoutMicros" BIGINT NOT NULL DEFAULT 0,
    "revshareBps" INTEGER NOT NULL DEFAULT 0,
    "platformFeeBps" INTEGER,
    "platformFeeFlatMicros" BIGINT NOT NULL DEFAULT 0,
    "attributionWindowHours" INTEGER NOT NULL DEFAULT 720,
    "cookieDurationHours" INTEGER NOT NULL DEFAULT 720,
    "dedupeWindowMinutes" INTEGER NOT NULL DEFAULT 1440,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "minAge" INTEGER,
    "disclosureRequirement" TEXT,
    "allowedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedChannels" "ChannelType"[] DEFAULT ARRAY[]::"ChannelType"[],
    "prohibitedChannels" "ChannelType"[] DEFAULT ARRAY[]::"ChannelType"[],
    "conversionRules" TEXT,
    "termsBody" TEXT NOT NULL,
    "termsVersion" INTEGER NOT NULL DEFAULT 1,
    "moderationScore" INTEGER,
    "moderationFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moderationNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_rules" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_creatives" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "kind" "CreativeKind" NOT NULL,
    "usage" "CreativeUsage" NOT NULL DEFAULT 'OPTIONAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "assetUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_budgets" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "totalBudgetMicros" BIGINT NOT NULL DEFAULT 0,
    "fundedMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "dailyCapMicros" BIGINT,
    "lowBalanceBps" INTEGER NOT NULL DEFAULT 1500,
    "lowBalanceNotifiedAt" TIMESTAMP(3),
    "exhaustedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_applications" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_invitations" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "message" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "label" TEXT,
    "subId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "channel" "ChannelType",
    "destinationOverride" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "termsVersion" INTEGER NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "clickCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "ipHash" TEXT NOT NULL,
    "ipPrefixHash" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "referrerHost" TEXT,
    "referrerUrl" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "subId" TEXT,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "fraudSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibility" "ClickEligibility" NOT NULL DEFAULT 'ELIGIBLE',
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "earningId" UUID,
    "sessionFp" TEXT NOT NULL,
    "latencyMs" INTEGER,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id","createdAt")
) PARTITION BY RANGE ("createdAt");

-- CreateTable
CREATE TABLE "impressions" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "ipHash" TEXT NOT NULL,
    "country" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "sessionFp" TEXT NOT NULL,

    CONSTRAINT "impressions_pkey" PRIMARY KEY ("id","createdAt")
) PARTITION BY RANGE ("createdAt");

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "linkId" UUID,
    "clickId" UUID,
    "clickAt" TIMESTAMP(3),
    "externalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" "BillableEvent" NOT NULL,
    "revenueMicros" BIGINT NOT NULL DEFAULT 0,
    "payoutMicros" BIGINT NOT NULL DEFAULT 0,
    "feeMicros" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "fraudSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "conversionId" UUID,
    "clickId" UUID,
    "eventType" "BillableEvent" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossMicros" BIGINT NOT NULL,
    "feeMicros" BIGINT NOT NULL,
    "netMicros" BIGINT NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payoutId" UUID,
    "approvedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "balanceMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actorUserId" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" TEXT NOT NULL DEFAULT 'stripe_connect',
    "stripeTransferId" TEXT,
    "stripePayoutId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "holdReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_events" (
    "id" UUID NOT NULL,
    "creatorId" UUID,
    "campaignId" UUID,
    "clickId" UUID,
    "conversionId" UUID,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "entityKind" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "severity" "FraudSignalSeverity" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "openedBy" "DisputeOpenedBy" NOT NULL,
    "openedByUserId" UUID NOT NULL,
    "brandId" UUID,
    "creatorId" UUID,
    "campaignId" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL DEFAULT 0,
    "targetKind" TEXT,
    "targetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorIpHash" TEXT,
    "action" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_versions" (
    "id" UUID NOT NULL,
    "kind" "TermsKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_acceptances" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "termsVersionId" UUID NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stat_hourly" (
    "id" UUID NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorId" UUID,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "qualifiedClicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "grossMicros" BIGINT NOT NULL DEFAULT 0,
    "netMicros" BIGINT NOT NULL DEFAULT 0,
    "feeMicros" BIGINT NOT NULL DEFAULT 0,
    "revenueMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stat_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeId" TEXT,
    "filters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "rowCount" INTEGER,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailNormalized_key" ON "users"("emailNormalized");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_tokenHash_key" ON "email_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_tokens_userId_purpose_idx" ON "email_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerUserId_key" ON "oauth_accounts"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_stripeCustomerId_key" ON "brands"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "brands_verification_idx" ON "brands"("verification");

-- CreateIndex
CREATE INDEX "brand_members_userId_idx" ON "brand_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_members_brandId_userId_key" ON "brand_members"("brandId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_payment_methods_stripePaymentMethodId_key" ON "brand_payment_methods"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "brand_payment_methods_brandId_idx" ON "brand_payment_methods"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_deposits_stripePaymentIntentId_key" ON "brand_deposits"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "brand_deposits_brandId_createdAt_idx" ON "brand_deposits"("brandId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "verified_domains_brandId_domain_key" ON "verified_domains"("brandId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "creators_userId_key" ON "creators"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "creators_handle_key" ON "creators"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "creators_stripeAccountId_key" ON "creators"("stripeAccountId");

-- CreateIndex
CREATE INDEX "creators_verification_idx" ON "creators"("verification");

-- CreateIndex
CREATE UNIQUE INDEX "creator_profiles_creatorId_key" ON "creator_profiles"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_creatorId_platform_handle_key" ON "social_accounts"("creatorId", "platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_status_isPublic_idx" ON "campaigns"("status", "isPublic");

-- CreateIndex
CREATE INDEX "campaigns_brandId_status_idx" ON "campaigns"("brandId", "status");

-- CreateIndex
CREATE INDEX "campaigns_category_idx" ON "campaigns"("category");

-- CreateIndex
CREATE INDEX "campaigns_payoutModel_idx" ON "campaigns"("payoutModel");

-- CreateIndex
CREATE INDEX "campaign_rules_campaignId_idx" ON "campaign_rules"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_creatives_campaignId_idx" ON "campaign_creatives"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_budgets_campaignId_key" ON "campaign_budgets"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_applications_creatorId_status_idx" ON "campaign_applications"("creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_applications_campaignId_creatorId_key" ON "campaign_applications"("campaignId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invitations_campaignId_creatorId_key" ON "campaign_invitations"("campaignId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_code_key" ON "tracking_links"("code");

-- CreateIndex
CREATE INDEX "tracking_links_campaignId_creatorId_idx" ON "tracking_links"("campaignId", "creatorId");

-- CreateIndex
CREATE INDEX "tracking_links_creatorId_createdAt_idx" ON "tracking_links"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_campaignId_createdAt_idx" ON "clicks"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_creatorId_createdAt_idx" ON "clicks"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_linkId_createdAt_idx" ON "clicks"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_ipPrefixHash_createdAt_idx" ON "clicks"("ipPrefixHash", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_sessionFp_createdAt_idx" ON "clicks"("sessionFp", "createdAt");

-- CreateIndex
CREATE INDEX "clicks_eligibility_createdAt_idx" ON "clicks"("eligibility", "createdAt");

-- CreateIndex
CREATE INDEX "impressions_campaignId_createdAt_idx" ON "impressions"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "impressions_creatorId_createdAt_idx" ON "impressions"("creatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_idempotencyKey_key" ON "conversions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "conversions_creatorId_createdAt_idx" ON "conversions"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "conversions_campaignId_createdAt_idx" ON "conversions"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "conversions_status_idx" ON "conversions"("status");

-- CreateIndex
CREATE INDEX "conversions_clickId_idx" ON "conversions"("clickId");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_campaignId_externalId_key" ON "conversions"("campaignId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_idempotencyKey_key" ON "earnings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "earnings_creatorId_status_idx" ON "earnings"("creatorId", "status");

-- CreateIndex
CREATE INDEX "earnings_campaignId_createdAt_idx" ON "earnings"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "earnings_creatorId_createdAt_idx" ON "earnings"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "earnings_status_availableAt_idx" ON "earnings"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ledger_accounts_ownerKind_ownerId_idx" ON "ledger_accounts"("ownerKind", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_type_ownerKind_ownerId_currency_key" ON "ledger_accounts"("type", "ownerKind", "ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transactions_kind_createdAt_idx" ON "ledger_transactions"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_stripeTransferId_key" ON "payouts"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payouts_creatorId_status_idx" ON "payouts"("creatorId", "status");

-- CreateIndex
CREATE INDEX "payouts_status_requestedAt_idx" ON "payouts"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "fraud_events_createdAt_idx" ON "fraud_events"("createdAt");

-- CreateIndex
CREATE INDEX "fraud_events_creatorId_createdAt_idx" ON "fraud_events"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_events_resolution_idx" ON "fraud_events"("resolution");

-- CreateIndex
CREATE INDEX "fraud_events_band_createdAt_idx" ON "fraud_events"("band", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_reference_key" ON "disputes"("reference");

-- CreateIndex
CREATE INDEX "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_brandId_idx" ON "disputes"("brandId");

-- CreateIndex
CREATE INDEX "disputes_creatorId_idx" ON "disputes"("creatorId");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_endpoints_brandId_idx" ON "webhook_endpoints"("brandId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx" ON "webhook_deliveries"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_brandId_idx" ON "api_keys"("brandId");

-- CreateIndex
CREATE INDEX "audit_logs_entityKind_entityId_idx" ON "audit_logs"("entityKind", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "terms_versions_kind_version_key" ON "terms_versions"("kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "terms_acceptances_userId_termsVersionId_key" ON "terms_acceptances"("userId", "termsVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotencyKey_key" ON "jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "jobs_queue_status_runAt_idx" ON "jobs"("queue", "status", "runAt");

-- CreateIndex
CREATE INDEX "stat_hourly_campaignId_bucket_idx" ON "stat_hourly"("campaignId", "bucket");

-- CreateIndex
CREATE INDEX "stat_hourly_creatorId_bucket_idx" ON "stat_hourly"("creatorId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "stat_hourly_bucket_campaignId_creatorId_key" ON "stat_hourly"("bucket", "campaignId", "creatorId");

-- CreateIndex
CREATE INDEX "export_jobs_userId_createdAt_idx" ON "export_jobs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "stripe_events_type_processedAt_idx" ON "stripe_events"("type", "processedAt");

-- CreateIndex
CREATE INDEX "idempotency_records_createdAt_idx" ON "idempotency_records"("createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_payment_methods" ADD CONSTRAINT "brand_payment_methods_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_deposits" ADD CONSTRAINT "brand_deposits_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_deposits" ADD CONSTRAINT "brand_deposits_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_domains" ADD CONSTRAINT "verified_domains_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creators" ADD CONSTRAINT "creators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_creatives" ADD CONSTRAINT "campaign_creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_budgets" ADD CONSTRAINT "campaign_budgets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_applications" ADD CONSTRAINT "campaign_applications_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_applications" ADD CONSTRAINT "campaign_applications_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitations" ADD CONSTRAINT "campaign_invitations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitations" ADD CONSTRAINT "campaign_invitations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitations" ADD CONSTRAINT "campaign_invitations_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "conversions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_events" ADD CONSTRAINT "fraud_events_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_hourly" ADD CONSTRAINT "stat_hourly_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
