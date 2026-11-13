import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

function run(html:string, options:{env?:Record<string,string>,flags?:string[]}={}){
 const root=mkdtempSync(join(tmpdir(),'office-static-qa-'));
 const input=join(root,'input.html'),output=join(root,'evidence');writeFileSync(input,html);
 const processResult=Bun.spawnSync(['node',resolve('office/qa-html.mjs'),input,output,...(options.flags??[])],{env:{...process.env,...options.env},timeout:95000,maxBuffer:2*1024*1024});
 const stdout=processResult.stdout.toString();
 expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(1024*1024);
 const report=JSON.parse(stdout);
 return {root,output,report,code:processResult.exitCode,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('static QA accepts real generated dashboard with bounded evidence and closed-default print',()=>{
 const r=run(readFileSync('office/examples/dashboard.html','utf8'));
 try{
  expect(r.code).toBe(0);expect(r.report.status).toBe('passed');expect(r.report.mode).toBe('static');
  expect(r.report.views).toHaveLength(3);expect(r.report.print.details_closed).toBe(true);
  expect(r.report.print.visible_print_tables).toBe(2);expect(r.report.print.open_state_screen_tables_hidden).toBe(true);
  expect(r.report.network_responses).toHaveLength(0);
  expect(r.report.evidence.length).toBe(5);
  for(const artifact of r.report.evidence)expect(existsSync(join(r.output,artifact.filename))).toBe(true);
  expect(r.report.views.every((v:any)=>v.script_interactions_tested===false)).toBe(true);
 }finally{r.cleanup();}
},30000);

test('inline script, event handler, fetch and popup script cannot execute or mutate title',()=>{
 const r=run(`<!doctype html><title>UNCHANGED-MARKER</title><h1>Static evidence</h1><body onload="document.title='EVENT-MUTATED'"><script>document.title='SCRIPT-MUTATED';document.body.innerHTML='changed';fetch('https://example.invalid/secret');window.open('https://example.invalid/popup');</script>`);
 try{
  expect(r.code).toBe(1);expect(r.report.status).toBe('unsupported');expect(r.report.passed).toBe(false);
  expect(r.report.views.every((v:any)=>v.document_title==='UNCHANGED-MARKER')).toBe(true);
  expect(r.report.views[0].static_script_features.script_elements).toBe(1);
  expect(r.report.views[0].static_script_features.event_handlers).toBe(1);
  expect(r.report.popup_pages).toBe(0);expect(r.report.blocked_requests).toHaveLength(0);expect(r.report.network_responses).toHaveLength(0);
 }finally{r.cleanup();}
},30000);

test('image and CSS resource attempts fail offline with context-wide abort, no responses',()=>{
 const r=run(`<!doctype html><title>Resource test</title><style>@import url('https://example.invalid/import.css');body{background-image:url('https://example.invalid/background')}</style><h1>Network forbidden</h1><img src="https://example.invalid/image">`);
 try{
  expect(r.code).toBe(1);expect(r.report.status).toBe('failed');expect(r.report.network_responses).toHaveLength(0);
  expect(r.report.blocked_requests.length+r.report.request_failures.length).toBeGreaterThan(0);
  expect(r.report.views[0].external_assets.length).toBeGreaterThan(0);
  expect(r.report.boundary).toContain('not an OS sandbox');
 }finally{r.cleanup();}
},30000);

test('network failure logs are capped at 100 entries and text at 1000 characters',()=>{
 const r=run('<!doctype html><title>Capped</title>'+Array.from({length:130},(_,i)=>`<img src="https://example.invalid/${i}/${'a'.repeat(1200)}">`).join(''));
 try{
  expect(r.code).toBe(1);expect(r.report.blocked_requests.length).toBeLessThanOrEqual(100);expect(r.report.request_failures.length).toBeLessThanOrEqual(100);
  expect(r.report.blocked_requests.every((x:string)=>x.length<=1000)).toBe(true);
  expect(Object.values(r.report.record_overflow).some((n:any)=>n>0)).toBe(true);
  expect(r.report.network_responses).toHaveLength(0);
 }finally{r.cleanup();}
},30000);

test('input and DOM budgets fail explicitly before unbounded screenshots',()=>{
 const big=run('x'.repeat(4*1024*1024+1));
 try{expect(big.code).toBe(1);expect(big.report.error).toContain('4 MiB');expect(big.report.evidence).toHaveLength(0);}finally{big.cleanup();}
 const many=run('<!doctype html><title>DOM</title>'+ '<span>x</span>'.repeat(50001));
 try{expect(many.code).toBe(1);expect(many.report.error).toContain('DOM budget');expect(many.report.evidence).toHaveLength(0);}finally{many.cleanup();}
},30000);

test('long documents disclose screenshot truncation and skip print rather than claiming pass',()=>{
 const r=run('<!doctype html><title>Long</title><div style="height:20000px">Long document</div>');
 try{
  expect(r.code).toBe(1);expect(r.report.status).toBe('limited');expect(r.report.passed).toBe(false);
  expect(r.report.views.every((v:any)=>v.screenshot_truncated)).toBe(true);
  expect(r.report.evidence.every((e:any)=>e.captured_height===12000&&e.truncated)).toBe(true);
  expect(r.report.print.status).toBe('skipped');
 }finally{r.cleanup();}
},30000);

test('missing browser and invalid deadline are structured non-pass results',()=>{
 const missing=run('<title>Blocked</title>',{env:{PLAYWRIGHT_CHROMIUM_EXECUTABLE:'/nonexistent/office-test-chromium'}});
 try{expect(missing.code).toBe(2);expect(missing.report.status).toBe('blocked');expect(missing.report.error).toContain('Chromium');}finally{missing.cleanup();}
 const deadline=run('<title>Bad deadline</title>',{flags:['--timeout-ms','90001']});
 try{expect(deadline.code).toBe(1);expect(deadline.report.error).toContain('1000..90000');}finally{deadline.cleanup();}
},30000);


test('nested srcdoc DOM and scripts are rejected as unsupported, not invisible to budgets',()=>{
 const r=run('<title>Frames</title><iframe srcdoc="'+('&lt;span&gt;x&lt;/span&gt;'.repeat(50005))+'&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>');
 try{expect(r.code).toBe(1);expect(r.report.status).toBe('unsupported');expect(r.report.error).toContain('Embedded');expect(r.report.evidence).toHaveLength(0);}finally{r.cleanup();}
},30000);

test('print-only oversized height and forced pagination fail before producing PDFs',()=>{
 for(const body of ['<style>@media print{body{height:120000px}}</style><p>Short screen</p>','<style>@media print{.break{break-before:page}}</style>'+ '<div class="break">x</div>'.repeat(30)]){
 const r=run('<title>Print budget</title>'+body);try{expect(r.code).toBe(1);expect(r.report.error).toContain('Print layout budget');expect(r.report.evidence.filter((e:any)=>e.kind==='pdf')).toHaveLength(0);}finally{r.cleanup();}
 }
},30000);

test('full-page screenshots reset keyboard scroll, retain top hero pixels, and match PNG dimensions',()=>{
 const html='<!doctype html><title>Top hero regression</title><style>html,body{margin:0}header{height:80px;background:rgb(255,0,255)}body{min-height:2600px}</style><header>TOP HERO</header><details style="margin-top:2300px"><summary>Bottom native toggle</summary><p>Details</p></details>';
 const r=run(html);
 try{
  expect(r.code).toBe(0);expect(r.report.input_sha256).toBe(require('node:crypto').createHash('sha256').update(html).digest('hex'));
  for(const evidence of r.report.evidence.filter((e:any)=>e.kind==='screenshot')){
   const png=readFileSync(join(r.output,evidence.filename));
   expect(png.readUInt32BE(16)).toBe(evidence.pixel_width);expect(png.readUInt32BE(20)).toBe(evidence.pixel_height);
   expect(evidence.pixel_height).toBe(evidence.captured_height);expect(evidence.pixel_height).toBeGreaterThan(evidence.viewport.height);
   expect(evidence.capture_origin).toEqual({x:0,y:0});
   expect(png[24]).toBe(8);expect([2,6]).toContain(png[25]);
   const chunks:Buffer[]=[];for(let offset=8;offset<png.length;){const size=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));offset+=12+size;}
   const pixels=require('node:zlib').inflateSync(Buffer.concat(chunks));
   // First pixel has zero left/above neighbors under every PNG filter.
   expect([...pixels.subarray(1,4)]).toEqual([255,0,255]);
  }
 }finally{r.cleanup();}
},30000);


