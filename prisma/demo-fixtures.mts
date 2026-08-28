/**
 * Audicents demo fixtures.
 *
 * Every brand here is fictional. None of the names, products or logos belong to
 * a real company, which is deliberate: a demo that borrows a real trademark
 * cannot be shown publicly.
 *
 * The performance figures are chosen, not random, and they reconcile: the
 * publisher's campaign rows sum to the totals on their dashboard, the pending
 * and available splits sum to lifetime earnings, and the brand's campaign rows
 * sum to the totals on theirs. `npm run db:seed:demo` asserts that before it
 * writes anything, so a figure edited here cannot quietly desynchronise the
 * screens.
 */

export interface DemoBrandFixture {
  key: string;
  name: string;
  legalName: string;
  category: string;
  website: string;
  about: string;
  /** Two-letter monogram drawn as the brand mark. No third-party logos. */
  monogram: string;
  /** Brand accent, as an HSL triple, used for the generated logo tile. */
  hsl: string;
}

export const DEMO_BRANDS: DemoBrandFixture[] = [
  {
    key: 'northline',
    name: 'Northline',
    legalName: 'Northline Supply Co.',
    category: 'fashion',
    website: 'https://northline.example.com',
    about: 'Considered everyday clothing, made to outlast the season it was bought in.',
    monogram: 'NL',
    hsl: '154 40% 26%',
  },
  {
    key: 'terrafuel',
    name: 'TerraFuel',
    legalName: 'TerraFuel Nutrition Inc.',
    category: 'fitness',
    website: 'https://terrafuel.example.com',
    about: 'Whole-food greens and daily nutrition for people who train.',
    monogram: 'TF',
    hsl: '96 38% 30%',
  },
  {
    key: 'ember',
    name: 'Ember Coffee',
    legalName: 'Ember Coffee Roasters LLC',
    category: 'food',
    website: 'https://embercoffee.example.com',
    about: 'Small-batch roasts shipped within two days of roasting.',
    monogram: 'EC',
    hsl: '22 52% 34%',
  },
  {
    key: 'oakiron',
    name: 'Oak & Iron',
    legalName: 'Oak & Iron Furniture Co.',
    category: 'lifestyle',
    website: 'https://oakandiron.example.com',
    about: 'Solid-wood furniture built to order in North Carolina.',
    monogram: 'OI',
    hsl: '30 34% 28%',
  },
  {
    key: 'haven',
    name: 'Haven Travel',
    legalName: 'Haven Travel Club Ltd.',
    category: 'travel',
    website: 'https://haventravel.example.com',
    about: 'A membership that finds and books quiet places to stay.',
    monogram: 'HT',
    hsl: '190 40% 30%',
  },
  {
    key: 'fieldhouse',
    name: 'Fieldhouse',
    legalName: 'Fieldhouse Athletic Co.',
    category: 'fitness',
    website: 'https://fieldhouse.example.com',
    about: 'Training gear for garage gyms and small clubs.',
    monogram: 'FH',
    hsl: '210 34% 32%',
  },
  {
    key: 'vantage',
    name: 'Vantage',
    legalName: 'Vantage Money Inc.',
    category: 'finance',
    website: 'https://vantage.example.com',
    about: 'A budgeting app that shows where the month actually went.',
    monogram: 'VG',
    hsl: '168 38% 28%',
  },
  {
    key: 'lumen',
    name: 'Lumen Labs',
    legalName: 'Lumen Labs Skincare Inc.',
    category: 'beauty',
    website: 'https://lumenlabs.example.com',
    about: 'Short-ingredient skincare, tested on humans who volunteered.',
    monogram: 'LL',
    hsl: '340 26% 36%',
  },
  {
    key: 'cadence',
    name: 'Cadence',
    legalName: 'Cadence Audio Inc.',
    category: 'tech',
    website: 'https://cadenceaudio.example.com',
    about: 'Open-back headphones and desktop amplifiers for people who listen closely.',
    monogram: 'CD',
    hsl: '260 24% 36%',
  },
];

