/**
 * Destination URL construction.
 *
 * What we append to the brand's landing page is deliberately minimal:
 *   - `adc_click` so the brand can report a conversion back against this click
 *   - the publisher's sub-id and UTM parameters, which are the brand's own
 *     campaign taxonomy and are expected downstream
 *
 * Nothing about the visitor is forwarded. No IP, no fingerprint, no publisher
 * identity beyond the opaque click id, which is meaningless without our
 * database. A brand receiving traffic learns nothing about the person.
 */

export const CLICK_ID_PARAM = 'adc_click';

export interface DestinationParams {
  base: string;
  clickId: string;
  subId?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
}

export function buildDestinationUrl(params: DestinationParams): string {
  let url: URL;
  try {
    url = new URL(params.base);
  } catch {
    // Campaign destinations are validated at creation, so this should be
    // unreachable; returning the raw string is safer than throwing on the hot path.
    return params.base;
  }

  url.searchParams.set(CLICK_ID_PARAM, params.clickId);

  if (params.subId) url.searchParams.set('subid', params.subId);

  const utm = params.utm ?? {};
  // Only set UTM parameters the brand's own URL has not already specified,
  // so a landing page with deliberate tagging is not overwritten.
  const utmPairs: Array<[string, string | null | undefined]> = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
    ['utm_content', utm.content],
    ['utm_term', utm.term],
  ];
  for (const [key, value] of utmPairs) {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }

  return url.toString();
}
