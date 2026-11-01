import {Store} from '../src/store';import {Engine} from '../src/engine';import {startServer} from '../src/server';
import {mkdirSync,writeFileSync} from 'node:fs';
let engine:Engine;
const host={async create(){return 'demo-'+crypto.randomUUID();},async submit(id:string){setTimeout(()=>void engine.event({type:'session.status',properties:{sessionID:id,status:{type:'busy'}}}),100);setTimeout(()=>void engine.event({type:'permission.asked',properties:{sessionID:id}}),700);},async inspect(){return {status:'running' as const};},async abort(){}};
const store=new Store(':memory:');engine=new Engine(store,host);await engine.start();
const page=startServer(engine,'/demo/project — 演示，不接入真实 OpenCode',true);
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/demo-url.txt',page.url,{mode:0o600});
console.log('Demo listening on loopback. Private launch URL saved to artifacts/demo-url.txt (git-ignored).');
for(const s of ['SIGTERM','SIGINT'] as const)process.on(s,()=>{page.stop();void engine.stop().then(()=>{store.close();process.exit(0);});});
