/** Static, offline browser-context QA. Not an OS sandbox. Never downloads. */
import { open, mkdir, writeFile, stat, unlink, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import {createHash} from 'node:crypto';
const LIMITS=Object.freeze({html_bytes:4*1024*1024,dom_elements:50000,deadline_ms:90000,screenshot_height:12000,print_pages:25,first_party_tables:12,first_party_total_columns:60,first_party_total_rows:5000,records:100,text_chars:1000,artifact_bytes:16*1024*1024,stdout_bytes:1024*1024});
const report={version:2,mode:'static',chromium_sandbox_requested:true,boundary:'Fresh JavaScript-disabled offline browser contexts with all requests aborted. This is browser-context isolation, not an OS sandbox. Chromium sandbox is explicitly requested, with no automatic fallback.',status:'failed',passed:false,limits:LIMITS,views:[],print:{},evidence:[],console_errors:[],page_errors:[],blocked_requests:[],request_failures:[],network_responses:[],record_overflow:{},unsupported:[],popup_pages:0,visual_review:'screenshots_for_human_review'};
const short=x=>String(x).slice(0,LIMITS.text_chars);
function record(key,value){if(report[key].length<LIMITS.records)report[key].push(typeof value==='string'?short(value):value);else report.record_overflow[key]=(report.record_overflow[key]||0)+1;}
let browser,created=false,output,timer,timedOut=false;let deadline=60000;const started=Date.now();
const remaining=()=>Math.max(1,deadline-(Date.now()-started));
async function artifact(name,kind,extra={}){const path=join(output,name),bytes=(await stat(path)).size;if(bytes>LIMITS.artifact_bytes){await unlink(path);throw new Error(`Artifact exceeds ${LIMITS.artifact_bytes} bytes: ${name}`);}report.evidence.push({filename:name,kind,bytes,...extra});}
async function run(){
 const args=process.argv.slice(2);const input=args[0];output=args[1];
 if(!input||!output||args.length%2!==0||args.length>6)throw new Error('Usage: node office/qa-html.mjs INPUT OUTPUT [--timeout-ms N] [--mode static|first-party-table]');
 await mkdir(output,{recursive:false});created=true;
 const flags=new Set();for(let i=2;i<args.length;i+=2){if(flags.has(args[i]))throw new Error('Duplicate CLI flag');flags.add(args[i]);if(args[i]==='--timeout-ms')deadline=Number(args[i+1]);else if(args[i]==='--mode')report.mode=args[i+1];else throw new Error('Unknown CLI flag');}
 if(!Number.isInteger(deadline)||deadline<1000||deadline>LIMITS.deadline_ms)throw new Error('timeout-ms must be 1000..90000');
 if(!['static','first-party-table'].includes(report.mode))throw new Error('Unknown QA mode');
 if(extname(input).toLowerCase()!=='.html'||/^[a-z]+:\/\//i.test(input))throw new Error('Input must be a local .html file, not a URL');
 report.input=resolve(input);report.deadline_ms=deadline;
 const handle=await open(input,'r');let bytes;
 try{const info=await handle.stat();if(!info.isFile()||info.size>LIMITS.html_bytes)throw new Error('HTML input exceeds 4 MiB or is not a regular file');const buffer=Buffer.alloc(LIMITS.html_bytes+1);let used=0;while(used<buffer.length){const {bytesRead}=await handle.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}if(used>LIMITS.html_bytes)throw new Error('HTML input exceeds 4 MiB');bytes=buffer.subarray(0,used);}finally{await handle.close();}
 report.input_sha256=createHash('sha256').update(bytes).digest('hex');report.input_bytes=bytes.length;
 const html=bytes.toString('utf8');
 // Conservative pre-parse rejection prevents srcdoc subtrees allocating before DOM checks.
 if(/<\s*(?:iframe|frame|object|embed)(?=[\s/>])/i.test(html)){report.unsupported.push('Embedded browsing context tags are unsupported; conservative text detection may reject commented examples');report.status='unsupported';throw new Error('Embedded iframe/frame/object/embed rejected before browser parsing');}
 let chromium;try{({chromium}=await import('@playwright/test'));}catch(error){report.status='blocked';throw new Error('Preinstalled Playwright unavailable: '+short(error));}
 timer=setTimeout(()=>{timedOut=true;void browser?.close().catch(()=>{});},remaining());timer.unref();
 try{browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:Math.min(15000,remaining()),...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});}catch(error){report.status='blocked';throw new Error('Preinstalled Chromium unavailable or launch blocked: '+short(error));}
 let runtime='',headerCSP='';const virtualURL='https://office-validation.invalid/document';
 if(report.mode==='first-party-table'){
  report.boundary='Only reviewed fixed first-party runtime may execute, enforced by exact-byte preflight and tool-owned response-header CSP. Matching is not source authentication. Offline fresh sandbox-requested browser contexts, not OS sandbox.';
  const unsupported=message=>{report.status='unsupported';report.unsupported.push(message);throw new Error(message);};
  if(/<\s*(?:base|noscript|template)(?=[\s/>])/i.test(html))unsupported('base/noscript/template rejected before interactive parsing');
  if(/<meta\b[^>]*\bhttp-equiv\s*=\s*(?:["']\s*)?refresh\b/i.test(html))unsupported('meta refresh rejected before interactive parsing');
  runtime=(await readFile(new URL('./first-party-table.js',import.meta.url),'utf8')).replace(/\r\n?/g,'\n');
  const digest=createHash('sha256').update(runtime).digest('base64');report.runtime_sha256=createHash('sha256').update(runtime).digest('hex');
  headerCSP=`default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const pre=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',offline:true,acceptDownloads:false});
  await pre.route('**/*',route=>{record('blocked_requests',short(route.request().url()));return route.abort();});
  const prepage=await pre.newPage();try{await prepage.setContent(html,{waitUntil:'load',timeout:Math.min(15000,remaining())});}catch(error){await pre.close();unsupported('Disabled interactive preflight could not parse document safely: '+short(error));}
  if(await prepage.locator('*').count()>LIMITS.dom_elements)throw new Error('Interactive preflight DOM budget exceeded');
  const eligibility=await prepage.evaluate(expected=>{
   const scripts=[...document.querySelectorAll('script')],all=[...document.querySelectorAll('*')];
   const problems=[];
   if(scripts.length!==1||scripts[0]?.textContent!==expected||scripts[0]?.attributes.length!==0)problems.push('Require exactly one attribute-free script with exact approved runtime bytes');
   if(document.querySelector('base,noscript,template,iframe,frame,object,embed'))problems.push('Forbidden embedded or parser-changing element');
   if([...document.querySelectorAll('meta[http-equiv]')].some(e=>e.httpEquiv.toLowerCase()==='refresh'))problems.push('meta refresh forbidden');
   for(const el of all)for(const a of el.attributes){if(/^on/i.test(a.name)||a.name.toLowerCase()==='srcdoc'||/^(?:javascript|vbscript):/i.test(a.value.replace(/[\u0000-\u0020]/g,'')))problems.push('Event attribute, srcdoc or executable URL forbidden');}
   const wrappers=[...document.querySelectorAll('[data-office-table]')];if(wrappers.length<1||wrappers.length>12)problems.push('Require 1..12 interactive table regions');let rowCount=0,columnCount=0;
   for(const box of wrappers){
    const table=box.querySelector('table'),headers=table?.tHead?.rows[0]?.cells,body=table?.tBodies?.[0];
    if(box.querySelector('[data-office-table]')||box.querySelectorAll('table').length!==1||!headers||!body||table.tBodies.length!==1||headers.length<1||headers.length>30||body.rows.length>2000){problems.push('Invalid interactive table structure/budget');continue;}
    rowCount+=body.rows.length;columnCount+=headers.length;
    const numericText=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    for(const cell of body.querySelectorAll('[data-office-number]')){const visible=cell.textContent.trim(),value=cell.getAttribute('data-office-number');if(!numericText.test(visible)||!numericText.test(value)||!Number.isFinite(Number(visible))||!Number.isFinite(Number(value))||Number(visible)!==Number(value))problems.push('Numeric metadata does not match visible finite numeric text');}
    if(box.querySelectorAll('[data-office-search]').length!==1||box.querySelector('[data-office-search]')?.type!=='search'||box.querySelectorAll('[data-office-clear]').length!==1||box.querySelector('[data-office-clear]')?.type!=='button'||box.querySelectorAll('[data-office-status]').length!==1)problems.push('Invalid fixed controls');
    const buttons=[...box.querySelectorAll('[data-office-sort]')];if(buttons.length!==headers.length||buttons.some((b,i)=>b.tagName!=='BUTTON'||b.type!=='button'||b.getAttribute('data-office-sort')!==String(i)||b.parentElement!==headers[i]))problems.push('Invalid sorting controls');
    const printCopy=box.closest('.interactive-screen')?.nextElementSibling;if(!printCopy?.classList.contains('interactive-print'))problems.push('Require independent full-source print copy');
    if([...body.rows].some(r=>!r.hasAttribute('data-office-empty')&&r.cells.length!==headers.length))problems.push('Mismatched row columns');
   }
   if(rowCount>5000)problems.push('Total interactive row budget exceeds 5000');if(columnCount>60)problems.push('Total interactive sorting column budget exceeds 60');
   return {problems:problems.slice(0,20),table_count:wrappers.length,row_count:rowCount,column_count:columnCount};
  },runtime);
  await pre.close();if(eligibility.problems.length)unsupported(eligibility.problems.join('; '));report.interactive_preflight=eligibility;report.interactive_preflight_passed=true;report.interactive_contexts_started=0;
 }
 for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
  if(remaining()<1||timedOut)throw new Error('QA deadline exceeded');
  if(report.mode==='first-party-table')report.interactive_contexts_started++;
  const context=await browser.newContext({viewport,javaScriptEnabled:report.mode==='first-party-table',serviceWorkers:'block',offline:true,acceptDownloads:false});
  context.setDefaultTimeout(Math.min(10000,remaining()));context.setDefaultNavigationTimeout(Math.min(15000,remaining()));
  let primary,documentDelivered=false;
  await context.route('**/*',route=>{const req=route.request();if(report.mode==='first-party-table'&&!documentDelivered&&req.url()===virtualURL&&req.method()==='GET'&&req.isNavigationRequest()&&req.frame()===primary?.mainFrame()){documentDelivered=true;return route.fulfill({status:200,contentType:'text/html; charset=utf-8',headers:{'Content-Security-Policy':headerCSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:html});}record('blocked_requests',short(req.url()));return route.abort('blockedbyclient');});
  context.on('page',page=>{if(primary&&page!==primary){report.popup_pages++;void page.close().catch(()=>{});}});
  context.on('response',response=>{if(response.url()!==virtualURL&&/^https?:/i.test(response.url()))record('network_responses',{url:short(response.url()),status:response.status()});});
  context.on('requestfailed',request=>record('request_failures',{url:short(request.url()),error:short(request.failure()?.errorText||'unknown')}));
  const page=await context.newPage();primary=page;
  page.on('console',m=>{if(m.type()==='error')record('console_errors',m.text());});
  page.on('pageerror',e=>record('page_errors',e.message));
  if(report.mode==='first-party-table'){const response=await page.goto(virtualURL,{waitUntil:'load',timeout:Math.min(15000,remaining())});if(response?.headers()['content-security-policy']!==headerCSP)throw new Error('Tool-owned CSP response header not enforced');report.header_csp_enforced=true;}else await page.setContent(html,{waitUntil:'load',timeout:Math.min(15000,remaining())});
  const embedded=await page.locator('iframe,frame,object,embed').count();if(embedded){report.unsupported.push('Embedded browsing contexts are unsupported in static mode');report.status='unsupported';throw new Error('Embedded iframe/frame/object/embed rejected before DOM traversal');}
  const count=await page.locator('*').count();if(count>LIMITS.dom_elements)throw new Error(`DOM budget exceeded: ${count} > ${LIMITS.dom_elements}`);
  const measurements=await page.evaluate(({cap,maxText})=>{
   const all=[...document.querySelectorAll('*')];const clipped=[];let scripts=0,handlers=0,jsUrls=0;
   for(const el of all){if(el.tagName==='SCRIPT')scripts++;for(const a of el.attributes){if(/^on/i.test(a.name))handlers++;if(['href','src','action'].includes(a.name)&&/^\s*javascript:/i.test(a.value))jsUrls++;}}
   for(const el of document.querySelectorAll('h1,h2,h3,p,.label,.value,.note,.badge,summary')){const s=getComputedStyle(el);if((['hidden','clip'].includes(s.overflowX)&&el.scrollWidth>el.clientWidth+1)||(['hidden','clip'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+1)){if(clipped.length<cap)clipped.push(el.textContent.slice(0,maxText));}}
   const ids=all.filter(e=>e.id).map(e=>e.id),seen=new Set(),duplicates=[];for(const id of ids){if(seen.has(id)){if(duplicates.length<cap)duplicates.push(id.slice(0,maxText));}else seen.add(id);}
   return {document_title:document.title.slice(0,maxText),dom_elements:all.length,document_height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),horizontal_overflow:document.documentElement.scrollWidth>innerWidth+1,clipped_text:clipped,static_script_features:{script_elements:scripts,event_handlers:handlers,javascript_urls:jsUrls},svg_count:document.querySelectorAll('svg').length,external_assets:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(x=>/^(https?:|\/\/|file:)/i.test(x)).slice(0,cap).map(x=>x.slice(0,maxText)),allowed_source_links:[...document.querySelectorAll('.source-list a[href]')].map(e=>e.href.slice(0,maxText)).slice(0,cap),missing_table_captions:[...document.querySelectorAll('table')].filter(e=>!e.caption).length,duplicate_ids:duplicates,missing_chart_names:[...document.querySelectorAll('svg')].filter(e=>!e.querySelector('title')||!e.querySelector('desc')).length};
  },{cap:LIMITS.records,maxText:LIMITS.text_chars});
  if(report.mode==='static'&&Object.values(measurements.static_script_features).some(n=>n>0)&&!report.unsupported.length)report.unsupported.push('JavaScript-dependent content is unsupported in static mode. Scripts and event handlers are disabled; no application-script interactions are validated.');
  let fixedRuntimeChecks=[];
  if(report.mode==='first-party-table'){
   const boxes=page.locator('[data-office-table]');
   for(let i=0;i<await boxes.count();i++){
    const box=boxes.nth(i);if(await box.getAttribute('data-office-ready')!=='true')throw new Error('Approved runtime did not initialize; page CSP may be stricter');
    const original=await box.locator('tbody tr:not([data-office-empty])').allTextContents();
    const search=box.locator('[data-office-search]'),clear=box.locator('[data-office-clear]'),sorts=box.locator('[data-office-sort]');
    const noMatch='__office_qa_no_match_83c7adf1__';await search.fill(noMatch);
    if(await box.locator('tbody tr:not([data-office-empty]):visible').count()!==0||await box.locator('[data-office-status]').textContent()!==`显示 0 / ${original.length} 条记录`)throw new Error('Fixed search zero-result/status check failed');
    await clear.click();if(JSON.stringify(await box.locator('tbody tr:not([data-office-empty])').allTextContents())!==JSON.stringify(original))throw new Error('Clear did not restore original order');
    if(original.length){const term=Array.from(original[0].trim()).slice(0,12).join('');const expectedMatches=original.filter(text=>text.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(term.normalize('NFKC').toLocaleLowerCase('zh-CN'))).length;await search.fill(term);if(await box.locator('tbody tr:not([data-office-empty]):visible').count()!==expectedMatches||await box.locator('[data-office-status]').textContent()!==`显示 ${expectedMatches} / ${original.length} 条记录`)throw new Error('Fixed search matching-row/status check failed');await clear.click();}
    if(await sorts.count()){
     for(let column=0;column<await sorts.count();column++){
      const expected=await box.evaluate((element,col)=>{
       const rows=[...element.querySelectorAll('tbody tr:not([data-office-empty])')].map((row,index)=>({text:row.textContent,index,value:row.cells[col].textContent.trim(),number:row.cells[col].getAttribute('data-office-number')}));
       const populated=rows.filter(r=>r.value!=='');const numeric=populated.length>0&&populated.every(r=>r.number!==null&&Number.isFinite(Number(r.number)));
       const sorted=direction=>[...rows].sort((a,b)=>{if(a.value===''&&b.value!=='')return 1;if(b.value===''&&a.value!=='')return -1;const n=numeric&&a.value&&b.value?Number(a.value)-Number(b.value):a.value.localeCompare(b.value,'zh-CN',{numeric:true,sensitivity:'base'});return n?direction*n:a.index-b.index;}).map(r=>r.text);
       return {up:sorted(1),down:sorted(-1)};
      },column);
      const button=sorts.nth(column);await button.click();if(await box.locator('th').nth(column).getAttribute('aria-sort')!=='ascending')throw new Error('Ascending sort state failed');
      const ascendingRows=await box.locator('tbody tr:not([data-office-empty])').allTextContents();if(JSON.stringify(ascendingRows)!==JSON.stringify(expected.up))throw new Error('Ascending sort values incorrect');
      await button.click();if(await box.locator('th').nth(column).getAttribute('aria-sort')!=='descending')throw new Error('Descending sort state failed');
      const descendingRows=await box.locator('tbody tr:not([data-office-empty])').allTextContents();if(JSON.stringify(descendingRows)!==JSON.stringify(expected.down))throw new Error('Descending sort values incorrect');await clear.click();
     }
    }
    await clear.click();if(await search.inputValue()!==''||JSON.stringify(await box.locator('tbody tr:not([data-office-empty])').allTextContents())!==JSON.stringify(original))throw new Error('Table restoration before evidence failed');
    fixedRuntimeChecks.push({table_index:i,original_rows:original.length,search_match:original.length>0,zero_results:true,reset_original_order:true,sort_state:true,sorted_columns:await sorts.count(),all_columns_checked:true});
   }
  }
  const details=page.locator('details');let nativeToggles=0;const scrollReachability=[];
  const scrollCheck=async region=>{if(!await region.evaluate(e=>e.scrollWidth>e.clientWidth+1))return;await region.focus();await page.keyboard.press('ArrowRight');let moved=false;for(let n=0;n<20&&remaining()>0;n++){if(await region.evaluate(e=>e.scrollLeft>0)){moved=true;break;}await new Promise(r=>setTimeout(r,50));}if(!moved)throw new Error('Native keyboard horizontal scroll did not move');const reached=await region.evaluate(e=>{e.scrollTo({left:e.scrollWidth,top:0,behavior:'instant'});return Math.abs(e.scrollWidth-e.clientWidth-e.scrollLeft)<2;});if(!reached)throw new Error('Horizontal region end unreachable');if(scrollReachability.length<LIMITS.records)scrollReachability.push({keyboard_scroll:true,end_reachable:true});await region.evaluate(e=>e.scrollTo({left:0,top:0,behavior:'instant'}));};
  if(await details.count()>100)throw new Error('Native details interaction budget exceeds 100');
  for(let i=0;i<await details.count();i++){
   const detail=details.nth(i),summary=detail.locator('summary').first();const initiallyOpen=await detail.getAttribute('open')!==null;
   await summary.focus();await page.keyboard.press('Enter');if((await detail.getAttribute('open')!==null)===initiallyOpen)throw new Error('Native details did not toggle');
   if(!initiallyOpen){for(const region of await detail.locator('.table-scroll:visible').all())await scrollCheck(region);}
   await summary.focus();await page.keyboard.press('Enter');if((await detail.getAttribute('open')!==null)!==initiallyOpen)throw new Error('Native details did not restore');nativeToggles++;
  }
  const regions=page.locator('.chart-scroll:visible,.table-scroll:visible');if(await regions.count()>200)throw new Error('Scrollable region budget exceeds 200');
  for(const region of await regions.all())await scrollCheck(region);
  const height=Math.min(LIMITS.screenshot_height,measurements.document_height),truncated=measurements.document_height>LIMITS.screenshot_height;
  // Native keyboard scrolling can still be animating after focus moves away.
  // Reset both document and nested scroll regions, then require two stable samples.
  let stableSamples=0,captureScrollPositions=[],captureOrigin,scrollPositionCount=0;
  for(let attempt=0;attempt<8&&stableSamples<2;attempt++){
    if(remaining()<300)throw new Error('Insufficient deadline for screenshot scroll stabilization');
    await page.evaluate(()=>{document.activeElement?.blur?.();for(const e of document.querySelectorAll('.chart-scroll,.table-scroll'))e.scrollTo({left:0,top:0,behavior:'instant'});window.scrollTo({left:0,top:0,behavior:'instant'});});
    await new Promise(r=>setTimeout(r,250));
    const snapshot=await page.evaluate(()=>({origin:{x:window.scrollX,y:window.scrollY},positions:[...document.querySelectorAll('.chart-scroll,.table-scroll')].map((e,index)=>({index,kind:e.classList.contains('chart-scroll')?'chart':'table',x:e.scrollLeft,y:e.scrollTop}))}));
    captureOrigin=snapshot.origin;scrollPositionCount=snapshot.positions.length;captureScrollPositions=snapshot.positions.slice(0,LIMITS.records);
    const zero=captureOrigin.x===0&&captureOrigin.y===0&&snapshot.positions.every(p=>Math.abs(p.x)<.5&&Math.abs(p.y)<.5);
    stableSamples=zero?stableSamples+1:0;
  }
  if(stableSamples<2)throw new Error('Screenshot nested scroll positions failed to stabilize at origin');
  await page.screenshot({path:join(output,`viewport-${viewport.width}.png`),fullPage:true,clip:{x:0,y:0,width:viewport.width,height:Math.max(1,height)},timeout:Math.min(15000,remaining())});
  const pngHandle=await open(join(output,`viewport-${viewport.width}.png`),'r');const header=Buffer.alloc(24);try{const {bytesRead}=await pngHandle.read(header,0,24,0);if(bytesRead!==24||header.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||header.toString('ascii',12,16)!=='IHDR')throw new Error('Invalid PNG screenshot header');}finally{await pngHandle.close();}
  const pixelWidth=header.readUInt32BE(16),pixelHeight=header.readUInt32BE(20);
  if(pixelWidth!==viewport.width||pixelHeight!==height)throw new Error(`Screenshot pixel dimensions mismatch: ${pixelWidth}x${pixelHeight}, expected ${viewport.width}x${height}`);
  await artifact(`viewport-${viewport.width}.png`,'screenshot',{viewport,truncated,captured_height:height,document_height:measurements.document_height,pixel_width:pixelWidth,pixel_height:pixelHeight,capture_origin:captureOrigin,capture_scroll_positions:captureScrollPositions,capture_scroll_position_count:scrollPositionCount,scroll_stable_samples:stableSamples});
  report.views.push({viewport,...measurements,native_details_toggle_count:nativeToggles,script_interactions_tested:report.mode==='first-party-table',fixed_runtime_checks:fixedRuntimeChecks,scroll_reachability:scrollReachability,screenshot_truncated:truncated});
  if(viewport.width===1440){
   if(truncated){report.print={status:'skipped',reason:'Document exceeds 12000px screenshot/print budget'};}
   else{
    await page.emulateMedia({media:'print'});
    await page.setViewportSize({width:794,height:1123});
    const printBudget=async()=>{
      const m=await page.evaluate(()=>({height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),width:document.documentElement.scrollWidth,forced_breaks:[...document.querySelectorAll('*')].reduce((n,e)=>{const s=getComputedStyle(e);return n+(['page','always','left','right','recto','verso'].includes(s.breakBefore)?1:0)+(['page','always','left','right','recto','verso'].includes(s.breakAfter)?1:0);},0)}));
      if(m.height>12000||m.width>795||Math.ceil(m.height/1000)+m.forced_breaks>25)throw new Error('Print layout budget exceeded: '+JSON.stringify(m));
      return m;
    };
    const printPdf=async(filename,state)=>{const layout=await printBudget();await page.pdf({path:join(output,filename),format:'A4',printBackground:true,preferCSSPageSize:false,pageRanges:'1-25',timeout:Math.min(15000,remaining())});await artifact(filename,'pdf',{state,layout,page_range_cap:25});const pdf=await readFile(join(output,filename));const pageObjects=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;if(pageObjects<1||pageObjects>=25){report.print.truncation_possible=true;report.print.page_count_warning='Chromium PDF page-object count reaches cap or cannot be established';}report.evidence.at(-1).chromium_page_objects=pageObjects;};
    report.print=await page.evaluate(()=>({details_closed:[...document.querySelectorAll('details')].every(e=>!e.open),visible_print_tables:[...document.querySelectorAll('.print-chart-data')].filter(e=>e.getBoundingClientRect().height>0).length,svg_count:document.querySelectorAll('svg').length}));
    if(report.print.svg_count&&report.print.visible_print_tables!==report.print.svg_count)report.print.data_warning='Not every SVG has a visible independent print data table';
    await printPdf('print-default.pdf','unmodified-default');
    // A separate open-state check does not alter the default-state evidence above.
    await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
    report.print.open_state_screen_tables_hidden=await page.evaluate(()=>[...document.querySelectorAll('details')].every(e=>getComputedStyle(e).display==='none'));
    await printPdf('print-open.pdf','details-open');
    if(report.mode==='first-party-table'){
      await page.emulateMedia({media:'screen'});
      for(const box of await page.locator('[data-office-table]').all())await box.locator('[data-office-search]').fill('__office_qa_no_match_83c7adf1__');
      await page.emulateMedia({media:'print'});
      const fullSource=await page.evaluate(()=>[...document.querySelectorAll('[data-office-table]')].every(box=>{const snapshot=table=>({headers:[...table.tHead.rows].map(r=>[...r.cells].map(c=>c.textContent)),rows:[...table.tBodies[0].rows].filter(r=>!r.hasAttribute('data-office-empty')).map(r=>[...r.cells].map(c=>c.textContent))});const original=snapshot(box.querySelector('table'));const copy=box.closest('.interactive-screen')?.nextElementSibling;if(!copy||getComputedStyle(copy).display==='none')return false;const printed=snapshot(copy.querySelector('table'));return JSON.stringify(original)===JSON.stringify(printed)&&getComputedStyle(box.closest('.interactive-screen')).display==='none';}));
      if(!fullSource)throw new Error('Filtered-state print does not preserve every source row');
      await printPdf('print-filtered.pdf','screen-filtered-independent-full-source');report.print.filtered_full_source_preserved=true;
      await page.emulateMedia({media:'screen'});for(const box of await page.locator('[data-office-table]').all())await box.locator('[data-office-clear]').click();
    }
    report.print.pagination_review='requires_visual_review';
   }
  }
  await context.close();
 }
 const faults=report.console_errors.length||report.page_errors.length||report.blocked_requests.length||report.request_failures.length||report.popup_pages||report.network_responses.length||report.print.data_warning||report.views.some(v=>v.horizontal_overflow||v.clipped_text.length||v.external_assets.length||v.missing_chart_names||v.missing_table_captions||v.duplicate_ids.length);
 const limited=report.print.truncation_possible||report.views.some(v=>v.screenshot_truncated);
 report.passed=!faults&&!limited&&!report.unsupported.length;
 report.status=report.unsupported.length?'unsupported':faults?'failed':limited?'limited':'passed';
}
try{await run();}catch(error){report.error=short(error);if(!['blocked','unsupported'].includes(report.status))report.status='failed';report.passed=false;}
finally{clearTimeout(timer);if(browser)await browser.close().catch(()=>{});if(timedOut){report.passed=false;report.status='failed';report.error='QA deadline exceeded';}report.elapsed_ms=Date.now()-started;let json=JSON.stringify(report,null,2);if(Buffer.byteLength(json)>LIMITS.stdout_bytes){report.passed=false;report.status='failed';report.error='Report budget exceeded';report.views=[];json=JSON.stringify(report,null,2);}if(created){try{await writeFile(join(output,'report.json'),json,{flag:'wx'});}catch(error){report.passed=false;report.status='failed';report.error='Could not persist report: '+short(error);json=JSON.stringify(report,null,2);}}process.stdout.write(json+'\n');process.exitCode=report.passed?0:report.status==='blocked'?2:1;}
