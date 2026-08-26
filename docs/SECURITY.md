# Security

## Authentication

Passwords are hashed with **scrypt** (N=2¹⁶, r=8, p=1 — roughly 100ms and 64MB
per hash), stored as `scrypt$N$r$p$salt$hash` so the parameters can be raised
later and old hashes upgraded on next sign-in. Verification is constant-time.

Sessions are opaque 32-byte random tokens. **Only the SHA-256 hash is stored**,
so a database leak cannot be replayed as a live session. The cookie is
`HttpOnly`, `SameSite=Lax`, `Secure` in production, and lasts 30 days. Session
validity — including whether the account has since been suspended — is checked
on every request rather than baked into a signed token, so suspension takes
effect immediately.

Sign-in is rate limited per address and per account. Repeated failures lock the
account temporarily. The same generic message is returned whether the email
exists or not.

**Multi-factor authentication** is TOTP (RFC 6238), implemented against Node's
crypto rather than a package. Secrets are encrypted at rest with AES-256-GCM.
Recovery codes are single-use and stored only as hashes. Administrator accounts
must satisfy MFA *within the current session* before any privileged action —
having it enabled is not enough.

## Authorisation

A permission matrix (`src/lib/rbac.ts`) maps roles to explicit permissions.
Guards resolve who is asking and what they may do:

```ts
const { brand } = await requireBrand('brand:apikeys:manage');
```

Two rules that matter:

- **Authorisation is the permission, not a role compared inline.** A brand
  member and a brand owner differ in exactly one place — the matrix.
- **Every tenant-scoped query is filtered by the resolved tenant**, not by an
  id from the request. A brand cannot read another brand's campaign by guessing
  its UUID, and the test suite asserts it.

Middleware redirects signed-out visitors away from application areas, but it
checks only that a session cookie exists — it cannot reach the database. The
page guards remain the authorisation boundary.

One behaviour worth knowing: when a signed-in user opens an area they are not
allowed into, Next.js has already flushed the document shell by the time the
guard runs, so the redirect travels in the response body and the status is 200.
The page never renders and no data is in the response. The end-to-end suite
asserts exactly that.

## CSRF

Every mutation goes through one wrapper that verifies:

1. `Origin`/`Referer` matches the deployment's own origin.
2. A double-submit token: a value in a JS-readable cookie echoed in the form.

A developer cannot forget it — the form component injects the token, and the
action wrapper rejects anything without it. The public API is exempt because it
authenticates with a bearer token, which is not sent automatically by a browser.

## API keys

Generated with 32 bytes of entropy, prefixed `pk_live_` or `pk_test_` depending
on the deployment's payment mode. **Only a hash is stored**; the key is shown
once at creation and cannot be recovered. Keys carry scopes, are revocable
immediately, and record last use.

Webhook signing secrets are different: they are stored **encrypted** rather than
hashed, because the delivery worker needs the plaintext to sign each payload.
Revealing one to a brand owner is therefore possible, and audited every time.

## Input handling

Every action and endpoint parses input with a Zod schema before the handler sees
it. Database access is through Prisma's parameterised queries; the few raw SQL
statements use tagged templates or `$queryRawUnsafe` with bound parameters and
never interpolate user input.

CSV exports escape values that begin with `=`, `+`, `-` or `@` to prevent
formula injection when a spreadsheet opens them.

Campaign destination URLs are checked against private, loopback, link-local and
internal-suffix hostnames before a campaign can go live, so a campaign cannot be
used to probe internal infrastructure. With a Safe Browsing key configured, URLs
are also screened for malware and phishing; without one, the campaign is flagged
for manual review instead of being silently approved.

## Headers

Set globally in `next.config.ts`:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

The redirect route overrides `Referrer-Policy` with `no-referrer`, so the
tracking code is not leaked to the advertiser's site in the referrer header.
That rule is ordered after the global one deliberately — an end-to-end test
asserts the override wins, because it silently regressed once.

