import { brand } from '@/lib/brand';

/**
 * Brand tracking SDK, served as JavaScript.
 *
 * Generated rather than a static file so the tracking host is baked in from
 * configuration — a self-hosted deployment gets an SDK pointing at its own
 * domain without anyone editing a file.
 *
 * The SDK itself is deliberately tiny (~2KB) and dependency-free. It does three
 * things: capture the click id from the landing page URL, persist it for the
 * attribution window, and report conversions.
 */

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  if (file !== 'p.js' && file !== 'promotr.js') {
    return new Response('Not found', { status: 404 });
  }

  // The origin is taken from the request rather than from NEXT_PUBLIC_APP_URL,
  // because NEXT_PUBLIC_* values are inlined at build time: one image deployed
  // to staging and production would otherwise serve both the same, wrong host.
  const origin = originOf(request);

  return new Response(sdkSource(origin), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function originOf(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    return `${forwardedProto ?? 'https'}://${forwardedHost}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return brand.appUrl;
  }
}

function sdkSource(origin: string): string {
  const trackingHost = brand.trackingUrl || origin;
  const appHost = origin;

  return `/*! ${brand.name} tracking SDK v1.0.0 | ${appHost} */
(function (window, document) {
  'use strict';

  var ENDPOINT = ${JSON.stringify(appHost)};
  var TRACKING = ${JSON.stringify(trackingHost)};
  var CLICK_PARAM = 'pmtr_click';
  var STORAGE_KEY = 'pmtr_click_id';
  var STORAGE_TS_KEY = 'pmtr_click_ts';
  /* Default 30-day attribution window; the server enforces the real one. */
  var DEFAULT_TTL_DAYS = 30;

  var config = { key: null, campaign: null, ttlDays: DEFAULT_TTL_DAYS, debug: false };
  var queue = [];

  function log() {
    if (config.debug && window.console) {
      window.console.log.apply(window.console, ['[promotr]'].concat([].slice.call(arguments)));
    }
  }

  /* Storage is wrapped because Safari private mode throws on setItem, and a
     thrown error inside a merchant's checkout page is unacceptable. */
  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    try {
      document.cookie = key + '=' + encodeURIComponent(value) +
        ';path=/;max-age=' + (config.ttlDays * 86400) + ';SameSite=Lax' +
        (location.protocol === 'https:' ? ';Secure' : '');
    } catch (e) { /* ignore */ }
  }

  function read(key) {
    try {
      var value = window.localStorage.getItem(key);
      if (value) return value;
    } catch (e) { /* ignore */ }
    var match = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  /* Capture the click id the redirect appended to the landing page URL. */
  function capture() {
    var params = new URLSearchParams(window.location.search);
    var clickId = params.get(CLICK_PARAM);
    if (clickId) {
      store(STORAGE_KEY, clickId);
      store(STORAGE_TS_KEY, String(Date.now()));
      log('captured click', clickId);
    }
    return clickId;
  }

  function currentClickId() {
    var stored = read(STORAGE_KEY);
    if (!stored) return null;
    var ts = parseInt(read(STORAGE_TS_KEY) || '0', 10);
    if (ts && Date.now() - ts > config.ttlDays * 86400000) {
      log('stored click expired');
      return null;
    }
    return stored;
  }

  function post(path, body, onDone) {
    var url = ENDPOINT + path;
    /* sendBeacon survives page unload, which matters on a thank-you page that
       immediately redirects. It cannot set headers, so the key travels in the
       body for that path. */
    if (!onDone && window.navigator && window.navigator.sendBeacon) {
      try {
        var blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
        if (window.navigator.sendBeacon(url, blob)) { log('beacon sent', body); return; }
      } catch (e) { /* fall through to fetch */ }
    }

    if (window.fetch) {
      window.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key },
        body: JSON.stringify(body),
        keepalive: true,
        mode: 'cors',
      }).then(function (response) {
        return response.json().catch(function () { return {}; });
      }).then(function (data) {
        log('response', data);
        if (onDone) onDone(null, data);
      }).catch(function (error) {
        log('error', error);
        if (onDone) onDone(error, null);
      });
      return;
    }

    /* Last resort for very old browsers: the pixel endpoint. */
    var img = new Image(1, 1);
    img.src = ENDPOINT + '/px/c?k=' + encodeURIComponent(config.key) +
      '&c=' + encodeURIComponent(body.campaign_id) +
      '&id=' + encodeURIComponent(body.conversion_id) +
      (body.click_id ? '&click=' + encodeURIComponent(body.click_id) : '') +
      (body.value ? '&v=' + encodeURIComponent(body.value) : '');
  }

  var promotr = {
    /**
     * promotr.init({ key: 'pk_live_...', campaign: '<campaign-id>' })
     */
    init: function (options) {
      options = options || {};
      config.key = options.key || config.key;
      config.campaign = options.campaign || config.campaign;
      config.ttlDays = options.attributionDays || config.ttlDays;
      config.debug = Boolean(options.debug);

      capture();
      log('initialised', { campaign: config.campaign, hasKey: Boolean(config.key) });

      var pending = queue.splice(0, queue.length);
      for (var i = 0; i < pending.length; i++) {
        promotr.trackConversion(pending[i][0], pending[i][1]);
      }
      return promotr;
    },

    /**
     * promotr.trackConversion({ conversionId: 'order-1042', value: 129.99 })
     *
     * conversionId must be stable for a given order: it is the de-duplication
     * key, so firing this twice for one order is safe and charges once.
     */
    trackConversion: function (event, callback) {
      event = event || {};

      if (!config.key) {
        queue.push([event, callback]);
        log('queued until init()');
        return;
      }

      var conversionId = event.conversionId || event.conversion_id || event.orderId;
      if (!conversionId) {
        log('trackConversion requires a conversionId');
        if (callback) callback(new Error('conversionId is required'), null);
        return;
      }

      var clickId = event.clickId || currentClickId();
      if (!clickId) {
        log('no click id available — this visit was not attributed to a publisher');
      }

      var body = {
        campaign_id: event.campaignId || config.campaign,
        conversion_id: String(conversionId),
        click_id: clickId || null,
        value: event.value !== undefined && event.value !== null ? String(event.value) : undefined,
        currency: event.currency,
        quantity: event.quantity,
        event_type: event.type || event.eventType,
        metadata: event.metadata,
      };

      post('/api/v1/conversions', body, callback);
    },

    /** The click id for this visit, or null when unattributed. */
    getClickId: function () { return currentClickId(); },

    /** Clears stored attribution — call from a privacy/consent control. */
    clear: function () {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      try { window.localStorage.removeItem(STORAGE_TS_KEY); } catch (e) { /* ignore */ }
      document.cookie = STORAGE_KEY + '=;path=/;max-age=0';
      document.cookie = STORAGE_TS_KEY + '=;path=/;max-age=0';
    },

    trackingHost: TRACKING,
    version: '1.0.0'
  };

  /* Capture immediately, so a landing page that never calls init() still
     records the click id for a later conversion. */
  capture();

  /* Replay calls made before the script finished loading. */
  var existing = window.promotr;
  window.promotr = promotr;
  if (existing && existing.q && existing.q.length) {
    for (var j = 0; j < existing.q.length; j++) {
      var call = existing.q[j];
      if (promotr[call[0]]) promotr[call[0]].apply(promotr, [].slice.call(call, 1));
    }
  }
})(window, document);
`;
}
