import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { loadEnv } from './db-config.mjs';
loadEnv();
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
const page = await browser.newPage();
const base = process.env.BASE_URL || 'http://localhost:3000';
const errors = [];
page.on('pageerror', e => errors.push(e.message));
mkdirSync('.codex/admin-spacing', { recursive:true });
try {
  await page.setViewport({ width:1920, height:917 });
  await page.goto(base+'/login', { waitUntil:'networkidle2' });
  await page.type('input[type=email]',process.env.adminlogin);
  await page.type('input[type=password]',process.env.adminpassword);
  await Promise.all([page.waitForNavigation({ waitUntil:'networkidle2' }),page.click('button[type=submit]')]);
  const routes = process.env.ROUTES?.split(',') ?? ['/admin/orders','/admin/products','/admin/customers','/admin/discounts','/admin/orders/new','/admin/products/new','/admin/settings/general','/admin/orders/tracking/qikink','/admin/analytics','/admin'];
  for (const route of routes) {
    await page.goto(base+route,{waitUntil:'networkidle2'});
    await page.waitForSelector('main h1',{timeout:60000});
    const metrics = await page.evaluate(() => {
      const frame = document.querySelector('.admin-content-frame');
      const header = document.querySelector('main h1').getBoundingClientRect();
      const sidebar = document.querySelector('.admin > aside').getBoundingClientRect();
      const row = document.querySelector('tbody tr');
      return { gutter:Math.round(header.left-sidebar.right), layout:frame.dataset.layout, row:row ? Math.round(row.getBoundingClientRect().height) : null, overflow:document.documentElement.scrollWidth>innerWidth };
    });
    if(metrics.overflow || metrics.gutter < 12) throw new Error(`${route}: ${JSON.stringify(metrics)}`);
    console.log(route, metrics);
    await page.screenshot({path:'.codex/admin-spacing/'+(route.slice(1).replaceAll('/','-'))+'.png'});
    if (route === '/admin/products/new') {
      const top = await page.$eval('main h1', el => el.getBoundingClientRect().top);
      await page.type('input[placeholder="Short sleeve t-shirt"]', 'Layout check');
      await page.waitForSelector('[data-slot="save-bar"][aria-hidden="false"]');
      const changedTop = await page.$eval('main h1', el => el.getBoundingClientRect().top);
      if (top !== changedTop) throw new Error('Save bar shifted the editor');
      await page.screenshot({path:'.codex/admin-spacing/save-bar.png'});
      await page.click('[data-slot="save-bar"] button[data-variant="ghost"]');
      await page.waitForSelector('[data-slot="save-bar"][aria-hidden="true"]');
      console.log('PASS: save bar appears without moving content; discard restores clean state.');
    }
  }
  // Exercise client navigation: hidden Activity content must not zero the next page's gutter.
  await page.goto(base+'/admin/orders',{waitUntil:'networkidle2'});
  await page.click('.orders-table tbody a');
  await page.waitForSelector('.order-detail', { visible:true });
  await page.click('a[aria-label="Back to orders"]');
  await page.waitForSelector('.orders-table', { visible:true });
  await page.waitForFunction(() => document.querySelector('.admin-content-frame').dataset.layout === 'list');
  const gutter = await page.evaluate(() => document.querySelector('.orders-index').getBoundingClientRect().left - document.querySelector('.admin > aside').getBoundingClientRect().right);
  if(gutter < 12) throw new Error('Gutter lost after detail → list navigation');
  await page.click('button[aria-label="Select all orders on this page"]');
  await page.waitForSelector('.orders-selection');
  if(!(await page.$eval('.orders-selection',el=>el.textContent)).includes('50 selected')) throw new Error('Selection did not select the page');
  await page.click('button[aria-label="Order view"]');
  await page.waitForSelector('[role=menu]');
  await page.keyboard.press('Escape');
  for (const width of [1440,1024,390]) {
    await page.setViewport({width,height:917});
    await page.evaluate(()=>window.scrollTo(0,0));
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Orders overflow at '+width);
    await page.screenshot({path:`.codex/admin-spacing/orders-${width}.png`});
  }
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: shared gutters, row sizing, selection, menu, responsive orders and client-navigation regression.');
} finally { await browser.close(); }