test('wide nested table and chart regions settle at their first column before screenshots',()=>{
 const html='<!doctype html><title>Nested scroll origin</title><style>html,body{margin:0}.table-scroll,.chart-scroll{width:300px;overflow-x:auto;scroll-behavior:smooth}.wide{width:2000px;height:100px;background:blue}.first{width:60px;height:100px;background:red}</style><div class="table-scroll" tabindex="0"><div class="wide"><div class="first">FIRST</div></div></div><div class="chart-scroll" tabindex="0"><div class="wide"><div class="first">FIRST</div></div></div>';
 const r=run(html);try{
  expect(r.code).toBe(0);
  for(const e of r.report.evidence.filter((e:any)=>e.kind==='screenshot')){
   expect(e.capture_scroll_position_count).toBe(2);expect(e.scroll_stable_samples).toBe(2);
   expect(e.capture_scroll_positions.every((p:any)=>p.x===0&&p.y===0)).toBe(true);
   const png=readFileSync(join(r.output,e.filename)),chunks:Buffer[]=[];
   for(let offset=8;offset<png.length;){const size=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}
   const pixels=require('node:zlib').inflateSync(Buffer.concat(chunks));
   // First region starts at document origin: its first column is red, later columns blue.
   expect([...pixels.subarray(1,4)]).toEqual([255,0,0]);
  }
 }finally{r.cleanup();}
},30000);
