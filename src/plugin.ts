import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { realpathSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store';
import { Engine } from './engine';
import { injectedHost } from './host';
import { startServer } from './server';
import {spawn} from 'node:child_process';
export const TaskManager: Plugin = async ctx => {
  const directory=realpathSync(ctx.directory);
  const id=createHash('sha256').update(directory).digest('hex').slice(0,24);
  const root=join(process.env.XDG_STATE_HOME || join(homedir(),'.local','state'),'opencode-workbench',id);
  mkdirSync(root,{recursive:true,mode:0o700});
  const store=new Store(join(root,'tasks.sqlite'));
  const engine=new Engine(store,injectedHost({...ctx,directory}));
  // Never await host HTTP calls while OpenCode is initializing this plugin:
  // re-entering the same instance during initialization can deadlock recovery.
  const page=await startServer(engine,directory);
  let startupTimer=setTimeout(()=>void engine.start().catch(()=>{}),0);
  let disposed=false;
  const dispose=async()=>{if(disposed)return;disposed=true;clearTimeout(startupTimer);page.stop();await engine.stop();store.close();};
  return {
    dispose,
    event:async({event})=>{
      if(event.type==='server.instance.disposed' && (event as any).properties?.directory===directory) {await dispose();return;}
      await engine.event(event);
    },
    'permission.ask':async(input,output)=>{
      if(store.active().some(r=>r.sessionID===input.sessionID) && output.status==='allow') output.status='ask';
    },
    tool:{open_task_manager:tool({
      description:'在本机默认浏览器中打开当前 OpenCode 项目的定时任务管理页面。只打开页面，不创建或执行任务。',
      args:{},
      async execute(_args,context) {
        if(disposed)throw new Error('任务管理已停止，请重新打开项目');
        if(store.active().some(r=>r.sessionID===context.sessionID)) throw new Error('定时任务不能递归打开管理器');
        const command=process.platform==='darwin'?['open',page.url]:process.platform==='win32'?['rundll32','url.dll,FileProtocolHandler',page.url]:['xdg-open',page.url];
        const code=await new Promise<number>((resolve,reject)=>{const proc=spawn(command[0],command.slice(1),{stdio:'ignore'});proc.once('error',()=>reject(new Error('本机浏览器启动失败')));proc.once('exit',code=>resolve(code??1));});
        if(code!==0)throw new Error('无法打开默认浏览器，请检查本机浏览器后再次调用');
        return '已打开当前项目的定时任务管理页面。调度仅在 OpenCode 后端运行时有效；审批请在 OpenCode 会话处理。';
      }
    })}
  };
};
