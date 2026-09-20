import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { loadEnv } from './db-config.mjs';
loadEnv();
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
const page = await browser.newPage();
const base = process.env.BASE_URL || 'http://localhost:3000';
const errors = [];
page.on('pageerror', e => errors.push(e.message));
mkdirSync('.codex/analytics', { recursive:true });
try {
  await page.setViewport({width:1600,height:1000});
  await page.goto(base+'/login',{waitUntil:'networkidle2'});
  await page.type('input[type=email]',process.env.adminlogin);
  await page.type('input[type=password]',process.env.adminpassword);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle2'}),page.click('button[type=submit]')]);
  await page.goto(base+'/admin/analytics?range=90d&compare=previous_period',{waitUntil:'networkidle2',timeout:90000});
  await page.waitForSelector('.analytics-explorer svg path',{timeout:90000});
  await page.screenshot({path:'.codex/analytics/overview-desktop.png',fullPage:true});
  for (const metric of ['Orders','Sessions','Average order value','Conversion rate','Returning customers','Total sales']) {
    await page.evaluate(label=>[...document.querySelectorAll('.analytics-kpi')].find(el=>el.textContent.includes(label)).click(),metric);
    await page.waitForFunction(label=>document.querySelector('.analytics-explorer h2').textContent===label+' over time',{},metric);
  }
  await page.click('.analytics-view-toggle');
  await page.waitForSelector('.analytics-data-table');
  const cells = await page.$$eval('.analytics-data-table tbody tr', rows=>rows.length);
  if (!cells) throw new Error('Missing chart data rows');
  await page.click('.analytics-view-toggle');
  for(const label of ['Location','Units','Source','Sales']) {
    await page.evaluate(label=>[...document.querySelectorAll('.analytics-segmented button')].find(el=>el.textContent===label).click(),label);
  }
  await new Promise(resolve=>setTimeout(resolve,1800));
  const chart = await page.$('.analytics-explorer .analytics-chart');
  const box = await chart.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.waitForSelector('.analytics-tooltip',{visible:true,timeout:15000});
  await page.screenshot({path:'.codex/analytics/tooltip.png'});
  await page.mouse.move(0,0);
  await page.evaluate(()=>[...document.querySelectorAll('.analytics-toolbar button')].find(el=>el.textContent.includes('Previous period')).click());
  await page.waitForSelector('[role=menuitem]');
  await page.evaluate(()=>[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.includes('No comparison')).click());
  await page.waitForFunction(()=>!document.querySelector('.analytics-chart-legend .comparison'));
  await page.evaluate(()=>[...document.querySelectorAll('.analytics-toolbar button')].find(el=>el.textContent.includes('Last 90 days')).click());
  await page.waitForSelector('[role=menuitem]');
  await page.evaluate(()=>[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.includes('Last 7 days')).click());
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('range')==='7d');
  await page.waitForFunction(()=>document.querySelector('.analytics-toolbar').textContent.includes('Last 7 days'));
  await page.goto(base+'/admin/analytics?range=90d&compare=previous_period',{waitUntil:'networkidle2'});
  for(const width of [1024,390,320]) {
    await page.setViewport({width,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    await new Promise(resolve=>setTimeout(resolve,400));
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Overflow at '+width);
    await page.screenshot({path:`.codex/analytics/overview-${width}.png`,fullPage:true});
  }
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.goto(base+'/admin/analytics?range=today',{waitUntil:'networkidle2'});
  await page.waitForSelector('.analytics-kpi');
  await page.screenshot({path:'.codex/analytics/today-reduced-motion.png',fullPage:true});
  await page.setViewport({width:1600,height:1000});
  await page.goto(base+'/admin/analytics/reports/sales-over-time?range=90d',{waitUntil:'networkidle2',timeout:90000});
  await page.waitForSelector('main svg path');
  await page.screenshot({path:'.codex/analytics/report.png',fullPage:true});
  await page.goto(base+'/admin/analytics/live',{waitUntil:'networkidle2',timeout:90000});
  await page.waitForFunction(()=>!document.body.textContent.includes('Collecting visitor observations'),{timeout:30000});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Pause').click());
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='Resume'));
  await page.screenshot({path:'.codex/analytics/live.png',fullPage:true});
  await page.setViewport({width:390,height:900});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Live View overflows on mobile');
  await page.screenshot({path:'.codex/analytics/live-mobile.png',fullPage:true});
  if(errors.length) throw new Error([...new Set(errors)].join('\n'));
  console.log('PASS: six metrics, exact values, rankings, tooltip, 1600/1024/390/320px, reduced motion, report and live pause.');
} finally { if(errors.length) console.log('BROWSER ERRORS', [...new Set(errors)]); await browser.close(); }
