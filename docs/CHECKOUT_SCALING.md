# Checkout reliability and rollout

Implemented September 25, 2026. These changes are in the working tree; migrations
0036 and 0037 must be applied before the application is deployed. They have only
been applied to an isolated local PostgreSQL test database so far.

## Behavior

- Checkout locks stock in product/variant/inventory-ID order, locks coupon usage,
  and serializes guest customer creation by email. A persisted cart fingerprint
  returns the original order on repeat submissions. Transaction-abort errors get
  up to two short, jittered retries.
- Payment attempts are allocated while holding the order lock, before contacting
  Cashfree. Their UUID is the Cashfree idempotency key; the request body is frozen.
  Retries reuse an active session or recover it by its gateway order ID. They do
  not treat a declined transaction or closed popup as a closed gateway order.
- Signed payment events, payment status, order credit and fulfillment jobs commit
  together. Amount and currency must match. Success cannot be overwritten by a
  late failure. A legacy event recorded as merely received can be reprocessed.
  Signature freshness accepts Cashfree's documented millisecond timestamps while
  retaining legacy second timestamps and the exact signed header bytes.
- Prepaid checkout reserves stock for 45 minutes; starting a payment can extend
  that to cover the 30-minute gateway window plus a five-minute buffer. Release
  requires **all** payment attempts to be verified closed, or no attempts at all.
  Allocations restore stock to the exact locations from which it was deducted.
  Late captured payments after cancellation/stock release are held for review,
  recorded in payments, and never automatically sent to production.
- COD review holds and jobs are created inside the checkout transaction. Queue
  workers use five-minute leases and fenced updates. Payment reconciliation runs
  independently of a shopper returning to the site. Failed work backs off up to
  one hour; twelve consecutive errors require review. Normal polling does not
  consume the failure budget.
- Auto-fulfillment is limited to ten attempts per minute across instances, with
  bounded work per invocation. A lost supplier response is **not** blindly retried:
  an uncertain dispatch is fenced and alerts through health monitoring. An explicit
  rejection can be retried. This avoids duplicate print jobs.
- Checkout/payment actions allow twelve attempts per token/action/minute. On
  Vercel a separate shared limit allows 600 actions per IP/minute, accommodating
  shared networks. These database-backed limits need no Redis configuration.

## Verification performed

The isolated database suite applies every repository migration, then exercises:

- 100 and 200 simultaneous submissions, including overlapping carts in reverse order;
- last-unit contention, coupon exhaustion, repeated carts and shared guest emails;
- concurrent payment allocation and settlement, duplicate/late webhooks, wrong
  amounts/currencies and injected database failures with redelivery;
- verified stock expiry, late captured money, admin cancellation racing expiry;
- partial COD credits, job lease recovery/fencing, supplier dispatch exclusion,
  distributed rate limits and restricted RPC permissions.

The payment recovery suite executes the actual TypeScript payment/client modules
against that database and a simulated gateway. It checks a lost response after
creation, 25 simultaneous session starts, HTTP 429 recovery and successful-payment
reconciliation. It also sends 100 signed duplicate webhook requests through the
actual handler, checks 503/redelivery after an injected database failure, tests
worker authentication, and verifies that a settings outage retains fulfillment
for recovery by concurrent workers. It never calls a payment or fulfillment provider.
Server-rendered order-page checks also verify that cancelled/expired and
payment-review orders neither request another payment nor emit a purchase event.

These are database concurrency and simulated integration tests, **not a hosted
end-to-end capacity certification**. The live database was inspected read-only:
60 maximum database connections, approximately 53 MB, migrations through 0035.
Cashfree and Qikink are configured for live mode; Qikink auto-send is enabled.
No live orders, payments, supplier requests or database migrations were created.
The connection limit is not a user limit: short queries share database connections.

## Reproduce locally

Start a disposable PostgreSQL 17 database (or an equivalent local instance):

```powershell
docker run --rm --name haze-checkout-test -e POSTGRES_PASSWORD=haze-local-test-only -e POSTGRES_DB=haze_checkout_test -p 127.0.0.1:55439:5432 -d postgres:17-alpine -c max_connections=150
$env:CHECKOUT_TEST_USERS='200'
npm run verify:checkout
npm run verify:payment-recovery
npm run verify:order-status
```

The checkout suite requires an empty `haze_checkout_test` database and refuses
non-loopback hosts or other database names. It stubs Supabase auth/storage tables
only; actual application tables and functions come from the migrations. It does
not read `.env.local`. Set `CHECKOUT_TEST_DB_URL` to override local credentials.
Recreate only this disposable database before another checkout-suite run.
The client pool defaults to 40 connections; simultaneous submissions beyond that
queue for a connection. `CHECKOUT_TEST_POOL_SIZE` can override this (2–100). This
models connection sharing; it does not claim 200 simultaneous database sessions.

