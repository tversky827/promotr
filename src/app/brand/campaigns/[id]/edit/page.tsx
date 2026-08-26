import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { CampaignWizard, type CampaignDraft } from '@/components/brand/campaign-wizard';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { formatMicros, microsToDecimalString } from '@/lib/money';
import { getSettings } from '@/lib/settings';

export const metadata: Metadata = { title: 'Edit campaign' };
export const dynamic = 'force-dynamic';

/**
 * Editing an existing campaign.
 *
 * The same wizard as creation, loaded with the campaign's current values. The
 * warning about re-review is shown up front rather than after saving: a brand
 * changing the payout on a live campaign needs to know it will go back into
 * moderation before they change it, not afterwards.
 */
export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { brand } = await pageBrand();
  const { id } = await params;
  const csrfToken = await currentCsrfToken();
  const settings = await getSettings();

  const campaign = await prisma.campaign.findFirst({
    where: { id, brandId: brand.id },
    include: { budget: true, rules: true },
  });
  if (!campaign) notFound();

  if (campaign.status === 'COMPLETED' || campaign.status === 'SUSPENDED') {
    return (
      <>
        <PageHeader title={campaign.name} description="This campaign can no longer be edited." />
        <Alert tone="info" title={`This campaign is ${campaign.status.toLowerCase()}`}>
          Its history stays available, but its terms are fixed — publishers agreed to them, and
          changing them after the fact would rewrite that agreement. Duplicate it into a new
          campaign instead.
        </Alert>
      </>
    );
  }

  const isLive = campaign.status === 'ACTIVE' || campaign.status === 'APPROVED';

  const draft: CampaignDraft = {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    category: campaign.category,
    description: campaign.description,
    offerSummary: campaign.offerSummary,
    destinationUrl: campaign.destinationUrl,
    payoutModel: campaign.payoutModel,
    payoutAmount:
      campaign.payoutMicros > 0n ? microsToDecimalString(campaign.payoutMicros) : '',
    revsharePercent: campaign.revshareBps > 0 ? (campaign.revshareBps / 100).toString() : '',
    attributionWindowDays: (campaign.attributionWindowHours / 24).toString(),
    dedupeWindowHours: (campaign.dedupeWindowMinutes / 60).toString(),
    requiresApproval: campaign.requiresApproval,
    isPublic: campaign.isPublic,
    minAge: campaign.minAge?.toString() ?? '',
    disclosureRequirement: campaign.disclosureRequirement ?? '',
    conversionRules: campaign.conversionRules ?? '',
    allowedCountries: campaign.allowedCountries,
    blockedCountries: campaign.blockedCountries,
    allowedChannels: campaign.allowedChannels,
    prohibitedChannels: campaign.prohibitedChannels,
    prohibitedPresets: campaign.rules
      .filter((rule) => rule.kind === 'PROHIBITED')
      .map((rule) => rule.label),
    totalBudget:
      campaign.budget && campaign.budget.totalBudgetMicros > 0n
        ? microsToDecimalString(campaign.budget.totalBudgetMicros)
        : '',
    dailyCap: campaign.budget?.dailyCapMicros
      ? microsToDecimalString(campaign.budget.dailyCapMicros)
      : '',
    startsAt: campaign.startsAt?.toISOString().slice(0, 10) ?? '',
    endsAt: campaign.endsAt?.toISOString().slice(0, 10) ?? '',
    termsBody: campaign.termsBody,
  };

  return (
    <>
      <PageHeader
        title={`Edit ${campaign.name}`}
        description="Publishers keep the terms they accepted. Changing the terms here bumps the version for new links."
      />

      {isLive ? (
        <Alert tone="warning" title="Changing the payout or destination sends this back to review" className="mb-6">
          A live campaign whose economics or destination change is re-moderated before it runs
          again — otherwise approval could be bypassed by editing after the fact. Everything else
          saves immediately and the campaign keeps running.
        </Alert>
      ) : null}

      <CampaignWizard
        csrfToken={csrfToken}
        initial={draft}
        brandName={brand.displayName}
        platformFeeBps={brand.defaultFeeBps ?? settings.platformFeeBps}
        minFundingLabel={formatMicros(BigInt(settings.minCampaignFundingMicros), {
          showSubCent: false,
        })}
      />
    </>
  );
}
