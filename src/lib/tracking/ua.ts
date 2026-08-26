/**
 * User-agent classification.
 *
 * Hand-rolled rather than pulled from a library for two reasons: this runs on
 * every redirect, where a 200KB regex table would be the dominant cost; and the
 * bot list is a fraud control we need to own and tune, not inherit.
 *
 * The goal is not perfect device attribution — it is a stable, cheap signal for
 * analytics plus a reliable "this is automation" verdict for the fraud engine.
 */

export interface ParsedUserAgent {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
  isBot: boolean;
  /** Set when the UA is a *known, declared* crawler (Googlebot, Slack, etc). */
  knownCrawler: boolean;
  /** Set when the UA looks like headless automation rather than a real browser. */
  automation: boolean;
}

/** Declared crawlers. Mostly benign — they should not be billed, nor punished. */
const CRAWLER_PATTERNS: Array<[RegExp, string]> = [
  [/googlebot|google-inspectiontool|storebot-google/i, 'Googlebot'],
  [/bingbot|adidxbot|bingpreview/i, 'Bingbot'],
  [/slurp/i, 'Yahoo Slurp'],
  [/duckduckbot/i, 'DuckDuckBot'],
  [/baiduspider/i, 'Baiduspider'],
  [/yandexbot/i, 'YandexBot'],
  [/applebot/i, 'Applebot'],
  [/facebookexternalhit|facebookcatalog|facebot/i, 'Facebook'],
  [/twitterbot/i, 'Twitterbot'],
  [/linkedinbot/i, 'LinkedInBot'],
  [/slackbot|slack-imgproxy/i, 'Slackbot'],
  [/discordbot/i, 'Discordbot'],
  [/telegrambot/i, 'TelegramBot'],
  [/whatsapp/i, 'WhatsApp'],
  [/pinterest(bot)?/i, 'Pinterest'],
  [/redditbot/i, 'Redditbot'],
  [/embedly|quora link preview|outbrain|vkshare/i, 'Link preview'],
  [/ahrefsbot|semrushbot|mj12bot|dotbot|blexbot|petalbot|dataforseo/i, 'SEO crawler'],
  [/gptbot|claudebot|anthropic-ai|ccbot|perplexitybot|bytespider|google-extended/i, 'AI crawler'],
  [/uptimerobot|pingdom|statuscake|site24x7|newrelicpinger/i, 'Uptime monitor'],
  [/bot\b|crawler|spider|crawling/i, 'Generic bot'],
];

/**
 * Automation signatures. These are the ones that matter for click fraud: a
 * headless browser or scripted HTTP client driving traffic through links.
 */
const AUTOMATION_PATTERNS: Array<[RegExp, string]> = [
  [/headlesschrome/i, 'HeadlessChrome'],
  [/phantomjs/i, 'PhantomJS'],
  [/electron/i, 'Electron'],
  [/puppeteer|playwright|selenium|webdriver|cypress/i, 'Browser automation'],
  [/python-requests|python-urllib|aiohttp|httpx/i, 'Python HTTP client'],
  [/curl\//i, 'curl'],
  [/wget/i, 'wget'],
  [/go-http-client/i, 'Go HTTP client'],
  [/java\/|okhttp|apache-httpclient/i, 'Java HTTP client'],
  [/node-fetch|axios|got\/|undici/i, 'Node HTTP client'],
  [/ruby|faraday/i, 'Ruby HTTP client'],
  [/postmanruntime|insomnia/i, 'API client'],
  [/scrapy|colly|guzzlehttp/i, 'Scraper'],
];

const BROWSER_PATTERNS: Array<[RegExp, string]> = [
  // Order matters: every Chromium browser also claims to be Chrome and Safari.
  [/edg(?:e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/ucbrowser/i, 'UC Browser'],
  [/yabrowser/i, 'Yandex Browser'],
  [/brave/i, 'Brave'],
  [/vivaldi/i, 'Vivaldi'],
  [/firefox\/|fxios/i, 'Firefox'],
  [/chrome\/|crios/i, 'Chrome'],
  [/safari\//i, 'Safari'],
  [/msie |trident\//i, 'Internet Explorer'],
];

const OS_PATTERNS: Array<[RegExp, string]> = [
  [/windows nt 10|windows nt 11/i, 'Windows 10/11'],
  [/windows nt/i, 'Windows'],
  [/iphone os|cpu iphone/i, 'iOS'],
  [/ipad|cpu os/i, 'iPadOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/android/i, 'Android'],
  [/cros/i, 'ChromeOS'],
  [/ubuntu/i, 'Ubuntu'],
  [/linux/i, 'Linux'],
  [/freebsd|openbsd/i, 'BSD'],
];

const MOBILE_HINT = /mobile|iphone|ipod|android.*mobile|windows phone|blackberry|iemobile/i;
const TABLET_HINT = /ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i;

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua || ua.trim() === '') {
    // A completely absent user-agent is itself a strong automation signal:
    // every real browser sends one.
    return {
      deviceType: 'unknown',
      browser: 'Unknown',
      os: 'Unknown',
      isBot: true,
      knownCrawler: false,
      automation: true,
    };
  }

  for (const [pattern, name] of AUTOMATION_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        deviceType: 'bot',
        browser: name,
        os: matchFirst(OS_PATTERNS, ua) ?? 'Unknown',
        isBot: true,
        knownCrawler: false,
        automation: true,
      };
    }
  }

  for (const [pattern, name] of CRAWLER_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        deviceType: 'bot',
        browser: name,
        os: matchFirst(OS_PATTERNS, ua) ?? 'Unknown',
        isBot: true,
        knownCrawler: true,
        automation: false,
      };
    }
  }

  const browser = matchFirst(BROWSER_PATTERNS, ua) ?? 'Unknown';
  const os = matchFirst(OS_PATTERNS, ua) ?? 'Unknown';

  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (TABLET_HINT.test(ua)) deviceType = 'tablet';
  else if (MOBILE_HINT.test(ua)) deviceType = 'mobile';

  return { deviceType, browser, os, isBot: false, knownCrawler: false, automation: false };
}

function matchFirst(patterns: Array<[RegExp, string]>, ua: string): string | null {
  for (const [pattern, name] of patterns) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

/** Normalise a referrer to its host, discarding path and query. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Channel inference from the referring host — used for traffic-source rules. */
export function inferChannel(host: string | null): string | null {
  if (!host) return null;
  const map: Array<[RegExp, string]> = [
    [/tiktok\./, 'TIKTOK'],
    [/instagram\.|cdninstagram/, 'INSTAGRAM'],
    [/youtube\.|youtu\.be/, 'YOUTUBE'],
    [/twitter\.|x\.com|t\.co$/, 'X'],
    [/facebook\.|fb\.com|fb\.me/, 'FACEBOOK'],
    [/linkedin\.|lnkd\.in/, 'LINKEDIN'],
    [/reddit\.|redd\.it/, 'REDDIT'],
    [/pinterest\./, 'PINTEREST'],
    [/snapchat\./, 'SNAPCHAT'],
    [/twitch\./, 'TWITCH'],
    [/google\.|bing\.|duckduckgo\.|search\.yahoo/, 'PAID_SEARCH'],
  ];
  for (const [pattern, channel] of map) {
    if (pattern.test(host)) return channel;
  }
  return null;
}
