# API

Base URL: your deployment's origin. Everything under `/api/v1` is versioned and
stable; a breaking change gets a new version.

The machine-readable specification is served at `/api/openapi.json`, and the
human documentation is in the product at `/docs/api`, `/docs/tracking` and
`/docs/webhooks`.

## Authentication

API keys are issued by a brand owner under **Developers**. They are shown once,
at creation — only a hash is stored, so a key cannot be recovered afterwards.

```
Authorization: Bearer pk_live_xxxxxxxxxxxx
```

Keys carry scopes. Grant only what an integration needs:

| Scope | Allows |
| --- | --- |
| `conversions:write` | Reporting conversions |
| `campaigns:read` | Listing campaigns and their configuration |
| `campaigns:write` | Creating and updating campaigns |
| `reports:read` | Campaign statistics |
| `publishers:read` | Publishers promoting your campaigns |
| `payouts:read` | Payout records |

`pk_live_` and `pk_test_` prefixes reflect the deployment's Stripe mode, so a
test deployment cannot mint keys that look production-grade.

Some integrations cannot set headers. Those may pass `key=` as a query
parameter on `/api/postback` and `/px/c` only. It will appear in access logs
along the way, so scope such a key to `conversions:write` and nothing else.

## Response envelope

```json
{ "data": { ... } }
```

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { … } } }
```

Codes are stable and safe to branch on; messages are for humans and may change.

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing, invalid or revoked key |
| `FORBIDDEN` | 403 | Key lacks the scope, or the resource is another brand's |
| `NOT_FOUND` | 404 | No such resource |
| `CONFLICT` | 409 | The request contradicts current state |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded the limit |
| `VALIDATION_ERROR` | 422 | Input failed validation; `details` names the fields |
| `RATE_LIMITED` | 429 | Too many requests; see `Retry-After` |
| `INTERNAL_ERROR` | 500 | Our fault; the message carries a reference to quote |
| `NOT_CONFIGURED` | 503 | A required integration is not configured on this deployment |

A duplicate is **not** an error: it returns 200 with `duplicate: true`.

## Money in responses

All amounts are strings of integer micros — millionths of a currency unit.
`"40000000"` is $40.00. They are strings because a JSON number cannot hold
large integers exactly in every client. Divide by 1,000,000 for a decimal
amount, and prefer a decimal type over a float when you do.

## Report a conversion

```
POST /api/v1/conversions
Authorization: Bearer pk_live_…
Idempotency-Key: order-1042-attempt-1        (optional)
```

```json
{
  "campaign_id": "8f14e45f-ea0c-4b21-9d8e-2c3f1a5b7e90",
  "click_id": "3a7b1c9d-5e2f-4a8b-9c1d-6e3f2a5b8c7d",
  "conversion_id": "order-1042",
  "value": "129.99",
  "currency": "usd",
  "event_type": "SALE",
  "quantity": 1,
  "metadata": { "plan": "annual" }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `campaign_id` | yes | UUID of your campaign |
| `conversion_id` | yes | Your order or lead id — the de-duplication key |
| `click_id` | practically | The `pmtr_click` value from your landing page. Without it the conversion cannot be attributed and is rejected |
| `value` | for revenue share | Decimal string or number; parsed exactly, never through a float |
| `event_type` | no | `SALE`, `LEAD`, `CLICK`, `IMPRESSION`, `CUSTOM` |
| `currency` | no | Defaults to the campaign's currency |
| `quantity` | no | For per-unit models |
| `metadata` | no | Stored and returned; keep it free of personal data |

**201** for a new conversion, **200** with `duplicate: true` for one already
recorded.

```json
{
  "data": {
    "id": "b2c3d4e5-…",
    "conversion_id": "order-1042",
    "status": "PENDING",
    "duplicate": false,
    "publisher_payout": "40000000",
    "platform_fee": "10000000",
    "currency": "usd",
    "recorded_at": "2026-03-14T10:22:05.000Z"
  }
}
```

A conversion can be accepted and still earn nothing — an exhausted budget is the
common case. The response then carries `status: "REJECTED"` with a reason. The
event is recorded either way, because you need to see that it happened.

### Why a conversion is refused

| Reason | What it means |
| --- | --- |
| `CLICK_NOT_FOUND` | No click matches `click_id` |
| `ATTRIBUTION_WINDOW_EXPIRED` | The click is older than the campaign's window |
| `CAMPAIGN_INACTIVE` | The campaign is paused, completed or unfunded |
| `BUDGET_EXHAUSTED` | Recorded, but nothing left to pay it with |
| `DUPLICATE` | Already recorded — a success, not a failure |

## Other endpoints

| Endpoint | Scope | Purpose |
| --- | --- | --- |
| `GET /api/v1/campaigns` | `campaigns:read` | Your campaigns and their configuration |
| `GET /api/v1/campaigns/{id}/stats` | `reports:read` | Clicks, conversions and spend for a range |
| `GET /api/postback` | `conversions:write` | Server-to-server conversion, for platforms that only accept a URL template |
| `GET /px/c` | `conversions:write` | 1×1 pixel conversion, for template-only checkouts |
| `GET /api/health` | none | Liveness and readiness |
| `GET /api/openapi.json` | none | This API, machine-readable |

The pixel always returns a valid GIF with 200, even when the report is rejected
— a broken image on a customer's confirmation page would be worse for the brand
than an unrecorded conversion. The outcome is in the `X-Promotr-Status` header
and visible in the dashboard.

## Rate limits

| Surface | Limit |
| --- | --- |
| Conversion ingest | 1,200 / minute per key |
| Reads | 600 / minute per key |
| Writes | 120 / minute per key |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`
(seconds until the window resets); a 429 also carries `Retry-After`. If the rate limiter
itself is unavailable, requests are allowed rather than denied — an outage in a
protective control should not become an outage in the product.

## Webhooks

Register endpoints under **Developers**. Each delivery carries:

```
X-Promotr-Signature: t=1710412925,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

Verify by computing `HMAC-SHA256(secret, "{timestamp}.{body}")` and comparing in
constant time, then rejecting timestamps outside a five-minute tolerance.
`verifySignature()` in `src/lib/webhooks/outbound.ts` is the reference
implementation, and the test suite proves the scheme round-trips and rejects
tampering and replays.

Deliveries retry with exponential backoff; an endpoint that fails repeatedly is
disabled rather than retried forever, and re-enabling it clears the counter.
Every delivery and its response is visible under **Developers**, with a retry
button.

Events: `campaign.created`, `campaign.started`, `campaign.paused`,
`campaign.completed`, `campaign.budget.low`, `campaign.budget.exhausted`,
`click.created`, `conversion.created`, `conversion.approved`,
`conversion.rejected`, `conversion.reversed`, `payout.created`,
`payout.completed`, `payout.failed`, `publisher.joined`, `dispute.opened`,
`dispute.resolved`.

## Tracking links

A link looks like `https://your-domain/go/AbC123`. The redirect appends one
parameter to your destination:

```
https://yourbrand.com/landing?pmtr_click=8f14e45f-ea0c-4b21-9d8e-2c3f1a5b7e90
```

Store it, and send it back as `click_id` when the visitor converts. It is opaque
— it identifies the click in our database and says nothing about the visitor.
The redirect sends `Referrer-Policy: no-referrer`, so the tracking code is not
leaked to your site in the referrer header.

The JavaScript SDK at `/sdk/p.js` captures and stores it for you, and sends
conversions with one call. It is about 2KB and has no dependencies.
