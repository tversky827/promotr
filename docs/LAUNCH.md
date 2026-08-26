# Launch checklist

The software is built and tested. What follows is the work that software cannot
do for you. Nothing here is ceremonial — each item is something that, skipped,
either loses money or breaks a legal obligation.

## Before anything else

### Legal review — not optional

The legal documents in this repository (terms of service, privacy policy,
creator agreement, brand agreement, acceptable use, campaign rules) are drafts
written to be readable and to cover the obvious ground. **They have not been
reviewed by a lawyer, and they are not legal advice.** Have counsel in your
jurisdiction review all of them before you take a payment.

Ask counsel specifically about:

- **Money transmission.** You take money from brands, hold it, and pay
  publishers. Depending on jurisdiction, structure and volume, that may be a
  regulated activity requiring licensing. Using Stripe Connect changes the
  analysis; it does not automatically settle it.
- **Tax reporting.** Payments to publishers are reportable in most
  jurisdictions (1099-NEC in the US, and various equivalents elsewhere). The
  platform records which form a publisher declared; it does not file anything.
- **Data protection.** GDPR, CCPA and their relatives apply to click data even
  though no raw addresses are stored. You need a lawful basis, a retention
  policy, and a data processing agreement with brands.
- **Advertising law.** Publishers must disclose paid promotion (FTC endorsement
  guides in the US, ASA rules in the UK, and so on). The platform reminds them
  of the obligation. It cannot enforce it, and you may share liability for what
  they publish.
- **Your marketing claims.** Do not describe this platform as an investment, as
  guaranteed income, as guaranteed advertising results, or as a financial
  institution. It is none of those things.

### Security review

- Commission a penetration test. This codebase has not had one.
- Rotate every credential that has ever been in a chat, a ticket or a laptop.
- Confirm `APP_ENCRYPTION_KEY` and `IP_HASH_SECRET` are unique to production and
  stored in a secret manager, not in a file.
- Confirm `.env` is not in the image, not in the repository, and not in a build
  log.
- Read [SECURITY.md](SECURITY.md), including its stated limitations.

### Insurance and structure

- Errors and omissions, and cyber liability, are the usual ones for a platform
  holding other people's money.
- Confirm with your accountant how held balances appear on your books. Brand
  deposits and publisher balances are liabilities, not revenue. The ledger
  models it that way; your accounts should too.

## Technical readiness

### Infrastructure

- [ ] Postgres with point-in-time recovery, and **a restore you have actually
      performed**
- [ ] Redis configured (`REDIS_URL`)
- [ ] Object storage configured (S3-compatible)
- [ ] Worker running as a supervised process, or the cron endpoint scheduled
- [ ] TLS, HSTS confirmed live, and the domain's DNS locked down
- [ ] `TRUST_PROXY` correct for your topology — wrong here means spoofable
      client addresses

### Payments

- [ ] Stripe account activated for live payments and Connect
- [ ] Live keys in production, test keys nowhere near it
- [ ] Webhooks pointed at `/api/webhooks/stripe` with the signing secret set
- [ ] A real card charged end to end, and the deposit visible in the ledger
- [ ] A real payout paid end to end to a test publisher, and reconciled
- [ ] A refund and a chargeback simulated in Stripe's test mode, and the ledger
      checked afterwards

### Email

- [ ] Provider configured and sending
- [ ] SPF, DKIM and DMARC published for the sending domain
- [ ] Verification, password reset, payout and dispute emails all received in a
      real inbox, not just the log

### Monitoring

- [ ] Sentry receiving errors
- [ ] Alerts on: `ledger.drift_detected`, global balance failure, dead-lettered
      jobs, rollup age, 5xx rate
- [ ] Someone is on the other end of those alerts

### Verification

```bash
npm run verify        # typecheck, full test suite, production build
npm audit             # expect zero vulnerabilities
```

- [ ] Green
- [ ] `/api/health` returns 200 in production
- [ ] `/status` renders and reports every capability operational

## Operational readiness

### Settings

Open **Admin → Settings** and decide each of these deliberately rather than
inheriting a default:

- [ ] Platform fee (default 20%)
- [ ] Minimum payout (default $25)
- [ ] Earning hold period (default 7 days)
- [ ] Fraud thresholds (21 / 51 / 76)
- [ ] Whether brand verification is required before a campaign can launch
- [ ] Whether publisher verification and a tax declaration are required before
      payout
- [ ] Prohibited campaign categories and keywords

### People

- [ ] At least two administrators, both with MFA enabled
- [ ] Someone owns the fraud console daily
- [ ] Someone owns disputes with a stated response time
- [ ] Support address monitored, and it matches
      `NEXT_PUBLIC_BRAND_SUPPORT_EMAIL`

### Money controls

- [ ] Reconciliation alerting is live, and someone knows what to do when it
      fires
- [ ] A written procedure for a publisher disputing a rejected earning
- [ ] A written procedure for a brand disputing traffic
- [ ] A decision, in advance, about who absorbs chargebacks. The platform
      currently absorbs them and never claws back publisher earnings — that is
      a deliberate choice and it has a cost

## Before the first real campaign

Run the whole loop with real money, at small amounts:

1. Create a brand account and verify it.
2. Fund a campaign with a real card, for a few dollars.
3. Launch it.
4. From a second account, take a publisher link.
5. Click it from a phone on mobile data. Confirm the redirect, and confirm the
   click appears with the right country and device.
6. Report a conversion through the API with the click id.
7. Confirm the earning, the brand's spend, and the platform fee, and check the
   ledger balances.
8. Wait out the hold period. Confirm the earning becomes available.
9. Withdraw it to a real Connect account. Confirm the money arrives.
10. Reconcile. Every account should agree with its entries, and total debits
    should equal total credits.

If any step surprises you, do not launch. Fix it, then run the loop again.

## Day one

- Watch the fraud console. Early traffic is where the probing happens.
- Watch the ledger reconciliation job.
- Watch the queue depth.
- Keep click retention at the default until you know your volume.

## What this checklist does not cover

Pricing, positioning, acquiring the first brands and the first publishers, and
the cold-start problem of a two-sided marketplace. Those are the hard parts, and
no amount of correct software solves them.
