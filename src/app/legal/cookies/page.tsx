import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  alternates: { canonical: '/legal/cookies' },
};

export default function CookiesPage() {
  return (
    <LegalDocument
      title="Cookie Policy"
      effectiveDate="on account creation"
      summary="The platform uses very few cookies, and none for advertising or cross-site profiling."
    >
      <Section title="Cookies this platform sets">
        <List
          items={[
            'A session cookie, set only after you sign in. It holds an opaque token, is HTTP-only, and is required for the application to work.',
            'A cross-site request forgery token, readable by the page so forms can echo it back. It contains no personal data.',
            'A theme preference, stored in your browser only and never sent to us.',
          ]}
        />
        <p>
          We do not set advertising cookies, and we do not use third-party analytics or tracking
          pixels on our own site.
        </p>
      </Section>

      <Section title="Cookies set by advertisers">
        <p>
          When you click a tracking link you are redirected to an advertiser&apos;s own website. What
          that site does — including any cookies it sets — is governed by its own policies, not ours.
          We pass it an opaque click identifier and nothing that identifies you.
        </p>
      </Section>

      <Section title="For brands installing our tracking SDK">
        <p>
          If you install the conversion tracking SDK on your site, it stores a click identifier in
          the visitor&apos;s browser (local storage, with a cookie fallback) so a later conversion
          can be attributed to the publisher who sent the visit. That identifier is opaque and
          contains no personal data.
        </p>
        <p>
          You are responsible for obtaining any consent required in your jurisdiction before
          initialising the SDK, and for describing it in your own cookie policy. The SDK exposes a{' '}
          <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-sm">clear()</code>{' '}
          method for wiring into a consent control.
        </p>
      </Section>
    </LegalDocument>
  );
}
