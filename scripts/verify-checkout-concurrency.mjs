#!/usr/bin/env node
/** Isolated real-Postgres integration tests. Never loads .env.local or uses live APIs.
 * CHECKOUT_TEST_DB_URL must point at an EMPTY local database named haze_checkout_test.
 * Creates Supabase auth/storage stubs and applies every real migration.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

const url = new URL(process.env.CHECKOUT_TEST_DB_URL ?? 'postgresql://postgres:haze-local-test-only@127.0.0.1:55439/haze_checkout_test');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/haze_checkout_test') {
  throw new Error('Refusing to run outside the isolated local haze_checkout_test database');
}
const poolSize = Number(process.env.CHECKOUT_TEST_POOL_SIZE ?? 40);
assert.ok(Number.isInteger(poolSize) && poolSize >= 2 && poolSize <= 100);
const pool = new pg.Pool({ connectionString: url.toString(), max: poolSize, statement_timeout: 30_000 });
const users = Number(process.env.CHECKOUT_TEST_USERS ?? 100);
assert.ok(Number.isInteger(users) && users >= 100 && users <= 200, 'Use 100 to 200 concurrent submissions');
const q = (sql, values = []) => pool.query(sql, values);
let checks = 0;
function check(name, condition) { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); }
async function rpc(name, args) {
  const { rows } = await q(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`, args);
  return rows[0].result;
}
async function product(stock = 1000) {
  const { rows: [p] } = await q("insert into products(title,handle,status,price,track_inventory) values ('Test tee',$1,'active',100,true) returning id", [`test-${randomUUID()}`]);
  await q('insert into inventory_levels(product_id,location_id,quantity) select $1,id,$2 from locations where is_default limit 1', [p.id, stock]);
  return p.id;
}
async function cart(products, email = `${randomUUID()}@example.test`, method = 'prepaid', code) {
  const token = randomUUID();
  const { rows: [c] } = await q('insert into carts(token) values($1) returning id', [token]);
  for (let i=0; i<products.length; i++) {
    await q("insert into cart_items(cart_id,product_id,quantity,created_at) values($1,$2,1,now()+($3 * interval '1 second'))",[c.id,products[i],i]);
  }
  return { cart_token: token, email, phone: '+919999999999', first_name:'Test', last_name:'Shopper',
    shipping_address: { first_name:'Test',last_name:'Shopper',address1:'Test street',city:'Test city',province:'Test state',postal_code:'110001',country:'IN' },
    payment_method: method, discount_code: code };
}
async function stock(id) { return Number((await q('select sum(quantity) as n from inventory_levels where product_id=$1',[id])).rows[0].n); }
async function settle(p, outcome, key = randomUUID()) {
  return rpc('settle_cashfree_payment',[p.provider_order_id,JSON.stringify(outcome),key,'PAYMENT_SUCCESS_WEBHOOK','{}']);
}
const paid = (p) => ({status:'success',paidAmount:Number(p.amount),paidCurrency:p.currency,cfPaymentId:randomUUID()});

try {
  const exists = await q("select to_regclass('public.orders') as tbl");
  if (exists.rows[0].tbl) throw new Error('Test database must be empty. Create a fresh local database before rerunning.');
  await q(`
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key,bucket_id text);
  `);
  for (const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
    try { await q(readFileSync(`supabase/migrations/${file}`,'utf8')); }
    catch (e) { throw new Error(`Migration ${file}: ${e.message}`,{cause:e}); }
  }
  check('all migrations apply on PostgreSQL',true);
  await q("update shop_settings set currency='INR' where id=1");
  const a = await product(), b = await product();
  const carts = await Promise.all(Array.from({length:users},(_,i)=>cart(i%2 ? [a,b] : [b,a])));
  const started = performance.now();
  const latencies = [];
  const orders = await Promise.all(carts.map(async c=>{
    const start=performance.now(); const order=await rpc('place_order',[JSON.stringify(c)]);
    latencies.push(performance.now()-start); return order;
  }));
  latencies.sort((a,b)=>a-b);
  check(`${users} simultaneous reversed-cart checkouts complete without deadlock`,new Set(orders.map(o=>o.order_id)).size===users);
  check('inventory decremented exactly once per line',await stock(a)===1000-users && await stock(b)===1000-users);
  console.log(JSON.stringify({test:'local PostgreSQL checkout burst',users,poolSize,durationMs:Math.round(performance.now()-started),p95Ms:Math.round(latencies[Math.ceil(users*.95)-1]),maxMs:Math.round(latencies.at(-1))}));
  const repeats=await Promise.all(Array.from({length:30},()=>rpc('place_order',[JSON.stringify(carts[0])])));
  check('repeated cart submissions return the original order',repeats.every(o=>o.order_id===orders[0].order_id) && await stock(a)===1000-users);
  const last = await product(1);
  const lastCarts=await Promise.all(Array.from({length:30},()=>cart([last])));
  const contested=await Promise.allSettled(lastCarts.map(c=>rpc('place_order',[JSON.stringify(c)])));
  check('only one shopper wins the last unit',contested.filter(r=>r.status==='fulfilled').length===1 && await stock(last)===0);
  check('sold-out errors are shopper-visible',contested.filter(r=>r.status==='rejected').every(r=>r.reason.code==='HZ001'));
  const code=`T${randomUUID().slice(0,8)}`;
  await q("insert into discounts(code,type,value,status,usage_limit) values($1,'fixed',10,'active',10)",[code]);
  const promoCarts=await Promise.all(Array.from({length:30},async()=>cart([await product()],undefined,'prepaid',code)));
  const promos=await Promise.allSettled(promoCarts.map(c=>rpc('place_order',[JSON.stringify(c)])));
  check('limited coupon admits exactly ten concurrent shoppers',promos.filter(r=>r.status==='fulfilled').length===10);
  const sameEmail=`${randomUUID()}@example.test`;
  const emailCarts=await Promise.all(Array.from({length:10},()=>cart([a],sameEmail)));
  await Promise.all(emailCarts.map(c=>rpc('place_order',[JSON.stringify(c)])));
  check('concurrent guest orders share one customer',Number((await q('select count(*) as n from customers where email=$1',[sameEmail])).rows[0].n)===1);
  const attempts=await Promise.all(Array.from({length:30},()=>rpc('claim_cashfree_attempt',[orders[0].order_id,null,'sandbox'])));
  const p=attempts[0];
  check('concurrent payment starts share one durable attempt',new Set(attempts.map(p=>p.id)).size===1);
  const outcomes=await Promise.all(Array.from({length:30},()=>settle(p,paid(p),'duplicate-test')));
  check('duplicate webhook settles the order once',outcomes.filter(o=>o.newlyPaid).length===1);
  await settle(p,{status:'failed'});
  check('late failure cannot overwrite a successful payment',(await q('select status from payments where id=$1',[p.id])).rows[0].status==='success');
  const p2=await rpc('claim_cashfree_attempt',[orders[1].order_id,null,'sandbox']);
  await assert.rejects(settle(p2,{...paid(p2),paidAmount:1},'wrong-amount'));
  await assert.rejects(settle(p2,{...paid(p2),paidCurrency:'USD'},'wrong-currency'));
  check('invalid amount rolls back both event ledger and payment',Number((await q("select count(*) as n from payment_events where idempotency_key='wrong-amount'")).rows[0].n)===0);
  await q(`create function reject_paid_test() returns trigger language plpgsql as $$begin if new.id='${orders[1].order_id}' and new.payment_status='paid' then raise exception 'injected failure'; end if; return new; end$$;
    create trigger reject_paid_test before update on orders for each row execute function reject_paid_test();`);
  await assert.rejects(settle(p2,paid(p2),'injected-db-failure'));
  check('database failure does not acknowledge webhook',Number((await q("select count(*) as n from payment_events where idempotency_key='injected-db-failure'")).rows[0].n)===0);
  await q('drop trigger reject_paid_test on orders; drop function reject_paid_test()');
  check('redelivery succeeds after failure',(await settle(p2,paid(p2),'injected-db-failure')).newlyPaid);
  const batch=await Promise.all(orders.slice(5).map(o=>rpc('claim_cashfree_attempt',[o.order_id,null,'sandbox'])));
  const batchPaid=await Promise.all(batch.map(p=>settle(p,paid(p))));
  check('simultaneous successful payments all settle',batchPaid.every(p=>p.newlyPaid));
  const oldEventAttempt=await rpc('claim_cashfree_attempt',[orders[4].order_id,null,'sandbox']);
  await q("insert into payment_events(idempotency_key,payload) values('legacy-received-only','{}')");
  check('legacy received-only webhook can be recovered',(await settle(oldEventAttempt,paid(oldEventAttempt),'legacy-received-only')).newlyPaid);
  const reserved = orders[2];
  const p3=await rpc('claim_cashfree_attempt',[reserved.order_id,null,'sandbox']);
  await q("update orders set reservation_expires_at=now()-interval '1 minute' where id=$1",[reserved.order_id]);
  check('expired clock cannot release an unconfirmed payment',!await rpc('release_checkout_stock',[reserved.order_id]));
  await settle(p3,{status:'expired',remoteOrderStatus:'EXPIRED'});
  const before=await stock(a);
  const released=await Promise.all(Array.from({length:20},()=>rpc('release_checkout_stock',[reserved.order_id])));
  check('expired inventory restored exactly once',released.filter(Boolean).length===1 && await stock(a)===before+1);
  await settle(p3,paid(p3));
  check('late captured payment is flagged for review',(await q('select reconciliation_required from payments where id=$1',[p3.id])).rows[0].reconciliation_required);
  check('late captured payment never queues released stock for shipment',Number((await q("select count(*) as n from commerce_jobs where order_id=$1 and kind='fulfill'",[reserved.order_id])).rows[0].n)===0);
  const jobs=await Promise.all(Array.from({length:20},()=>rpc('claim_commerce_job',['fulfill'])));
  check('job leases cannot be claimed twice',new Set(jobs.filter(Boolean).map(j=>j.id)).size===jobs.filter(Boolean).length);
  const leased=jobs.find(Boolean);
  await q("update commerce_jobs set status='done',lease_until=null where kind='fulfill' and id<>$1",[leased.id]);
  await q("update commerce_jobs set lease_until=now()-interval '1 minute' where id=$1",[leased.id]);
  const reclaimed=await rpc('claim_commerce_job',['fulfill']);
  check('interrupted worker lease is recoverable',reclaimed.id===leased.id && reclaimed.lease_token!==leased.lease_token);
  const stale=await q("update commerce_jobs set status='done' where id=$1 and lease_token=$2",[leased.id,leased.lease_token]);
  check('old worker cannot overwrite a recovered lease',stale.rowCount===0);
  const dispatch=await Promise.all(Array.from({length:20},()=>rpc('claim_fulfillment_dispatch',[orders[0].order_id])));
  check('only one supplier POST can be claimed',dispatch.filter(Boolean).length===1);
  const rates=await Promise.all(Array.from({length:30},()=>rpc('consume_commerce_rate',['test-limit',12,60])));
  check('rate limits are atomic across connections',rates.filter(Boolean).length===12);
  check('private settlement RPC is not callable by shoppers',!(await q("select has_function_privilege('anon','public.settle_cashfree_payment(text,jsonb,text,text,jsonb)','execute') as allowed")).rows[0].allowed);
  const noPay=await rpc('place_order',[JSON.stringify(await cart([a]))]);
  await q("update orders set reservation_expires_at=now()-interval '1 minute' where id=$1",[noPay.order_id]);
  check('abandoned checkout without a payment safely expires',await rpc('release_checkout_stock',[noPay.order_id]));
  const staffId=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[staffId,'staff@example.test']);
  const cancelled=await rpc('place_order',[JSON.stringify(await cart([a]))]);
  await q("update orders set reservation_expires_at=now()-interval '1 minute' where id=$1",[cancelled.order_id]);
  const cancellationStock=await stock(a);
  const staff=await pool.connect();
  try {
    await staff.query('begin');
    await staff.query("select set_config('request.jwt.claim.sub',$1,true)",[staffId]);
    const cancel=staff.query('select cancel_checkout_order($1,true)',[cancelled.order_id]).then(()=>staff.query('commit'));
    await Promise.all([cancel,rpc('release_checkout_stock',[cancelled.order_id])]);
  } finally {staff.release();}
  check('manual cancellation racing expiry cannot double-restock',await stock(a)===cancellationStock+1);
  const cod=await rpc('place_order',[JSON.stringify(await cart([a],undefined,'cod'))]);
  const {rows:[req]}=await q("insert into payment_requests(order_id,amount,expires_at) values($1,50,now()+interval '1 day') returning id",[cod.order_id]);
  const advance=await rpc('claim_cashfree_attempt',[cod.order_id,req.id,'sandbox']);
  await Promise.all(Array.from({length:10},()=>settle(advance,paid(advance))));
  const {rows:[codOrder]}=await q('select amount_paid,payment_status from orders where id=$1',[cod.order_id]);
  check('duplicate advance webhooks credit money exactly once',Number(codOrder.amount_paid)===50 && codOrder.payment_status==='partially_paid');
  const manualCod=await rpc('place_order',[JSON.stringify(await cart([a],undefined,'cod'))]);
  const {rows:[manualReq]}=await q("insert into payment_requests(order_id,amount,expires_at) values($1,50,now()+interval '1 day') returning id",[manualCod.order_id]);
  const {rows:[manualPayment]}=await q("insert into payments(order_id,request_id,provider,provider_order_id,amount,currency) values($1,$2,'manual',$3,50,'INR') returning *",[manualCod.order_id,manualReq.id,`MANUAL${randomUUID()}`]);
  await rpc('settle_cashfree_payment',[manualPayment.provider_order_id,JSON.stringify({...paid(manualPayment),method:'manual'})]);
  check('manual COD advance still settles with currency validation',(await q('select amount_paid from orders where id=$1',[manualCod.order_id])).rows[0].amount_paid==='50.00');
  check('commerce health surfaces late-payment review',(await rpc('commerce_health',[])).paymentsNeedingReview>=1);
  console.log(`\n${checks} integration checks passed. No live payments, supplier calls, or production data touched.`);
} finally { await pool.end(); }
