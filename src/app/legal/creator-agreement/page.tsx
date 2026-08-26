import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Creator Agreement',
  alternates: { canonical: '/legal/creator-agreement' },
};

export default function CreatorAgreementPage() {
  return (
    <LegalDocument
      title="Creator and Publisher Agreement"
      effectiveDate="on account creation"
      summary="The terms that apply specifically to creators and publishers earning on the platform."
    >
      <Section title="1. Your relationship with us">
        <p>
          You are an independent participant in a marketplace. You are not an employee, agent,
          partner, or joint venturer of {brand.legalName} or of any advertiser. You decide what to
          promote, how, and whether to promote anything at all.
        </p>
        <p>
          Nothing here guarantees you any level of earnings. What you earn depends entirely on the
          qualifying activity you generate.
        </p>
      </Section>

      <Section title="2. Taking a campaign link">
        <p>
          Before a link is issued you accept that campaign&apos;s terms. The version you accepted is
          recorded against the link. If a brand later changes the campaign&apos;s compensation or
          terms, that creates a new version — it does not retroactively change what you agreed to for
          activity already generated.
        </p>
      </Section>

      <Section title="3. What you are paid for">
        <List
          items={[
            'Only activity that meets the campaign’s stated rules and passes traffic-quality screening.',
            'The payout shown on the campaign is what reaches your balance. The platform commission is charged to the brand on top of it, not deducted from you.',
            'A campaign can only pay what it has funded. When a campaign’s budget is exhausted, traffic still reaches the advertiser but stops earning. Remaining budget is shown on every campaign page.',
          ]}
        />
      </Section>

      <Section title="4. Traffic quality">
        <p>
          Every click and conversion is screened. Where activity is flagged, the associated earnings
          are <strong>held</strong> pending review, not deleted. You are told which signal was
          triggered and why. If the review clears the activity, the earnings become available as
          normal.
        </p>
        <p>
          You may dispute any rejection through the platform. Disputes are reviewed by the platform
          operator, and the reasoning is recorded and shared with you.
        </p>
      </Section>

      <Section title="5. Getting paid">
        <List
          items={[
            'You need a connected payout account and, where required, tax information on file before funds can be sent.',
            'Earnings become withdrawable after the campaign’s verification period and any account hold period.',
            'You request a payout once your available balance clears the platform minimum.',
            'Sub-cent amounts stay in your balance until they can be paid whole — they are not rounded away.',
            'If a transfer fails, the full amount returns to your balance and you are told why.',
          ]}
        />
      </Section>

      <Section title="6. Reversals">
        <p>
          If an advertiser refunds an order, receives a chargeback, or a conversion is found to be
          invalid, the related earning may be reversed. Where a reversal exceeds your current
          balance, the shortfall is recovered from future earnings. Reversals appear in your earnings
          ledger with their reason.
        </p>
      </Section>

      <Section title="7. Disclosure">
        <p>
          Advertising disclosure requirements vary by country, platform, and content type. Complying
          with the ones that apply to you and your audience is your responsibility. Some campaigns
          state additional disclosure requirements, which are shown before you take the link. This is
          not legal advice.
        </p>
      </Section>

      <Section title="8. Tax">
        <p>
          You are responsible for your own tax obligations on what you earn. We may be required to
          collect tax information and report payments to tax authorities. We do not provide tax
          advice.
        </p>
      </Section>

      <Section title="9. Ending the relationship">
        <p>
          You can stop promoting at any time and deactivate your links. You can close your account
          once your balance is withdrawn. We may suspend an account for breach of the Acceptable Use
          Policy, and where we do we will tell you why and you may dispute it.
        </p>
      </Section>
    </LegalDocument>
  );
}
