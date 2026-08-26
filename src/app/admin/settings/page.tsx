import type { Metadata } from 'next';

import { SettingsEditor } from '@/components/admin/settings-editor';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { DEFAULT_SETTINGS, getSettings, SETTING_DESCRIPTIONS } from '@/lib/settings';

export const metadata: Metadata = { title: 'Platform settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings groups. Order and grouping are deliberate: money first, because a
 * mistyped fee is the most consequential change on this page.
 */
const GROUPS: Array<{ title: string; description: string; keys: Array<keyof typeof DEFAULT_SETTINGS> }> = [
  {
    title: 'Commission and payouts',
    description: 'What the platform takes, and when publishers can withdraw.',
    keys: [
      'platformFeeBps',
      'platformFeeFlatMicros',
      'minimumPayoutMicros',
      'earningHoldDays',
      'payoutAutoApproveUnderMicros',
      'payoutScheduleCron',
    ],
  },
  {
    title: 'Traffic quality',
    description:
      'Score thresholds for the fraud engine. Raising them makes the platform more permissive.',
    keys: [
      'fraudReviewThreshold',
      'fraudSuspiciousThreshold',
      'fraudRejectThreshold',
      'fraudAutoHoldEnabled',
    ],
  },
  {
    title: 'Conversions',
    description: 'How long a conversion stays pending before it clears automatically.',
    keys: ['conversionAutoApproveEnabled', 'conversionAutoApproveDays'],
  },
  {
    title: 'Campaign moderation',
    description: 'What gets reviewed by a human and what is never accepted.',
    keys: [
      'campaignAutoApproveEnabled',
      'campaignModerationScoreThreshold',
      'prohibitedCategories',
      'prohibitedKeywords',
    ],
  },
  {
    title: 'Verification requirements',
    description: 'Gates before money can move.',
    keys: [
      'brandVerificationRequiredToLaunch',
      'creatorVerificationRequiredForPayout',
      'creatorTaxFormRequiredForPayout',
    ],
  },
  {
    title: 'Limits',
    description: 'Guard rails on account behaviour.',
    keys: ['maxActiveCampaignsPerBrand', 'maxLinksPerCreatorPerCampaign', 'minCampaignFundingMicros'],
  },
  {
    title: 'Markets',
    description: 'Where the platform operates.',
    keys: ['supportedCurrencies', 'supportedCountries'],
  },
  {
    title: 'Notifications',
    description: 'Which events generate email.',
    keys: ['notifyBrandOnConversion', 'notifyCreatorOnEarning', 'budgetLowNotifyBps'],
  },
];

export default async function AdminSettingsPage() {
  await pageAdmin();
  const csrfToken = await currentCsrfToken();
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="Platform settings"
        description="Operator-configurable behaviour. Changes take effect within 30 seconds across all instances and are recorded in the audit log."
      />

      <div className="space-y-4">
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} description={group.description} />
            <div className="mt-5 space-y-4">
              {group.keys.map((key) => (
                <SettingsEditor
                  key={key}
                  settingKey={key}
                  label={key}
                  description={SETTING_DESCRIPTIONS[key]}
                  value={serialise(settings[key])}
                  kind={kindOf(DEFAULT_SETTINGS[key])}
                  csrfToken={csrfToken}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-xs text-fg-subtle text-pretty">
        Values ending in <code className="font-mono">Micros</code> are in millionths of a currency
        unit — 25000000 is $25.00. Money is stored this way so that sub-cent pricing, such as a
        quarter-cent per click, is exact rather than rounded on every event. Values ending in{' '}
        <code className="font-mono">Bps</code> are basis points — 2000 is 20%.
      </p>
    </>
  );
}

function serialise(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function kindOf(value: unknown): 'boolean' | 'number' | 'list' | 'text' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  return 'text';
}
