import type { Metadata } from 'next';

import { CodeBlock, DocSection, ParamTable } from '@/components/docs/code';
import { Alert } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Webhooks',
  description: 'Receive events when things happen on your campaigns.',
  alternates: { canonical: '/docs/webhooks' },
};

export default function WebhooksDocsPage() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">Webhooks</h1>
        <p className="mt-3 text-md text-fg-muted text-pretty">
          Configure an endpoint in your brand dashboard under Developers, choose the events you care
          about, and we will POST them to you as they happen.
        </p>
      </header>

      <DocSection id="events" title="Events">
        <ParamTable
          params={[
            { name: 'campaign.created', type: 'event', description: 'A campaign was created.' },
            { name: 'campaign.started', type: 'event', description: 'A campaign went live.' },
            { name: 'campaign.paused', type: 'event', description: 'A campaign was paused.' },
            { name: 'campaign.completed', type: 'event', description: 'A campaign ended; unspent budget returned.' },
            { name: 'campaign.budget.low', type: 'event', description: 'Remaining budget crossed the alert threshold.' },
            { name: 'campaign.budget.exhausted', type: 'event', description: 'The campaign can no longer accrue billable activity.' },
            { name: 'conversion.created', type: 'event', description: 'A conversion was recorded.' },
            { name: 'conversion.approved', type: 'event', description: 'A conversion cleared verification.' },
            { name: 'conversion.rejected', type: 'event', description: 'A conversion was rejected; you were not charged.' },
            { name: 'conversion.reversed', type: 'event', description: 'An approved conversion was reversed.' },
            { name: 'publisher.joined', type: 'event', description: 'A publisher took a link for your campaign.' },
            { name: 'dispute.opened', type: 'event', description: 'A dispute was raised.' },
            { name: 'dispute.resolved', type: 'event', description: 'A dispute was decided.' },
          ]}
        />
        <p>
          Subscribe to <code>*</code> to receive everything.
        </p>
      </DocSection>

      <DocSection id="payload" title="Payload">
        <CodeBlock language="json">{`{
  "id": "evt_x7k2m9q4",
  "type": "conversion.created",
  "created": 1773484925,
  "data": {
    "conversionId": "b2c3d4e5-...",
    "campaignId": "8f14e45f-...",
    "externalId": "order-1042",
    "revenueMicros": "129990000",
    "payoutMicros": "40000000",
    "status": "PENDING"
  }
}`}</CodeBlock>
      </DocSection>

      <DocSection id="signatures" title="Verifying signatures">
        <p>Every delivery carries a signature header:</p>
        <CodeBlock language="text">{`Audicents-Signature: t=1773484925,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
Audicents-Event-Id: evt_x7k2m9q4
Audicents-Event-Type: conversion.created
Audicents-Delivery-Attempt: 1`}</CodeBlock>

        <p>
          The signature is an HMAC-SHA256 of{' '}
          <code>{'{timestamp}.{raw body}'}</code> using your endpoint&apos;s signing secret. The
          timestamp is inside the signed payload, so a captured delivery cannot be replayed later.
        </p>

        <CodeBlock language="javascript" filename="Node.js">{`import crypto from 'node:crypto';

function verify(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=')),
  );

  const timestamp = Number(parts.t);
  // Reject anything older than five minutes.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  // Constant-time comparison — a === would leak the signature byte by byte.
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(parts.v1),
  );
}`}</CodeBlock>

        <Alert tone="warning" title="Verify against the raw body">
          Parse the JSON only after verifying. Re-serialising before verification changes the bytes
          and the signature will not match.
        </Alert>
      </DocSection>

      <DocSection id="retries" title="Retries and failures">
        <p>
          Return any 2xx status to acknowledge. Anything else is a failure, and we retry with
          exponential backoff: 1 minute, 5 minutes, 25 minutes, 2 hours, 6 hours, 12 hours, 24 hours.
          After eight attempts the delivery is marked dead and stops.
        </p>
        <p>
          An endpoint that fails fifteen consecutive deliveries is disabled automatically and you are
          notified. You can re-enable it and redeliver individual events from your dashboard.
        </p>
        <Alert tone="info" title="Acknowledge fast, process later">
          Return 200 as soon as you have durably received the event, then process asynchronously. If
          you do your work before responding, a slow database will look like a webhook failure and
          trigger retries you do not want.
        </Alert>
      </DocSection>

      <DocSection id="ordering" title="Ordering and duplicates">
        <p>
          Delivery is at-least-once and unordered. Use <code>Audicents-Event-Id</code> to de-duplicate,
          and the <code>created</code> timestamp to detect out-of-order arrivals. Do not assume that
          receiving <code>conversion.approved</code> means you already received{' '}
          <code>conversion.created</code>.
        </p>
      </DocSection>

      <DocSection id="testing" title="Testing">
        <p>
          Point an endpoint at a request-inspection service to see the exact payloads and headers we
          send. Every delivery attempt, its response code and body are logged in your dashboard under
          Developers, so you can debug without instrumenting your own server.
        </p>
        <p>
          Questions:{' '}
          <a href={`mailto:${brand.supportEmail}`} className="text-primary hover:underline">
            {brand.supportEmail}
          </a>
        </p>
      </DocSection>
    </div>
  );
}