export type PayoutModelKey = 'CPC' | 'CPA' | 'CPL' | 'REVSHARE';

export interface DemoCampaignFixture {
  key: string;
  brand: string;
  name: string;
  objective: string;
  model: PayoutModelKey;
  /** Publisher earning per billable event, in dollars. Zero for revenue share. */
  payout: string;
  /** Publisher share of revenue, in basis points. Zero for fixed payouts. */
  revshareBps?: number;
  /** One line for the marketplace card. */
  offer: string;
  /** What the product actually is. */
  product: string;
  /** Who the brand wants this put in front of. */
  audience: string;
  description: string;
  conversionRules: string;
  countries: string[];
  channels: string[];
  /** Copy a publisher may use as-is; shown on the campaign page. */
  exampleCopy: string;
  /** Extra rules beyond the standard prohibitions. */
  rules: Array<{ kind: 'ALLOWED' | 'PROHIBITED' | 'REQUIREMENT'; label: string; detail?: string }>;
}

const STANDARD_RULES: DemoCampaignFixture['rules'] = [
  {
    kind: 'REQUIREMENT',
    label: 'Disclose the paid relationship',
    detail:
      'Every post must carry a clear, visible disclosure. You are responsible for meeting the advertising disclosure rules that apply where your audience is.',
  },
  { kind: 'PROHIBITED', label: 'Incentivised or bot traffic' },
  { kind: 'PROHIBITED', label: 'Bidding on the brand name in paid search' },
  { kind: 'PROHIBITED', label: 'Claims the brand has not made' },
];

