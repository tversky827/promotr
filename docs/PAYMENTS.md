# Payments

Money in this system moves through a double-entry ledger. Nothing adjusts a
balance directly; every movement is a balanced transaction, and every balance is
derived from entries that cannot be altered after they are written.

## Units

Integer **micros** — millionths of a currency unit — held in `BIGINT` columns.
$1.00 is 1,000,000. A quarter-cent cost-per-click is 2,500, exactly. No floating
point value touches money anywhere in the codebase. See
[DATABASE.md](DATABASE.md#money) for why cents are not enough.

Rounding happens once, at the payment provider boundary, where amounts must be
whole cents. The remainder stays in the publisher's balance.

## Accounts

| Account | Kind | Holds |
| --- | --- | --- |
| `BRAND_DEPOSIT` | liability | Money a brand has paid in but not yet committed |
| `CAMPAIGN_ESCROW` | liability | Money committed to a specific campaign |
| `PUBLISHER_PENDING` | liability | Earnings accrued but not yet approved |
| `PUBLISHER_AVAILABLE` | liability | Earnings a publisher may withdraw |
| `PLATFORM_REVENUE` | income | Platform fees |
| `PAYOUT_CLEARING` | asset in transit | Payouts sent but not yet settled |
| `EXTERNAL_SETTLEMENT` | external | The outside world: cards, banks, the provider |
| `ROUNDING` | adjustment | Sub-cent remainders at external boundaries |

Deposits and escrow are liabilities because the money is the brand's until it is
spent. Publisher balances are liabilities because that money is owed. The
platform's own income is the only account that is ours.

## The lifecycle of a dollar

```
1. Brand pays by card
   DEBIT  external settlement      CREDIT brand deposit

2. Brand funds a campaign
   DEBIT  brand deposit            CREDIT campaign escrow

3. A billable event occurs
   DEBIT  campaign escrow          CREDIT publisher pending
                                   CREDIT platform revenue

4. The approval window passes
   DEBIT  publisher pending        CREDIT publisher available

5. The publisher withdraws
   DEBIT  publisher available      CREDIT payout clearing

6. The provider confirms the transfer
   DEBIT  payout clearing          CREDIT external settlement
```

Each step is one transaction with an idempotency key. Replaying any of them is a
no-op, which is what makes webhook retries and job retries safe.

## Fees

The platform fee is configuration, not a constant: `platformFeeBps` (default
2000 = 20%) plus an optional flat per-event amount, overridable per brand
(`Brand.defaultFeeBps`), per campaign (`Campaign.platformFeeBps`) and per
publisher tier (`Creator.feeBpsOverride`). An administrator changes it in
**Settings** without a deploy.

The fee is priced **upward from the publisher's payout**, never deducted from
it. A campaign offering $40 per sale pays the publisher exactly $40 and charges
the brand $50. A publisher's earnings are what the campaign advertised, always.

## Campaign budgets

`campaign_budgets` tracks `fundedMicros`, `reservedMicros` and `spentMicros`.
Available funds are `funded - reserved - spent`.

Every billable event takes `SELECT … FOR UPDATE` on the budget row before
reserving. That serialises concurrent events on one campaign: fifty simultaneous
conversions against a budget with room for ten produce exactly ten earnings, and
there is a test that runs precisely that.

The lock is not the only defence. A CHECK constraint,
`campaign_budget_within_funding`, makes overspend impossible at the database
level, so a future code path that forgets to lock fails loudly instead of
quietly overspending. There is also a test for that, using raw SQL to bypass the
application entirely.

When funds run out the campaign stops accepting billable activity. Events are
still recorded — the brand needs to see the demand it could not pay for — but
they accrue nothing and say why.

## Earnings

```
PENDING ──approval window──► APPROVED ──hold elapses──► AVAILABLE ──► PAID
   │                            │
   └──flagged──► UNDER_REVIEW ──┴──rejected──► REJECTED / REVERSED
```

- **Hold period** (`earningHoldDays`, default 7) is the window in which a brand
  can dispute or a chargeback can arrive. Money is real but not yet withdrawable.
- **UNDER_REVIEW** is a hold, not a confiscation. The claim exists and the
  brand's budget stays reserved against it. An administrator approves or
  rejects it with a reason, and the publisher can dispute the outcome.
- **REVERSED** unwinds the original transaction with an exact inverse. It never
  edits history; the reversal is its own transaction, and both remain visible.

## Payouts

Publishers withdraw to a Stripe Connect account. Before a payout is allowed:

| Gate | Reason |
| --- | --- |
| Minimum balance (default $25) | Transfer fees make smaller payouts uneconomic |
| Connect onboarding complete | We cannot pay an account that cannot receive |
| Identity verification | Legal requirement for money transmission |
| Tax declaration on file | Required to report payments |
| No administrative hold | An open investigation blocks withdrawal, not the balance |
| No payout already in flight | Prevents double withdrawal of one balance |

Each gate returns a specific reason, not a generic refusal, so a publisher knows
what to fix.

Requesting a payout moves the balance into clearing immediately, so it cannot be
spent twice. The payout is only **settled** by the provider's webhook — not by
the API call that created it. If the transfer fails, the exact inverse is posted
and the publisher's balance is restored in full, to the micro. There is a test
asserting the returned amount is exactly the amount withdrawn.

## Edge cases, and what happens

| Case | Behaviour |
| --- | --- |
| Failed card payment | Deposit marked failed; no ledger entries; brand told why |
| Partial refund | Reverses that amount from the deposit balance, drawing back from campaign escrow if needed |
| Full refund | Same, for the whole amount |
| Chargeback | Platform absorbs it. **Publisher earnings are never reversed** — the publisher delivered the traffic and did nothing wrong. The brand's account is flagged for review |
| Campaign cancelled | Unspent budget returns to the brand's deposit balance; reserved amounts stay reserved until their earnings resolve |
| Budget increased or decreased | A funding or defunding transaction; never an edit to a number |
| Negative adjustment | An administrator can post one, with a mandatory reason, recorded in the audit log with before and after balances |
| Payout failure | Full inverse posted; balance restored |
| Publisher suspended | Traffic stops being billable; existing balance is untouched and still payable |
| Brand suspended | Campaigns stop; escrowed funds stay escrowed until resolved |
| Conversion reversed | Inverse transaction; the brand's budget is returned |
| Duplicate event | Idempotency key makes it a no-op |
| Duplicate webhook | Provider event ids are recorded; a replay is ignored |
| Delayed webhook | Order-independent: settlement is keyed on the payment, not on arrival time |
| Provider outage | Money movements refuse with a clear message. Nothing is recorded as having happened |

## Reconciliation

A scheduled job recomputes every account's balance from its entries and compares
it with the cached total. Any drift is logged as an error and surfaced in the
admin console; there is also a global check that total debits equal total
credits across the whole ledger. An administrator can run both on demand from
**System health**.

Reconciliation is not decoration. It is how a bug that miscounts money gets
found in hours rather than at the end of a quarter.

## Without Stripe configured

The application runs. Campaigns can be built, links taken, clicks tracked and
earnings accrued using account balances an administrator credits manually.
What is switched off is anything that touches real money: card payments, payouts
and Connect onboarding all report "not configured" and refuse. No fake payment
is ever recorded, and no payout is ever marked paid without the provider saying
so.
