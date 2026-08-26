import { formatMicros } from '@/lib/money';

/** Display formatting shared by every surface. */

export function formatNumber(value: number | bigint): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** Compact form for dense tiles: 12.4K, 3.1M. */
export function formatCompact(value: number | bigint): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function formatMoney(micros: bigint, options?: { showSubCent?: boolean }): string {
  return formatMicros(micros, options);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(date));
}

/** "3 minutes ago". Used wherever recency matters more than the exact instant. */
export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const then = new Date(date).getTime();
  const diffSeconds = Math.round((then - Date.now()) / 1000);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  let value = diffSeconds;
  for (const [unit, divisor] of units) {
    if (Math.abs(value) < divisor) return formatter.format(Math.round(value), unit);
    value /= divisor;
  }
  return formatter.format(Math.round(value), 'year');
}

/** Sentence-case an enum value: PENDING_REVIEW → Pending review. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function truncate(value: string, length = 60): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

/** Payout model rendered the way a publisher reads it. */
export function describePayout(params: {
  payoutModel: string;
  payoutMicros: bigint;
  revshareBps: number;
}): string {
  const amount = formatMicros(params.payoutMicros);
  const share = `${(params.revshareBps / 100).toFixed(params.revshareBps % 100 === 0 ? 0 : 2)}%`;

  switch (params.payoutModel) {
    case 'CPC':
      return `${amount} per qualified click`;
    case 'CPL':
      return `${amount} per lead`;
    case 'CPA':
      return `${amount} per sale`;
    case 'CPM':
      return `${amount} per 1,000 impressions`;
    case 'REVSHARE':
      return `${share} of revenue`;
    case 'HYBRID':
      return `${amount} per click + ${share} of revenue`;
    default:
      return amount;
  }
}

export function payoutModelLabel(model: string): string {
  const labels: Record<string, string> = {
    CPC: 'Cost per click',
    CPL: 'Cost per lead',
    CPA: 'Cost per acquisition',
    CPM: 'Cost per mille',
    REVSHARE: 'Revenue share',
    HYBRID: 'Hybrid',
  };
  return labels[model] ?? model;
}

export function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    TIKTOK: 'TikTok',
    INSTAGRAM: 'Instagram',
    YOUTUBE: 'YouTube',
    X: 'X',
    FACEBOOK: 'Facebook',
    LINKEDIN: 'LinkedIn',
    REDDIT: 'Reddit',
    PINTEREST: 'Pinterest',
    SNAPCHAT: 'Snapchat',
    TWITCH: 'Twitch',
    WEBSITE: 'Website',
    BLOG: 'Blog',
    NEWSLETTER: 'Newsletter',
    PODCAST: 'Podcast',
    COMMUNITY: 'Community',
    APP: 'App',
    PAID_SEARCH: 'Paid search',
    PAID_SOCIAL: 'Paid social',
    DISPLAY: 'Display',
    NATIVE_ADS: 'Native ads',
    SMS: 'SMS',
    EMAIL_LIST: 'Email list',
    OTHER: 'Other',
  };
  return labels[channel] ?? humanize(channel);
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Status → badge tone. Keeps colour semantics consistent everywhere. */
export function statusTone(
  status: string,
): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'ACTIVE':
    case 'APPROVED':
    case 'VERIFIED':
    case 'AVAILABLE':
    case 'PAID':
    case 'RESOLVED':
    case 'delivered':
    case 'succeeded':
    case 'SUCCEEDED':
      return 'success';
    case 'PENDING':
    case 'PENDING_REVIEW':
    case 'REQUESTED':
    case 'PROCESSING':
    case 'UNDER_REVIEW':
    case 'INVESTIGATING':
    case 'AWAITING_INFORMATION':
    case 'pending':
    case 'QUEUED':
    case 'RUNNING':
      return 'warning';
    case 'REJECTED':
    case 'SUSPENDED':
    case 'FAILED':
    case 'REVERSED':
    case 'DEAD':
    case 'failed':
    case 'CANCELED':
      return 'danger';
    case 'DRAFT':
    case 'PAUSED':
    case 'COMPLETED':
    case 'UNVERIFIED':
    case 'WITHDRAWN':
      return 'neutral';
    case 'ON_HOLD':
    case 'RESTRICTED':
      return 'warning';
    case 'OPEN':
      return 'info';
    default:
      return 'neutral';
  }
}