export const DEMO_CAMPAIGNS: DemoCampaignFixture[] = [
  // --- Northline: the demo brand, six live campaigns -----------------------
  {
    key: 'northline-fall',
    brand: 'northline',
    name: 'Northline Fall Collection',
    objective: 'traffic',
    model: 'CPC',
    payout: '1.25',
    offer: 'Earn $1.25 for every qualified click on the fall collection.',
    product: 'The autumn range: waxed jackets, merino knitwear and selvedge denim.',
    audience: 'Adults 24–45 in the US and Canada who follow style, workwear or slow fashion.',
    description:
      'Northline’s fall collection is the range the brand is putting its season behind. Send your audience to the collection page and earn on every qualified click — no purchase required. Clicks are screened for duplicates and bot traffic before they qualify.',
    conversionRules:
      'A qualified click is a unique human visit to the collection page. Repeat visits from the same session inside 24 hours count once.',
    countries: ['US', 'CA'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'X', 'NEWSLETTER', 'BLOG'],
    exampleCopy:
      'Northline’s fall drop is up — the waxed jacket is the one I keep reaching for. Link below (paid partnership).',
    rules: STANDARD_RULES,
  },
  {
    key: 'northline-first-order',
    brand: 'northline',
    name: 'Northline — First Order',
    objective: 'sales',
    model: 'CPA',
    payout: '14.00',
    offer: 'Earn $14.00 for every first-time customer order.',
    product: 'Any first order from a new Northline customer.',
    audience: 'People who have not bought from Northline before, US and Canada.',
    description:
      'A flat payout on first orders. The order has to be from a genuinely new customer and survive the return window, which is why this one pays more per event than the click campaigns.',
    conversionRules:
      'A completed first order over $60 from a new customer, not cancelled or returned within 30 days.',
    countries: ['US', 'CA'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'NEWSLETTER', 'BLOG', 'PODCAST'],
    exampleCopy:
      'If you have not tried Northline, the first order is the one to start with. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'northline-denim',
    brand: 'northline',
    name: 'Northline Denim Launch',
    objective: 'traffic',
    model: 'CPC',
    payout: '0.95',
    offer: 'Earn $0.95 per qualified click on the denim launch.',
    product: 'A three-fit denim line in raw and washed selvedge.',
    audience: 'Adults 22–40 in the US who follow denim, workwear or menswear.',
    description:
      'A launch campaign for Northline’s first denim line. Traffic-only: you earn on qualified clicks whether or not anyone buys.',
    conversionRules: 'A unique human visit to the denim landing page.',
    countries: ['US'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'X', 'BLOG'],
    exampleCopy: 'Northline finally made denim. Raw selvedge, three fits. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'northline-outerwear',
    brand: 'northline',
    name: 'Northline Outerwear — Revenue Share',
    objective: 'sales',
    model: 'REVSHARE',
    payout: '0',
    revshareBps: 1000,
    offer: 'Earn 10% of every outerwear order you drive.',
    product: 'Waxed cotton and down outerwear, $180–$480.',
    audience: 'Adults 28–55 in the US and Canada in colder states and provinces.',
    description:
      'The outerwear range carries the highest order values Northline sells, so this one pays a share of revenue rather than a flat fee. A $380 jacket pays $38.',
    conversionRules:
      'A completed outerwear order, not cancelled or returned within 30 days. Revenue share is calculated on the order subtotal, excluding tax and shipping.',
    countries: ['US', 'CA'],
    channels: ['INSTAGRAM', 'YOUTUBE', 'NEWSLETTER', 'BLOG', 'PODCAST'],
    exampleCopy:
      'Third winter in this Northline waxed jacket and it looks better than it did new. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'northline-newsletter',
    brand: 'northline',
    name: 'Northline Newsletter Signups',
    objective: 'leads',
    model: 'CPL',
    payout: '2.40',
    offer: 'Earn $2.40 for every confirmed newsletter signup.',
    product: 'The Northline list: one email a week, early access to drops.',
    audience: 'Anyone in the US, Canada or the UK interested in the brand.',
    description:
      'A low-friction campaign that converts well from long-form content. The signup has to be confirmed by email before it pays, which is what keeps the payout honest for both sides.',
    conversionRules: 'A newsletter signup confirmed by clicking the link in the confirmation email.',
    countries: ['US', 'CA', 'GB'],
    channels: ['NEWSLETTER', 'BLOG', 'X', 'INSTAGRAM', 'YOUTUBE', 'COMMUNITY'],
    exampleCopy:
      'Northline sends one email a week and it is the only clothing list I have not unsubscribed from. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'northline-winter',
    brand: 'northline',
    name: 'Northline Winter Preview',
    objective: 'traffic',
    model: 'CPC',
    payout: '1.10',
    offer: 'Earn $1.10 per qualified click on the winter preview.',
    product: 'An early look at the winter range, before general release.',
    audience: 'Adults 24–45 in the US and Canada who already follow the brand.',
    description:
      'A preview campaign running ahead of the winter release. Traffic-only, and the payout reflects that this audience is warmer than cold traffic.',
    conversionRules: 'A unique human visit to the winter preview page.',
    countries: ['US', 'CA'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'NEWSLETTER'],
    exampleCopy: 'Northline’s winter preview is live before it goes public. Paid link below.',
    rules: STANDARD_RULES,
  },

  // --- The rest of the marketplace ----------------------------------------
  {
    key: 'terrafuel-greens',
    brand: 'terrafuel',
    name: 'TerraFuel Daily Greens',
    objective: 'traffic',
    model: 'CPC',
    payout: '2.50',
    offer: 'Earn $2.50 for every qualified click.',
    product: 'A daily greens powder, sold as a subscription or a one-off tub.',
    audience: 'Adults 25–45 in the US who train regularly or follow nutrition content.',
    description:
      'TerraFuel pays for traffic rather than sales, which makes this one of the highest per-click payouts in the marketplace. In exchange they screen hard: clicks from outside the target countries, or that look automated, do not qualify.',
    conversionRules:
      'A unique human visit from an allowed country. Duplicate sessions inside 24 hours count once.',
    countries: ['US'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'PODCAST', 'NEWSLETTER'],
    exampleCopy:
      'TerraFuel is the greens I actually finish the tub of. Paid link below — worth a look if you train.',
    rules: STANDARD_RULES,
  },
  {
    key: 'ember-subscription',
    brand: 'ember',
    name: 'Ember Coffee Subscription',
    objective: 'traffic',
    model: 'CPC',
    payout: '0.85',
    offer: 'Earn $0.85 per qualified click on the subscription page.',
    product: 'A coffee subscription: one bag a fortnight, roasted to order.',
    audience: 'Adults 25–55 in the US and Canada who buy speciality coffee.',
    description:
      'A steady, high-volume campaign. Ember accepts a wide range of placements and the landing page converts well from food and morning-routine content.',
    conversionRules: 'A unique human visit to the subscription page.',
    countries: ['US', 'CA'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'NEWSLETTER', 'BLOG', 'PODCAST'],
    exampleCopy: 'Ember roasts the day it ships, which you can taste. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'oakiron-consult',
    brand: 'oakiron',
    name: 'Oak & Iron Design Consult',
    objective: 'leads',
    model: 'CPL',
    payout: '3.00',
    offer: 'Earn $3.00 for every qualified design consultation booked.',
    product: 'A free 20-minute consultation with a furniture maker.',
    audience: 'Homeowners 30–60 in the US furnishing a room or building an extension.',
    description:
      'Oak & Iron builds to order, so a booked consultation is worth a lot to them. The lead has to be reachable and inside the US to qualify.',
    conversionRules:
      'A consultation booked with a valid US phone number and email, not cancelled before it happens.',
    countries: ['US'],
    channels: ['INSTAGRAM', 'YOUTUBE', 'PINTEREST', 'BLOG', 'NEWSLETTER'],
    exampleCopy:
      'Oak & Iron built our dining table to the exact size of an awkward room. The consult is free. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'haven-membership',
    brand: 'haven',
    name: 'Haven Travel Membership',
    objective: 'leads',
    model: 'CPL',
    payout: '12.00',
    offer: 'Earn $12.00 for every completed membership signup.',
    product: 'A travel membership: curated stays, no ads, cancel any time.',
    audience: 'Adults 28–55 in the US, Canada and the UK who travel two or more times a year.',
    description:
      'The highest fixed payout in the marketplace, and the hardest to earn: the signup has to complete the full onboarding, not just leave an email. Best from long-form travel content where the audience already trusts the recommendation.',
    conversionRules:
      'A membership signup that completes onboarding and confirms its email within 7 days.',
    countries: ['US', 'CA', 'GB'],
    channels: ['YOUTUBE', 'PODCAST', 'NEWSLETTER', 'BLOG', 'INSTAGRAM'],
    exampleCopy:
      'Haven is how I have booked the last four trips. Paid link below if you want to try the membership.',
    rules: STANDARD_RULES,
  },
  {
    key: 'fieldhouse-gear',
    brand: 'fieldhouse',
    name: 'Fieldhouse Gear — Revenue Share',
    objective: 'sales',
    model: 'REVSHARE',
    payout: '0',
    revshareBps: 800,
    offer: 'Earn 8% of every order you drive.',
    product: 'Racks, bars, plates and benches for home and small-club gyms.',
    audience: 'Adults 25–50 in the US building or upgrading a home gym.',
    description:
      'Order values here run high — a rack and a bar is often over $900 — so 8% goes further than it sounds. Fieldhouse ships heavy freight, so the return window is 45 days.',
    conversionRules:
      'A completed order, not cancelled or returned within 45 days. Revenue share is on the order subtotal.',
    countries: ['US'],
    channels: ['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'BLOG', 'COMMUNITY'],
    exampleCopy:
      'Full garage gym tour — the rack, bar and plates are all Fieldhouse. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'vantage-app',
    brand: 'vantage',
    name: 'Vantage — Verified Signups',
    objective: 'leads',
    model: 'CPL',
    payout: '9.00',
    offer: 'Earn $9.00 for every verified account.',
    product: 'A budgeting app that connects to your accounts and categorises spending.',
    audience: 'Adults 22–40 in the US and Canada who are trying to get on top of spending.',
    description:
      'Vantage pays on verified accounts, not installs, so the payout is high and the bar is real: the account has to connect a bank and stay active for seven days. Financial content converts best here.',
    conversionRules:
      'An account that verifies its email, connects at least one bank account and is still active after 7 days.',
    countries: ['US', 'CA'],
    channels: ['YOUTUBE', 'TIKTOK', 'NEWSLETTER', 'BLOG', 'PODCAST'],
    exampleCopy:
      'Vantage is the first budgeting app I have kept past the second month. Paid link below.',
    rules: STANDARD_RULES,
  },
  {
    key: 'lumen-skincare',
    brand: 'lumen',
    name: 'Lumen Labs Skincare — Revenue Share',
    objective: 'sales',
    model: 'REVSHARE',
    payout: '0',
    revshareBps: 1200,
    offer: 'Earn 12% of every order you drive.',
    product: 'A six-product skincare range with short ingredient lists.',
    audience: 'Adults 20–45 in the US, Canada and the UK who follow skincare or beauty content.',
    description:
      'The highest revenue share in the marketplace. Order values are modest, so this rewards volume: routine and get-ready-with-me content does well.',
    conversionRules:
      'A completed order, not cancelled or returned within 30 days. Revenue share is on the order subtotal.',
    countries: ['US', 'CA', 'GB'],
    channels: ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'PINTEREST', 'BLOG'],
    exampleCopy:
      'My whole routine is four Lumen Labs products now. Paid link below with what I actually use.',
    rules: STANDARD_RULES,
  },
  {
    key: 'cadence-audio',
    brand: 'cadence',
    name: 'Cadence Audio — Revenue Share',
    objective: 'sales',
    model: 'REVSHARE',
    payout: '0',
    revshareBps: 600,
    offer: 'Earn 6% of every order you drive.',
    product: 'Open-back headphones and desktop amplifiers, $220–$1,400.',
    audience: 'Adults 24–50 in the US, Canada and the UK who follow audio, music or desk-setup content.',
    description:
      'A lower percentage on much higher order values. One amplifier sale is worth more than a month of most click campaigns, but the buying cycle is long — this rewards reviews and comparisons rather than quick posts.',
    conversionRules:
      'A completed order, not cancelled or returned within 30 days. Revenue share is on the order subtotal.',
    countries: ['US', 'CA', 'GB'],
    channels: ['YOUTUBE', 'BLOG', 'PODCAST', 'COMMUNITY', 'X'],
    exampleCopy:
      'Six months with the Cadence open-backs — here is what they are good at and what they are not. Paid link below.',
    rules: STANDARD_RULES,
  },
];

