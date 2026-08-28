import type { Metadata } from 'next';

import { CodeBlock, DocSection, ParamTable } from '@/components/docs/code';
import { Alert, Badge } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Conversion tracking',
  description:
    'Four ways to report conversions: JavaScript SDK, pixel, server-to-server postback, and REST API.',
  alternates: { canonical: '/docs/tracking' },
};

export default function TrackingDocsPage() {
  const host = brand.appUrl;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">
          Conversion tracking
        </h1>
        <p className="mt-3 text-md text-fg-muted text-pretty">
          You have four ways to tell us a conversion happened. They all de-duplicate against the same
          conversion identifier, so you can use more than one without being charged twice.
        </p>
      </header>

      <DocSection id="how-it-works" title="How attribution works">
        <p>
          When a visitor clicks a publisher&apos;s tracking link we redirect them to your destination
          URL with one parameter appended:
        </p>
        <CodeBlock language="text">{`https://yourbrand.com/landing?adc_click=8f14e45f-ea0c-4b21-9d8e-2c3f1a5b7e90`}</CodeBlock>
        <p>
          That value is the click identifier. Store it, and send it back when the visitor converts.
          It is opaque — it identifies the click in our database and tells you nothing about the
          visitor.
        </p>
        <Alert tone="info" title="If you cannot pass the click identifier">
          Without it we cannot attribute the conversion to a publisher, and the conversion is
          rejected. There is no fallback fingerprinting: guessing which publisher earned a
          commission would be worse than declining to guess.
        </Alert>
      </DocSection>

      <DocSection id="sdk" title="Option 1: JavaScript SDK (recommended)">
        <p>
          The SDK captures the click identifier automatically on your landing page, stores it for the
          attribution window, and sends conversions. It is about 2KB and has no dependencies.
        </p>

        <p>Add it to every page, including your landing pages:</p>
        <CodeBlock language="html" filename="Every page">{`<script async src="${host}/sdk/a.js"></script>
<script>
  window.audicents = window.audicents || { q: [] };
  window.addEventListener('load', function () {
    audicents.init({
      key: 'pk_live_your_api_key',
      campaign: 'your-campaign-id'
    });
  });
</script>`}</CodeBlock>

        <p>Then, on your confirmation or thank-you page:</p>
        <CodeBlock language="javascript" filename="Confirmation page">{`audicents.trackConversion({
  conversionId: 'order-1042',   // your order id — this is the de-duplication key
  value: 129.99,                 // order value; drives revenue-share payouts
  currency: 'usd'
});`}</CodeBlock>

        <p>The SDK also exposes:</p>
        <CodeBlock language="javascript">{`audicents.getClickId();  // the stored click id, or null if this visit was not attributed
audicents.clear();       // clears stored attribution — wire this into your consent control`}</CodeBlock>

        <Alert tone="warning" title="conversionId must be stable">
          Use your own order identifier, not a random value. If it changes between retries you will
          be charged twice. If it stays the same, retrying is free and safe.
        </Alert>
      </DocSection>

      <DocSection id="pixel" title="Option 2: Image pixel">
        <p>
          For platforms where you can only paste HTML — a template, an email receipt, a hosted
          checkout confirmation.
        </p>
        <CodeBlock language="html">{`<img src="${host}/px/c?k=pk_live_your_api_key&c=CAMPAIGN_ID&id=ORDER_ID&click=CLICK_ID&v=129.99"
     width="1" height="1" alt="" style="display:none" />`}</CodeBlock>

        <ParamTable
          params={[
            { name: 'k', type: 'string', required: true, description: 'Your API key.' },
            { name: 'c', type: 'uuid', required: true, description: 'The campaign id.' },
            {
              name: 'id',
              type: 'string',
              required: true,
              description: 'Your order identifier. The de-duplication key.',
            },
            {
              name: 'click',
              type: 'uuid',
              description: 'The adc_click value from the landing page URL.',
            },
            { name: 'v', type: 'decimal', description: 'Order value, e.g. 129.99.' },
            { name: 'cur', type: 'string', description: 'Currency code. Defaults to usd.' },
          ]}
        />

        <Alert tone="info" title="The pixel always returns an image">
          Even when the request is rejected, the endpoint returns a valid 1×1 GIF with HTTP 200 — a
          broken image icon on your confirmation page would be worse for you than an unrecorded
          conversion. The outcome is in the <code>X-Audicents-Status</code> response header, and
          failures are visible in your dashboard.
        </Alert>
      </DocSection>

      <DocSection id="postback" title="Option 3: Server-to-server postback">
        <p>
          A plain GET request from your server. This is the shape most affiliate and ad platforms can
          emit, because they only let you configure a URL template.
        </p>
        <CodeBlock language="text">{`GET ${host}/api/postback
  ?key=pk_live_your_api_key
  &campaign_id=CAMPAIGN_ID
  &click_id={CLICK_ID}
  &conversion_id={ORDER_ID}
  &value={ORDER_TOTAL}`}</CodeBlock>

        <Alert tone="warning" title="Keys in query strings end up in logs">
          Passing the key as a query parameter is supported because many platforms cannot set
          headers, but it will appear in access logs along the way. Prefer the{' '}
          <code>Authorization: Bearer</code> header where your platform allows it, and scope keys
          used this way to <code>conversions:write</code> only.
        </Alert>
      </DocSection>

      <DocSection id="api" title="Option 4: REST API">
        <p>The most control, and the one to use if you are writing the integration yourself.</p>
        <CodeBlock language="bash">{`curl -X POST ${host}/api/v1/conversions \\
  -H "Authorization: Bearer pk_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042-attempt-1" \\
  -d '{
    "campaign_id": "8f14e45f-ea0c-4b21-9d8e-2c3f1a5b7e90",
    "click_id": "3a7b1c9d-5e2f-4a8b-9c1d-6e3f2a5b8c7d",
    "conversion_id": "order-1042",
    "value": "129.99",
    "currency": "usd",
    "event_type": "SALE"
  }'`}</CodeBlock>

        <p>A successful response:</p>
        <CodeBlock language="json">{`{
  "data": {
    "id": "b2c3d4e5-...",
    "conversion_id": "order-1042",
    "status": "PENDING",
    "duplicate": false,
    "publisher_payout": "40000000",
    "platform_fee": "10000000",
    "currency": "usd",
    "recorded_at": "2026-03-14T10:22:05.000Z"
  }
}`}</CodeBlock>

        <Alert tone="info" title="Amounts are returned in micros">
          <code>40000000</code> is $40.00. One micro is a millionth of a currency unit. This is how
          the platform stores money internally so that sub-cent CPC and CPM pricing is exact rather
          than rounded — see the API reference for the full explanation.
        </Alert>
      </DocSection>

      <DocSection id="dedup" title="De-duplication">
        <p>
          A conversion is unique on <code>(campaign_id, conversion_id)</code>. Reporting the same
          pair again returns HTTP 200 with <code>duplicate: true</code> and creates nothing.
        </p>
        <p>
          <Badge tone="success">201</Badge> a new conversion was recorded.{' '}
          <Badge tone="neutral">200</Badge> this was a duplicate; nothing was charged.
        </p>
        <p>
          A retry is therefore always safe. If your first request times out, send it again with the
          same <code>conversion_id</code>.
        </p>
      </DocSection>

      <DocSection id="testing" title="Testing your integration">
        <ol className="ml-5 list-decimal space-y-2">
          <li>Create a campaign and fund it with a small amount.</li>
          <li>Sign up a second account as a publisher and take a link for your campaign.</li>
          <li>
            Click your own tracking link. It will be flagged as a self-click and not billed, but the
            click is still recorded and you will get a <code>adc_click</code> value.
          </li>
          <li>Copy that value and fire a conversion with it using any of the four methods.</li>
          <li>
            Check your campaign dashboard. The conversion appears immediately with its status and,
            if it was rejected, the reason.
          </li>
        </ol>
      </DocSection>
    </div>
  );
}
