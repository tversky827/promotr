import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ModerationPanel } from '@/components/admin/moderation-panel';
import {
  Alert,
  Badge,
  Breadcrumb,
  Card,
  CardHeader,
  DescriptionList,
  Field,
  PageHeader,
} from '@/components/ui/primitives';
import { Stat, StatGrid } from '@/components/ui/stat';
import { currentCsrfToken } from '@/lib/auth/csrf';
import { pageAdmin } from '@/lib/auth/guards';
import { availableMicros } from '@/lib/billing/budget';
import { prisma } from '@/lib/db';
import {
  countryName,
  describePayout,
  formatDateTime,
  formatNumber,
  humanize,
  statusTone,
} from '@/lib/format';
import { formatMicros } from '@/lib/money';

export const metadata: Metadata = { title: 'Campaign review' };
export const dynamic = 'force-dynamic';

export default async function AdminCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageAdmin();
  const csrfToken = await currentCsrfToken();

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      brand: true,
      budget: true,
      rules: true,
      _count: { select: { links: true, conversions: true, earnings: true } },
    },
  });
  if (!campaign) notFound();

  const [clicks, spend] = await Promise.all([
    prisma.click.count({ where: { campaignId: campaign.id } }),
    prisma.earning.aggregate({
      where: { campaignId: campaign.id, status: { notIn: ['REJECTED', 'REVERSED'] } },
      _sum: { grossMicros: true, feeMicros: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Campaigns', href: '/admin/campaigns' }, { label: campaign.name }]}
          />
        }
        title={campaign.name}
        description={campaign.offerSummary}
        action={<Badge tone={statusTone(campaign.status)}>{humanize(campaign.status)}</Badge>}
      />

      <StatGrid columns={4} className="mb-6">
        <Stat label="Clicks" value={formatNumber(clicks)} />
        <Stat label="Conversions" value={formatNumber(campaign._count.conversions)} />
        <Stat
          label="Brand spend"
          value={formatMicros(spend._sum.grossMicros ?? 0n, { showSubCent: false })}
        />
        <Stat
          label="Platform fees"
          value={formatMicros(spend._sum.feeMicros ?? 0n, { showSubCent: false })}
          tone="primary"
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {campaign.moderationFlags.length > 0 ? (
            <Alert
              tone={
                (campaign.moderationScore ?? 0) >= 60
                  ? 'danger'
                  : (campaign.moderationScore ?? 0) >= 30
                    ? 'warning'
                    : 'info'
              }
              title={`Automated moderation score: ${campaign.moderationScore ?? 0}`}
            >
              <div className="mt-1 whitespace-pre-wrap text-sm">{campaign.moderationNotes}</div>
            </Alert>
          ) : null}

          <Card>
            <CardHeader title="Destination" />
            <div className="mt-3">
              <a
                href={campaign.destinationUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all font-mono text-sm text-primary hover:underline"
              >
                {campaign.destinationUrl}
              </a>
              <p className="mt-2 text-xs text-fg-subtle text-pretty">
                Open in a new tab to review before approving. The link carries `nofollow` and
                `noopener` so reviewing it passes nothing to the advertiser.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Campaign content" />
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Description
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted text-pretty">
                  {campaign.description}
                </p>
              </div>
              {campaign.conversionRules ? (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Conversion rules
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted text-pretty">
                    {campaign.conversionRules}
                  </p>
                </div>
              ) : null}
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Terms (v{campaign.termsVersion})
                </h3>
                <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-sunken/50 p-3 text-sm text-fg-muted">
                  {campaign.termsBody}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Configuration" />
            <DescriptionList columns={2} className="mt-4">
              <Field label="Publisher payout">{describePayout(campaign)}</Field>
              <Field label="Category">{humanize(campaign.category)}</Field>
              <Field label="Attribution window">
                {Math.round(campaign.attributionWindowHours / 24)} days
              </Field>
              <Field label="Access">
                {campaign.requiresApproval ? 'Approval required' : 'Open'}
              </Field>
              <Field label="Countries">
                {campaign.allowedCountries.length > 0
                  ? campaign.allowedCountries.map(countryName).join(', ')
                  : 'Worldwide'}
              </Field>
              <Field label="Publishers with links">{formatNumber(campaign._count.links)}</Field>
            </DescriptionList>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <ModerationPanel
            campaignId={campaign.id}
            status={campaign.status}
            csrfToken={csrfToken}
          />

          <Card>
            <CardHeader title="Advertiser" />
            <DescriptionList columns={1} className="mt-4">
              <Field label="Business">
                <Link
                  href={`/admin/brands/${campaign.brand.id}`}
                  className="text-primary hover:underline"
                >
                  {campaign.brand.legalName}
                </Link>
              </Field>
              <Field label="Verification">
                <Badge tone={statusTone(campaign.brand.verification)}>
                  {humanize(campaign.brand.verification)}
                </Badge>
              </Field>
              <Field label="Website">
                <a
                  href={campaign.brand.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all text-sm text-primary hover:underline"
                >
                  {campaign.brand.website}
                </a>
              </Field>
              <Field label="On platform since">{formatDateTime(campaign.brand.createdAt)}</Field>
            </DescriptionList>
          </Card>

          <Card>
            <CardHeader title="Budget" />
            <DescriptionList columns={1} className="mt-4">
              <Field label="Funded">
                {formatMicros(campaign.budget?.fundedMicros ?? 0n, { showSubCent: false })}
              </Field>
              <Field label="Available">
                {formatMicros(campaign.budget ? availableMicros(campaign.budget) : 0n, {
                  showSubCent: false,
                })}
              </Field>
              <Field label="Committed">
                {formatMicros(campaign.budget?.reservedMicros ?? 0n, { showSubCent: false })}
              </Field>
              <Field label="Settled spend">
                {formatMicros(campaign.budget?.spentMicros ?? 0n, { showSubCent: false })}
              </Field>
            </DescriptionList>
          </Card>
        </div>
      </div>
    </>
  );
}
