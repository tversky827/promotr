import Link from 'next/link';
import type { Metadata } from 'next';

import { MarketingFooter, MarketingNav } from '@/components/marketing/nav';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { homePathFor } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import { brand } from '@/lib/brand';
import { prisma } from '@/lib/db';
import { formatMicros } from '@/lib/money';
import { describePayout } from '@/lib/format';

export const metadata: Metadata = {
  title: `${brand.name} — Get paid to drive traffic`,
  description:
    'Brands pay creators and publishers for measurable performance. Discover campaigns, get your tracking link, promote, and earn.',
  alternates: { canonical: '/' },
};

// The landing page shows live campaign data, so it revalidates rather than
// being fully static.
export const revalidate = 300;

export default async function LandingPage() {
  const session = await getSession();

  // Real campaigns, not illustrations. If none are live yet the section is
  // simply omitted rather than filled with invented examples.
  const featured = await prisma.campaign
    .findMany({
      where: { status: 'ACTIVE', isPublic: true },
      orderBy: { payoutMicros: 'desc' },
      take: 3,
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        payoutModel: true,
        payoutMicros: true,
        revshareBps: true,
        brand: { select: { displayName: true } },
      },
    })
    .catch(() => []);

  return (
    <>
      <MarketingNav
        signedIn={Boolean(session)}
        homePath={session ? homePathFor(session.user.role) : '/login'}
      />

      <main id="main">
        <Hero featured={featured.length} />
        <LogosStrip />
        <HowItWorks />
        {featured.length > 0 ? <FeaturedCampaigns campaigns={featured} /> : null}
        <ForCreators />
        <ForBrands />
        <FraudSection />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>

      <MarketingFooter />
    </>
  );
}

