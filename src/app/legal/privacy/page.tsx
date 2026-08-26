import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${brand.name} handles personal data.`,
  alternates: { canonical: '/legal/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate="on account creation"
      summary="What we collect, why, how long we keep it, and what you can do about it. This describes the platform's actual implementation, not an aspiration."
    >
      <Section title="1. Two kinds of data">
        <p>
          This platform handles two very different categories, and it is worth separating them
          clearly:
        </p>
        <List
          items={[
            'Account data — information about brands and publishers who hold accounts with us: name, email, business details, payout status, earnings.',
            'Traffic data — information about visitors who click a tracking link. These people do not have accounts with us, and we deliberately collect as little about them as the system can function on.',
          ]}
        />
      </Section>

      <Section title="2. What we collect about visitors">
        <p>When someone clicks a tracking link, we record:</p>
        <List
          items={[
            'A pseudonymous identifier derived from the IP address using a keyed one-way hash. The raw IP address is never written to storage.',
            'A coarse network-level hash (equivalent to a /24 for IPv4) used to detect click bursts.',
            'Country, and where the hosting platform provides it, region and city.',
            'Device type, browser family, and operating system family, derived from the user-agent string.',
            'The referring website’s hostname. The full referring URL is deliberately discarded, because query strings on referring pages frequently contain personal data.',
            'Any campaign tracking parameters the publisher set (sub-ID and UTM values).',
            'A device fingerprint derived from the above using a keyed hash, used solely to avoid billing an advertiser twice for the same visitor.',
          ]}
        />
        <p>
          We do not collect names, email addresses, precise location, cross-site browsing history, or
          any special-category data about visitors. We do not sell traffic data, and we do not share
          it with advertisers beyond an opaque click identifier that is meaningless outside our
          database.
        </p>
      </Section>

      <Section title="3. Why we can collect it">
        <p>
          Traffic data is processed for fraud prevention, billing accuracy, and attribution — the
          legitimate interests of operating an advertising marketplace where advertisers are charged
          only for genuine activity. Account data is processed to perform our contract with you and
          to meet legal obligations including tax reporting and anti-fraud requirements.
        </p>
      </Section>

      <Section title="4. Retention">
        <List
          items={[
            'Raw click and impression records are retained for a configurable period (180 days by default) and are then deleted in bulk.',
            'Aggregated statistics, which contain no visitor-level data, are retained indefinitely so historical reporting survives.',
            'Financial records — earnings, ledger entries, payouts — are retained as long as required for tax and audit purposes, typically at least seven years.',
            'Session records are deleted shortly after expiry.',
          ]}
        />
      </Section>

      <Section title="5. Your rights over account data">
        <p>
          If you hold an account you can, from your account settings:
        </p>
        <List
          items={[
            'Export everything we hold about you, as machine-readable JSON.',
            'Correct your profile and business information directly.',
            'Request deletion of your account. Where you have an outstanding balance we will ask you to withdraw it first, since deleting the account would strand money we hold for you.',
            'Withdraw marketing consent without affecting service emails, which are necessary to operate your account.',
          ]}
        />
        <p>
          Depending on where you live you may have additional rights, including the right to object
          to processing and to complain to a supervisory authority.
        </p>
      </Section>

      <Section title="6. Sub-processors">
        <p>
          We use third parties to operate the service. Which ones are active depends on how this
          deployment is configured, and the current set is visible to the operator in the admin
          system-health screen. Typically these are a payment provider, an email delivery provider,
          object storage, and error monitoring.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          Passwords are stored using a memory-hard key derivation function. Secrets held at rest —
          multi-factor seeds, webhook signing secrets, tax identifiers — are encrypted with
          authenticated encryption. Session tokens are stored only as hashes, so a database
          compromise cannot be replayed as a live session. See the{' '}
          <a href="/legal/security" className="text-primary hover:underline">
            security page
          </a>{' '}
          for more.
        </p>
      </Section>

      <Section title="8. Contact">
        <p>
          Privacy questions and data requests:{' '}
          <a href={`mailto:${brand.supportEmail}`} className="text-primary hover:underline">
            {brand.supportEmail}
          </a>
        </p>
      </Section>
    </LegalDocument>
  );
}
