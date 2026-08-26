import { describe, expect, it } from 'vitest';

import { inferChannel, parseUserAgent, referrerHost } from '@/lib/tracking/ua';

describe('user-agent parsing', () => {
  it('identifies real desktop browsers', () => {
    const chrome = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(chrome).toMatchObject({
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Windows 10/11',
      isBot: false,
    });
  });

  it('distinguishes Edge from the Chrome it impersonates', () => {
    const edge = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    );
    expect(edge.browser).toBe('Edge');
  });

  it('identifies mobile and tablet devices', () => {
    const iphone = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    expect(iphone.deviceType).toBe('mobile');
    expect(iphone.os).toBe('iOS');

    const ipad = parseUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1',
    );
    expect(ipad.deviceType).toBe('tablet');
  });

  it('flags headless and scripted clients as automation', () => {
    for (const ua of [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36',
      'python-requests/2.31.0',
      'curl/8.4.0',
      'Go-http-client/2.0',
      'PostmanRuntime/7.36.0',
      'axios/1.6.0',
    ]) {
      const parsed = parseUserAgent(ua);
      expect(parsed.automation, ua).toBe(true);
      expect(parsed.isBot, ua).toBe(true);
      expect(parsed.knownCrawler, ua).toBe(false);
    }
  });

  it('recognises declared crawlers without treating them as automation fraud', () => {
    const googlebot = parseUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    );
    expect(googlebot.isBot).toBe(true);
    expect(googlebot.knownCrawler).toBe(true);
    expect(googlebot.automation).toBe(false);
  });

  it('treats a missing user-agent as automation', () => {
    expect(parseUserAgent('').automation).toBe(true);
    expect(parseUserAgent(null).isBot).toBe(true);
    expect(parseUserAgent(undefined).deviceType).toBe('unknown');
  });

  it('extracts referrer hosts and ignores malformed values', () => {
    expect(referrerHost('https://www.tiktok.com/@user/video/123')).toBe('tiktok.com');
    expect(referrerHost('not a url')).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });

  it('infers a promotional channel from the referrer', () => {
    expect(inferChannel('tiktok.com')).toBe('TIKTOK');
    expect(inferChannel('youtu.be')).toBe('YOUTUBE');
    expect(inferChannel('x.com')).toBe('X');
    expect(inferChannel('example.com')).toBeNull();
  });
});
