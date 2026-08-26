import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Brand Agreement',
  alternates: { canonical: '/legal/brand-agreement' },
};

export default function BrandAgreementPage() {
  return (
    <LegalDocument
      title="Brand Agreement"
      effectiveDate="on account creation"
      summary="The terms that apply specifically to advertisers running campaigns on the platform."
    >
      <Section title="1. Your campaigns">
        <p>
          You are responsible for the accuracy and legality of everything in your campaign: the
          product, the claims, the destination, and the terms publishers accept. You warrant that you
          own or are authorised to promote the destination you point traffic at.
        </p>
      </Section>

      <Section title="2. Review and approval">
        <p>
          Campaigns are screened before going live. Screening covers destination safety, prohibited
          categories, and unsupportable claims. Changing a live campaign&apos;s compensation or
          destination returns it to review — approval would mean nothing otherwise.
        </p>
      </Section>

      <Section title="3. Funding and what you are charged">
        <List
          items={[
            'You fund a campaign in advance. It can never accrue more than its funded balance — this is enforced at the database level, not merely in the interface.',
            'You are charged only for activity that meets your campaign’s rules and passes traffic-quality screening.',
            'The publisher payout you set is what the publisher receives. The platform commission is added on top and is shown to you before you launch, and on every line of your spend report.',
            'Unspent budget returns to your account balance when a campaign ends, and can be reallocated or refunded.',
          ]}
        />
      </Section>

      <Section title="4. Reporting conversions">
        <p>
          You report conversions through the pixel, server-to-server postback, REST API, or webhook.
          Whichever you use, you must supply a stable conversion identifier so duplicates can be
          detected. You will not be charged twice for the same identifier.
        </p>
        <p>
          You must report conversions accurately. Systematically withholding conversions that
          occurred, or rejecting valid activity to avoid paying, is a breach of these terms and of the
          Acceptable Use Policy.
        </p>
      </Section>

      <Section title="5. Disputes and reversals">
        <p>
          You may dispute activity you believe is invalid, with the specific click or conversion
          identifiers. Where a dispute is upheld, the associated charge is reversed and the funds
          return to your campaign.
        </p>
        <p>
          Where a dispute is not upheld, the charge stands. Publishers can also dispute your
          rejections, and those are reviewed on the same basis.
        </p>
      </Section>

      <Section title="6. Chargebacks">
        <p>
          Initiating a payment chargeback rather than using the dispute process will suspend your
          account and pause your live campaigns. Publisher earnings already accrued are not reversed —
          they delivered the traffic, and a payment dispute between you and us is not their concern.
        </p>
      </Section>

      <Section title="7. Publisher relationships">
        <p>
          You may set approval requirements, channel restrictions, and geographic targeting. You may
          not require publishers to act as your agents, make claims on your behalf beyond your
          approved creative, or bypass the platform to transact directly on campaigns discovered here.
        </p>
      </Section>

      <Section title="8. Data">
        <p>
          {brand.legalName} passes you an opaque click identifier and any tracking parameters the
          publisher set. It does not pass you personal data about visitors. Anything your own site
          collects after the redirect is governed by your policies and your obligations.
        </p>
      </Section>
    </LegalDocument>
  );
}
