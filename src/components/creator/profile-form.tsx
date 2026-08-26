'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { ChipGroup, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { CSRF_FIELD } from '@/lib/auth/constants';
import { runAction } from '@/lib/client/submit';
import { CAMPAIGN_CATEGORIES, CHANNELS, COUNTRIES, PUBLISHER_TYPES } from '@/lib/taxonomy';
import { addSocialAccount, removeSocialAccount, updateCreatorProfile } from '@/server/actions/creator';

export function CreatorProfileForm({
  csrfToken,
  creator,
  profile,
  socials,
}: {
  csrfToken: string;
  creator: { handle: string; publisherType: string; country: string };
  profile: {
    displayName: string;
    bio: string;
    website: string;
    categories: string[];
    audienceCountries: string[];
    channels: string[];
    isPublic: boolean;
  };
  socials: Array<{ id: string; platform: string; handle: string; followers: number | null }>;
}) {
  return (
    <div className="space-y-4">
      <ActionForm action={updateCreatorProfile} csrfToken={csrfToken}>
        <FormBody className="space-y-4">
          <Card className="space-y-4">
            <CardHeader title="Public profile" />
            <NameField defaultValue={profile.displayName} />
            <HandleField defaultValue={creator.handle} />
            <BioField defaultValue={profile.bio} />
            <WebsiteField defaultValue={profile.website} />
            <Switch
              name="isPublic"
              label="Show my profile to brands"
              description="Brands can find you in publisher discovery and invite you to campaigns. Turning this off does not affect any campaign you already promote."
              defaultChecked={profile.isPublic}
            />
          </Card>

          <Card className="space-y-5">
            <CardHeader
              title="Audience"
              description="Used to surface relevant campaigns. Never used to decide what you are paid."
            />
            <TypeSelect defaultValue={creator.publisherType} />
            <CountrySelect defaultValue={creator.country} />

            <fieldset>
              <legend className="text-sm font-medium text-fg">Channels you publish on</legend>
              <div className="mt-3">
                <ChipGroup name="channels" options={[...CHANNELS]} defaultValue={profile.channels} />
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-fg">Topics your audience cares about</legend>
              <div className="mt-3">
                <ChipGroup
                  name="categories"
                  options={[...CAMPAIGN_CATEGORIES]}
                  defaultValue={profile.categories}
                />
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-fg">Where your audience is</legend>
              <div className="mt-3">
                <ChipGroup
                  name="audienceCountries"
                  options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
                  defaultValue={profile.audienceCountries}
                />
              </div>
            </fieldset>
          </Card>

          <div className="flex justify-end">
            <SubmitButton size="lg" pendingLabel="Saving…">
              Save profile
            </SubmitButton>
          </div>
        </FormBody>
      </ActionForm>

      <SocialAccounts csrfToken={csrfToken} socials={socials} />
    </div>
  );
}

function SocialAccounts({
  csrfToken,
  socials,
}: {
  csrfToken: string;
  socials: Array<{ id: string; platform: string; handle: string; followers: number | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [platform, setPlatform] = useState('TIKTOK');
  const [handle, setHandle] = useState('');
  const [followers, setFollowers] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('platform', platform);
      formData.set('handle', handle);
      formData.set('followers', followers);

      const result = await runAction(addSocialAccount, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setHandle('');
      setFollowers('');
      router.refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set(CSRF_FIELD, csrfToken);
      formData.set('id', id);
      await runAction(removeSocialAccount, formData);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="Connected channels"
        description="Optional. Helps brands understand your reach when they review approval-required campaigns."
      />

      {/*
        These are self-declared rather than API-verified. Requiring OAuth with
        every platform would exclude exactly the long-tail publishers this
        marketplace exists for — and it would not change payouts, which are
        driven purely by measured traffic. The UI says so plainly.
      */}
      <Alert tone="info" className="mt-4">
        These are self-reported and shown to brands as such. They never affect what you earn —
        payouts come from measured traffic only.
      </Alert>

      {socials.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {socials.map((social) => (
            <li
              key={social.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{social.platform}</Badge>
                  <span className="truncate text-sm text-fg">@{social.handle}</span>
                </div>
                {social.followers ? (
                  <p className="mt-0.5 text-2xs text-fg-subtle">
                    {social.followers.toLocaleString()} followers (self-reported)
                  </p>
                ) : null}
              </div>
              <Button size="xs" variant="ghost" loading={pending} onClick={() => remove(social.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_120px_auto] sm:items-end">
        <Select
          label="Platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
        />
        <Input
          label="Handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="yourhandle"
          prefix="@"
        />
        <Input
          label="Followers"
          value={followers}
          onChange={(event) => setFollowers(event.target.value)}
          placeholder="12000"
          inputMode="numeric"
        />
        <Button loading={pending} disabled={handle.trim() === ''} onClick={add}>
          Add
        </Button>
      </div>
    </Card>
  );
}

function NameField({ defaultValue }: { defaultValue: string }) {
  return (
    <Input
      name="displayName"
      label="Display name"
      defaultValue={defaultValue}
      required
      error={useFieldError('displayName')}
    />
  );
}

function HandleField({ defaultValue }: { defaultValue: string }) {
  return (
    <Input
      name="handle"
      label="Handle"
      defaultValue={defaultValue}
      prefix="@"
      required
      error={useFieldError('handle')}
      description="Changing this changes your public profile URL."
    />
  );
}

function BioField({ defaultValue }: { defaultValue: string }) {
  return (
    <Textarea
      name="bio"
      label="About you"
      defaultValue={defaultValue}
      rows={4}
      error={useFieldError('bio')}
    />
  );
}

function WebsiteField({ defaultValue }: { defaultValue: string }) {
  return (
    <Input
      name="website"
      label="Website"
      defaultValue={defaultValue}
      placeholder="https://example.com"
      error={useFieldError('website')}
    />
  );
}

function TypeSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <Select
      name="publisherType"
      label="Publisher type"
      defaultValue={defaultValue}
      options={PUBLISHER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
      error={useFieldError('publisherType')}
    />
  );
}

function CountrySelect({ defaultValue }: { defaultValue: string }) {
  return (
    <Select
      name="country"
      label="Your country"
      defaultValue={defaultValue}
      options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
      error={useFieldError('country')}
      description="Determines available payout methods."
    />
  );
}
