'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox, Input, RadioCard, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader, Separator } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import {
  CAMPAIGN_CATEGORIES,
  CAMPAIGN_OBJECTIVES,
  CHANNELS,
  COUNTRIES,
  PAYOUT_MODELS,
  PROHIBITED_PRESETS,
} from '@/lib/taxonomy';
import { createCampaign, updateCampaign } from '@/server/actions/campaigns';
import { launchDemoCampaign } from '@/server/actions/demo';

/**
 * Campaign wizard.
 *
 * Eight steps, but only three are required to reach a launchable campaign —
 * basics, compensation, and budget. Everything else has a working default, so a
 * brand that wants a simple CPC campaign is not forced through targeting rules
 * they do not need. The step rail shows what is complete and lets them jump.
 *
 * All state lives in this component and is submitted once at the end, so a
 * half-finished campaign never hits the database.
 */

export interface CampaignDraft {
  id?: string;
  name: string;
  objective: string;
  category: string;
  description: string;
  offerSummary: string;
  destinationUrl: string;
  payoutModel: string;
  payoutAmount: string;
  revsharePercent: string;
  attributionWindowDays: string;
  dedupeWindowHours: string;
  requiresApproval: boolean;
  isPublic: boolean;
  minAge: string;
  disclosureRequirement: string;
  conversionRules: string;
  allowedCountries: string[];
  blockedCountries: string[];
  allowedChannels: string[];
  prohibitedChannels: string[];
  prohibitedPresets: string[];
  totalBudget: string;
  dailyCap: string;
  startsAt: string;
  endsAt: string;
  termsBody: string;
}

export const EMPTY_DRAFT: CampaignDraft = {
  name: '',
  objective: 'traffic',
  category: '',
  description: '',
  offerSummary: '',
  destinationUrl: '',
  payoutModel: 'CPC',
  payoutAmount: '',
  revsharePercent: '',
  attributionWindowDays: '30',
  dedupeWindowHours: '24',
  requiresApproval: false,
  isPublic: true,
  minAge: '',
  disclosureRequirement: '',
  conversionRules: '',
  allowedCountries: [],
  blockedCountries: [],
  allowedChannels: [],
  prohibitedChannels: [],
  prohibitedPresets: ['spam', 'misleading', 'incentivised', 'cookie-stuffing'],
  totalBudget: '',
  dailyCap: '',
  startsAt: '',
  endsAt: '',
  termsBody: '',
};

