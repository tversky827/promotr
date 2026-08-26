'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError, useFormState } from '@/components/ui/action-form';
import { Button, ButtonLink } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/primitives';
import { applyToCampaign, createTrackingLink } from '@/server/actions/links';

/**
 * The link generator.
 *
 * Deliberately one screen and one click for the common case: accept the terms,
 * press the button, copy the link. Sub-ID and UTM fields are present but
 * collapsed, because most publishers do not need them on the first link and
 * putting them up front would make a 5-second flow feel like a form.
 */

export function GetLinkPanel({
  campaignId,
  campaignName,
  brandName,
  payoutDescription,
  requiresApproval,
  applicationStatus,
  disclosureRequirement,
  termsBody,
  csrfToken,
  signedIn,
  isCreator,
  budgetExhausted,
}: {
  campaignId: string;
  campaignName: string;
  brandName: string;
  payoutDescription: string;
  requiresApproval: boolean;
  applicationStatus: string | null;
  disclosureRequirement: string | null;
  termsBody: string;
  csrfToken: string;
  signedIn: boolean;
  isCreator: boolean;
  budgetExhausted: boolean;
}) {
  const [generated, setGenerated] = useState<{ url: string; reused: boolean } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!signedIn) {
    return (
      <div className="card p-5">
        <h2 className="text-md font-semibold text-fg">Get your tracking link</h2>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          Sign in as a creator or publisher to generate a link for this campaign.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ButtonLink href="/signup?type=creator" fullWidth>
            Create a free account
          </ButtonLink>
          <Link
            href="/login"
            className="text-center text-sm text-fg-muted transition-colors hover:text-fg"
          >
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (!isCreator) {
    return (
      <div className="card p-5">
        <h2 className="text-md font-semibold text-fg">Publisher account required</h2>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          You are signed in with a brand account. Tracking links are generated from a
          creator/publisher account.
        </p>
      </div>
    );
  }

  if (generated) {
    return (
      <div className="card border-success/30 p-5 ring-1 ring-success/15">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-success-soft text-success">
            <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
              <path
                d="m5 10.5 3.5 3.5L15 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2 className="text-md font-semibold text-fg">
            {generated.reused ? 'Here is your link' : 'Your link is ready'}
          </h2>
        </div>

        <p className="mt-2 text-sm text-fg-muted">
          You earn <strong className="text-fg">{payoutDescription}</strong> on qualified traffic
          through this link.
        </p>

        <CopyField value={generated.url} className="mt-4" />

        {disclosureRequirement ? (
          <Alert tone="info" className="mt-4" title="Disclosure requirement">
            {disclosureRequirement}
          </Alert>
        ) : null}

        <p className="mt-3 text-xs text-fg-subtle text-pretty">
          Advertising disclosure rules vary by country and platform. Complying with the ones that
          apply to you is your responsibility — this is not legal advice.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" fullWidth onClick={() => setGenerated(null)}>
            Create another link
          </Button>
          <ButtonLink href="/creator/links" fullWidth className="justify-center">
            View all links
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (requiresApproval && applicationStatus !== 'APPROVED') {
    return (
      <ApplyPanel
        campaignId={campaignId}
        campaignName={campaignName}
        brandName={brandName}
        applicationStatus={applicationStatus}
        csrfToken={csrfToken}
      />
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-md font-semibold text-fg">Get your tracking link</h2>
        <Badge tone="success" dot>
          Open
        </Badge>
      </div>

      <p className="mt-1.5 text-sm text-fg-muted">
        You earn <strong className="text-fg">{payoutDescription}</strong>.
      </p>

      {budgetExhausted ? (
        <Alert tone="warning" className="mt-4" title="Budget exhausted">
          This campaign has spent its funded budget. You can still take a link, but traffic will not
          earn until the brand adds funds.
        </Alert>
      ) : null}

      <ActionForm
        action={createTrackingLink}
        csrfToken={csrfToken}
        className="mt-4"
        refresh={false}
        onSuccess={(data) => setGenerated({ url: data.url, reused: data.reused })}
      >
        <input type="hidden" name="campaignId" value={campaignId} />

        <FormBody className="space-y-4">
          <details
            open={showAdvanced}
            onToggle={(event) => setShowAdvanced((event.target as HTMLDetailsElement).open)}
            className="rounded-md border border-border"
          >
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
              <span className="inline-flex items-center gap-1.5">
                <svg
                  viewBox="0 0 20 20"
                  className={`size-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="m8 6 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Tracking options (optional)
              </span>
            </summary>

            <div className="space-y-3 border-t border-border p-3">
              <SubIdField />
              <div className="grid gap-3 sm:grid-cols-2">
                <UtmField name="utmSource" label="UTM source" placeholder="tiktok" />
                <UtmField name="utmMedium" label="UTM medium" placeholder="social" />
              </div>
              <UtmField name="utmCampaign" label="UTM campaign" placeholder="spring-drop" />
              <LabelField />
            </div>
          </details>

          <TermsAcceptance termsBody={termsBody} />

          <SubmitButton fullWidth size="lg" pendingLabel="Generating…">
            Get my tracking link
          </SubmitButton>
        </FormBody>
      </ActionForm>
    </div>
  );
}

function ApplyPanel({
  campaignId,
  campaignName,
  brandName,
  applicationStatus,
  csrfToken,
}: {
  campaignId: string;
  campaignName: string;
  brandName: string;
  applicationStatus: string | null;
  csrfToken: string;
}) {
  if (applicationStatus === 'PENDING') {
    return (
      <div className="card p-5">
        <Badge tone="warning" className="mb-3">
          Application pending
        </Badge>
        <h2 className="text-md font-semibold text-fg">Waiting on {brandName}</h2>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          Your application to promote {campaignName} is being reviewed. You will be notified when
          the brand responds, and your link will be available immediately afterwards.
        </p>
      </div>
    );
  }

  if (applicationStatus === 'REJECTED') {
    return (
      <div className="card p-5">
        <Badge tone="danger" className="mb-3">
          Not accepted
        </Badge>
        <h2 className="text-md font-semibold text-fg">This application was not accepted</h2>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          {brandName} did not accept your application for this campaign. Plenty of open campaigns
          need no approval at all.
        </p>
        <ButtonLink
          href="/campaigns?open=1"
          variant="secondary"
          fullWidth
          className="mt-4 justify-center"
        >
          Browse open campaigns
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-md font-semibold text-fg">Apply to promote</h2>
        <Badge tone="warning">Approval required</Badge>
      </div>
      <p className="mt-1.5 text-sm text-fg-muted text-pretty">
        {brandName} reviews publishers before issuing links for this campaign. Tell them how you
        plan to promote it.
      </p>

      <ActionForm action={applyToCampaign} csrfToken={csrfToken} className="mt-4">
        <input type="hidden" name="campaignId" value={campaignId} />
        <FormBody className="space-y-4">
          <MessageField />
          <SubmitButton fullWidth pendingLabel="Sending…">
            Send application
          </SubmitButton>
        </FormBody>
      </ActionForm>
    </div>
  );
}

function TermsAcceptance({ termsBody }: { termsBody: string }) {
  const error = useFieldError('acceptTerms');
  return (
    <div>
      <details className="mb-2.5 rounded-md border border-border bg-surface-sunken/50">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
          Read the campaign terms
        </summary>
        <div className="max-h-56 overflow-y-auto border-t border-border p-3 text-sm leading-relaxed text-fg-muted whitespace-pre-wrap">
          {termsBody}
        </div>
      </details>

      <Checkbox
        name="acceptTerms"
        required
        label={<span className="text-sm">I have read and accept the campaign terms</span>}
      />
      {error ? (
        <p className="mt-1 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SubIdField() {
  return (
    <Input
      name="subId"
      label="Sub-ID"
      placeholder="video-42"
      error={useFieldError('subId')}
      description="Tag this link so you can see which post or video earned what."
    />
  );
}

function UtmField({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder: string;
}) {
  return <Input name={name} label={label} placeholder={placeholder} error={useFieldError(name)} />;
}

function LabelField() {
  return (
    <Input
      name="label"
      label="Internal label"
      placeholder="March newsletter"
      error={useFieldError('label')}
      description="Only visible to you, in your links list."
    />
  );
}

function MessageField() {
  const { pending } = useFormState();
  return (
    <div className="space-y-1.5">
      <label htmlFor="apply-message" className="text-sm font-medium text-fg">
        How will you promote this? <span className="font-normal text-fg-subtle">(optional)</span>
      </label>
      <textarea
        id="apply-message"
        name="message"
        rows={4}
        disabled={pending}
        placeholder="I run a 12,000-subscriber newsletter about home fitness and would feature this in the Friday edition."
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base leading-relaxed text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
    </div>
  );
}

/** Copy-to-clipboard field with a real confirmation state. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API is unavailable over plain HTTP and in some embedded
      // browsers; fall back to selecting the text so the user can copy manually.
      const input = document.getElementById('copy-source') as HTMLInputElement | null;
      input?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={className}>
      <div className="flex gap-2">
        <input
          id="copy-source"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Your tracking link"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-sm text-fg"
        />
        <Button onClick={copy} variant={copied ? 'success' : 'primary'} className="shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="sr-only" role="status">
        {copied ? 'Link copied to clipboard' : ''}
      </p>
    </div>
  );
}
