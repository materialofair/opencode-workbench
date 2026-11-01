import {test,expect} from 'bun:test';
import {BrowserBroker,BrowserFault,validateBrowserConfig,type Command} from '../src/browser/broker';
function fixture(){
  const config=validateBrowserConfig({enabled:true,directory:'/fixture',bskPath:process.execPath,browser:'fixture-browser',allowedOrigins:['https://example.com'],actions:['navigate','click','fill','press']});
  const calls:string[][]=[];let count=0,ready=true,fail=false,abort=false;
  const command:Command=async args=>{
    calls.push(args);
    if(args[0]==='status')return {daemon_version:'0.4.0',browsers:[{instance_id:'fixture-browser',extension_version:'0.4.0'}]};
    if(args[0]==='session'&&args[1]==='start')return {session_id:`fixture-${++count}`,tab_id:'fixture-tab'};
    if(args[0]==='tab')return {tabs:[{tab_id:'fixture-tab',url:'https://example.com/',scope:'agent'}]};
    if(args[0]==='cooperate')return {ready,context_id:ready?`context-${++count}`:undefined,tab_id:'fixture-tab',observation:{url:'https://example.com/',text:'@e1 button "Fixture"\n@e2 textbox "Query"'}};
    if(args[0]==='click'&&abort)throw new BrowserFault('user_aborted','Person ended the task');
    if(args[0]==='click'&&fail)throw new BrowserFault('permission_denied','This action requires the context returned by the latest cooperate sync','unknown');
    return {success:true};
  };
  const broker=new BrowserBroker(config,command);const approvals:any[]=[];const ask=async(p:any)=>{approvals.push(p);};
  return {broker,calls,approvals,ask,setReady:(v:boolean)=>ready=v,setFail:(v:boolean)=>fail=v,setAbort:(v:boolean)=>abort=v};
}
test('browser broker binds owner/browser/tab, requires exact single-use context and reviews actions',async()=>{
  const f=fixture();const a=await f.broker.call({action:'start',intent:'Read the authorized fixture'},'owner',f.ask);
  await expect(f.broker.call({action:'sync',handle:a.handle},'other-owner',f.ask)).rejects.toThrow('Unknown browser handle');
  await f.broker.call({action:'navigate',handle:a.handle,url:'https://example.com/',intent:'Open fixture'},'owner',f.ask);
  await expect(f.broker.call({action:'click',handle:a.handle,ref:'@e1',intent:'Inspect fixture'},'owner',f.ask)).rejects.toThrow('Sync and read');
  const observation=await f.broker.call({action:'sync',handle:a.handle},'owner',f.ask);
  await f.broker.call({action:'click',handle:a.handle,context:observation.context_id,ref:'@e1',intent:'Inspect fixture'},'owner',f.ask);
  await expect(f.broker.call({action:'click',handle:a.handle,context:observation.context_id,ref:'@e1',intent:'Repeat'},'owner',f.ask)).rejects.toThrow('Sync and read');
  expect(f.approvals.map(p=>p.patterns[0])).toEqual(['start','navigate','click']);expect(f.approvals.every(p=>p.always.length===0)).toBe(true);
  const click=f.calls.find(args=>args[0]==='click')!;expect(click).toContain('fixture-tab');expect(click).toContain(observation.context_id);
  await f.broker.call({action:'stop',handle:a.handle},'owner',f.ask);expect((await f.broker.close()).remainingOwnedSessions).toBe(0);
  expect(f.calls.some(args=>args[0]==='daemon'||args.includes('borrow')||args.includes('evaluate'))).toBe(false);
});
test('browser refusal consumes context without replay; hold and origin limits stay enforced',async()=>{
  const f=fixture(),a=await f.broker.call({action:'start',intent:'Read fixture'},'owner',f.ask);
  await expect(f.broker.call({action:'navigate',handle:a.handle,url:'https://unapproved.invalid',intent:'Outside scope'},'owner',f.ask)).rejects.toThrow('outside');
  await f.broker.call({action:'navigate',handle:a.handle,url:'https://example.com/',intent:'Open fixture'},'owner',f.ask);
  const state=await f.broker.call({action:'sync',handle:a.handle},'owner',f.ask);f.setFail(true);
  await expect(f.broker.call({action:'click',handle:a.handle,context:state.context_id,ref:'@e1',intent:'Fixture action'},'owner',f.ask)).rejects.toThrow('latest cooperate sync');
  await expect(f.broker.call({action:'click',handle:a.handle,context:state.context_id,ref:'@e1',intent:'Replay'},'owner',f.ask)).rejects.toThrow('Sync and read');
  expect(f.calls.filter(c=>c[0]==='click').length).toBe(1);f.setReady(false);
  const hold=await f.broker.call({action:'wait',handle:a.handle},'owner',f.ask);expect(hold.ready).toBe(false);
  await expect(f.broker.call({action:'fill',handle:a.handle,ref:'@e2',value:'Fixture',intent:'Fill'},'owner',f.ask)).rejects.toThrow('Sync and read');
  await f.broker.close();
});
test('user stop ends owned browser task; rejected host approval dispatches no action',async()=>{
  const f=fixture(),a=await f.broker.call({action:'start',intent:'Read fixture'},'owner',f.ask);
  await expect(f.broker.call({action:'navigate',handle:a.handle,url:'https://example.com/',intent:'Open fixture'},'owner',async()=>{throw new Error('Denied by person');})).rejects.toThrow('Denied');
  expect(f.calls.some(c=>c[0]==='navigate')).toBe(false);
  const state=await f.broker.call({action:'sync',handle:a.handle},'owner',f.ask);f.setAbort(true);
  await expect(f.broker.call({action:'click',handle:a.handle,context:state.context_id,ref:'@e1',intent:'Fixture'},'owner',f.ask)).rejects.toThrow('Person ended');
  await expect(f.broker.call({action:'start',intent:'Resume without user request'},'owner',f.ask)).rejects.toThrow('person stopped');
  expect(f.calls.some(c=>c[0]==='session'&&c[1]==='stop')).toBe(true);
});
test('native numeric tab/cooperation shapes stay pinned; failed stop remains visible',async()=>{
 const config=validateBrowserConfig({enabled:true,directory:'/fixture',bskPath:process.execPath,browser:'fixture',allowedOrigins:['https://example.com'],actions:['navigate','click']});
 let cid=0,failed=true,hold=false;const command:Command=async args=>{
  if(args[0]==='status')return {daemon_version:'0.4.0',browsers:[{instance_id:'fixture',extension_version:'0.4.0'}]};
  if(args[0]==='session'&&args[1]==='start')return {session_id:'native'};
  if(args[0]==='session'&&args[1]==='stop')return failed?{failed:['native'],stopped:[]}:{failed:[],stopped:['native']};
  if(args[0]==='tab')return {tabs:[{tab_id:12,url:'https://example.com/'}]};
  if(args[0]==='cooperate')return {kind:cid?'unchanged':'baseline',context_id:`native-${++cid}`,state:{mode:hold?'manual':'ready',editing:hold},...(cid===1?{observation:{text:'@e1 button "Fixture"',truncated:false}}:{})};return {tab_id:12};
 };
 const broker=new BrowserBroker(config,command),ask=async()=>{},a=await broker.call({action:'start',intent:'Fixture'},'owner',ask);
 const state=await broker.call({action:'sync',handle:a.handle},'owner',ask);expect(state.ready).toBe(true);
 const unchanged=await broker.call({action:'sync',handle:a.handle},'owner',ask);expect(unchanged.observation.text).toContain('@e1');
 hold=true;expect((await broker.call({action:'wait',handle:a.handle},'owner',ask)).ready).toBe(false);
 await expect(broker.call({action:'stop',handle:a.handle},'owner',ask)).rejects.toThrow('cleanup was not confirmed');expect((await broker.close()).remainingOwnedSessions).toBe(1);
 failed=false;expect((await broker.close()).remainingOwnedSessions).toBe(0);
});
