'use client';

import { useState } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { formatDateTime, formatRelative } from '@/lib/format';
import { CAMPAIGN_CATEGORIES } from '@/lib/taxonomy';
import {
  addBrandDomain,
  addBrandMember,
  checkBrandDomain,
  removeBrandDomain,
  removeBrandMember,
  updateBrandProfile,
} from '@/server/actions/brand';

/**
 * Brand account forms.
 *
 * Read-only for members: the same screens render, but the controls that change
 * the account are replaced with an explanation of who can change them. Hiding
 * them entirely would leave a member wondering whether the feature exists.
 */

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: string;
  isYou: boolean;
  joinedAt: string;
}

export interface DomainView {
  id: string;
  domain: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  recordName: string;
  recordValue: string;
}

export function BrandProfileForm({
  csrfToken,
  brand,
  canEdit,
}: {
  csrfToken: string;
  canEdit: boolean;
  brand: {
    displayName: string;
    legalName: string;
    website: string;
    category: string;
    contactEmail: string;
    contactPhone: string | null;
    description: string | null;
    addressLine1: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string;
    verification: string;
  };
}) {
  return (
    <Card>
      <CardHeader
        title="Brand details"
        description="What publishers see in the marketplace, and the legal entity we contract with."
        action={
          brand.verification === 'VERIFIED' ? (
            <Badge tone="success">Verified</Badge>
          ) : (
            <Badge tone="neutral">{brand.verification.toLowerCase().replace('_', ' ')}</Badge>
          )
        }
      />

      {!canEdit ? (
        <Alert tone="info" className="mt-4">
          Only a brand owner can change these details.
        </Alert>
      ) : null}

      <ActionForm action={updateBrandProfile} csrfToken={csrfToken} className="mt-4">
        <fieldset disabled={!canEdit} className="contents">
          <FormBody className="grid gap-4 sm:grid-cols-2">
            <TextField name="displayName" label="Public name" defaultValue={brand.displayName} required />
            <TextField name="legalName" label="Registered legal name" defaultValue={brand.legalName} required />
            <TextField name="website" label="Website" defaultValue={brand.website} required />
            <CategoryField defaultValue={brand.category} />
            <TextField name="contactEmail" label="Contact email" type="email" defaultValue={brand.contactEmail} required />
            <TextField name="contactPhone" label="Contact phone" defaultValue={brand.contactPhone ?? ''} />
            <DescriptionField defaultValue={brand.description ?? ''} />
            <TextField name="addressLine1" label="Address" defaultValue={brand.addressLine1 ?? ''} />
            <TextField name="city" label="City" defaultValue={brand.city ?? ''} />
            <TextField name="region" label="State or region" defaultValue={brand.region ?? ''} />
            <TextField name="postalCode" label="Postal code" defaultValue={brand.postalCode ?? ''} />
          </FormBody>
        </fieldset>

        <p className="mt-3 text-xs text-fg-subtle text-pretty">
          Country is {brand.country} and cannot be changed here — it determines which entity we
          contract with and how payouts are reported. Contact support to move a brand between
          countries.
        </p>

        {canEdit ? (
          <div className="mt-4">
            <SubmitButton>Save details</SubmitButton>
          </div>
        ) : null}
      </ActionForm>
    </Card>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  type,
  required,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <Input
      name={name}
      label={label}
      type={type}
      defaultValue={defaultValue}
      required={required}
      error={useFieldError(name)}
    />
  );
}

