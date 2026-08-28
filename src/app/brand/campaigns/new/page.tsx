import type { Metadata } from 'next';

import { CampaignWizard } from '@/components/brand/campaign-wizard';
import { PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageBrand } from '@/lib/auth/guards';
import { formatMicros } from '@/lib/money';
import { getSettings } from '@/lib/settings';

export const metadata: Metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  const { brand } = await pageBrand();
  const csrfToken = await currentCsrfToken();
  const settings = await getSettings();

  // The brand's negotiated rate takes precedence over the platform default.
  const feeBps = brand.defaultFeeBps ?? settings.platformFeeBps;

  return (
    <>
      <PageHeader
        title="Create a campaign"
        description={
          brand.isDemo
            ? 'Set what you pay for and who can promote it. It is funded from your account balance and goes live when you launch.'
            : 'Set what you pay for and who can promote it. You fund and launch on the next screen.'
        }
      />
      <CampaignWizard
        csrfToken={csrfToken}
        brandName={brand.displayName}
        platformFeeBps={feeBps}
        minFundingLabel={formatMicros(BigInt(settings.minCampaignFundingMicros), {
          showSubCent: false,
        })}
        canLaunch={brand.isDemo}
      />
    </>
  );
}
