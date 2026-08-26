'use client';

import { useState } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { ChipGroup, Input, RadioCard, Select, Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/primitives';
import { CAMPAIGN_CATEGORIES, CHANNELS, COUNTRIES, PUBLISHER_TYPES } from '@/lib/taxonomy';
import { createCreatorProfile } from '@/server/actions/onboarding';

export function CreatorOnboardingForm({
  csrfToken,
  defaultName,
  defaultHandle,
}: {
  csrfToken: string;
  defaultName: string;
  defaultHandle: string;
}) {
  const [handle, setHandle] = useState(defaultHandle || suggestHandle(defaultName));

  return (
    <ActionForm action={createCreatorProfile} csrfToken={csrfToken} redirectTo="/campaigns">
      <FormBody className="space-y-6">
        <Card className="space-y-4">
          <DisplayNameField
            defaultValue={defaultName}
            onNameChange={(value) => {
              if (!defaultHandle) setHandle(suggestHandle(value));
            }}
          />
          <HandleField value={handle} onChange={setHandle} />
        </Card>

        <Card>
          <fieldset>
            <legend className="text-sm font-medium text-fg">What kind of publisher are you?</legend>
            <p className="mb-3 mt-1 text-xs text-fg-muted">
              This does not restrict which campaigns you can take — it helps us surface relevant ones.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PUBLISHER_TYPES.map((type, index) => (
                <RadioCard
                  key={type.value}
                  name="publisherType"
                  value={type.value}
                  label={type.label}
                  description={type.hint}
                  defaultChecked={index === 0}
                />
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium text-fg">Where do you publish?</legend>
            <p className="mb-3 mt-1 text-xs text-fg-muted">Select every channel you use.</p>
            <ChipGroup name="channels" options={[...CHANNELS]} columns={3} />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-fg">What does your audience care about?</legend>
            <p className="mb-3 mt-1 text-xs text-fg-muted">Pick up to five.</p>
            <ChipGroup name="categories" options={[...CAMPAIGN_CATEGORIES]} columns={3} />
          </fieldset>
        </Card>

        <Card className="space-y-4">
          <CountryField />
          <WebsiteField />
          <BioField />
        </Card>

        <div className="flex justify-end">
          <SubmitButton size="lg" pendingLabel="Saving…">
            Save and find campaigns
          </SubmitButton>
        </div>
      </FormBody>
    </ActionForm>
  );
}

function DisplayNameField({
  defaultValue,
  onNameChange,
}: {
  defaultValue: string;
  onNameChange: (value: string) => void;
}) {
  return (
    <Input
      name="displayName"
      label="Display name"
      defaultValue={defaultValue}
      required
      error={useFieldError('displayName')}
      description="How you appear to brands."
      onChange={(event) => onNameChange(event.target.value)}
    />
  );
}

function HandleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      name="handle"
      label="Handle"
      value={value}
      onChange={(event) => onChange(event.target.value.toLowerCase())}
      required
      prefix="@"
      error={useFieldError('handle')}
      description="Your unique identifier. Lowercase letters, numbers and dashes."
    />
  );
}

function CountryField() {
  return (
    <Select
      name="country"
      label="Your country"
      required
      options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
      defaultValue="US"
      error={useFieldError('country')}
      description="Determines which payout methods are available to you."
    />
  );
}

function WebsiteField() {
  return (
    <Input
      name="website"
      label="Website"
      placeholder="https://example.com"
      error={useFieldError('website')}
      description="Optional. Your main site, channel, or newsletter."
    />
  );
}

function BioField() {
  return (
    <Textarea
      name="bio"
      label="About you"
      rows={3}
      placeholder="I write a weekly newsletter about home fitness for 12,000 subscribers."
      error={useFieldError('bio')}
      description="Optional. Brands running approval-required campaigns read this."
    />
  );
}

function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
