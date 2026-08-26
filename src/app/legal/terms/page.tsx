import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms governing use of ${brand.name}.`,
  alternates: { canonical: '/legal/terms' },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate="on account creation"
      summary={`These terms govern your use of ${brand.name}, a performance advertising marketplace connecting brands with creators and publishers.`}
    >
      <Section title="1. What this platform is">
        <p>
          {brand.legalName} operates an advertising technology marketplace. Brands publish campaigns
          that pay for measurable outcomes. Creators and publishers promote those campaigns using
          tracking links and are paid for qualifying activity.
        </p>
        <p>
          {brand.name} is <strong>not</strong> a bank, a broker-dealer, a money transmitter acting on
          its own account, an investment product, or an employer of the publishers who use it. It
          does not guarantee income, advertising results, or any level of earnings.
        </p>
      </Section>

      <Section title="2. Accounts">
        <List
          items={[
            'You must provide accurate information and keep it current.',
            'You are responsible for everything that happens under your account, including keeping your credentials secure.',
            'One person or business may not operate multiple accounts to circumvent limits, holds, or suspensions.',
            'We may require identity or business verification before money moves, and may decline or reverse verification at our discretion.',
          ]}
        />
      </Section>

      <Section title="3. How compensation works">
        <p>
          A campaign states what it pays and for what activity. Activity is billable only when it
          meets the campaign&apos;s stated rules and passes automated traffic-quality screening.
        </p>
        <List
          items={[
            'Earnings accrue as pending, are approved after the campaign’s verification period, and become withdrawable after any hold period stated in your account.',
            'Traffic that fails quality screening is not billable. Where screening flags activity for review, associated earnings are held pending that review and are released if the review clears them.',
            'Conversions may be reversed if the underlying transaction is refunded, charged back, or found to be invalid. Reversals are applied to your balance and are visible in your earnings ledger.',
            'Amounts are calculated using exact integer arithmetic. Sub-cent amounts remain in your balance until they can be paid whole.',
          ]}
        />
      </Section>

      <Section title="4. Payments and payouts">
        <List
          items={[
            'Brands fund campaigns in advance. A campaign cannot accrue liability beyond its funded balance.',
            'Publisher payouts are made through our payment provider once your available balance clears the platform minimum and any required verification or tax information is on file.',
            'We do not store payment card details. Card processing and payout onboarding are handled by our payment provider.',
            'A failed payout returns the full amount to your available balance. You will be told why it failed.',
          ]}
        />
      </Section>

      <Section title="5. Prohibited conduct">
        <p>
          The Acceptable Use Policy forms part of these terms. In summary, you may not generate
          artificial traffic, misrepresent an advertiser, use prohibited promotional methods, or
          attempt to manipulate tracking or attribution.
        </p>
      </Section>

      <Section title="6. Suspension and termination">
        <p>
          We may suspend an account, pause a campaign, or place a hold on payouts where we
          reasonably believe these terms have been breached, where required by law, or where there is
          a credible risk of fraud. Where we do, we will tell you the reason and you may dispute the
          decision through the platform.
        </p>
        <p>
          Suspending an account does not, by itself, forfeit earnings for activity that was
          legitimate. Where a review determines activity was legitimate, the associated earnings are
          released.
        </p>
      </Section>

      <Section title="7. Disputes">
        <p>
          Both brands and publishers may raise a dispute through the platform. Disputes are reviewed
          by the platform operator, and the decision and its reasoning are recorded and shared with
          both parties.
        </p>
      </Section>

      <Section title="8. Disclosure and compliance">
        <p>
          You are solely responsible for complying with advertising disclosure requirements, consumer
          protection law, data protection law, and tax obligations that apply to you. Campaigns may
          state additional disclosure requirements. Nothing in this platform constitutes legal or tax
          advice.
        </p>
      </Section>

      <Section title="9. Liability">
        <p>
          To the maximum extent permitted by law, {brand.legalName} is not liable for indirect,
          incidental, or consequential losses, or for lost profits or anticipated earnings. Nothing
          in these terms limits liability that cannot lawfully be limited.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          We may update these terms. Material changes are notified to account holders, and the
          version you accepted is recorded against your account.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions about these terms: <a href={`mailto:${brand.supportEmail}`} className="text-primary hover:underline">{brand.supportEmail}</a>
        </p>
      </Section>
    </LegalDocument>
  );
}
