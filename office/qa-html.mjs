/** Static, offline browser-context QA. Not an OS sandbox. Never downloads. */
import { open, mkdir, writeFile, stat, unlink, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import {createHash} from 'node:crypto';
const LIMITS=Object.freeze({html_bytes:4*1024*1024,dom_elements:50000,deadline_ms:90000,screenshot_height:12000,print_pages:25,records:100,text_chars:1000,artifact_bytes:16*1024*1024,stdout_bytes:1024*1024});
const report={version:2,mode:'static',chromium_sandbox_requested:true,boundary:'Fresh JavaScript-disabled offline browser contexts with all requests aborted. This is browser-context isolation, not an OS sandbox. Chromium sandbox is explicitly requested, with no automatic fallback.',status:'failed',passed:false,limits:LIMITS,views:[],print:{},evidence:[],console_errors:[],page_errors:[],blocked_requests:[],request_failures:[],network_responses:[],record_overflow:{},unsupported:[],popup_pages:0,visual_review:'screenshots_for_human_review'};
const short=x=>String(x).slice(0,LIMITS.text_chars);
function record(key,value){if(report[key].length<LIMITS.records)report[key].push(typeof value==='string'?short(value):value);else report.record_overflow[key]=(report.record_overflow[key]||0)+1;}
let browser,created=false,output,timer,timedOut=false;let deadline=60000;const started=Date.now();
const remaining=()=>Math.max(1,deadline-(Date.now()-started));
async function artifact(name,kind,extra={}){const path=join(output,name),bytes=(await stat(path)).size;if(bytes>LIMITS.artifact_bytes){await unlink(path);throw new Error(`Artifact exceeds ${LIMITS.artifact_bytes} bytes: ${name}`);}report.evidence.push({filename:name,kind,bytes,...extra});}
async function run(){
 const args=process.argv.slice(2);const input=args[0];output=args[1];
 if(!input||!output||args.length!==2&&(args.length!==4||args[2]!=='--timeout-ms'))throw new Error('Usage: node office/qa-html.mjs input.html new-evidence-directory [--timeout-ms 60000]');
 await mkdir(output,{recursive:false});created=true;
 if(args.length===4){deadline=Number(args[3]);if(!Number.isInteger(deadline)||deadline<1000||deadline>LIMITS.deadline_ms)throw new Error('timeout-ms must be 1000..90000');}
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
 for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
  if(remaining()<1||timedOut)throw new Error('QA deadline exceeded');
  const context=await browser.newContext({viewport,javaScriptEnabled:false,serviceWorkers:'block',offline:true,acceptDownloads:false});
  context.setDefaultTimeout(Math.min(10000,remaining()));context.setDefaultNavigationTimeout(Math.min(15000,remaining()));
  await context.route('**/*',route=>{record('blocked_requests',short(route.request().url()));return route.abort('blockedbyclient');});
  let primary;
  context.on('page',page=>{if(primary&&page!==primary){report.popup_pages++;void page.close().catch(()=>{});}});
  context.on('response',response=>{if(/^https?:/i.test(response.url()))record('network_responses',{url:short(response.url()),status:response.status()});});
  context.on('requestfailed',request=>record('request_failures',{url:short(request.url()),error:short(request.failure()?.errorText||'unknown')}));
  const page=await context.newPage();primary=page;
  page.on('console',m=>{if(m.type()==='error')record('console_errors',m.text());});
  page.on('pageerror',e=>record('page_errors',e.message));
  await page.setContent(html,{waitUntil:'load',timeout:Math.min(15000,remaining())});
  const embedded=await page.locator('iframe,frame,object,embed').count();if(embedded){report.unsupported.push('Embedded browsing contexts are unsupported in static mode');report.status='unsupported';throw new Error('Embedded iframe/frame/object/embed rejected before DOM traversal');}
  const count=await page.locator('*').count();if(count>LIMITS.dom_elements)throw new Error(`DOM budget exceeded: ${count} > ${LIMITS.dom_elements}`);
  const measurements=await page.evaluate(({cap,maxText})=>{
   const all=[...document.querySelectorAll('*')];const clipped=[];let scripts=0,handlers=0,jsUrls=0;
   for(const el of all){if(el.tagName==='SCRIPT')scripts++;for(const a of el.attributes){if(/^on/i.test(a.name))handlers++;if(['href','src','action'].includes(a.name)&&/^\s*javascript:/i.test(a.value))jsUrls++;}}
   for(const el of document.querySelectorAll('h1,h2,h3,p,.label,.value,.note,.badge,summary')){const s=getComputedStyle(el);if((['hidden','clip'].includes(s.overflowX)&&el.scrollWidth>el.clientWidth+1)||(['hidden','clip'].includes(s.overflowY)&&el.scrollHeight>el.clientHeight+1)){if(clipped.length<cap)clipped.push(el.textContent.slice(0,maxText));}}
   const ids=all.filter(e=>e.id).map(e=>e.id),seen=new Set(),duplicates=[];for(const id of ids){if(seen.has(id)){if(duplicates.length<cap)duplicates.push(id.slice(0,maxText));}else seen.add(id);}
   return {document_title:document.title.slice(0,maxText),dom_elements:all.length,document_height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),horizontal_overflow:document.documentElement.scrollWidth>innerWidth+1,clipped_text:clipped,static_script_features:{script_elements:scripts,event_handlers:handlers,javascript_urls:jsUrls},svg_count:document.querySelectorAll('svg').length,external_assets:[...document.querySelectorAll('[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')).filter(x=>/^(https?:|\/\/|file:)/i.test(x)).slice(0,cap).map(x=>x.slice(0,maxText)),allowed_source_links:[...document.querySelectorAll('.source-list a[href]')].map(e=>e.href.slice(0,maxText)).slice(0,cap),missing_table_captions:[...document.querySelectorAll('table')].filter(e=>!e.caption).length,duplicate_ids:duplicates,missing_chart_names:[...document.querySelectorAll('svg')].filter(e=>!e.querySelector('title')||!e.querySelector('desc')).length};
  },{cap:LIMITS.records,maxText:LIMITS.text_chars});
  if(Object.values(measurements.static_script_features).some(n=>n>0)&&!report.unsupported.length)report.unsupported.push('JavaScript-dependent content is unsupported in static mode. Scripts and event handlers are disabled; no application-script interactions are validated.');
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
  report.views.push({viewport,...measurements,native_details_toggle_count:nativeToggles,script_interactions_tested:false,scroll_reachability:scrollReachability,screenshot_truncated:truncated});
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
