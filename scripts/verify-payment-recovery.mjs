#!/usr/bin/env node
// Executes the actual payment/client modules with a simulated gateway and real,
// isolated Postgres RPCs. No production env file, network call or real payment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import pg from 'pg';

const url = new URL(process.env.CHECKOUT_TEST_DB_URL ?? 'postgresql://postgres:haze-local-test-only@127.0.0.1:55439/haze_checkout_test');
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.pathname !== '/haze_checkout_test') throw new Error('Local test database required');
const pool = new pg.Pool({connectionString:url.toString(),max:40});
let failNextConfigRead=false;
const query = async (sql,values) => {
  try { return {data:(await pool.query(sql,values)).rows,error:null}; }
  catch(error) { return {data:null,error:{code:error.code,message:error.message}}; }
};
function table(name) {
  assert.ok(['orders','payments','integration_credentials','commerce_jobs','commerce_rate_limits','commerce_worker_health'].includes(name));
  let columns='*', patch, inserted, deleting=false, filters=[], order='';
  const builder={
    select(value) {columns=value;return this;},
    update(value) {patch=value;return this;},
    upsert(value) {inserted=value;return this;},
    delete() {deleting=true;return this;},
    eq(key,value) { filters.push([key,value,'=']);return this;},
    lt(key,value) { filters.push([key,value,'<']);return this;},
    order(key,options) {order=` order by ${key} ${options.ascending?'asc':'desc'}`;return this;},
    async execute(single=false) {
      if(name==='integration_credentials' && failNextConfigRead) {
        failNextConfigRead=false;return {data:null,error:{code:'08006',message:'Injected settings read failure'}};
      }
      const values=[];
      const bind=v=>{values.push(v);return `$${values.length}`;};
      let sql;
      if(inserted) {
        const entries=Object.entries(inserted);
        sql=`insert into ${name}(${entries.map(([k])=>k).join(',')}) values(${entries.map(([,v])=>bind(v)).join(',')}) on conflict(id) do update set ${entries.map(([k])=>`${k}=excluded.${k}`).join(',')} returning *`;
      } else {
        const prefix=deleting ? `delete from ${name}` : patch ? `update ${name} set ${Object.entries(patch).map(([k,v])=>`${k}=${bind(v)}`).join(',')}` : `select ${columns} from ${name}`;
        const where=filters.length ? ` where ${filters.map(([k,v,op])=>`${k}${op}${bind(v)}`).join(' and ')}` : '';
        sql=prefix+where+(patch||deleting?' returning *':order);
      }
      const result=await query(sql,values);
      return {...result,data:single ? result.data?.[0] ?? null : result.data};
    },
    single(){return this.execute(true);},maybeSingle(){return this.execute(true);},
    then(resolve,reject){return this.execute().then(resolve,reject);},
  };
  return builder;
}
const db={from:table,async rpc(name,args) {
  assert.match(name,/^[a-z_]+$/);
  const entries=Object.entries(args);
  const result=await query(`select ${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as result`,entries.map(([,v])=>v));
  return {...result,data:result.data?.[0]?.result ?? null};
}};
const remote=new Map();
let dropNextResponse=false, throttle=false, postCalls=0, gatewayCreations=0;
const bodies=new Map();
const fakeFetch=async (input,init) => {
  assert.match(String(input),/^https:\/\/sandbox\.cashfree\.com\/pg\/orders/);
  assert.ok(init.signal, 'gateway requests must have a timeout');
  if(throttle) return Response.json({message:'Too many requests'},{status:429});
  const path=new URL(input).pathname;
  if(init.method==='POST') {
    postCalls++;
    const body=JSON.parse(init.body),key=init.headers['x-idempotency-key'];
    assert.ok(key);
    if(bodies.has(key)) assert.equal(init.body,bodies.get(key),'idempotent retries must freeze request bytes');
    bodies.set(key,init.body);
    if(!remote.has(body.order_id)) {
      gatewayCreations++;
      remote.set(body.order_id,{order_id:body.order_id,order_status:'ACTIVE',order_amount:body.order_amount,
        order_currency:body.order_currency,payment_session_id:`session-${body.order_id}`,cf_order_id:randomUUID()});
    }
    if(dropNextResponse) {dropNextResponse=false;throw new Error('Simulated lost response after gateway accepted order');}
    return Response.json(remote.get(body.order_id));
  }
  if(path.endsWith('/payments')) return Response.json([]);
  const id=decodeURIComponent(path.split('/').at(-1));
  return remote.has(id) ? Response.json(remote.get(id)) : Response.json({code:'order_not_found'},{status:404});
};
const testProcess={env:{CRON_SECRET:'local-test-cron-secret'}};
const context=vm.createContext({console,Date,Math,Promise,URL,Request,Response,Buffer,AbortSignal,fetch:fakeFetch,setTimeout,clearTimeout,process:testProcess});
const config={environment:'sandbox',appId:'test',secretKey:'test',enabled:true};
let supplierCalls=0;
function synthetic(exports) {
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
}
const stubs={
  '@/lib/supabase/admin':synthetic({createAdminClient:()=>db}),
  '@/lib/shop/phone-codes':synthetic({nationalPhoneDigits:()=> '9999999999'}),
  './config':synthetic({getCashfreeConfig:async()=>config,SDK_MODE:{sandbox:'sandbox',live:'production'},API_VERSION:'2026-01-01',HOSTS:{sandbox:'https://sandbox.cashfree.com'}}),
  'node:crypto':synthetic({createHmac,timingSafeEqual}),
  '@/lib/commerce/jobs':synthetic({runCommerceJobs:async()=>({completed:0,deferred:0,failed:0})}),
  '@/lib/qikink/fulfillment':synthetic({pushOrderToQikink:async()=>{supplierCalls++;return {ok:true,qikinkOrderId:'simulated-supplier-order'};}}),
};
stubs['@/lib/cashfree/config']=stubs['./config'];
const modules=new Map();
async function module(path) {
  if(modules.has(path))return modules.get(path);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const m=new vm.SourceTextModule(code,{context,identifier:path}); modules.set(path,m);
  const paths={
    './client':'src/lib/cashfree/client.ts',
    '@/lib/cashfree/payment':'src/lib/cashfree/payment.ts',
    '@/lib/cashfree/webhook':'src/lib/cashfree/webhook.ts',
  };
  await m.link(async name=>stubs[name] ?? (paths[name] ? module(paths[name]) : Promise.reject(new Error(`Unexpected import ${name}`))));
  return m;
}
const created=[];
async function order() {
  const {rows:[o]}=await pool.query("insert into orders(payment_method,payment_status,total,currency,checkout_token,email,phone) values('prepaid','pending',190,'INR',$1,'test@example.test','9999999999') returning *",[randomUUID().replaceAll('-','').repeat(2)]);
  created.push(o.id);return o;
}
try {
  const m=await module('src/lib/cashfree/payment.ts');await m.evaluate();
  const {startCashfreePayment,reconcilePayment}=m.namespace;
  const o=await order(); dropNextResponse=true;
  const failed=await startCashfreePayment(o.id,()=> 'https://example.test/return');
  assert.equal(failed.ok,false);
  const before=postCalls;
  const recovered=await startCashfreePayment(o.id,()=> 'https://other-tab.example.test/return');
  assert.equal(recovered.ok,true);assert.equal(postCalls,before);
  console.log('PASS lost create response recovers existing gateway order without another POST');
  const o2=await order(), count=gatewayCreations;
  const results=await Promise.all(Array.from({length:25},(_,i)=>startCashfreePayment(o2.id,()=>`https://example.test/tab/${i}`)));
  assert.ok(results.every(r=>r.ok));assert.equal(gatewayCreations,count+1);
  assert.equal(new Set(results.map(r=>r.paymentSessionId)).size,1);
  console.log('PASS 25 concurrent payment starts share one gateway order and session');
  throttle=true;const o3=await order();assert.equal((await startCashfreePayment(o3.id,()=> 'https://example.test/return')).ok,false);
  throttle=false;assert.equal((await startCashfreePayment(o3.id,()=> 'https://example.test/return')).ok,true);
  assert.equal(Number((await pool.query('select count(*) as n from payments where order_id=$1',[o3.id])).rows[0].n),1);
  console.log('PASS gateway throttling retains the same recoverable attempt');
  const provider=results[0].orderId;remote.get(provider).order_status='PAID';
  await reconcilePayment(o2.id);
  assert.equal((await pool.query('select payment_status from orders where id=$1',[o2.id])).rows[0].payment_status,'paid');
  assert.equal((await startCashfreePayment(o2.id,()=> 'https://example.test/return')).ok,false);
  console.log('PASS reconciliation records captured money and refuses another payment');
  const webhook=await module('src/app/api/webhooks/cashfree/route.ts');await webhook.evaluate();
  const o4=await order();await startCashfreePayment(o4.id,()=> 'https://example.test/return');
  const {rows:[p4]}=await pool.query('select * from payments where order_id=$1',[o4.id]);
  const event=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{
    order:{order_id:p4.provider_order_id,order_amount:190,order_currency:'INR'},
    payment:{cf_payment_id:'simulated-webhook-payment',payment_status:'SUCCESS',payment_amount:190,payment_currency:'INR'},
  }});
  const request=(valid=true,timestamp=String(Date.now()))=>new Request('https://example.test/api/webhooks/cashfree',{
    method:'POST',body:event,headers:{'x-webhook-timestamp':timestamp,
      'x-webhook-signature':valid ? createHmac('sha256','test').update(timestamp+event).digest('base64') : 'invalid',
      'x-idempotency-header':`test-webhook-${o4.id}`},
  });
  assert.equal((await webhook.namespace.POST(request(false))).status,401);
  assert.equal((await webhook.namespace.POST(request(true,String(Date.now()-3600_000)))).status,401);
  assert.equal((await pool.query('select payment_status from orders where id=$1',[o4.id])).rows[0].payment_status,'pending');
  console.log('PASS forged and stale webhook requests cannot update an order');
  await pool.query(`create function reject_webhook_test() returns trigger language plpgsql as $$begin if new.id='${o4.id}' and new.payment_status='paid' then raise exception 'injected failure'; end if; return new; end$$;
    create trigger reject_webhook_test before update on orders for each row execute function reject_webhook_test();`);
  assert.equal((await webhook.namespace.POST(request())).status,503);
  await pool.query('drop trigger reject_webhook_test on orders; drop function reject_webhook_test()');
  const deliveries=await Promise.all(Array.from({length:100},()=>webhook.namespace.POST(request())));
  assert.ok(deliveries.every(r=>r.status===200));
  assert.equal((await pool.query('select payment_status from orders where id=$1',[o4.id])).rows[0].payment_status,'paid');
  assert.equal(Number((await pool.query('select count(*) as n from payment_events where idempotency_key=$1',[`test-webhook-${o4.id}`])).rows[0].n),1);
  assert.equal((await webhook.namespace.POST(request(true,String(Math.floor(Date.now()/1000))))).status,200);
  console.log('PASS failed webhook returns 503; 100 signed redeliveries record one settlement (milliseconds and legacy seconds)');
  const cron=await module('src/app/api/cron/commerce/route.ts');await cron.evaluate();
  assert.equal((await cron.namespace.GET(new Request('https://example.test/api/cron/commerce'))).status,401);
  assert.equal((await cron.namespace.GET(new Request('https://example.test/api/cron/commerce',{headers:{authorization:'Bearer wrong'}}))).status,401);
  assert.equal((await cron.namespace.GET(new Request('https://example.test/api/cron/commerce',{headers:{authorization:'Bearer local-test-cron-secret'}}))).status,200);
  delete testProcess.env.CRON_SECRET;
  assert.equal((await cron.namespace.GET(new Request('https://example.test/api/cron/commerce',{headers:{authorization:'Bearer undefined'}}))).status,401);
  console.log('PASS recovery worker rejects missing, incorrect and unconfigured credentials');
  // Everything in this guarded database is test data. Quiet earlier fixtures so
  // this job's retry behavior can be observed without unrelated fixture work.
  await pool.query("update commerce_jobs set status='done'");
  const workerOrder=await order();
  await pool.query("update orders set payment_status='paid' where id=$1",[workerOrder.id]);
  await pool.query("insert into integration_credentials(provider,environment,enabled,auto_send) values('qikink','sandbox',true,true) on conflict(provider) do update set enabled=true,auto_send=true");
  const {rows:[workerJob]}=await pool.query("insert into commerce_jobs(job_key,kind,order_id) values($1,'fulfill',$2) returning id",[`fulfill:${workerOrder.id}`,workerOrder.id]);
  const worker=await module('src/lib/commerce/jobs.ts');await worker.evaluate();
  failNextConfigRead=true;
  await worker.namespace.runCommerceJobs();
  const {rows:[deferred]}=await pool.query('select status,failures from commerce_jobs where id=$1',[workerJob.id]);
  assert.equal(deferred.status,'ready');assert.equal(deferred.failures,1);assert.equal(supplierCalls,0);
  await pool.query('update commerce_jobs set available_at=now() where id=$1',[workerJob.id]);
  await Promise.all([worker.namespace.runCommerceJobs(),worker.namespace.runCommerceJobs()]);
  assert.equal((await pool.query('select status from commerce_jobs where id=$1',[workerJob.id])).rows[0].status,'done');
  assert.equal(supplierCalls,1);
  assert.ok((await pool.query('select last_finished_at from commerce_worker_health where id=1')).rows[0].last_finished_at);
  console.log('PASS settings outage retains fulfillment; concurrent workers recover it once and record health');
} finally {
  await pool.query('delete from orders where id=any($1::uuid[])',[created]);
  await pool.end();
}