/**
 * The demo publisher's history, per campaign.
 *
 * `billable` is the number of events that actually paid, which is what the
 * earnings column is computed from — never a figure typed in directly.
 * `pendingBillable` of those are recent enough to still be on hold.
 *
 * For a click-priced campaign, `conversions` are outcomes the brand reported
 * back. They are shown because they matter to the brand, but they do not pay
 * the publisher — the clicks do. That is why the conversion counts here are
 * larger than the billable counts without the earnings being any larger.
 */
export interface DemoPerformanceRow {
  campaign: string;
  clicks: number;
  /** Billable events: qualified clicks for CPC, conversions for the rest. */
  billable: number;
  pendingBillable: number;
  conversions: number;
  /** Order value the brand reported, in dollars, across all conversions. */
  revenue: string;
}

export const DEMO_PERFORMANCE: DemoPerformanceRow[] = [
  { campaign: 'northline-fall', clicks: 4821, billable: 250, pendingBillable: 100, conversions: 182, revenue: '14204.00' },
  { campaign: 'terrafuel-greens', clicks: 3201, billable: 94, pendingBillable: 40, conversions: 94, revenue: '5734.00' },
  { campaign: 'ember-subscription', clicks: 1882, billable: 74, pendingBillable: 16, conversions: 74, revenue: '2516.00' },
  { campaign: 'northline-denim', clicks: 1640, billable: 62, pendingBillable: 8, conversions: 114, revenue: '9006.00' },
  { campaign: 'northline-winter', clicks: 1290, billable: 30, pendingBillable: 0, conversions: 89, revenue: '7031.00' },
  { campaign: 'northline-newsletter', clicks: 980, billable: 45, pendingBillable: 15, conversions: 45, revenue: '0.00' },
  { campaign: 'northline-first-order', clicks: 620, billable: 8, pendingBillable: 0, conversions: 8, revenue: '712.00' },
  { campaign: 'northline-outerwear', clicks: 690, billable: 21, pendingBillable: 0, conversions: 21, revenue: '1240.00' },
  { campaign: 'oakiron-consult', clicks: 610, billable: 19, pendingBillable: 8, conversions: 19, revenue: '0.00' },
  { campaign: 'haven-membership', clicks: 470, billable: 4, pendingBillable: 1, conversions: 4, revenue: '0.00' },
  { campaign: 'fieldhouse-gear', clicks: 940, billable: 34, pendingBillable: 0, conversions: 34, revenue: '787.50' },
  { campaign: 'vantage-app', clicks: 420, billable: 3, pendingBillable: 1, conversions: 3, revenue: '0.00' },
  { campaign: 'lumen-skincare', clicks: 760, billable: 12, pendingBillable: 0, conversions: 12, revenue: '240.00' },
  { campaign: 'cadence-audio', clicks: 168, billable: 4, pendingBillable: 0, conversions: 4, revenue: '240.00' },
];

