# Fraud and traffic quality

Two principles shape everything here.

**Never silently confiscate.** A high risk score does not delete a publisher's
earnings. It holds them, records why, and asks a human. A publisher who is
wrongly flagged is made whole by approving the held earning — not by an
administrator manually inventing a compensating adjustment.

**Always explain.** Every flag carries the list of signals that produced it,
each with a weight and a sentence of plain English. An operator deciding a case
can see the evidence; a publisher asking why can be told.

## Scoring

Signals are additive, capped at 100. Each has a fixed weight and severity.

| Signal | Weight | What it means |
| --- | --- | --- |
| `AUTOMATION_UA` | 85 | Scripted HTTP client or headless browser |
| `DUPLICATE_CLICK` | terminal | Same visitor, same link, inside the dedupe window |
| `GEO_NOT_ALLOWED` | terminal | Country outside the campaign's targeting |
| `CHANNEL_NOT_ALLOWED` | terminal | Traffic source the campaign prohibits |
| `KNOWN_CRAWLER` | 60 | A declared crawler. Not fraud — not a person either |
| `SELF_CLICK` | 55 | Came from the publisher's own network |
| `MISSING_USER_AGENT` | 45 | No user agent at all |
| `IMPOSSIBLE_VELOCITY` | 45 | Same device fingerprint in two countries within 15 minutes |
| `RAPID_REPEAT` | 40 | Repeat click within seconds |
| `CONVERSION_WITHOUT_CLICK` | 40 | Conversion with no attributable click |
| `IP_BURST` | 35 | Twenty-plus clicks from one network in a minute |
| `CONVERSION_TOO_FAST` | 35 | Converted implausibly soon after the click |
| `DEVICE_BURST` | 30 | Many clicks from one device fingerprint |
| `SUSPICIOUS_REFERRER` | 30 | Known traffic-exchange or auto-surf site |
| `ABNORMAL_CONVERSION_RATE` | 30 | Rate far outside the campaign's norm |
| `PUBLISHER_HIGH_RISK` | 30 | Account-level risk score is elevated |
| `PUBLISHER_UNDER_REVIEW` | 25 | Account already under investigation |
| `REVENUE_OUTLIER` | 25 | Revenue-share order more than 10× the campaign average |
| `GEO_MISMATCH` | 15 | Click is outside the audience countries the publisher declares |
| `NEW_PUBLISHER` | 10 | Account less than three days old |
| `MISSING_REFERRER` | 8 | No referrer — common and weak on its own |

Terminal signals end the assessment immediately: the event is not billable and
no further scoring is done.

Every signal in this table is one the engine actually produces. There is no
address-reputation signal — datacentre and proxy detection needs an IP
intelligence provider, and this platform does not ship one rather than shipping
a table of ranges that would be wrong within a month. If you subscribe to such
a provider, `src/lib/fraud/signals.ts` is where a signal is declared and
`assessClick` is where it would be raised.

## Bands and what they do

| Score | Band | Outcome |
| --- | --- | --- |
| 0–20 | Low | Billable, no flag |
| 21–50 | Review | Billable and flagged for visibility |
| 51–75 | Suspicious | Billable but **held**: earning is `UNDER_REVIEW` |
| 76–100 | High | Not billable; earning is not created |

Thresholds are settings (`fraudReviewThreshold`, `fraudSuspiciousThreshold`,
`fraudRejectThreshold`) and an operator can change them without a deploy.
Auto-holding can be switched off entirely.

Clicks that were held record `REVIEW` eligibility rather than `ELIGIBLE`, so the
click log distinguishes "passed cleanly" from "billed pending a decision". They
still count as qualified clicks, because the campaign's budget is reserved
against them either way.

## What is not fraud

Several outcomes stop an event from being billable without implying anyone did
anything wrong, and they deliberately do **not** create a fraud event or count
against the publisher's account:

- Traffic from a country the campaign does not target
- Traffic from a channel the campaign prohibits
- A conversion outside the attribution window
- A duplicate click inside the dedupe window
- A declared search-engine or link-preview crawler

Treating these as fraud would punish a publisher for a brand's targeting rules,
and would drown the fraud console in noise that no one should be reviewing.

## The console

**Admin → Fraud** lists flagged events, highest score first, each with its full
signal list, the publisher's account-level risk, and three actions:

- **Approve** — release held earnings to the publisher and settle the brand's
  spend. Being flagged is not proof of anything.
- **Reject** — reverse the earnings and return the brand's budget. The publisher
  is told the reason and can dispute it.
- **Hold payouts** — stop withdrawals for that publisher while a pattern is
  investigated, without touching their balance.

Every decision is recorded in the audit log with the operator, the reason, and
the before and after state.

## Account-level risk

A publisher's `riskScore` is recomputed from their last thirty days: rejection
rate, flag rate, and conversion patterns. It needs at least 25 clicks of
history before it produces a number, because judging an account on three clicks
is not judgement.

The score feeds back into per-click scoring as `PUBLISHER_HIGH_RISK` — a
publisher with a bad record needs less additional evidence to be held — but it
never disqualifies anyone on its own.

## Privacy

The engine works on hashes, not addresses. Raw IPs are never stored: an IP is
HMAC'd with `IP_HASH_SECRET` for duplicate detection, and separately hashed at
/24 or /48 granularity for burst detection. Device fingerprints are built from
coarse attributes (browser family, OS family, device type, IP hash) — enough to
group repeat visits from one device, not enough to identify a person across
sites. See [SECURITY.md](SECURITY.md#privacy).

## Reliability

The fraud engine must never break a redirect. Its lookups are wrapped so a
database failure degrades to "no evidence of duplication" — the safe direction,
because refusing to pay a legitimate publisher on the basis of a failed query
would be worse than paying for one questionable click. Scoring runs after the
response is sent, so it cannot add latency for the visitor either.

## Tuning

Start with the defaults. Then, weekly:

1. Read the fraud console. Are the flags right?
2. If real traffic is being held, raise `fraudSuspiciousThreshold`.
3. If bad traffic is being paid, lower `fraudRejectThreshold`.
4. Watch the approve-versus-reject ratio. Approving nearly everything means the
   thresholds are too tight; rejecting nearly everything means they are too
   loose, or you have an acquisition problem upstream.

Do not tune by lowering thresholds until nothing is flagged. Silence is not
safety.
