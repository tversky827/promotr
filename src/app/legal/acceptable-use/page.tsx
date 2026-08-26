import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';

export const metadata: Metadata = {
  title: 'Acceptable Use Policy',
  alternates: { canonical: '/legal/acceptable-use' },
};

export default function AcceptableUsePage() {
  return (
    <LegalDocument
      title="Acceptable Use Policy"
      effectiveDate="on account creation"
      summary="What is not allowed on the platform, for both publishers and brands."
    >
      <Section title="For publishers: traffic">
        <p>The following will result in traffic being rejected and may lead to suspension:</p>
        <List
          items={[
            'Automated, scripted, or bot-generated clicks, including headless browsers and click farms.',
            'Clicking your own links, or arranging for others to click them, for payment.',
            'Incentivising clicks with rewards, points, or payment, where the campaign prohibits it.',
            'Traffic exchanges, auto-surf services, and paid-to-click networks.',
            'Cookie stuffing, forced clicks, pop-unders, or any method that generates a click the visitor did not intend.',
            'Iframing or hiding tracking links so a visitor cannot see where they are going.',
            'Promoting through a channel the campaign lists as prohibited.',
          ]}
        />
      </Section>

      <Section title="For publishers: representation">
        <List
          items={[
            'Do not claim to be, or to be endorsed by, an advertiser you are not.',
            'Do not make claims about a product that the advertiser has not made or approved.',
            'Do not misrepresent prices, availability, guarantees, or outcomes.',
            'Do not bid on an advertiser’s brand terms in paid search unless the campaign expressly permits it.',
            'Do not register domains that imitate an advertiser’s domain.',
          ]}
        />
      </Section>

      <Section title="For brands: campaigns">
        <List
          items={[
            'Destinations must be sites you own or are authorised to promote, and must be reachable over https.',
            'Do not point an approved campaign at a different destination after approval. Doing so returns the campaign to review.',
            'Do not report conversions that did not occur, or withhold conversions that did.',
            'Do not reject valid activity to avoid paying for it. Rejections are reviewable, and a pattern of unjustified rejections is itself a breach.',
            'Campaign content must be accurate and must not make unsupportable claims about income, health outcomes, or investment returns.',
          ]}
        />
      </Section>

      <Section title="Prohibited categories">
        <p>
          The platform does not accept campaigns for certain categories. The current list is set by
          the platform operator and is enforced during campaign moderation. Categories commonly
          excluded include adult content, gambling, weapons, tobacco and nicotine, illicit
          substances, payday lending, and speculative investment schemes.
        </p>
      </Section>

      <Section title="Enforcement">
        <p>
          Automated screening runs on every click and every conversion. Where it flags activity, the
          associated earnings are held for review rather than removed, and both the publisher and the
          reviewing administrator see the specific signals that triggered the flag. Decisions can be
          disputed.
        </p>
        <p>
          Serious or repeated breaches result in account suspension. Suspension stops future
          billable activity; it does not automatically forfeit earnings for activity that was
          legitimate.
        </p>
      </Section>
    </LegalDocument>
  );
}
