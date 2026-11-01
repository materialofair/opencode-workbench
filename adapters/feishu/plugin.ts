import type {Plugin} from '@opencode-ai/plugin';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
// Optional entry point. Do not enable alongside another plugin owning the same bot.
export const FeishuDesktop:Plugin=async ctx=>{
  const config=process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG || join(homedir(),'.config','opencode','plugins','feishu.json');
  if(!existsSync(config))return {};
  const parsed=JSON.parse(readFileSync(config,'utf8'));
  if(typeof parsed.directory!=='string' || !parsed.directory.trim())throw new Error('Feishu adapter requires an explicit owner directory to avoid duplicate gateway connections');
  const owner=parsed.directory.replace(/^~(?=\/)/,homedir()).replace(/\$\{(\w+)\}/g,(_:string,k:string)=>process.env[k]??'');
  if(realpathSync(owner)!==realpathSync(ctx.directory))return {};
  const built=fileURLToPath(new URL('../../.data/feishu/dist/index.desktop.js',import.meta.url));
  if(!existsSync(built))throw new Error('Run bun scripts/prepare-feishu.ts before enabling the Feishu adapter');
  const module=await import(built);return module.FeishuPlugin(ctx);
};