## Deployment sequence

1. Provision a separate staging Supabase database and Cashfree sandbox account.
   Disable Qikink auto-send there. Verify staging does not share production data
   or gateway credentials. Apply migrations 0036 and 0037 using the existing
   migration runner with the explicitly selected staging connection.
2. Set a strong random `CRON_SECRET` in the deployment environment. It is a
   server-only secret, never a `NEXT_PUBLIC_` variable. Set `NEXT_PUBLIC_SITE_URL`
   to the intended HTTPS origin so payment returns are stable across retries.
3. The committed Vercel configuration invokes `/api/cron/commerce` every minute.
   **Vercel Pro/Enterprise is required for this built-in schedule.** On Hobby,
   remove the `crons` entry and configure an external scheduler with the same
   cadence and `Authorization: Bearer <CRON_SECRET>`. Do not substitute a daily
   schedule: recovery and inventory availability depend on frequent execution.
4. Deploy the application after migrations. Invoke the worker once, then verify
   its heartbeat keeps advancing without manual calls. Protect staging with
   deployment access controls; do not open the public preview lock just to test.
5. Run the staging scenarios below. Confirm Vercel plan/concurrency/timeouts,
   Supabase compute and connection utilization, and the merchant's actual Cashfree
   throughput limits. The function region is `hnd1`; verify database proximity.
   Do not increase Postgres `max_connections` without checking available compute.
6. Once staging passes, apply the migrations and deploy to production in a
   coordinated window. Avoid overlapping the old webhook/checkout implementation
   with the new one during a busy drop. Verify the cron and health endpoint before
   sending traffic. Leave the new schema in place if rolling the application back;
   preserve payment/stock ledgers and stop automatic expiry until the rollout is
   understood. A code rollback alone does not undo external payments.

Scheduler documentation: [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
Gateway contract: [Cashfree Create Order and idempotency](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order).
Signature format: [Cashfree webhook verification](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification).

## Hosted staging acceptance

Use a traffic tool or browser harness against the actual deployed cart and checkout
flow, with separate cookie jars per shopper. Start with 25, then 100 and 200 users
submitting within a few seconds. Keep volume tests on a simulated gateway; run a
smaller Cashfree sandbox integration check within that account's limits. Include
normal browsing/admin activity so checkout is not the only load.

Test COD, prepaid, same-size stock contention, limited coupons, double submits,
multiple payment tabs, browser disconnect after payment, duplicate/late webhooks,
gateway throttling/timeouts, supplier outages and a stopped/restarted worker.

Proposed release criteria: zero duplicate accepted payments/print jobs, zero lost
captured payments, no overselling where prohibited, no incorrect stock releases,
and no unexplained order failures. Measure p95 checkout submission under three
seconds and unexpected application errors under 0.5% (excluding intentional
stock/coupon rejections). Those performance thresholds are targets, not measured
production claims. Confirm the queue drains after the burst and every accepted
payment is accounted for, even when its browser never returns.

## Monitoring and recovery

Poll `GET /api/cron/commerce?health=1` with the same bearer secret. It returns 503
when the worker has not completed for five minutes, jobs have failed, payments or
dispatches need review, or due work has waited fifteen minutes. Configure the
hosting/uptime monitor to alert the operator on non-200 results. This endpoint
and structured `[commerce]` logs are implemented; an external alert destination
has not been connected. Never expose the bearer secret in a public monitor URL.

Staff can inspect the following through the SQL console:

```sql
select public.commerce_health();
select id,kind,order_id,status,failures,last_error,available_at
from commerce_jobs where status='failed' order by updated_at;
select id,order_id,provider_order_id,amount,currency,error
from payments where reconciliation_required;
select * from fulfillment_dispatches where state in ('sending','uncertain');
```

For a failed payment job, fix its underlying configuration/outage and requeue
that specific job. Never change a payment to successful without gateway evidence.
For an uncertain supplier dispatch, first find the order in the supplier dashboard
using our order number. If accepted, attach its provider ID and mark the fulfillment
sent; if the supplier confirms rejection, set its dispatch to `retryable` before
requeuing. Do not clear a dispatch fence merely because a request timed out.

```sql
-- After diagnosing one specific job; do not bulk-reset uncertain fulfillment.
update commerce_jobs
set status='ready',failures=0,available_at=now(),lease_token=null,lease_until=null
where id='<reviewed-job-uuid>' and status='failed';
```

Legacy orders lack exact stock allocations and are not automatically restocked.
Existing pending payment attempts are queued for reconciliation. Deleted inventory
locations prevent automatic release and require manual review. Gateway environment
changes leave attempts unresolved rather than treating another environment's 404
as proof that a live payment failed.