/** What the publisher's dashboard must add up to. Asserted before seeding. */
export const DEMO_CREATOR_TARGETS = {
  lifetimeEarnings: '1284.50',
  pending: '327.20',
  available: '957.30',
  clicks: 18492,
  conversions: 703,
  campaigns: 14,
  /** Percent, to one decimal place. */
  conversionRate: 3.8,
};

/**
 * The demo brand's history across all publishers, per campaign.
 *
 * Spend is *not* stored here. It is derived from `billable` — the number of
 * events that actually paid — times the gross cost of one event, which is the
 * publisher's payout grossed up by the platform fee. Storing it would let the
 * two drift; deriving it means a return-on-ad-spend figure on the brand
 * dashboard is arithmetic on the same events the publisher was paid for.
 *
 * For a click-priced campaign `conversions` are outcomes the brand reported
 * back and do not affect what it paid. For every other model they are the
 * billable events themselves, so the two columns agree by construction.
 */
export interface DemoBrandCampaignRow {
  campaign: string;
  creators: number;
  clicks: number;
  /** Events that paid: qualified clicks for CPC, conversions otherwise. */
  billable: number;
  conversions: number;
  /** Order value reported by the brand, in dollars, across all publishers. */
  revenue: string;
}

export const DEMO_BRAND_PERFORMANCE: DemoBrandCampaignRow[] = [
  { campaign: 'northline-fall', creators: 1842, clicks: 126420, billable: 11789, conversions: 4783, revenue: '121840.00' },
  { campaign: 'northline-denim', creators: 812, clicks: 52640, billable: 6658, conversions: 1994, revenue: '46220.00' },
  { campaign: 'northline-newsletter', creators: 631, clicks: 33910, billable: 1176, conversions: 1176, revenue: '18940.00' },
  { campaign: 'northline-first-order', creators: 486, clicks: 31180, billable: 528, conversions: 528, revenue: '60260.00' },
  { campaign: 'northline-outerwear', creators: 394, clicks: 24860, billable: 165, conversions: 165, revenue: '49440.00' },
  { campaign: 'northline-winter', creators: 508, clicks: 15910, billable: 1855, conversions: 602, revenue: '15780.00' },
];

/**
 * What the brand's dashboard must add up to. Asserted before seeding.
 *
 * Spend is the derived total, so it carries the fractions of a cent that a
 * $1.25 payout at a 20% fee produces. That is the honest number: rounding it to
 * something tidier would mean the dashboard and the ledger disagreed.
 */
export const DEMO_BRAND_TARGETS = {
  activeCampaigns: 6,
  creators: 2481,
  clicks: 284920,
  spend: '47825.3125',
  revenue: '312480.00',
  /** Sum of the follower counts of the publishers promoting. */
  reach: 8_400_000,
};

/** The platform's cut, in basis points. Also the default in platform settings. */
export const DEMO_FEE_BPS = 2000;