const STEPS = [
  { id: 'basics', title: 'Basics', hint: 'Name and objective' },
  { id: 'destination', title: 'Destination', hint: 'Where traffic goes' },
  { id: 'compensation', title: 'Compensation', hint: 'What publishers earn' },
  { id: 'targeting', title: 'Targeting', hint: 'Countries and channels' },
  { id: 'rules', title: 'Traffic rules', hint: 'What is not allowed' },
  { id: 'budget', title: 'Budget', hint: 'How much to spend' },
  { id: 'tracking', title: 'Tracking', hint: 'Attribution settings' },
  { id: 'review', title: 'Review', hint: 'Check and submit' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function CampaignWizard({
  csrfToken,
  initial,
  brandName,
  platformFeeBps,
  minFundingLabel,
  canLaunch = false,
}: {
  csrfToken: string;
  initial?: CampaignDraft;
  brandName: string;
  platformFeeBps: number;
  minFundingLabel: string;
  /**
   * A demo brand funds from the balance it already holds and has nothing to
   * decide between creating and launching, so the wizard finishes the job in
   * one press instead of leaving a draft on the next screen.
   */
  canLaunch?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CampaignDraft>(initial ?? EMPTY_DRAFT);
  const [step, setStep] = useState<StepId>('basics');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const isEditing = Boolean(initial?.id);

  const completion = useMemo(() => validate(draft), [draft]);

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const formData = new FormData();
    formData.set(CSRF_FIELD, csrfToken);
    if (draft.id) formData.set('campaignId', draft.id);

    for (const [key, value] of Object.entries(draft)) {
      if (key === 'id') continue;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, item);
      } else if (typeof value === 'boolean') {
        if (value) formData.set(key, 'on');
      } else {
        formData.set(key, value);
      }
    }

    const result = draft.id ? await runAction(updateCampaign, formData) : await runAction(createCampaign, formData);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      // Jump to the step containing the first error so it is not hidden.
      const firstField = Object.keys(result.fieldErrors ?? {})[0];
      if (firstField) setStep(stepForField(firstField));
      return;
    }

    const campaignId = 'campaignId' in result.data ? result.data.campaignId : draft.id;

    let launchedNow = false;
    if (canLaunch && campaignId && !draft.id) {
      setSubmitting(true);
      const launchForm = new FormData();
      launchForm.set(CSRF_FIELD, csrfToken);
      launchForm.set('campaignId', campaignId);
      const launched = await runAction(launchDemoCampaign, launchForm);
      setSubmitting(false);
      if (!launched.ok) {
        setError(launched.error);
        return;
      }
      // Moderation can still hold a campaign; only say it went live if it did.
      launchedNow = (launched.data as { launched?: boolean } | undefined)?.launched === true;
      if (!launchedNow && launched.message) setError(launched.message);
    }

    router.push(`/brand/campaigns/${campaignId}${launchedNow ? '?launched=1' : ''}`);
    router.refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      {/* Step rail */}
      <nav aria-label="Campaign steps" className="lg:sticky lg:top-20 lg:self-start">
        <ol className="scroll-x flex gap-1 lg:flex-col lg:gap-0.5">
          {STEPS.map((item, index) => {
            const active = item.id === step;
            const complete = completion.completedSteps.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setStep(item.id)}
                  aria-current={active ? 'step' : undefined}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-primary-soft text-primary'
                      : 'text-fg-muted hover:bg-surface-sunken hover:text-fg'
                  }`}
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold ${
                      complete
                        ? 'bg-success text-white'
                        : active
                          ? 'bg-primary text-primary-fg'
                          : 'bg-surface-sunken text-fg-subtle'
                    }`}
                    aria-hidden="true"
                  >
                    {complete ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="hidden text-2xs text-fg-subtle lg:block">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0">
        {error ? (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        ) : null}

        {step === 'basics' ? (
          <Card className="space-y-5">
            <CardHeader
              title="Campaign basics"
              description="What publishers see first in the marketplace."
            />
            <Input
              label="Campaign name"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Spring Drop — Performance Activewear"
              required
              error={fieldErrors.name}
            />
            <Input
              label="One-line offer summary"
              value={draft.offerSummary}
              onChange={(e) => set('offerSummary', e.target.value)}
              placeholder="Earn on every qualified visitor to our spring collection."
              required
              maxLength={280}
              hint={`${draft.offerSummary.length}/280`}
              error={fieldErrors.offerSummary}
              description="Shown on the campaign card. Lead with what the publisher gets."
            />
            <Select
              label="Objective"
              value={draft.objective}
              onChange={(e) => set('objective', e.target.value)}
              options={CAMPAIGN_OBJECTIVES.map((o) => ({ value: o.value, label: o.label }))}
              error={fieldErrors.objective}
            />
            <Select
              label="Category"
              value={draft.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Choose a category"
              options={CAMPAIGN_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              required
              error={fieldErrors.category}
            />
            <Textarea
              label="Description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              rows={5}
              required
              placeholder="Describe the product, who it is for, and what makes it convert. Publishers use this to decide whether their audience fits."
              error={fieldErrors.description}
            />
          </Card>
        ) : null}

        {step === 'destination' ? (
          <Card className="space-y-5">
            <CardHeader
              title="Destination"
              description="Where visitors land. This is checked for safety before your campaign is approved."
            />
            <Input
              label="Destination URL"
              value={draft.destinationUrl}
              onChange={(e) => set('destinationUrl', e.target.value)}
              placeholder="https://yourbrand.com/spring-collection"
              required
              error={fieldErrors.destinationUrl}
              description="Must use https. We append a click identifier so you can report conversions back."
            />
            <Alert tone="info" title="What we forward to you">
              Only an opaque click identifier, plus any sub-ID and UTM parameters the publisher set.
              Nothing identifying about the visitor is passed to your site by us.
            </Alert>
            <Textarea
              label="What counts as a conversion?"
              value={draft.conversionRules}
              onChange={(e) => set('conversionRules', e.target.value)}
              rows={3}
              placeholder="A completed checkout with a paid order over $25. Cancelled or refunded orders are reversed within 30 days."
              description="Publishers see this. Being specific here prevents disputes later."
              error={fieldErrors.conversionRules}
            />
          </Card>
        ) : null}

        {step === 'compensation' ? (
          <CompensationStep draft={draft} set={set} fieldErrors={fieldErrors} platformFeeBps={platformFeeBps} />
        ) : null}

        {step === 'targeting' ? (
          <Card className="space-y-6">
            <CardHeader
              title="Targeting"
              description="Traffic outside these rules is delivered to you but never billed."
            />
            <fieldset>
              <legend className="text-sm font-medium text-fg">Countries you accept</legend>
              <p className="mb-3 mt-1 text-xs text-fg-muted">
                Leave all unselected to accept traffic worldwide.
              </p>
              <CountryPicker
                selected={draft.allowedCountries}
                onChange={(value) => set('allowedCountries', value)}
              />
            </fieldset>

            <Separator />

            <fieldset>
              <legend className="text-sm font-medium text-fg">Channels you allow</legend>
              <p className="mb-3 mt-1 text-xs text-fg-muted">
                Leave unchecked to allow any channel not explicitly prohibited.
              </p>
              <ChannelPicker
                selected={draft.allowedChannels}
                onChange={(value) => set('allowedChannels', value)}
              />
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-fg">Channels you prohibit</legend>
              <p className="mb-3 mt-1 text-xs text-fg-muted">
                Traffic from these is never billable, and publishers are told before they take a link.
              </p>
              <ChannelPicker
                selected={draft.prohibitedChannels}
                onChange={(value) => set('prohibitedChannels', value)}
                tone="danger"
              />
            </fieldset>

            <Separator />

            <Input
              label="Minimum audience age"
              value={draft.minAge}
              onChange={(e) => set('minAge', e.target.value.replace(/\D/g, ''))}
              placeholder="18"
              inputMode="numeric"
              description="Optional. Set this if your product is age-restricted."
              error={fieldErrors.minAge}
            />
          </Card>
        ) : null}

        {step === 'rules' ? (
          <Card className="space-y-5">
            <CardHeader
              title="Traffic rules"
              description="These appear on the campaign page and in the terms publishers accept."
            />
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-fg">Prohibited promotion methods</legend>
              <div className="space-y-2">
                {PROHIBITED_PRESETS.map((preset) => (
                  <Checkbox
                    key={preset.value}
                    label={preset.label}
                    checked={draft.prohibitedPresets.includes(preset.value)}
                    onChange={(e) =>
                      set(
                        'prohibitedPresets',
                        e.target.checked
                          ? [...draft.prohibitedPresets, preset.value]
                          : draft.prohibitedPresets.filter((v) => v !== preset.value),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>

            <Separator />

            <Input
              label="Disclosure requirement"
              value={draft.disclosureRequirement}
              onChange={(e) => set('disclosureRequirement', e.target.value)}
              placeholder="Posts must include #ad or an equivalent visible disclosure."
              description="Shown prominently when a publisher takes a link."
              error={fieldErrors.disclosureRequirement}
            />

            <Textarea
              label="Campaign terms"
              value={draft.termsBody}
              onChange={(e) => set('termsBody', e.target.value)}
              rows={10}
              required
              error={fieldErrors.termsBody}
              description="Publishers must accept these before receiving a link. The version they accepted is recorded."
            />
            {draft.termsBody.trim() === '' ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('termsBody', defaultTerms(brandName, draft))}
              >
                Use a standard template
              </Button>
            ) : null}
          </Card>
        ) : null}

        {step === 'budget' ? (
          <Card className="space-y-5">
            <CardHeader
              title="Budget"
              description="A campaign can never spend more than you have funded. This is enforced at the database level, not just in the interface."
            />
            <Input
              label="Total campaign budget"
              value={draft.totalBudget}
              onChange={(e) => set('totalBudget', e.target.value)}
              prefix="$"
              placeholder="5000.00"
              inputMode="decimal"
              required
              error={fieldErrors.totalBudget}
              description={`You fund the campaign separately after creating it. Minimum initial funding is ${minFundingLabel}.`}
            />
            <Input
              label="Daily spend cap"
              value={draft.dailyCap}
              onChange={(e) => set('dailyCap', e.target.value)}
              prefix="$"
              placeholder="Optional"
              inputMode="decimal"
              description="Optional pacing limit. Billable activity pauses for the day once reached."
              error={fieldErrors.dailyCap}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="date"
                label="Start date"
                value={draft.startsAt}
                onChange={(e) => set('startsAt', e.target.value)}
                description="Optional. Defaults to as soon as it launches."
              />
              <Input
                type="date"
                label="End date"
                value={draft.endsAt}
                onChange={(e) => set('endsAt', e.target.value)}
                description="Optional. Unspent budget returns to your balance."
              />
            </div>
          </Card>
        ) : null}

        {step === 'tracking' ? (
          <Card className="space-y-5">
            <CardHeader
              title="Tracking and attribution"
              description="How long a click stays credited, and how repeat visits are handled."
            />
            <Input
              label="Attribution window (days)"
              value={draft.attributionWindowDays}
              onChange={(e) => set('attributionWindowDays', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              description="How long after a click a conversion still credits the publisher. 30 days is typical for e-commerce; 7 for impulse purchases."
              error={fieldErrors.attributionWindowDays}
            />
            <Input
              label="Repeat-click window (hours)"
              value={draft.dedupeWindowHours}
              onChange={(e) => set('dedupeWindowHours', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              description="Repeat visits from one device inside this window are recorded but not billed again."
              error={fieldErrors.dedupeWindowHours}
            />

            <Separator />

            <Checkbox
              label="Require approval before publishers get a link"
              description="Slower to scale, but you review each publisher first. Most campaigns perform better left open."
              checked={draft.requiresApproval}
              onChange={(e) => set('requiresApproval', e.target.checked)}
            />
            <Checkbox
              label="List publicly in the marketplace"
              description="Uncheck to make the campaign reachable only by direct link, and excluded from search engines."
              checked={draft.isPublic}
              onChange={(e) => set('isPublic', e.target.checked)}
            />
          </Card>
        ) : null}

        {step === 'review' ? (
          <ReviewStep
            draft={draft}
            completion={completion}
            platformFeeBps={platformFeeBps}
            onJump={setStep}
          />
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!.id)}
            disabled={stepIndex === 0}
          >
            Back
          </Button>

          {step === 'review' ? (
            <Button
              size="lg"
              loading={submitting}
              disabled={!completion.canSubmit}
              onClick={submit}
            >
              {isEditing ? 'Save changes' : canLaunch ? 'Launch campaign' : 'Create campaign'}
            </Button>
          ) : (
            <Button onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.id)}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompensationStep({
  draft,
  set,
  fieldErrors,
  platformFeeBps,
}: {
  draft: CampaignDraft;
  set: <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => void;
  fieldErrors: Record<string, string>;
  platformFeeBps: number;
}) {
  const model = PAYOUT_MODELS.find((m) => m.value === draft.payoutModel);
  const needsAmount = draft.payoutModel !== 'REVSHARE';
  const needsShare = draft.payoutModel === 'REVSHARE' || draft.payoutModel === 'HYBRID';

  return (
    <Card className="space-y-5">
      <CardHeader
        title="Compensation"
        description="What a publisher earns. This is the number shown in the marketplace, and it is exactly what lands in their balance."
      />

      <fieldset>
        <legend className="mb-3 text-sm font-medium text-fg">How do you want to pay?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYOUT_MODELS.map((option) => (
            <RadioCard
              key={option.value}
              name="payoutModel"
              value={option.value}
              label={option.label}
              description={option.hint}
              meta={option.example}
              checked={draft.payoutModel === option.value}
              onChange={(value) => set('payoutModel', value)}
            />
          ))}
        </div>
      </fieldset>

      {needsAmount ? (
        <Input
          label={
            draft.payoutModel === 'CPM'
              ? 'Publisher earns per 1,000 impressions'
              : draft.payoutModel === 'CPC'
                ? 'Publisher earns per qualified click'
                : draft.payoutModel === 'CPL'
                  ? 'Publisher earns per lead'
                  : draft.payoutModel === 'HYBRID'
                    ? 'Flat amount per click'
                    : 'Publisher earns per sale'
          }
          value={draft.payoutAmount}
          onChange={(e) => set('payoutAmount', e.target.value)}
          prefix="$"
          placeholder="0.25"
          inputMode="decimal"
          required={draft.payoutModel !== 'HYBRID'}
          error={fieldErrors.payoutAmount}
        />
      ) : null}

      {needsShare ? (
        <Input
          label="Revenue share"
          value={draft.revsharePercent}
          onChange={(e) => set('revsharePercent', e.target.value.replace(/[^\d.]/g, ''))}
          suffix="%"
          placeholder="10"
          inputMode="decimal"
          error={fieldErrors.revsharePercent}
          description="Percentage of the order value you report on each conversion."
        />
      ) : null}

      <FeePreview
        payoutAmount={draft.payoutAmount}
        payoutModel={draft.payoutModel}
        platformFeeBps={platformFeeBps}
      />

      {model ? (
        <Alert tone="info" title={`About ${model.label.toLowerCase()}`}>
          {model.hint}
        </Alert>
      ) : null}
    </Card>
  );
}

/**
 * Makes the fee arithmetic explicit before the brand commits. Hiding this until
 * the invoice is how ad platforms lose trust.
 */
function FeePreview({
  payoutAmount,
  payoutModel,
  platformFeeBps,
}: {
  payoutAmount: string;
  payoutModel: string;
  platformFeeBps: number;
}) {
  if (payoutModel === 'REVSHARE') {
    return (
      <div className="rounded-md border border-border bg-surface-sunken/50 p-4">
        <p className="text-sm text-fg-muted text-pretty">
          On revenue-share campaigns the platform fee of {(platformFeeBps / 100).toFixed(1)}% comes
          out of the share you pay, rather than being added on top.
        </p>
      </div>
    );
  }

  const net = parseDecimalToMicros(payoutAmount);
  if (net === null || net <= 0n) return null;

  // gross = net / (1 - fee); integer arithmetic, rounded up so the publisher's
  // advertised payout is never short.
  const bps = BigInt(Math.max(0, Math.min(9999, platformFeeBps)));
  const gross = (net * 10_000n + (10_000n - bps) - 1n) / (10_000n - bps);
  const fee = gross - net;

  return (
    <div className="rounded-md border border-border bg-surface-sunken/50 p-4">
      <h3 className="text-sm font-semibold text-fg">What this costs you</h3>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-fg-muted">Publisher receives</dt>
          <dd className="text-sm font-medium tabular-nums text-fg">{money(net)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-fg-muted">
            Platform fee ({(platformFeeBps / 100).toFixed(1)}%)
          </dt>
          <dd className="text-sm tabular-nums text-fg-muted">{money(fee)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
          <dt className="text-sm font-medium text-fg">You are charged</dt>
          <dd className="text-md font-semibold tabular-nums text-fg">{money(gross)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-fg-subtle text-pretty">
        Charged only on billable activity. Traffic that fails quality checks costs you nothing.
      </p>
    </div>
  );
}

function ReviewStep({
  draft,
  completion,
  platformFeeBps,
  onJump,
}: {
  draft: CampaignDraft;
  completion: ReturnType<typeof validate>;
  platformFeeBps: number;
  onJump: (step: StepId) => void;
}) {
  return (
    <Card className="space-y-5">
      <CardHeader
        title="Review"
        description="Check everything, then create the campaign. You fund and launch it on the next screen."
      />

      {completion.problems.length > 0 ? (
        <Alert tone="warning" title="Still needed before you can create this campaign">
          <ul className="mt-1 space-y-1">
            {completion.problems.map((problem) => (
              <li key={problem.field}>
                <button
                  type="button"
                  onClick={() => onJump(problem.step)}
                  className="text-left underline hover:no-underline"
                >
                  {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Ready to create">
          Everything required is filled in. The campaign is created as a draft, then goes to review.
        </Alert>
      )}

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Summary label="Name" value={draft.name || '—'} />
        <Summary label="Category" value={draft.category || '—'} />
        <Summary label="Destination" value={draft.destinationUrl || '—'} mono />
        <Summary
          label="Publisher payout"
          value={
            draft.payoutModel === 'REVSHARE'
              ? `${draft.revsharePercent || '0'}% of revenue`
              : `$${draft.payoutAmount || '0.00'} ${payoutUnit(draft.payoutModel)}`
          }
        />
        <Summary label="Total budget" value={draft.totalBudget ? `$${draft.totalBudget}` : '—'} />
        <Summary
          label="Attribution window"
          value={`${draft.attributionWindowDays || '30'} days`}
        />
        <Summary
          label="Countries"
          value={
            draft.allowedCountries.length > 0
              ? draft.allowedCountries.join(', ')
              : 'Worldwide'
          }
        />
        <Summary
          label="Access"
          value={draft.requiresApproval ? 'Approval required' : 'Open — instant links'}
        />
      </dl>

      <Separator />

      <FeePreview
        payoutAmount={draft.payoutAmount}
        payoutModel={draft.payoutModel}
        platformFeeBps={platformFeeBps}
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={draft.isPublic ? 'success' : 'neutral'}>
          {draft.isPublic ? 'Listed publicly' : 'Unlisted'}
        </Badge>
        <Badge tone="neutral">{draft.payoutModel}</Badge>
        {draft.prohibitedPresets.length > 0 ? (
          <Badge tone="neutral">{draft.prohibitedPresets.length} traffic restrictions</Badge>
        ) : null}
      </div>
    </Card>
  );
}

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={`mt-1 break-words text-base text-fg ${mono ? 'font-mono text-sm' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function ChannelPicker({
  selected,
  onChange,
  tone = 'primary',
}: {
  selected: string[];
  onChange: (value: string[]) => void;
  tone?: 'primary' | 'danger';
}) {
  const activeClass =
    tone === 'danger'
      ? 'border-danger bg-danger-soft/60 text-danger'
      : 'border-primary bg-primary-soft/60 text-primary';

  return (
    <div className="flex flex-wrap gap-1.5">
      {CHANNELS.map((channel) => {
        const active = selected.includes(channel.value);
        return (
          <button
            key={channel.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((v) => v !== channel.value)
                  : [...selected, channel.value],
              )
            }
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              active ? activeClass : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
            }`}
          >
            {channel.label}
          </button>
        );
      })}
    </div>
  );
}

/** Country chips, controlled by the wizard's state. */
function CountryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {COUNTRIES.map((country) => {
        const active = selected.includes(country.value);
        return (
          <button
            key={country.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active ? selected.filter((v) => v !== country.value) : [...selected, country.value],
              )
            }
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'border-primary bg-primary-soft/60 text-primary'
                : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
            }`}
          >
            {country.value}
          </button>
        );
      })}
    </div>
  );
}

interface Problem {
  field: string;
  step: StepId;
  message: string;
}

function validate(draft: CampaignDraft): {
  problems: Problem[];
  canSubmit: boolean;
  completedSteps: StepId[];
} {
  const problems: Problem[] = [];

  if (draft.name.trim().length < 3) {
    problems.push({ field: 'name', step: 'basics', message: 'Give the campaign a name' });
  }
  if (draft.category === '') {
    problems.push({ field: 'category', step: 'basics', message: 'Choose a category' });
  }
  if (draft.description.trim().length < 20) {
    problems.push({
      field: 'description',
      step: 'basics',
      message: 'Add a description of at least 20 characters',
    });
  }
  if (draft.offerSummary.trim().length < 10) {
    problems.push({
      field: 'offerSummary',
      step: 'basics',
      message: 'Add a one-line offer summary',
    });
  }
  if (!/^https:\/\/.+\..+/.test(draft.destinationUrl.trim())) {
    problems.push({
      field: 'destinationUrl',
      step: 'destination',
      message: 'Enter an https destination URL',
    });
  }

  if (draft.payoutModel === 'REVSHARE') {
    if (!draft.revsharePercent || Number.parseFloat(draft.revsharePercent) <= 0) {
      problems.push({
        field: 'revsharePercent',
        step: 'compensation',
        message: 'Enter a revenue share percentage',
      });
    }
  } else if (draft.payoutModel === 'HYBRID') {
    const hasFlat = parseDecimalToMicros(draft.payoutAmount);
    const hasShare = draft.revsharePercent && Number.parseFloat(draft.revsharePercent) > 0;
    if ((hasFlat === null || hasFlat <= 0n) && !hasShare) {
      problems.push({
        field: 'payoutAmount',
        step: 'compensation',
        message: 'A hybrid campaign needs a flat amount, a revenue share, or both',
      });
    }
  } else {
    const amount = parseDecimalToMicros(draft.payoutAmount);
    if (amount === null || amount <= 0n) {
      problems.push({
        field: 'payoutAmount',
        step: 'compensation',
        message: 'Enter what publishers earn per event',
      });
    }
  }

  const budget = parseDecimalToMicros(draft.totalBudget);
  if (budget === null || budget <= 0n) {
    problems.push({ field: 'totalBudget', step: 'budget', message: 'Set a total campaign budget' });
  }

  if (draft.termsBody.trim().length < 20) {
    problems.push({ field: 'termsBody', step: 'rules', message: 'Add campaign terms' });
  }

  const failedSteps = new Set(problems.map((p) => p.step));
  const completedSteps = STEPS.map((s) => s.id).filter(
    (id) => id !== 'review' && !failedSteps.has(id),
  );

  return { problems, canSubmit: problems.length === 0, completedSteps };
}

function stepForField(field: string): StepId {
  const map: Record<string, StepId> = {
    name: 'basics',
    objective: 'basics',
    category: 'basics',
    description: 'basics',
    offerSummary: 'basics',
    destinationUrl: 'destination',
    conversionRules: 'destination',
    payoutAmount: 'compensation',
    revsharePercent: 'compensation',
    payoutModel: 'compensation',
    minAge: 'targeting',
    termsBody: 'rules',
    disclosureRequirement: 'rules',
    totalBudget: 'budget',
    dailyCap: 'budget',
    attributionWindowDays: 'tracking',
    dedupeWindowHours: 'tracking',
  };
  return map[field] ?? 'basics';
}

function payoutUnit(model: string): string {
  switch (model) {
    case 'CPC':
      return 'per click';
    case 'CPL':
      return 'per lead';
    case 'CPA':
      return 'per sale';
    case 'CPM':
      return 'per 1,000 impressions';
    default:
      return '';
  }
}

/** Client-side decimal parsing. Integer arithmetic only — never a float. */
function parseDecimalToMicros(input: string): bigint | null {
  const trimmed = input.trim().replace(/[$,\s]/g, '');
  if (trimmed === '') return null;
  const match = /^(\d*)(?:\.(\d{0,6}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = match[1] || '0';
  const frac = (match[2] ?? '').padEnd(6, '0');
  try {
    return BigInt(whole) * 1_000_000n + BigInt(frac || '0');
  } catch {
    return null;
  }
}

function money(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const rest = micros % 1_000_000n;
  // Show four decimals only when the amount has sub-cent precision.
  const hasSubCent = rest % 10_000n !== 0n;
  const decimals = hasSubCent ? 4 : 2;
  const divisor = 10n ** BigInt(6 - decimals);
  const frac = rest / divisor;
  return `$${whole}.${frac.toString().padStart(decimals, '0')}`;
}

function defaultTerms(brandName: string, draft: CampaignDraft): string {
  const payout =
    draft.payoutModel === 'REVSHARE'
      ? `${draft.revsharePercent || '0'}% of qualifying revenue`
      : `$${draft.payoutAmount || '0.00'} ${payoutUnit(draft.payoutModel)}`;

  return `Campaign terms — ${draft.name || 'this campaign'}

1. Compensation
You earn ${payout} on activity that meets the conversion criteria described on the campaign page. Payouts are calculated from tracked, qualified activity only.

2. Attribution
Activity is attributed to the last click within ${draft.attributionWindowDays || '30'} days. Repeat visits from the same device within ${draft.dedupeWindowHours || '24'} hours are recorded but not separately billable.

3. Permitted promotion
You may promote this campaign through the channels listed as allowed on the campaign page. Any channel listed as prohibited is not billable.

4. Prohibited activity
You may not use spam, misleading or unsubstantiated claims, incentivised clicks, automated or bot-generated traffic, cookie stuffing, traffic exchanges, or any method that misrepresents ${brandName} or its products. You may not bid on ${brandName} brand terms in paid search unless expressly permitted.

5. Disclosure
${draft.disclosureRequirement || 'You are responsible for complying with all advertising disclosure requirements that apply to you and your audience.'}

6. Traffic quality
All activity is screened for quality. Activity that fails screening is not billable. Where activity is held for review you will be told why and may dispute the decision.

7. Changes and termination
${brandName} may pause or end this campaign at any time. Earnings already approved are unaffected. Material changes to compensation create a new version of these terms.

8. Nature of this agreement
This is a performance-based advertising arrangement. It creates no employment relationship, guarantees no level of earnings, and does not make you an agent of ${brandName}.`;
}
