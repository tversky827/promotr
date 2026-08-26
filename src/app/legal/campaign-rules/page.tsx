import type { Metadata } from 'next';

import { LegalDocument, List, Section } from '@/components/legal/document';

export const metadata: Metadata = {
  title: 'Campaign Rules',
  alternates: { canonical: '/legal/campaign-rules' },
};

export default function CampaignRulesPage() {
  return (
    <LegalDocument
      title="Campaign Rules"
      effectiveDate="on account creation"
      summary="What a campaign must contain, what it may not contain, and how activity is judged billable."
    >
      <Section title="Every campaign must state">
        <List
          items={[
            'What it pays and for what event.',
            'What counts as a conversion, specifically enough that a publisher can predict it.',
            'The attribution window, and the window within which repeat visits are not separately billable.',
            'Which promotional channels are allowed and which are prohibited.',
            'Any geographic or age restrictions.',
            'Any disclosure requirements beyond those the law already imposes on the publisher.',
          ]}
        />
      </Section>

      <Section title="Campaigns may not">
        <List
          items={[
            'Promise guaranteed income, guaranteed returns, or risk-free investment.',
            'Make health claims that a product cures, treats, or prevents disease without substantiation.',
            'Point at a destination the advertiser does not control.',
            'Use a destination flagged for malware or phishing.',
            'Fall into a category the platform operator has excluded.',
            'Change compensation or destination after approval without returning to review.',
          ]}
        />
      </Section>

      <Section title="When activity is billable">
        <p>Activity is billable when all of the following hold:</p>
        <List
          items={[
            'It came from a channel the campaign allows and none it prohibits.',
            'It came from a country the campaign targets.',
            'It is not a repeat visit from the same device inside the campaign’s de-duplication window.',
            'It passed automated traffic-quality screening, or a human review cleared it.',
            'The campaign had remaining funded budget at the moment the activity occurred.',
            'The publisher’s account was in good standing.',
          ]}
        />
        <p>
          Where any of these fails, the activity is still recorded and visible to both parties — the
          brand can see the traffic arrived — but no charge and no earning are created.
        </p>
      </Section>

      <Section title="Traffic-quality signals">
        <p>
          Screening scores each event from 0 to 100 against a published set of signals: declared
          automation, missing user agents, datacenter origins, click bursts from one network, repeat
          clicks, publisher self-clicking, implausibly fast conversions, duplicate conversion
          identifiers, and abnormal conversion rates.
        </p>
        <p>
          No single behavioural signal is sufficient to reject activity on its own. Rejection
          requires either a definitive technical signal or a combination of behavioural ones. Every
          decision records the signals that produced it, and those signals are shown to the publisher.
        </p>
      </Section>
    </LegalDocument>
  );
}
