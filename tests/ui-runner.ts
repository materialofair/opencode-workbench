import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {existsSync,mkdirSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {homedir} from 'node:os';
import {Store} from '../src/store';import {Engine} from '../src/engine';import {startServer} from '../src/server';
function executable(){
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const cache=join(homedir(),'Library','Caches','ms-playwright');
  if(existsSync(cache))for(const name of readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort().reverse()){
    const p=join(cache,name,'chrome-mac','Chromium.app','Contents','MacOS','Chromium');if(existsSync(p))return p;
  }
  return undefined;
}
async function main(){
  const store=new Store(':memory:');let engine:Engine;
  const host={async create(){return 'ui-simulation-session';},async submit(id:string){setTimeout(()=>void engine.event({type:'permission.asked',properties:{sessionID:id}}),50);},async inspect(){return {status:'running' as const};},async abort(){}};
  engine=new Engine(store,host);await engine.start();const server=await startServer(engine,'/demo/test-project',true);
  const browser=await chromium.launch({headless:true,executablePath:executable(),timeout:15000});const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept());
  try{
    await page.goto(server.url);await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
    await page.getByLabel('任务名称',{exact:true}).fill('每日项目摘要');await page.getByLabel('执行指令',{exact:true}).fill('只读整理待办；不修改文件，不向外发送消息。');await page.getByLabel('IANA 时区',{exact:true}).fill('Asia/Shanghai');
    await page.getByText('本任务模型（可选）',{exact:true}).click();await page.getByLabel('Provider ID',{exact:true}).fill('fixture-provider');await page.getByLabel('模型 ID',{exact:true}).fill('fixture-model');
    await page.getByRole('button',{name:'保存任务',exact:true}).click();await page.getByRole('heading',{name:'每日项目摘要',exact:true}).waitFor();
    assert.equal(store.tasks().length,1);assert.equal(store.tasks()[0].timezone,'Asia/Shanghai');assert.deepEqual(store.tasks()[0].model,{providerID:'fixture-provider',modelID:'fixture-model'});
    await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('项目摘要 · 工作日');await page.getByRole('button',{name:'保存任务',exact:true}).click();await page.getByRole('heading',{name:'项目摘要 · 工作日',exact:true}).waitFor();
    await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'启用',exact:true}).waitFor();assert.equal(store.tasks()[0].enabled,false);
    await page.getByRole('button',{name:'启用',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
    mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/task-manager-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'立即执行',exact:true}).click();await page.getByRole('button',{name:'运行历史',exact:true}).click();await page.getByText('等待审批',{exact:true}).waitFor({timeout:10000});
    await page.screenshot({path:'artifacts/task-manager-approval.png',fullPage:true});assert.equal(store.runs()[0].status,'waiting_approval');
    await page.getByRole('button',{name:'中止运行',exact:true}).click();await page.getByText('已中止',{exact:true}).waitFor();
    await page.getByRole('button',{name:'任务列表',exact:true}).click();await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('heading',{name:'把重复工作交给时间',exact:true}).waitFor();assert.equal(store.tasks().length,0);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/task-manager-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);assert.equal(new URL(page.url()).hash,'');
    // Text entered by users is rendered as text, never executable markup.
    const xss=store.save({name:'<img src=x onerror=alert(1)>',prompt:'<script>alert(1)</script>',timezone:'UTC',schedule:{kind:'interval',minutes:1},enabled:true,misfire:'skip'});
    await page.reload();await page.getByRole('heading',{name:xss.name,exact:true}).waitFor();assert.equal(await page.locator('article img').count(),0);assert.equal(await page.locator('article script').count(),0);
  }finally{await browser.close();server.stop();await engine.stop();store.close();}
}
await main();
console.log(JSON.stringify({runtime:'node',uiCRUD:true,approvalAndCancel:true,xssTextOnly:true}));