function CategoryField({ defaultValue }: { defaultValue: string }) {
  return (
    <Select
      name="category"
      label="Category"
      defaultValue={defaultValue}
      required
      error={useFieldError('category')}
      options={CAMPAIGN_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
    />
  );
}

function DescriptionField({ defaultValue }: { defaultValue: string }) {
  return (
    <Textarea
      name="description"
      label="What you sell"
      defaultValue={defaultValue}
      rows={3}
      hint="Shown on your marketplace listing"
      error={useFieldError('description')}
      className="sm:col-span-2"
    />
  );
}

export function TeamCard({
  csrfToken,
  members,
  canManage,
}: {
  csrfToken: string;
  members: MemberView[];
  canManage: boolean;
}) {
  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="Team"
          description="Owners can spend money and change the account. Members can build and run campaigns."
        />
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">
                {member.name}
                {member.isYou ? <span className="ml-1.5 text-fg-subtle">(you)</span> : null}
              </p>
              <p className="truncate text-xs text-fg-subtle">
                {member.email} · joined {formatDateTime(new Date(member.joinedAt))}
              </p>
            </div>
            <Badge tone={member.role === 'BRAND_OWNER' ? 'info' : 'neutral'}>
              {member.role === 'BRAND_OWNER' ? 'Owner' : 'Member'}
            </Badge>
            {canManage && !member.isYou ? (
              <ActionForm action={removeBrandMember} csrfToken={csrfToken}>
                <input type="hidden" name="userId" value={member.userId} />
                <SubmitButton variant="ghost" size="sm">
                  Remove
                </SubmitButton>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="border-t border-border p-5">
          <ActionForm action={addBrandMember} csrfToken={csrfToken} resetOnSuccess>
            <FormBody className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <TextField name="email" label="Add a colleague by email" defaultValue="" type="email" required />
              <RoleField />
              <SubmitButton variant="secondary">Add</SubmitButton>
            </FormBody>
          </ActionForm>
          <p className="mt-2 text-xs text-fg-subtle text-pretty">
            They need an account first — ask them to sign up, then add the email they used. We do
            not create accounts on someone else&apos;s behalf.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function RoleField() {
  return (
    <Select
      name="role"
      label="Role"
      defaultValue="BRAND_MEMBER"
      error={useFieldError('role')}
      options={[
        { value: 'BRAND_MEMBER', label: 'Member' },
        { value: 'BRAND_OWNER', label: 'Owner' },
      ]}
    />
  );
}

export function DomainsCard({
  csrfToken,
  domains,
  canManage,
}: {
  csrfToken: string;
  domains: DomainView[];
  canManage: boolean;
}) {
  const [added, setAdded] = useState<{ recordName: string; recordValue: string } | null>(null);

  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="Destination domains"
          description="Prove you control the sites your campaigns send traffic to. Verification is what lets a campaign point anywhere on that domain without a manual review of every URL."
        />
      </div>

      {domains.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            title="No domains yet"
            description="Add the domain your landing pages live on."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {domains.map((domain) => (
            <li key={domain.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{domain.domain}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {domain.verifiedAt
                      ? `Verified ${formatRelative(new Date(domain.verifiedAt))}`
                      : domain.lastCheckedAt
                        ? `Last checked ${formatRelative(new Date(domain.lastCheckedAt))} — not found yet`
                        : 'Not checked yet'}
                  </p>
                </div>
                {domain.verifiedAt ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="warning">Pending</Badge>
                )}
                {canManage ? (
                  <>
                    {!domain.verifiedAt ? (
                      <ActionForm action={checkBrandDomain} csrfToken={csrfToken}>
                        <input type="hidden" name="domainId" value={domain.id} />
                        <SubmitButton variant="secondary" size="sm">
                          Check DNS
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    <ActionForm action={removeBrandDomain} csrfToken={csrfToken}>
                      <input type="hidden" name="domainId" value={domain.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  </>
                ) : null}
              </div>

              {!domain.verifiedAt ? (
                <dl className="mt-3 grid gap-2 rounded-md border border-border bg-surface-sunken p-3 text-xs sm:grid-cols-[auto_1fr]">
                  <dt className="text-fg-subtle">Record name</dt>
                  <dd className="break-all font-mono text-fg">{domain.recordName}</dd>
                  <dt className="text-fg-subtle">Record value</dt>
                  <dd className="break-all font-mono text-fg">{domain.recordValue}</dd>
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="border-t border-border p-5">
          <ActionForm
            action={addBrandDomain}
            csrfToken={csrfToken}
            resetOnSuccess
            onSuccess={(data) => setAdded(data)}
          >
            <FormBody className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <TextField name="domain" label="Add a domain" defaultValue="" required />
              <SubmitButton variant="secondary">Add domain</SubmitButton>
            </FormBody>
          </ActionForm>

          {added ? (
            <Alert tone="info" title="Add this TXT record" className="mt-3">
              <span className="block break-all font-mono text-xs">{added.recordName}</span>
              <span className="block break-all font-mono text-xs">{added.recordValue}</span>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function CloseAccountCard({ supportEmail }: { supportEmail: string }) {
  return (
    <Card>
      <CardHeader
        title="Closing this brand"
        description="Campaign history, spend records and publisher earnings are financial records we are required to keep, so a brand account is closed by support rather than deleted from here. Any unspent balance is refunded to the card it came from."
      />
      <div className="mt-4">
        <ButtonLink
          href={`mailto:${supportEmail}?subject=Close%20brand%20account`}
          variant="secondary"
        >
          Email support to close
        </ButtonLink>
      </div>
    </Card>
  );
}
