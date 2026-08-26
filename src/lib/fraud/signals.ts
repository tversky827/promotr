/**
 * Fraud signal catalogue.
 *
 * Every signal is declared here with a weight and a human-readable explanation.
 * The explanation is not decoration — it is shown verbatim to admins in the
 * fraud console and to publishers when their traffic is held, because "your
 * earnings were rejected" without a reason is how a marketplace loses the
 * supply side.
 *
 * Weights are additive and the total is clamped to 0-100. They are deliberately
 * calibrated so that no single behavioural signal reaches the rejection
 * threshold on its own: rejection requires either a definitive technical signal
 * (declared automation) or a combination of behavioural ones.
 */

export type SignalCode =
  // Definitive technical signals
  | 'AUTOMATION_UA'
  | 'KNOWN_CRAWLER'
  | 'MISSING_USER_AGENT'
  // Duplication and velocity
  | 'DUPLICATE_CLICK'
  | 'RAPID_REPEAT'
  | 'IP_BURST'
  | 'DEVICE_BURST'
  | 'IMPOSSIBLE_VELOCITY'
  // Attribution anomalies
  | 'SELF_CLICK'
  | 'GEO_MISMATCH'
  | 'GEO_NOT_ALLOWED'
  | 'MISSING_REFERRER'
  | 'SUSPICIOUS_REFERRER'
  | 'CHANNEL_NOT_ALLOWED'
  // Account-level signals
  | 'PUBLISHER_UNDER_REVIEW'
  | 'PUBLISHER_HIGH_RISK'
  | 'NEW_PUBLISHER'
  // Conversion-specific
  | 'CONVERSION_WITHOUT_CLICK'
  | 'CONVERSION_TOO_FAST'
  | 'ABNORMAL_CONVERSION_RATE'
  | 'ATTRIBUTION_WINDOW_EXPIRED'
  | 'REVENUE_OUTLIER';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SignalDefinition {
  code: SignalCode;
  weight: number;
  severity: Severity;
  /** Shown to admins and, where appropriate, to the publisher. */
  explanation: string;
}

