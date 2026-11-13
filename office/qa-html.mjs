/** Offline QA, requires pre-provisioned matching Playwright Chromium; never downloads. */
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node office/qa-html.mjs input.html new-evidence-directory');
const html = await readFile(input, 'utf8');
await mkdir(output, { recursive: false });
const report = { input: resolve(input), views: [], print: {}, console_errors: [], page_errors: [], blocked_requests: [], request_failures: [], visual_review: 'screenshots_for_human_review', passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  for (const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]) {
    const context = await browser.newContext({ viewport, serviceWorkers:'block', acceptDownloads:false });
    const page = await context.newPage();
    page.on('console', m => { if (m.type()==='error') report.console_errors.push(m.text()); });
    page.on('pageerror', e => report.page_errors.push(e.message));
    page.on('requestfailed', r => report.request_failures.push({url:r.url(),error:r.failure()?.errorText}));
    await page.route('**/*', route => {report.blocked_requests.push(route.request().url());return route.abort('blockedbyclient');});
    await page.setContent(html, {waitUntil:'load'});
    await page.evaluate(() => document.fonts.ready);
    const measurements = await page.evaluate(() => ({
      horizontal_overflow:document.documentElement.scrollWidth>innerWidth+1,
      clipped_text:[...document.querySelectorAll('h1,h2,h3,p,.label,.value,.note,.badge,summary')].filter(el=>{const s=getComputedStyle(el);return ['hidden','clip'].includes(s.overflowX)&&el.scrollWidth>el.clientWidth+1 || ['hidden','clip'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+1;}).map(el=>el.textContent.slice(0,160)),
      svg_count:document.querySelectorAll('svg').length,
      external_assets:[...document.querySelectorAll('[src],[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(x=>/^(https?:|\/\/)/i.test(x)),
      missing_table_captions:[...document.querySelectorAll('table')].filter(e=>!e.caption).length,
      duplicate_ids:[...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,ids)=>ids.indexOf(id)!==i),
      scroll_regions:[...document.querySelectorAll('.chart-scroll,.table-scroll')].filter(e=>e.scrollWidth>e.clientWidth+1).length,
      missing_chart_names:[...document.querySelectorAll('svg')].filter(e=>!e.querySelector('title')||!e.querySelector('desc')).length
    }));
    const details = page.locator('details');
    for (let i=0;i<await details.count();i++) {
      await details.nth(i).locator('summary').focus();
      await page.keyboard.press('Enter');
      if (!await details.nth(i).getAttribute('open').then(x=>x!==null)) throw new Error('Details did not open');
      await details.nth(i).locator('summary').focus();
      await page.keyboard.press('Enter');
      if (await details.nth(i).getAttribute('open')!==null) throw new Error('Details did not close');
    }
    await page.screenshot({path:join(output,`viewport-${viewport.width}.png`),fullPage:true});
    report.views.push({viewport,...measurements,details_toggle_count:await details.count()});
    if(viewport.width===1440){
      await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
      await page.emulateMedia({media:'print'});
      report.print = await page.evaluate(()=>({details_open:[...document.querySelectorAll('details')].every(e=>e.open),table_count:document.querySelectorAll('table').length,svg_count:document.querySelectorAll('svg').length}));
      await page.pdf({path:join(output,'print.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
      report.print.pdf='print.pdf';report.print.pagination_review='requires_visual_review';
    }
    await context.close();
  }
  report.passed = !report.console_errors.length && !report.page_errors.length && !report.blocked_requests.length && !report.request_failures.length && report.views.every(v=>!v.horizontal_overflow&&!v.clipped_text.length&&!v.external_assets.length&&!v.missing_chart_names&&!v.missing_table_captions&&!v.duplicate_ids.length);
} catch(error) {report.error=String(error);}
finally {if(browser)await browser.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});}
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
