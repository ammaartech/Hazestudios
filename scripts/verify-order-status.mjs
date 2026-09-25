// Render the actual server page with controlled orders. No network or live data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

let order;
const context=vm.createContext({console,Date});
const empty=()=>null;
const mocks={
  'react/jsx-runtime':jsx,
  'next/image':{default:empty},
  'next/link':{default:({children,href})=>createElement('a',{href},children)},
  'next/navigation':{notFound:()=>{throw new Error('not found');}},
  'lucide-react':{Check:empty,Clock:empty},
  '@/lib/format':{formatDate:()=> 'Today',formatMoney:value=>`INR ${value}`},
  '@/lib/shop/checkout':{getOrderByToken:async()=>order},
  '@/lib/shop/countries':{countryName:value=>value},
  '@/lib/cashfree/payment':{getPaymentAttempts:async()=>[]},
  '@/lib/cashfree/advance':{getPaymentRequests:async()=>[]},
  '@/lib/shop/payment-methods':{isCodMethod:value=>value==='cod',isPrepaidMethod:value=>['prepaid','upi'].includes(value)},
  '@/lib/shop/cod-advance':{balanceDue:o=>o.total-o.amount_paid,findOpenRequest:()=>null,requestState:()=> 'open'},
  './pay-now':{PayNow:()=>createElement('div',null,'PAYMENT_BUTTON_MARKER')},
  './purchase-beacon':{PurchaseBeacon:()=>createElement('div',null,'PURCHASE_EVENT_MARKER')},
};
const source=ts.transpileModule(readFileSync('src/app/(shop)/orders/[token]/page.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const m=new vm.SourceTextModule(source,{context});
await m.link(async name=>{
  if(!mocks[name])throw new Error(`Unexpected import ${name}`);
  const values=mocks[name];
  return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});
});
await m.evaluate();
async function render(patch) {
  order={id:'test',order_number:1,created_at:new Date().toISOString(),shipping_address:{},email:'test@example.test',
    payment_method:'prepaid',payment_status:'pending',cancelled_at:null,hold_reason:null,released_at:null,
    total:100,subtotal:100,amount_paid:0,currency:'INR',items:[],images:[],...patch};
  return renderToStaticMarkup(await m.namespace.default({params:Promise.resolve({token:'test'})}));
}
for(const state of [{cancelled_at:new Date().toISOString(),payment_status:'voided'},{hold_reason:'payment_review'}]) {
  const html=await render(state);
  assert.doesNotMatch(html,/PAYMENT_BUTTON_MARKER|PURCHASE_EVENT_MARKER|Thank you|confirmed and reserved/);
  assert.match(html,state.hold_reason ? /received a payment/ : /order is closed/);
}
console.log('PASS expired/cancelled and payment-review orders do not claim confirmation, request payment, or fire purchase events');
const pending=await render({});assert.match(pending,/PAYMENT_BUTTON_MARKER/);assert.doesNotMatch(pending,/PURCHASE_EVENT_MARKER/);
const paid=await render({payment_status:'paid',amount_paid:100});assert.match(paid,/PURCHASE_EVENT_MARKER/);assert.doesNotMatch(paid,/PAYMENT_BUTTON_MARKER/);
console.log('PASS unpaid and paid orders keep the appropriate payment and confirmation behavior');
