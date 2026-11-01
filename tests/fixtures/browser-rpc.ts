import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';import {homedir} from 'node:os';
import {chromium,type Page} from '@playwright/test';
function executable(){
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root=join(homedir(),'Library','Caches','ms-playwright');
  if(existsSync(root))for(const name of readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse()){
    const file=join(root,name,'chrome-mac','Chromium.app','Contents','MacOS','Chromium');if(existsSync(file))return file;
  }
}
export async function browserRPC(){
  const browser=await chromium.launch({headless:true,executablePath:executable(),timeout:20000});
  const token=randomUUID(),prepared=new Set<string>(),sessions=new Map<string,{page:Page;tab:number;context?:string;bootstrap:boolean}>();
  const trace:{action:string;contextUsed?:boolean}[]=[];let port=0;
  const server=createServer(async(req,res)=>{
    try{
      if(req.url!=='/command'){
        res.setHeader('content-type','text/html');res.end('<!doctype html><title>Browser chain fixture</title><h1>Controlled fixture</h1><label>Query<input id="query"></label><button onclick="document.querySelector(\'#result\').textContent=\'Verified browser fixture: \'+document.querySelector(\'#query\').value">Read fixture</button><p id="result">Not verified</p>');return;
      }
      if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end('{}');return;}
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const args=JSON.parse(Buffer.concat(chunks).toString()) as string[];
      const flag=(name:string)=>args[args.indexOf(name)+1];const has=(name:string)=>args.includes(name);
      let out:any={};
      if(args[0]==='status')out={daemon_version:'0.4.0',protocol_version:'1.7',browsers:[{instance_id:'fixture-browser',extension_version:'0.4.0',extension_protocol_version:'1.7'}]};
      else if(args[0]==='session'&&args[1]==='request'){if(!has('--prepare'))throw new Error('Only request preparation is expected');prepared.add(args[2]);out={prepared:true};}
      else if(args[0]==='session'&&args[1]==='start'){
        if(flag('--browser')!=='fixture-browser'||!prepared.has(flag('--request-id')))throw new Error('Browser/request was not explicitly prepared');
        const sid='fixture-'+randomUUID(),page=await browser.newPage();sessions.set(sid,{page,tab:sessions.size+1,bootstrap:true});trace.push({action:'start'});out={session_id:sid};
      }else if(args[0]==='session'&&args[1]==='stop'){
        const s=sessions.get(args[2]);if(!s)throw new Error('Stopping unowned session');await s.page.close();sessions.delete(args[2]);trace.push({action:'stop'});out={stopped:[args[2]],failed:[]};
      }else{
        const s=sessions.get(flag('--session'));if(!s)throw new Error('Missing owned session');
        if(args[0]==='tab'){
          if(flag('--scope')!=='agent')throw new Error('Only agent scope is permitted');out={tabs:[{tab_id:s.tab,url:s.page.url(),scope:'agent'}]};
        }else if(args[0]==='cooperate'){
          if(flag('--tab-id')!==String(s.tab))throw new Error('Task tab was not pinned');
          const value=await s.page.getByLabel('Query').inputValue(),result=await s.page.locator('#result').innerText();s.context=randomUUID();
          out={tab_id:s.tab,kind:'baseline',context_id:s.context,state:{mode:'ready',editing:false},observation:{tab_id:s.tab,text:`@e1 textbox "Query" ="${value}"\n@e2 button "Read fixture"\n${result}`,truncated:false}};trace.push({action:'sync'});
        }else{
          const initial=args[0]==='navigate'&&s.bootstrap;
          if(!initial&&(!s.context||flag('--context')!==s.context))throw new Error('Single-use context missing/stale');s.context=undefined;s.bootstrap=false;
          if(args[0]==='navigate'){if(new URL(args[1]).origin!==`http://127.0.0.1:${port}`)throw new Error('Fixture origin only');await s.page.goto(args[1]);}
          else if(args[0]==='fill'&&flag('--ref')==='@e1')await s.page.getByLabel('Query').fill(flag('--value'));
          else if(args[0]==='click'&&flag('--ref')==='@e2')await s.page.getByRole('button',{name:'Read fixture',exact:true}).click();
          else throw new Error('Unexpected fixture action');
          trace.push({action:args[0],contextUsed:!initial});out={tab_id:s.tab,reached:'load',url:s.page.url()};
        }
      }
      res.setHeader('content-type','application/json');res.end(JSON.stringify(out));
    }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({code:'fixture_refusal',message:(e as Error).message}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));port=(server.address() as any).port;
  return {origin:`http://127.0.0.1:${port}`,token,trace,sessions,async close(){await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
