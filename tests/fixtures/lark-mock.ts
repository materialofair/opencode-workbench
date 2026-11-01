// In-memory Feishu transport for integration tests. No tokens, sockets or sends.
const key=Symbol.for('workbench.fixture.lark');
export const fixture=((globalThis as any)[key]??={calls:[],handlers:{},ready:false,stopped:false});
export const Domain={Feishu:'fixture-only'},AppType={SelfBuild:'fixture-only'},LoggerLevel={fatal:0,error:1,warn:2,info:3,debug:4,trace:5};
function endpoint(path:string[]):any{return new Proxy((...args:any[])=>{
  fixture.calls.push({path:path.join('.'),args});
  if(path.join('.')==='im.message.get')return Promise.resolve({code:0,data:{items:[{message_id:'fixture-parent',chat_id:'fixture-chat',msg_type:'interactive',body:{content:JSON.stringify({title:'Controlled quote',elements:[[{tag:'text',text:'Synthetic quoted browser task'}]]})}}]}});
  return Promise.resolve({code:0,data:{card_id:'fixture-card',message_id:`fixture-message-${fixture.calls.length}`},bot:{open_id:'fixture-bot'}});
},{get(_t,p){if(p==='then')return undefined;return endpoint([...path,String(p)]);}});}
export class Client{
  im=endpoint(['im']);cardkit=endpoint(['cardkit']);
  constructor(_config:unknown){}
  request=endpoint(['request']);
}
export class EventDispatcher{
  constructor(_config:unknown){}
  register(handlers:Record<string,unknown>){Object.assign(fixture.handlers,handlers);return this;}
}
export class WSClient{
  constructor(_config:unknown){}
  start(_options:unknown){fixture.ready=true;}
  close(){fixture.stopped=true;}
}
