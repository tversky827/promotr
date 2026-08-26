import { brand } from '@/lib/brand';

/**
 * OpenAPI 3.1 description, generated from the live configuration so the server
 * URL always matches the deployment rather than being a hard-coded constant.
 */

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  return Response.json(spec(), {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function spec() {
  return {
    openapi: '3.1.0',
    info: {
      title: `${brand.name} API`,
      version: '1.0.0',
      description:
        'Performance marketplace API. All monetary values are integer micros (one millionth of a currency unit) serialised as strings, so sub-cent pricing is exact and JavaScript float precision is never involved.',
      contact: { email: brand.supportEmail },
    },
    servers: [{ url: brand.appUrl, description: 'This deployment' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key created in the brand dashboard under Developers.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR',
                    'RATE_LIMITED', 'CONFLICT', 'NOT_CONFIGURED', 'INTERNAL_ERROR',
                  ],
                },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        Micros: {
          type: 'string',
          pattern: '^-?\\d+$',
          description:
            'An integer amount in micros, serialised as a string. "40000000" is $40.00; "2500" is $0.0025.',
          examples: ['40000000', '250000', '2500'],
        },
        ConversionRequest: {
          type: 'object',
          required: ['campaign_id', 'conversion_id'],
          properties: {
            campaign_id: { type: 'string', format: 'uuid' },
            conversion_id: {
              type: 'string',
              maxLength: 190,
              description:
                'Your stable order identifier. Reporting the same value twice for one campaign is a no-op.',
            },
            click_id: {
              type: ['string', 'null'],
              format: 'uuid',
              description: 'The pmtr_click value appended to your landing page URL.',
            },
            value: {
              type: ['string', 'number'],
              description: 'Order value as a decimal, e.g. "129.99".',
            },
            currency: { type: 'string', minLength: 3, maxLength: 3, default: 'usd' },
            event_type: {
              type: 'string',
              enum: ['CLICK', 'IMPRESSION', 'LEAD', 'SALE', 'CUSTOM'],
            },
            quantity: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
        Conversion: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            conversion_id: { type: 'string' },
            status: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'REJECTED', 'UNDER_REVIEW', 'REVERSED', 'DUPLICATE'],
            },
            duplicate: { type: 'boolean' },
            publisher_payout: { $ref: '#/components/schemas/Micros' },
            platform_fee: { $ref: '#/components/schemas/Micros' },
            currency: { type: 'string' },
            recorded_at: { type: 'string', format: 'date-time' },
          },
        },
        Campaign: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            status: {
              type: 'string',
              enum: [
                'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE',
                'PAUSED', 'COMPLETED', 'REJECTED', 'SUSPENDED',
              ],
            },
            payout_model: {
              type: 'string',
              enum: ['CPC', 'CPL', 'CPA', 'CPM', 'REVSHARE', 'HYBRID'],
            },
            publisher_payout: { $ref: '#/components/schemas/Micros' },
            revshare_bps: { type: 'integer' },
            budget: {
              type: 'object',
              properties: {
                funded: { $ref: '#/components/schemas/Micros' },
                available: { $ref: '#/components/schemas/Micros' },
                committed: { $ref: '#/components/schemas/Micros' },
                spent: { $ref: '#/components/schemas/Micros' },
              },
            },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing, invalid, or revoked API key.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'Too many requests.',
          headers: {
            'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' },
          },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/api/v1/conversions': {
        post: {
          summary: 'Report a conversion',
          description:
            'Idempotent on (campaign_id, conversion_id). A duplicate returns 200 with duplicate:true and charges nothing.',
          operationId: 'createConversion',
          security: [{ bearerAuth: ['conversions:write'] }],
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              schema: { type: 'string' },
              description: 'Optional. Use when you cannot guarantee a stable conversion_id.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ConversionRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'Conversion recorded.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/Conversion' } },
                  },
                },
              },
            },
            '200': { description: 'Duplicate — already recorded, nothing charged.' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { description: 'No such campaign on this account.' },
            '422': { description: 'Validation failed, or the conversion could not be attributed.' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
        get: {
          summary: 'Look up a conversion',
          operationId: 'getConversion',
          security: [{ bearerAuth: ['campaigns:read'] }],
          parameters: [
            { name: 'campaign_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'conversion_id', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'The conversion.' },
            '404': { description: 'Not found.' },
          },
        },
      },
      '/api/postback': {
        get: {
          summary: 'Server-to-server conversion postback',
          description:
            'A GET-with-query-parameters form for platforms that can only be configured with a URL template. Accepts the API key as a query parameter, which will appear in access logs — prefer the Authorization header where possible.',
          operationId: 'postback',
          parameters: [
            { name: 'key', in: 'query', schema: { type: 'string' }, description: 'API key, if a header cannot be set.' },
            { name: 'campaign_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'conversion_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'click_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'value', in: 'query', schema: { type: 'string' } },
            { name: 'currency', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Recorded, or a duplicate.' } },
        },
      },
      '/px/c': {
        get: {
          summary: 'Conversion pixel',
          description:
            'Always returns a 1x1 GIF with HTTP 200 so a misconfigured pixel never shows a broken image on an advertiser confirmation page. The real outcome is in the X-Promotr-Status header.',
          operationId: 'conversionPixel',
          parameters: [
            { name: 'k', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'c', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'click', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'v', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'A 1x1 GIF.',
              headers: {
                'X-Promotr-Status': {
                  schema: { type: 'string' },
                  description: 'recorded | duplicate | unauthorized | rejected:<reason> | error',
                },
              },
              content: { 'image/gif': {} },
            },
          },
        },
      },
      '/api/v1/campaigns': {
        get: {
          summary: 'List your campaigns',
          operationId: 'listCampaigns',
          security: [{ bearerAuth: ['campaigns:read'] }],
          responses: {
            '200': {
              description: 'Your campaigns.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          campaigns: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Campaign' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/campaigns/{id}/stats': {
        get: {
          summary: 'Campaign performance',
          operationId: 'campaignStats',
          security: [{ bearerAuth: ['reports:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { '200': { description: 'Aggregated performance.' } },
        },
      },
      '/api/health': {
        get: {
          summary: 'Health check',
          operationId: 'health',
          security: [],
          responses: {
            '200': { description: 'Healthy.' },
            '503': { description: 'A required dependency is unavailable.' },
          },
        },
      },
    },
  };
}
