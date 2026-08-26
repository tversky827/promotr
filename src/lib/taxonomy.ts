/**
 * Shared taxonomies.
 *
 * Categories and channels appear in campaign creation, publisher profiles, and
 * marketplace filters. Defining them once means a filter can never drift from
 * the values campaigns are actually created with.
 */

export const CAMPAIGN_CATEGORIES = [
  { value: 'ecommerce', label: 'E-commerce & retail' },
  { value: 'saas', label: 'Software & SaaS' },
  { value: 'finance', label: 'Personal finance' },
  { value: 'health', label: 'Health & wellness' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'beauty', label: 'Beauty & skincare' },
  { value: 'fashion', label: 'Fashion & apparel' },
  { value: 'food', label: 'Food & beverage' },
  { value: 'home', label: 'Home & garden' },
  { value: 'travel', label: 'Travel' },
  { value: 'education', label: 'Education & courses' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'entertainment', label: 'Entertainment & media' },
  { value: 'automotive', label: 'Automotive' },
  { value: 'pets', label: 'Pets' },
  { value: 'b2b-services', label: 'B2B services' },
  { value: 'marketplace', label: 'Marketplaces' },
  { value: 'subscription', label: 'Subscription boxes' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
] as const;

export const PUBLISHER_TYPES = [
  { value: 'CREATOR', label: 'Creator', hint: 'Social video, streaming, short-form' },
  { value: 'WEBSITE', label: 'Website or blog', hint: 'Content site, review site, niche blog' },
  { value: 'NEWSLETTER', label: 'Newsletter', hint: 'Email list you own' },
  { value: 'COMMUNITY', label: 'Community', hint: 'Discord, forum, group' },
  { value: 'PODCAST', label: 'Podcast', hint: 'Audio show' },
  { value: 'APP', label: 'App', hint: 'Mobile or desktop application' },
  { value: 'MEDIA_COMPANY', label: 'Media company', hint: 'Publisher with multiple properties' },
] as const;

export const CHANNELS = [
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'YOUTUBE', label: 'YouTube' },
  { value: 'X', label: 'X' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'REDDIT', label: 'Reddit' },
  { value: 'PINTEREST', label: 'Pinterest' },
  { value: 'SNAPCHAT', label: 'Snapchat' },
  { value: 'TWITCH', label: 'Twitch' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'BLOG', label: 'Blog' },
  { value: 'NEWSLETTER', label: 'Newsletter' },
  { value: 'PODCAST', label: 'Podcast' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'APP', label: 'App' },
  { value: 'PAID_SEARCH', label: 'Paid search' },
  { value: 'PAID_SOCIAL', label: 'Paid social' },
  { value: 'DISPLAY', label: 'Display ads' },
  { value: 'NATIVE_ADS', label: 'Native ads' },
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL_LIST', label: 'Email list' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const CAMPAIGN_OBJECTIVES = [
  { value: 'traffic', label: 'Traffic', hint: 'Get qualified visitors to a page' },
  { value: 'leads', label: 'Leads', hint: 'Sign-ups, trials, quote requests' },
  { value: 'sales', label: 'Sales', hint: 'Completed purchases' },
  { value: 'installs', label: 'App installs', hint: 'Mobile or desktop installs' },
  { value: 'awareness', label: 'Awareness', hint: 'Impressions against a CPM' },
] as const;

/** Countries the platform supports, kept in sync with the default settings. */
export const COUNTRIES = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IE', label: 'Ireland' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'PT', label: 'Portugal' },
  { value: 'AT', label: 'Austria' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'PL', label: 'Poland' },
  { value: 'CZ', label: 'Czechia' },
  { value: 'SG', label: 'Singapore' },
  { value: 'JP', label: 'Japan' },
  { value: 'MX', label: 'Mexico' },
  { value: 'BR', label: 'Brazil' },
] as const;

export const PAYOUT_MODELS = [
  {
    value: 'CPC',
    label: 'Cost per click',
    short: 'CPC',
    hint: 'Pay for each qualified visitor. Best for driving traffic.',
    example: '$0.25 per click',
  },
  {
    value: 'CPL',
    label: 'Cost per lead',
    short: 'CPL',
    hint: 'Pay when someone signs up, starts a trial, or requests a quote.',
    example: '$15.00 per lead',
  },
  {
    value: 'CPA',
    label: 'Cost per acquisition',
    short: 'CPA',
    hint: 'Pay only on a completed purchase. Lowest risk, hardest to earn.',
    example: '$40.00 per sale',
  },
  {
    value: 'CPM',
    label: 'Cost per thousand impressions',
    short: 'CPM',
    hint: 'Pay per thousand qualified impressions. For awareness campaigns.',
    example: '$5.00 per 1,000',
  },
  {
    value: 'REVSHARE',
    label: 'Revenue share',
    short: 'RevShare',
    hint: 'Pay a percentage of the order value. Scales with basket size.',
    example: '10% of revenue',
  },
  {
    value: 'HYBRID',
    label: 'Hybrid',
    short: 'Hybrid',
    hint: 'A flat amount plus a share of revenue. Attracts publishers who want a floor.',
    example: '$0.10 per click + 5%',
  },
] as const;

/** Prohibited-traffic presets offered in the campaign wizard. */
export const PROHIBITED_PRESETS = [
  { value: 'spam', label: 'Spam or unsolicited messaging' },
  { value: 'misleading', label: 'Misleading or unsubstantiated claims' },
  { value: 'trademark-bidding', label: 'Bidding on our brand terms' },
  { value: 'coupon-sites', label: 'Coupon and deal aggregators' },
  { value: 'incentivised', label: 'Incentivised traffic (rewards for clicking)' },
  { value: 'adult', label: 'Adult content placements' },
  { value: 'gambling', label: 'Gambling placements' },
  { value: 'auto-surf', label: 'Traffic exchanges and auto-surf' },
  { value: 'popunder', label: 'Pop-ups and pop-unders' },
  { value: 'cookie-stuffing', label: 'Cookie stuffing' },
  { value: 'typosquatting', label: 'Typosquatting our domain' },
  { value: 'unauthorised-email', label: 'Unauthorised email blasts' },
] as const;

export function labelFor<T extends readonly { value: string; label: string }[]>(
  list: T,
  value: string,
): string {
  return list.find((item) => item.value === value)?.label ?? value;
}
