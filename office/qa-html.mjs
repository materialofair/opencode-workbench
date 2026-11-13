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
      external_assets:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(x=>/^(https?:|\/\/)/i.test(x)),
      allowed_source_links:[...document.querySelectorAll('.source-list a[href]')].map(e=>e.href),
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
      const data=details.nth(i).locator('.table-scroll');
      if(!await data.isVisible())throw new Error('Expanded chart data not visible');
      if(await data.evaluate(e=>e.scrollWidth>e.clientWidth+1)){
        await data.focus();await page.keyboard.press('ArrowRight');
        await page.waitForFunction(e=>e.scrollLeft>0,await data.elementHandle(),{timeout:2000});
        const accessible=await data.evaluate(e=>{e.scrollLeft=e.scrollWidth;return Math.abs(e.scrollWidth-e.clientWidth-e.scrollLeft)<2;});
        if(!accessible)throw new Error('Expanded chart data end unreachable');
      }
      await details.nth(i).locator('summary').focus();
      await page.keyboard.press('Enter');
      if (await details.nth(i).getAttribute('open')!==null) throw new Error('Details did not close');
    }
    const scrollReachability=[];
    const regions=page.locator('.chart-scroll,.table-scroll:visible');
    for(let i=0;i<await regions.count();i++){
      const region=regions.nth(i);
      if(!await region.evaluate(e=>e.scrollWidth>e.clientWidth+1))continue;
      await region.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(e=>e.scrollLeft>0,await region.elementHandle(),{timeout:2000});
      const end=await region.evaluate(e=>{e.scrollLeft=e.scrollWidth;return {max:e.scrollWidth-e.clientWidth,reached:e.scrollLeft};});
      if(Math.abs(end.max-end.reached)>1)throw new Error('Horizontal scroll end unreachable');
      scrollReachability.push({keyboard_scroll:true,end_reachable:true});
      await region.evaluate(e=>e.scrollLeft=0);
    }
    await page.screenshot({path:join(output,`viewport-${viewport.width}.png`),fullPage:true});
    report.views.push({viewport,...measurements,details_toggle_count:await details.count(),scroll_reachability:scrollReachability});
    if(viewport.width===1440){
      // Test the delivered default-closed state. Never open details to make print pass.
      await page.emulateMedia({media:'print'});
      report.print = await page.evaluate(()=>({details_closed:[...document.querySelectorAll('details')].every(e=>!e.open),visible_print_tables:[...document.querySelectorAll('.print-chart-data')].filter(e=>e.getBoundingClientRect().height>0).length,svg_count:document.querySelectorAll('svg').length}));
      if(!report.print.details_closed || report.print.visible_print_tables!==report.print.svg_count)throw new Error('Default-closed print data missing');
      await page.pdf({path:join(output,'print-closed.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
      // Also check previously opened screen details do not duplicate print tables.
      await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
      report.print.open_state_screen_tables_hidden=await page.evaluate(()=>[...document.querySelectorAll('details')].every(e=>getComputedStyle(e).display==='none'));
      if(!report.print.open_state_screen_tables_hidden)throw new Error('Print duplicates screen data');
      await page.pdf({path:join(output,'print-open.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
      report.print.pdf='print-closed.pdf';report.print.pagination_review='requires_visual_review';
    }
    await context.close();
  }
  report.passed = !report.console_errors.length && !report.page_errors.length && !report.blocked_requests.length && !report.request_failures.length && report.views.every(v=>!v.horizontal_overflow&&!v.clipped_text.length&&!v.external_assets.length&&!v.missing_chart_names&&!v.missing_table_captions&&!v.duplicate_ids.length);
} catch(error) {report.error=String(error);}
finally {if(browser)await browser.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});}
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