## Privacy

**Raw IP addresses are never stored.** An address is used in-request to derive:

- `ipHash` — HMAC-SHA256 with `IP_HASH_SECRET`, for duplicate detection
- `ipPrefixHash` — the same over the /24 or /48, for burst detection
- part of a coarse device fingerprint (browser family, OS family, device type)

The address itself is discarded when the request ends. There is a test that
drives a click through the whole pipeline and asserts the address appears
nowhere in the stored row.

Rotating `IP_HASH_SECRET` invalidates historical correlation — deliberately.
Rotate it on a schedule if your policy calls for limiting how long behaviour can
be linked.

Raw click and impression rows are dropped by partition after
`CLICK_RETENTION_DAYS` (default 180). Aggregates survive, so reporting history
is preserved without keeping event-level data indefinitely.

Users can export everything held about them as JSON, and can request account
deletion from their settings. Deletion is scheduled with a 30-day window rather
than immediate, and a publisher with an unpaid balance must withdraw it first —
deleting an account we owe money to would strand the money.

## Secrets

Two keys are required and neither has a default:

| Variable | Protects |
| --- | --- |
| `APP_ENCRYPTION_KEY` | AES-256-GCM for MFA seeds, webhook secrets, OAuth tokens, tax identifiers |
| `IP_HASH_SECRET` | HMAC for pseudonymous identifiers |

Generate with `openssl rand -base64 32`. The application refuses to start in
production without them.

**Rotating `APP_ENCRYPTION_KEY` makes previously encrypted values
unreadable.** There is no envelope-key indirection, which is a deliberate
simplification: rotation therefore means re-encrypting existing values with both
keys available, not swapping the variable. Plan for it before you need it.

No secret is ever committed. `.env` is git-ignored; `.env.example` documents
every variable with no real values.

## Audit trail

Every consequential action writes an audit record: who, when, what, the reason,
and the before and after state. Balance adjustments, fraud decisions,
suspensions, refunds, campaign moderation, key issuance, secret reveals,
settings changes. The log is queryable in the admin console and is append-only.

## Rate limits

| Surface | Limit |
| --- | --- |
| Sign-in | 10 per address / 8 per account per 15 min |
| Sign-up | 5 per hour |
| Password reset | 5 per hour |
| Conversion ingest | 1,200 per minute per key |
| API reads / writes | 600 / 120 per minute |
| Redirects | 300 per minute per address |
| Link generation | 60 per hour |
| Payout requests | 10 per hour |
| Exports | 20 per hour |

Backed by Redis when configured. Without it, limits are enforced per process —
correct on a single instance, and weaker across several, which is why Redis is
recommended in production. If the limiter itself fails, requests are **allowed**:
an outage in a protective control should not become an outage in the product.

## Money-specific protections

- Overspend is impossible at the database level, not merely guarded in code.
- Ledger entries cannot be updated or deleted; a trigger enforces it.
- Every transaction must balance, checked by a deferred constraint at commit.
- Payouts settle only on a signed provider webhook, never on an API response.
- Stripe webhooks are signature-verified and deduplicated by event id.

## Reporting a vulnerability

Email the address in `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL` with "Security" in the
subject. Please give us a reasonable window to fix an issue before disclosing
it.

## Known limitations

Stated plainly, because pretending otherwise is worse:

- There is no field-level encryption of the whole database. Secrets are
  encrypted; ordinary business data relies on disk encryption and access
  control at the database.
- The in-memory fallbacks (rate limiting, caching, export storage) are correct
  on one instance only. Configure Redis and object storage for multi-instance
  deployments.
- Device fingerprinting is intentionally coarse. It groups repeat visits; it
  does not defeat a determined fraud operation with residential proxies. That
  is an accepted trade against being able to track people across sites.
- The platform has not been penetration tested. Do that before launch — see
  [LAUNCH.md](LAUNCH.md).
