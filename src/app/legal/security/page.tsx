import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Security',
  alternates: { canonical: '/legal/security' },
};

export default function SecurityPage() {
  return (
    <LegalDocument
      title="Security"
      effectiveDate="on account creation"
      summary="How the platform protects accounts, money, and visitor data. This describes what is actually implemented."
    >
      <Section title="Accounts">
        <List
          items={[
            'Passwords are hashed with scrypt at OWASP-recommended parameters. Plaintext passwords are never stored or logged.',
            'Session tokens are stored only as SHA-256 hashes, so a database compromise cannot be replayed as a live session.',
            'Administrator accounts require multi-factor authentication before any privileged action, not merely at sign-in.',
            'Repeated failed sign-ins trigger a progressive lockout. Rate limits apply per address and per account.',
            'A password reset signs out every other session.',
            'Sign-up, sign-in and password reset return identical responses whether or not an account exists, so the endpoints cannot be used to discover who has an account.',
          ]}
        />
      </Section>

      <Section title="Money">
        <List
          items={[
            'All financial movement goes through a double-entry ledger. Entries are append-only, enforced by database triggers — a correction is a new offsetting entry, never an edit.',
            'Every transaction must balance. The database rejects an unbalanced transaction at commit.',
            'Campaign budgets are protected by row locks, so concurrent billable events cannot overspend a campaign. A database CHECK constraint enforces the same rule independently of application code.',
            'Every posting carries an idempotency key, so a webhook replay or a job retry cannot double-charge or double-pay.',
            'Cached account balances are reconciled against the sum of their entries nightly and on demand. Any drift is escalated rather than silently corrected.',
            'Card details never reach our servers — payment is handled entirely by our payment provider.',
          ]}
        />
      </Section>

      <Section title="Visitor data">
        <List
          items={[
            'Raw IP addresses are never written to storage. They are replaced with a keyed HMAC at the point of collection.',
            'Referring URLs are reduced to their hostname, because query strings on referring pages frequently contain personal data.',
            'Nothing identifying is forwarded to advertisers — only an opaque click identifier meaningless outside our database.',
            'Raw tracking records are deleted in bulk after a configurable retention period.',
          ]}
        />
      </Section>

      <Section title="Application">
        <List
          items={[
            'Every mutation verifies both the request origin and a double-submit token.',
            'Every database query is parameterised. Dynamic SQL is confined to a closed set of column and interval names, never user input.',
            'Authorisation is enforced by named permissions resolved from the session, never from an identifier supplied by the client.',
            'Redirect destinations are validated against private address ranges and screened for malware where screening is configured. Where it is not configured, campaigns are flagged for manual review rather than passed.',
            'Outbound webhooks are signed with a timestamped HMAC, so a captured delivery cannot be replayed.',
            'Secrets at rest — multi-factor seeds, webhook secrets, OAuth tokens, tax identifiers — are encrypted with AES-256-GCM.',
            'Error responses never include stack traces. Unexpected errors return a reference the user can quote to support.',
          ]}
        />
      </Section>

      <Section title="Auditability">
        <p>
          Every administrative and financial action records the actor, the timestamp, a written
          reason, and the before and after state. The audit log is append-only and is readable in the
          admin panel.
        </p>
      </Section>

      <Section title="Reporting a vulnerability">
        <p>
          If you believe you have found a security issue, email{' '}
          <a href={`mailto:${brand.supportEmail}`} className="text-primary hover:underline">
            {brand.supportEmail}
          </a>{' '}
          with enough detail to reproduce it. Please do not test against other people&apos;s accounts
          or data, and give us reasonable time to respond before disclosing publicly.
        </p>
      </Section>
    </LegalDocument>
  );
}
