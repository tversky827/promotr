'use client';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Card, CardHeader } from '@/components/ui/primitives';
import { CAMPAIGN_CATEGORIES, COUNTRIES } from '@/lib/taxonomy';
import { createBrandProfile } from '@/server/actions/onboarding';

export function BrandOnboardingForm({
  csrfToken,
  defaultEmail,
}: {
  csrfToken: string;
  defaultEmail: string;
}) {
  return (
    <ActionForm action={createBrandProfile} csrfToken={csrfToken} redirectTo="/brand">
      <FormBody className="space-y-6">
        <Card className="space-y-4">
          <CardHeader
            title="Business details"
            description="The legal name should match your registration and payment records."
          />
          <Field name="legalName" label="Registered business name" placeholder="Everyday Athletic LLC" required />
          <Field
            name="displayName"
            label="Public brand name"
            placeholder="Everyday Athletic"
            required
            description="What publishers see on your campaigns."
          />
          <Field
            name="website"
            label="Website"
            placeholder="https://everydayathletic.com"
            required
            description="Campaign destinations should be on this domain."
          />
          <CategorySelect />
          <BioField />
        </Card>

        <Card className="space-y-4">
          <CardHeader title="Contact" />
          <Field
            name="contactEmail"
            label="Contact email"
            type="email"
            defaultValue={defaultEmail}
            required
          />
          <Field name="contactPhone" label="Phone" placeholder="+1 555 000 0000" />
        </Card>

        <Card className="space-y-4">
          <CardHeader
            title="Business address"
            description="Required for payment processing and invoicing."
          />
          <CountrySelect />
          <Field name="addressLine1" label="Address" placeholder="100 Market Street" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="city" label="City" />
            <Field name="region" label="State or region" />
            <Field name="postalCode" label="Postal code" />
          </div>
          <Field
            name="taxId"
            label="Tax ID"
            placeholder="Optional"
            description="Stored encrypted. Used for invoicing and tax reporting only."
          />
        </Card>

        <Alert tone="info">
          Your account is created immediately. Campaigns enter review before going live, which is
          usually quick — you can build and fund a campaign while verification is in progress.
        </Alert>

        <div className="flex justify-end">
          <SubmitButton size="lg" pendingLabel="Creating…">
            Create brand account
          </SubmitButton>
        </div>
      </FormBody>
    </ActionForm>
  );
}

function Field({
  name,
  label,
  ...rest
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}) {
  return <Input name={name} label={label} error={useFieldError(name)} {...rest} />;
}

function CategorySelect() {
  return (
    <Select
      name="category"
      label="Industry"
      required
      placeholder="Choose an industry"
      options={CAMPAIGN_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
      error={useFieldError('category')}
    />
  );
}

function CountrySelect() {
  return (
    <Select
      name="country"
      label="Country"
      required
      defaultValue="US"
      options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
      error={useFieldError('country')}
    />
  );
}

function BioField() {
  return (
    <Textarea
      name="description"
      label="What does your business do?"
      rows={3}
      placeholder="We sell performance activewear direct to consumers."
      error={useFieldError('description')}
      description="Shown to publishers deciding whether to promote you."
    />
  );
}
