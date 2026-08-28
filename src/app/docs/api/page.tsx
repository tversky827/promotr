import type { Metadata } from 'next';

import { CodeBlock, DocSection, ParamTable } from '@/components/docs/code';
import { Alert } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'REST API',
  description: `The ${brand.name} REST API reference.`,
  alternates: { canonical: '/docs/api' },
};

export default function ApiDocsPage() {
  const host = brand.appUrl;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">REST API</h1>
        <p className="mt-3 text-md text-fg-muted text-pretty">
          A machine-readable OpenAPI 3.1 description is available at{' '}
          <a href="/api/openapi.json" className="text-primary hover:underline">
            /api/openapi.json
          </a>
          .
        </p>
      </header>

      <DocSection id="auth" title="Authentication">
        <p>
          Create an API key from your brand dashboard under Developers. The full key is shown once at
          creation and cannot be recovered — only its hash is stored.
        </p>
        <CodeBlock language="bash">{`curl ${host}/api/v1/campaigns \\
  -H "Authorization: Bearer pk_live_xxxxxxxxxxxx"`}</CodeBlock>
        <p>
          Keys carry scopes. A key used for server-to-server conversion reporting should have only{' '}
          <code>conversions:write</code>, so a leak cannot be used to read your reports.
        </p>
        <ParamTable
          params={[
            { name: 'conversions:write', type: 'scope', description: 'Report conversions.' },
            { name: 'campaigns:read', type: 'scope', description: 'Read campaigns and conversions.' },
            { name: 'campaigns:write', type: 'scope', description: 'Create and update campaigns.' },
            { name: 'reports:read', type: 'scope', description: 'Read performance reports.' },
            { name: 'publishers:read', type: 'scope', description: 'Read publisher performance.' },
            { name: 'payouts:read', type: 'scope', description: 'Read payout records.' },
          ]}
        />
      </DocSection>

      <DocSection id="money" title="How money is represented">
        <p>
          Every monetary value in this API is an integer <strong>micros</strong> value, serialised as
          a string to avoid JavaScript&apos;s float precision limits. One micro is a millionth of a
          currency unit.
        </p>
        <CodeBlock language="text">{`"40000000"   = $40.00
"250000"     = $0.25
"2500"       = $0.0025   (a quarter-cent CPC — exact, not rounded)`}</CodeBlock>
        <p>
          Performance advertising routinely prices below a cent: a $5.00 CPM is $0.005 per
          impression. Storing cents would force rounding on every event, and those roundings compound
          across millions of events. Micros give four extra decimal places while staying integral, so
          the arithmetic is exact.
        </p>
      </DocSection>

      <DocSection id="responses" title="Response format">
        <p>Every endpoint returns one of two shapes.</p>
        <CodeBlock language="json" filename="Success">{`{ "data": { ... } }`}</CodeBlock>
        <CodeBlock language="json" filename="Failure">{`{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body did not validate.",
    "details": { "issues": [{ "field": "conversion_id", "message": "required" }] }
  }
}`}</CodeBlock>
        <p>
          <code>code</code> is a stable string you can branch on. <code>message</code> is written for
          humans and may change.
        </p>
        <ParamTable
          params={[
            { name: 'UNAUTHORIZED', type: '401', description: 'Missing, invalid, or revoked API key.' },
            { name: 'FORBIDDEN', type: '403', description: 'The key lacks the required scope.' },
            { name: 'NOT_FOUND', type: '404', description: 'The resource does not exist on your account.' },
            { name: 'CONFLICT', type: '409', description: 'The request conflicts with current state.' },
            { name: 'VALIDATION_ERROR', type: '422', description: 'The request body failed validation.' },
            { name: 'RATE_LIMITED', type: '429', description: 'Slow down. See the Retry-After header.' },
            { name: 'NOT_CONFIGURED', type: '503', description: 'A required integration is not configured on this deployment.' },
            { name: 'INTERNAL_ERROR', type: '500', description: 'Our fault. The message includes a reference to quote to support.' },
          ]}
        />
      </DocSection>

      <DocSection id="rate-limits" title="Rate limits">
        <p>
          Limits are per API key. Conversion reporting allows 1,200 requests per minute; other
          endpoints allow 600. Responses carry <code>RateLimit-Limit</code>,{' '}
          <code>RateLimit-Remaining</code> and <code>RateLimit-Reset</code>.
        </p>
        <p>
          A 429 includes <code>Retry-After</code> in seconds. Back off and retry — conversion
          reporting is idempotent, so a retry cannot double-charge.
        </p>
      </DocSection>

      <DocSection id="conversions" title="Conversions">
        <h3 className="text-md font-semibold text-fg">POST /api/v1/conversions</h3>
        <ParamTable
          params={[
            { name: 'campaign_id', type: 'uuid', required: true, description: 'The campaign the conversion belongs to. Must be on your account.' },
            { name: 'conversion_id', type: 'string', required: true, description: 'Your stable order identifier. The de-duplication key.' },
            { name: 'click_id', type: 'uuid', description: 'The adc_click value from the landing page. Without it the conversion cannot be attributed.' },
            { name: 'value', type: 'string | number', description: 'Order value as a decimal, e.g. "129.99". Drives revenue-share payouts.' },
            { name: 'currency', type: 'string', description: 'Three-letter code. Defaults to usd.' },
            { name: 'event_type', type: 'enum', description: 'CLICK, IMPRESSION, LEAD, SALE, or CUSTOM. Inferred from the campaign if omitted.' },
            { name: 'quantity', type: 'integer', description: 'For CPM and multi-unit events. Defaults to 1.' },
            { name: 'metadata', type: 'object', description: 'Arbitrary key/value data stored with the conversion.' },
          ]}
        />

        <h3 className="mt-6 text-md font-semibold text-fg">GET /api/v1/conversions</h3>
        <p>
          Look up a conversion you previously reported. Requires <code>campaign_id</code> and{' '}
          <code>conversion_id</code> as query parameters, and the <code>campaigns:read</code> scope.
        </p>
        <CodeBlock language="bash">{`curl "${host}/api/v1/conversions?campaign_id=CAMPAIGN&conversion_id=order-1042" \\
  -H "Authorization: Bearer pk_live_xxxxxxxxxxxx"`}</CodeBlock>
      </DocSection>

      <DocSection id="campaigns" title="Campaigns">
        <h3 className="text-md font-semibold text-fg">GET /api/v1/campaigns</h3>
        <p>Lists your campaigns with their current budget and performance.</p>
        <CodeBlock language="json">{`{
  "data": {
    "campaigns": [
      {
        "id": "8f14e45f-...",
        "name": "Spring Drop",
        "status": "ACTIVE",
        "payout_model": "CPA",
        "publisher_payout": "40000000",
        "budget": {
          "funded": "500000000",
          "available": "312500000",
          "committed": "37500000",
          "spent": "150000000"
        },
        "created_at": "2026-03-01T09:00:00.000Z"
      }
    ]
  }
}`}</CodeBlock>

        <h3 className="mt-6 text-md font-semibold text-fg">GET /api/v1/campaigns/:id/stats</h3>
        <p>
          Performance for one campaign. Accepts <code>from</code> and <code>to</code> as ISO dates.
        </p>
      </DocSection>

      <DocSection id="idempotency" title="Idempotency">
        <p>
          Conversion reporting is idempotent on <code>(campaign_id, conversion_id)</code>. You can
          additionally send an <code>Idempotency-Key</code> header when you cannot guarantee a stable
          conversion identifier.
        </p>
        <Alert tone="info" title="Retries are always safe">
          If a request times out, send it again. You will get a 200 with{' '}
          <code>duplicate: true</code> if the first one actually landed.
        </Alert>
      </DocSection>

      <DocSection id="errors" title="Handling errors well">
        <CodeBlock language="javascript">{`async function reportConversion(payload, attempt = 1) {
  const response = await fetch('${host}/api/v1/conversions', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.AUDICENTS_API_KEY}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) return response.json();

  const body = await response.json();

  // Rate limited: back off and retry. Idempotency makes this safe.
  if (body.error.code === 'RATE_LIMITED' && attempt < 5) {
    const wait = Number(response.headers.get('Retry-After') ?? 1) * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return reportConversion(payload, attempt + 1);
  }

  // Validation errors will not succeed on retry — fix the payload.
  if (body.error.code === 'VALIDATION_ERROR') {
    throw new Error(\`Invalid payload: \${JSON.stringify(body.error.details)}\`);
  }

  // Server errors are worth retrying.
  if (response.status >= 500 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    return reportConversion(payload, attempt + 1);
  }

  throw new Error(body.error.message);
}`}</CodeBlock>
      </DocSection>
    </div>
  );
}
