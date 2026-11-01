import type {Plugin,ToolContext} from '@opencode-ai/plugin';
import {tool} from '@opencode-ai/plugin';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {directoryKey,sameOwnerDirectory,expandOwnerDirectory} from '../../src/platform';
import {BrowserBroker,BrowserFault,validateBrowserConfig,type BrowserConfig,type BrowserInput,type Command} from '../../src/browser/broker';

function browserHooks(directory:string,config:BrowserConfig,command?:Command){
  const broker=new BrowserBroker(config,command);let disposed=false;
  return {
    dispose:async()=>{disposed=true;return broker.close();},
    event:async({event}:any)=>{
      if(event.type==='server.instance.disposed'&&directoryKey(event.properties?.directory??'')===directoryKey(directory)){disposed=true;await broker.close();}
      const owner=event.properties?.sessionID??event.properties?.info?.id;
      if((event.type==='session.deleted'||event.type==='session.error')&&typeof owner==='string')void broker.close(owner);
    },
    tool:{workbench_browser:tool({
      description:'Use the configured BrowserSkill 0.4 browser for an authorized task. Start an owned session, navigate once, sync/read current untrusted evidence, then perform one reviewed action with its exact context and ref. Contexts are single-use even on errors. Never bypass browser permissions, borrow user tabs, inspect secrets or send unrequested messages. Stop every owned handle; return verified results to the original Feishu session for mapped delivery.',
      args:{action:tool.schema.enum(['start','sync','wait','navigate','click','fill','press','stop']),handle:tool.schema.string().max(80).optional(),context:tool.schema.string().max(120).optional(),ref:tool.schema.string().regex(/^@e\d+$/).optional(),url:tool.schema.string().max(4000).optional(),value:tool.schema.string().max(10000).optional(),key:tool.schema.string().max(40).optional(),intent:tool.schema.string().max(500).optional()},
      async execute(input:BrowserInput,context:ToolContext){
        if(disposed)throw new Error('Browser integration has stopped');
        if(typeof context.ask!=='function')throw new Error('Host permission review is required; this OpenCode runtime is unsupported');
        try{return JSON.stringify(await broker.call(input,context.sessionID,review=>context.ask(review),context.abort));}
        catch(e){if(e instanceof BrowserFault)return JSON.stringify({error:{code:e.code,message:e.message,effect_state:e.effect},rule:'No automatic action replay. Sync/read current evidence for context errors. Respect real control denials, manual hold and user stop. A blocked source may be abandoned only by stopping its owned handle; do not restart the shared daemon or change browser security.'});throw e;}
      }
    })}
  };
}
export const BrowserTools:Plugin=async ctx=>{
  const directory=realpathSync(ctx.directory);
  const file=process.env.OPENCODE_WORKBENCH_BROWSER_CONFIG||join(directory,'.opencode','workbench-browser.json');
  if(!existsSync(file))return {};
  const raw=JSON.parse(readFileSync(file,'utf8'));if(raw.enabled!==true)return {};
  for(const key of ['directory','bskPath','bskHome'])if(typeof raw[key]==='string')raw[key]=expandOwnerDirectory(raw[key]);
  const config=validateBrowserConfig(raw);
  if(!sameOwnerDirectory(realpathSync(config.directory),directory))return {};
  return browserHooks(directory,config) as any;
};