export const SIGNALS: Record<SignalCode, SignalDefinition> = {
  AUTOMATION_UA: {
    code: 'AUTOMATION_UA',
    weight: 85,
    severity: 'CRITICAL',
    explanation:
      'The request came from scripted automation (a headless browser or HTTP client), not a person using a browser.',
  },
  KNOWN_CRAWLER: {
    code: 'KNOWN_CRAWLER',
    weight: 60,
    severity: 'LOW',
    explanation:
      'The visitor is a declared search-engine or link-preview crawler. Not fraud, but not a person either, so it is not billable.',
  },
  MISSING_USER_AGENT: {
    code: 'MISSING_USER_AGENT',
    weight: 45,
    severity: 'HIGH',
    explanation: 'The request sent no user-agent header. Every real browser sends one.',
  },
  DUPLICATE_CLICK: {
    code: 'DUPLICATE_CLICK',
    weight: 70,
    severity: 'MEDIUM',
    explanation:
      'The same visitor already clicked this link within the campaign de-duplication window, so this click is not separately billable.',
  },
  RAPID_REPEAT: {
    code: 'RAPID_REPEAT',
    weight: 40,
    severity: 'MEDIUM',
    explanation: 'The same device clicked this link again within seconds of the previous click.',
  },
  IP_BURST: {
    code: 'IP_BURST',
    weight: 35,
    severity: 'MEDIUM',
    explanation:
      'An unusual number of clicks arrived from one network in a short window, which is characteristic of click farms and scripted traffic.',
  },
  DEVICE_BURST: {
    code: 'DEVICE_BURST',
    weight: 30,
    severity: 'MEDIUM',
    explanation: 'One device generated an unusual number of clicks across campaigns in a short window.',
  },
  IMPOSSIBLE_VELOCITY: {
    code: 'IMPOSSIBLE_VELOCITY',
    weight: 45,
    severity: 'HIGH',
    explanation:
      'The same device appeared from geographically distant locations faster than travel between them would allow.',
  },
  SELF_CLICK: {
    code: 'SELF_CLICK',
    weight: 55,
    severity: 'HIGH',
    explanation:
      'The click appears to originate from the publisher who owns the link. Publishers may not click their own links for payment.',
  },
  GEO_MISMATCH: {
    code: 'GEO_MISMATCH',
    weight: 15,
    severity: 'LOW',
    explanation:
      "The visitor's location is inconsistent with the publisher's declared audience.",
  },
  GEO_NOT_ALLOWED: {
    code: 'GEO_NOT_ALLOWED',
    weight: 100,
    severity: 'INFO',
    explanation:
      'The visitor is outside the campaign’s permitted countries, so the click is not billable. This is a targeting rule, not an accusation.',
  },
  MISSING_REFERRER: {
    code: 'MISSING_REFERRER',
    weight: 8,
    severity: 'INFO',
    explanation:
      'No referrer was sent. Common and usually innocent (apps, direct taps, privacy settings), so this carries almost no weight on its own.',
  },
  SUSPICIOUS_REFERRER: {
    code: 'SUSPICIOUS_REFERRER',
    weight: 30,
    severity: 'MEDIUM',
    explanation:
      'The referring site is a known traffic-exchange, auto-surf, or incentivised-click network.',
  },
  CHANNEL_NOT_ALLOWED: {
    code: 'CHANNEL_NOT_ALLOWED',
    weight: 100,
    severity: 'INFO',
    explanation:
      'The traffic came through a promotional channel this campaign prohibits, so it is not billable.',
  },
  PUBLISHER_UNDER_REVIEW: {
    code: 'PUBLISHER_UNDER_REVIEW',
    weight: 25,
    severity: 'MEDIUM',
    explanation: 'This publisher account is currently under manual review.',
  },
  PUBLISHER_HIGH_RISK: {
    code: 'PUBLISHER_HIGH_RISK',
    weight: 30,
    severity: 'HIGH',
    explanation: 'This publisher has an elevated account risk score from prior activity.',
  },
  NEW_PUBLISHER: {
    code: 'NEW_PUBLISHER',
    weight: 10,
    severity: 'INFO',
    explanation:
      'The publisher account is new, so there is little history to judge this traffic against. Weighted lightly on purpose — being new is not suspicious.',
  },
  CONVERSION_WITHOUT_CLICK: {
    code: 'CONVERSION_WITHOUT_CLICK',
    weight: 40,
    severity: 'MEDIUM',
    explanation: 'The conversion could not be matched to a recorded click.',
  },
  CONVERSION_TOO_FAST: {
    code: 'CONVERSION_TOO_FAST',
    weight: 35,
    severity: 'MEDIUM',
    explanation:
      'The conversion was reported implausibly soon after the click — faster than a person could complete the action.',
  },
  ABNORMAL_CONVERSION_RATE: {
    code: 'ABNORMAL_CONVERSION_RATE',
    weight: 30,
    severity: 'MEDIUM',
    explanation:
      "This publisher's conversion rate on this campaign is far above the campaign norm.",
  },
  ATTRIBUTION_WINDOW_EXPIRED: {
    code: 'ATTRIBUTION_WINDOW_EXPIRED',
    weight: 100,
    severity: 'INFO',
    explanation:
      'The click happened outside the campaign’s attribution window, so the conversion cannot be credited to it.',
  },
  REVENUE_OUTLIER: {
    code: 'REVENUE_OUTLIER',
    weight: 25,
    severity: 'MEDIUM',
    explanation:
      'The reported conversion value is far outside the typical range for this campaign.',
  },
};

export interface DetectedSignal {
  code: SignalCode;
  weight: number;
  severity: Severity;
  explanation: string;
  /** Case-specific evidence, e.g. "42 clicks from this network in 60s". */
  detail?: string;
}

export function signal(code: SignalCode, detail?: string): DetectedSignal {
  const def = SIGNALS[code];
  return {
    code: def.code,
    weight: def.weight,
    severity: def.severity,
    explanation: def.explanation,
    detail,
  };
}

/**
 * Known traffic-exchange / incentivised-click domains. Deliberately short and
 * conservative: a false positive here withholds a real publisher's money.
 */
export const SUSPICIOUS_REFERRER_HOSTS = new Set([
  'traffup.net',
  'hitleap.com',
  'easyhits4u.com',
  '10khits.com',
  'otohits.net',
  'webtrafficgeeks.org',
  'jingling.com',
  'autosurf.com',
  'trafficadbar.com',
  'bigfoot-traffic.com',
]);