function Hero({ featured }: { featured: number }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 grid-backdrop" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="primary" className="mb-5">
            Performance-based, not follower-based
          </Badge>

          <h1 className="text-4xl font-semibold tracking-tight text-fg text-balance sm:text-5xl lg:text-6xl">
            Get paid to drive traffic.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-muted text-pretty">
            Brands pay creators and publishers for measurable performance. Discover campaigns, get
            your tracking link, promote, and earn — with no negotiation and no waiting for approval.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/campaigns" size="lg" className="w-full sm:w-auto">
              Find campaigns
            </ButtonLink>
            <ButtonLink href="/signup?type=brand" variant="secondary" size="lg" className="w-full sm:w-auto">
              Launch a campaign
            </ButtonLink>
          </div>

          <p className="mt-4 text-sm text-fg-subtle">
            Free to join for creators and publishers. No minimum audience size.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-4xl">
          <TrackingLinkPreview />
        </div>

        {featured > 0 ? (
          <p className="mt-6 text-center text-sm text-fg-subtle">
            {featured} campaign{featured === 1 ? '' : 's'} currently accepting traffic.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** A static illustration of the link-generation moment — the core promise. */
function TrackingLinkPreview() {
  return (
    <div className="card overflow-hidden shadow-lg" aria-hidden="true">
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-sunken px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-danger/40" />
        <span className="size-2.5 rounded-full bg-warning/40" />
        <span className="size-2.5 rounded-full bg-success/40" />
        <span className="ml-3 text-xs text-fg-subtle">Get your tracking link</span>
      </div>

      <div className="grid gap-0 sm:grid-cols-[1.3fr_1fr]">
        <div className="border-b border-border p-5 sm:border-b-0 sm:border-r">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-fg-subtle">Campaign</div>
              <div className="mt-1 text-md font-semibold text-fg">Everyday Athletic — Spring Drop</div>
            </div>
            <Badge tone="success" dot>
              Open
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-fg-subtle">Your payout</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-fg">$0.35</div>
              <div className="text-xs text-fg-subtle">per qualified click</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-fg-subtle">Budget left</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-fg">$8,420</div>
              <div className="text-xs text-fg-subtle">of $10,000</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs uppercase tracking-wide text-fg-subtle">Tracking link</div>
            <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2">
              <code className="flex-1 truncate font-mono text-sm text-fg">
                {brand.trackingUrl.replace(/^https?:\/\//, '')}/go/K7M2QX9F4B
              </code>
              <span className="shrink-0 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-fg">
                Copy
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-sunken/60 p-5">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">Live performance</div>
          <dl className="mt-3 space-y-3">
            {[
              ['Clicks', '1,284'],
              ['Qualified', '1,190'],
              ['Conversions', '47'],
              ['Earned', '$416.50'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-fg-muted">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-fg">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-fg-muted">EPC</span>
              <span className="text-sm font-semibold tabular-nums text-success">$0.32</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogosStrip() {
  const items = [
    'TikTok creators',
    'YouTubers',
    'Newsletters',
    'Niche websites',
    'Podcasts',
    'Communities',
  ];
  return (
    <section className="border-b border-border bg-surface-sunken/40 py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-fg-subtle">
          Built for every kind of publisher
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {items.map((item) => (
            <span key={item} className="text-base font-medium text-fg-muted">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Find a campaign',
      body: 'Browse open campaigns by payout, category, and the channels you actually use. Every campaign shows its exact terms up front.',
    },
    {
      title: 'Get your link',
      body: 'Accept the terms and your unique tracking link is generated instantly. No application, no media kit, no waiting — unless the brand specifically requires approval.',
    },
    {
      title: 'Promote it',
      body: 'Share it wherever your audience is. Add a sub-ID to see which post, video, or send performed best.',
    },
    {
      title: 'Get paid',
      body: 'Qualified traffic and conversions become earnings automatically. Withdraw once you clear the payout minimum.',
    },
  ];

  return (
    <section id="how-it-works" className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
            From campaign to paid, in four steps
          </h2>
          <p className="mt-3 text-md text-fg-muted text-pretty">
            The whole point is that there is no negotiation in the middle.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary">
                {index + 1}
              </div>
              <h3 className="mt-4 text-md font-semibold text-fg">{step.title}</h3>
              <p className="mt-2 text-sm text-fg-muted text-pretty">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FeaturedCampaigns({
  campaigns,
}: {
  campaigns: Array<{
    id: string;
    slug: string;
    name: string;
    category: string;
    payoutModel: string;
    payoutMicros: bigint;
    revshareBps: number;
    brand: { displayName: string };
  }>;
}) {
  return (
    <section className="border-b border-border bg-surface-sunken/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
              Campaigns accepting traffic now
            </h2>
            <p className="mt-2 text-md text-fg-muted">Live payouts, updated continuously.</p>
          </div>
          <ButtonLink href="/campaigns" variant="secondary" size="sm">
            View all campaigns
          </ButtonLink>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.slug}`}
              className="card group p-5 transition-all hover:border-border-strong hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs uppercase tracking-wide text-fg-subtle">
                    {campaign.brand.displayName}
                  </p>
                  <h3 className="mt-1 text-md font-semibold text-fg group-hover:text-primary">
                    {campaign.name}
                  </h3>
                </div>
                <Badge tone="neutral">{campaign.category}</Badge>
              </div>
              <div className="mt-5 border-t border-border pt-4">
                <div className="text-xl font-semibold tabular-nums text-fg">
                  {formatMicros(campaign.payoutMicros)}
                </div>
                <div className="mt-0.5 text-sm text-fg-muted">
                  {describePayout(campaign)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForCreators() {
  const points = [
    {
      title: 'No audience minimum',
      body: 'A newsletter with 400 engaged readers can out-earn an account with 400,000 passive followers. Payment is tied to results, not reach.',
    },
    {
      title: 'Know your rate before you post',
      body: 'Every campaign states the payout, the rules, and the attribution window before you take the link. Nothing changes after the fact.',
    },
    {
      title: 'Sub-IDs for every placement',
      body: 'Tag each video, post, or send. See exactly which placement earned what, and stop guessing.',
    },
    {
      title: 'An earnings ledger you can audit',
      body: 'Every cent traces to a specific click or conversion, with its status and the reason for it. No opaque balance.',
    },
  ];

  return (
    <section id="creators" className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Badge tone="primary" className="mb-4">
              For creators and publishers
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
              Your distribution is worth something. Price it accordingly.
            </h2>
            <p className="mt-4 text-md text-fg-muted text-pretty">
              Whether you run a TikTok account, a niche site, a Discord server, or a Substack, the
              same thing is true: you can send qualified people somewhere. This is where that gets
              paid for directly.
            </p>
            <div className="mt-7">
              <ButtonLink href="/signup?type=creator" size="lg">
                Start earning
              </ButtonLink>
            </div>
          </div>

          <dl className="grid gap-6 sm:grid-cols-2">
            {points.map((point) => (
              <div key={point.title}>
                <dt className="text-md font-semibold text-fg">{point.title}</dt>
                <dd className="mt-2 text-sm text-fg-muted text-pretty">{point.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function ForBrands() {
  const points = [
    {
      title: 'Pay for outcomes',
      body: 'Set a price per click, lead, sale, thousand impressions, or a share of revenue. You are never billed for activity outside the rules you set.',
    },
    {
      title: 'Distribution without recruiting',
      body: 'Publishers discover your campaign and start immediately. You can require approval when it matters, but you never have to hand-pick anyone.',
    },
    {
      title: 'Hard budget ceilings',
      body: 'A campaign can never spend more than you funded. Concurrent traffic is serialised against the budget, so an overspend is impossible.',
    },
    {
      title: 'Attribution you control',
      body: 'JavaScript pixel, server-to-server postback, REST API, or webhook. Pick the one that matches how your stack already works.',
    },
  ];

  return (
    <section id="brands" className="border-b border-border bg-surface-sunken/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <dl className="order-2 grid gap-6 sm:grid-cols-2 lg:order-1">
            {points.map((point) => (
              <div key={point.title}>
                <dt className="text-md font-semibold text-fg">{point.title}</dt>
                <dd className="mt-2 text-sm text-fg-muted text-pretty">{point.body}</dd>
              </div>
            ))}
          </dl>

          <div className="order-1 lg:order-2">
            <Badge tone="primary" className="mb-4">
              For brands
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
              Buy measured outcomes, not impressions you hope worked.
            </h2>
            <p className="mt-4 text-md text-fg-muted text-pretty">
              Post a campaign, fund it, and pay only for the activity that meets your rules. The
              platform handles discovery, tracking, attribution, fraud screening, and publisher
              payments.
            </p>
            <div className="mt-7">
              <ButtonLink href="/signup?type=brand" size="lg">
                Launch a campaign
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FraudSection() {
  const signals = [
    'Headless browsers and scripted clients',
    'Datacenter and proxy traffic',
    'Click bursts from a single network',
    'Repeat clicks inside the dedupe window',
    'Self-clicking by the publisher',
    'Conversions faster than humanly possible',
    'Duplicate conversion reports',
    'Traffic from prohibited channels',
  ];

  return (
    <section id="fraud" className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <Badge tone="primary" className="mb-4">
            Traffic quality
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
            Fraud screening that explains itself
          </h2>
          <p className="mt-3 text-md text-fg-muted text-pretty">
            Every click is scored against a set of signals before it becomes billable. Brands are not
            charged for traffic that fails. Publishers are told exactly what was flagged and can
            dispute it — a flag holds earnings for review, it does not delete them.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-3xl gap-x-8 gap-y-3 sm:grid-cols-2">
          {signals.map((signal) => (
            <div key={signal} className="flex items-start gap-2.5">
              <svg
                viewBox="0 0 20 20"
                className="mt-0.5 size-4 shrink-0 text-success"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
                <path
                  d="m6.5 10 2.5 2.5 4.5-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-sm text-fg-muted">{signal}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-b border-border bg-surface-sunken/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
            Transparent pricing
          </h2>
          <p className="mt-3 text-md text-fg-muted text-pretty">
            One commission on performance. No listing fees, no monthly minimums, no charge for
            traffic that fails quality checks.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-md font-semibold text-fg">Creators &amp; publishers</h3>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-fg">Free</p>
            <p className="mt-2 text-sm text-fg-muted text-pretty">
              You keep the payout the campaign advertises. The rate you see on a campaign card is
              the rate that lands in your balance — the platform commission is charged to the brand
              on top, not deducted from you.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-fg-muted">
              {['No signup fee', 'No revenue share on your payout', 'Payouts via Stripe'].map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-success">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="card border-primary/30 p-6 ring-1 ring-primary/15">
            <h3 className="text-md font-semibold text-fg">Brands</h3>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-fg">
              Commission<span className="text-lg font-normal text-fg-muted"> on performance</span>
            </p>
            <p className="mt-2 text-sm text-fg-muted text-pretty">
              A percentage on top of what you pay publishers, charged only on billable activity.
              Your exact rate is shown on every campaign before you launch it, and on every line of
              your spend report.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-fg-muted">
              {[
                'Only charged on qualified activity',
                'Fraudulent traffic is never billed',
                'Unspent budget returns to your balance',
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-success">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const faqs = [
    {
      q: 'Do I need a large following to join?',
      a: 'No. There is no minimum audience size. Campaigns pay for measurable activity, so a small, engaged audience that converts is worth more than a large one that does not.',
    },
    {
      q: 'How quickly can I start promoting?',
      a: 'For open campaigns, immediately. Accept the campaign terms and your tracking link is generated on the spot. Some brands choose to require approval, and those campaigns are labelled as such before you apply.',
    },
    {
      q: 'When do I get paid?',
      a: 'Earnings accrue as pending, are approved after the campaign’s verification period, then become available to withdraw. You request a payout once your available balance clears the platform minimum. Funds are sent through Stripe to your connected account.',
    },
    {
      q: 'What happens if my traffic gets flagged?',
      a: 'The affected earnings are held for review, not removed. You are told which signal was triggered and why, and you can open a dispute from your dashboard. If the review clears the traffic, the earnings become available as normal.',
    },
    {
      q: 'How do brands report conversions?',
      a: 'Four ways: a JavaScript pixel, a server-to-server postback, the REST API, or an inbound webhook. All four are de-duplicated against the same conversion identifier, so a brand is never charged twice for one order.',
    },
    {
      q: 'Can a campaign run out of money mid-click?',
      a: 'A campaign can only accrue what its funded budget covers. When the budget is exhausted, traffic still reaches the advertiser, but the brand is not charged and no earning is created. The campaign card shows remaining budget so you can see this coming.',
    },
    {
      q: 'Do I need to disclose that a link is sponsored?',
      a: 'Advertising disclosure requirements vary by country, platform, and content type, and complying with the ones that apply to you is your responsibility. Campaigns may also carry their own disclosure requirements, which are shown on the campaign page. This is not legal advice.',
    },
    {
      q: 'What data do you collect about visitors?',
      a: 'As little as possible. Raw IP addresses are never stored — they are replaced with a keyed hash used for fraud detection. We forward nothing identifying to the advertiser beyond an opaque click identifier. See the privacy policy for the full detail.',
    },
  ];

  return (
    <section className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance">
          Common questions
        </h2>

        <dl className="mt-8 divide-y divide-border">
          {faqs.map((faq) => (
            <div key={faq.q} className="py-5">
              <dt className="text-md font-semibold text-fg">{faq.q}</dt>
              <dd className="mt-2 text-sm text-fg-muted text-pretty">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Structured data so these answers can surface in search results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((faq) => ({
              '@type': 'Question',
              name: faq.q,
              acceptedAnswer: { '@type': 'Answer', text: faq.a },
            })),
          }),
        }}
      />
    </section>
  );
}

function FinalCta() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-fg text-balance sm:text-4xl">
          Start in the next five minutes
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-md text-fg-muted text-pretty">
          Creators: find a campaign and take your link. Brands: post a campaign, fund it, and start
          getting traffic today.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/campaigns" size="lg" className="w-full sm:w-auto">
            Find campaigns
          </ButtonLink>
          <ButtonLink href="/signup?type=brand" variant="secondary" size="lg" className="w-full sm:w-auto">
            Launch a campaign
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
