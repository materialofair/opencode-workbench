import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {previewImport,applyImport,projectKey} from '../src/import-tasks';
import {Engine} from '../src/engine';
import {startServer} from '../src/server';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const project='/fixture/project';
function task(overrides:Record<string,unknown>={}){return {id:'old-1',project,name:'Fixture summary',prompt:'Read fixture only',timezone:'Etc/UTC',schedule:{kind:'daily',time:'09:30',weekdays:[5,1,3,3]},enabled:true,...overrides};}
function manifest(tasks=[task()],id='fixture-source'){return {version:1,sources:[{kind:'plugin',id,tasks}]};}
test('preview is read-only and omits prompt; apply is disabled, project-local and preserves origin through edits',()=>{
  const s=new Store(':memory:');try{
    const m=manifest(),p=previewImport(s,project,m);expect(p.counts.ready).toBe(1);expect(s.tasks()).toHaveLength(0);expect(JSON.stringify(p)).not.toContain('Read fixture only');
    const result=applyImport(s,project,m,p.preview);expect(result.imported).toHaveLength(1);
    const t=s.tasks()[0];expect(t.enabled).toBe(false);expect(t.next).toBeNull();expect(t.schedule).toEqual({kind:'daily',time:'09:30',weekdays:[1,3,5]});expect(t.origin).toMatchObject({kind:'plugin',sourceID:'fixture-source',taskID:'old-1',executor:'unassigned',originalEnabled:true});
    const edited=s.save({...t,prompt:'Local edit',origin:{sourceID:'forged'}},t.id,t.revision);expect(edited.origin).toEqual(t.origin);
    expect(applyImport(s,project,m,p.preview).imported).toEqual([]);expect(s.tasks()[0].prompt).toBe('Local edit');
    s.delete(t.id);expect(applyImport(s,project,m,p.preview).rows[0].reasons[0]).toContain('deleted');expect(s.tasks()).toHaveLength(0);
  }finally{s.close();}
});
test('same source changed, near matches and cross-source semantic duplicates explain their result',()=>{
  const s=new Store(':memory:');try{
    const m=manifest(),p=previewImport(s,project,m);applyImport(s,project,m,p.preview);
    expect(previewImport(s,project,manifest([task({prompt:'Changed'})])).rows[0]).toMatchObject({status:'conflict'});
    const cross=previewImport(s,project,manifest([task({id:'other',name:'Different label',schedule:{kind:'daily',time:'09:30',weekdays:[1,3,5]}})],'second-source'));
    expect(cross.rows[0]).toMatchObject({status:'duplicate',existingTaskID:s.tasks()[0].id});
    const near=previewImport(s,project,manifest([task({id:'other',schedule:{kind:'interval',minutes:5}})],'second-source'));
    expect(near.rows[0].status).toBe('conflict');expect(near.rows[0].reasons[0]).toContain('different schedule');
  }finally{s.close();}
});
test('batch source collisions, duplicates and unsupported rows cannot partially commit',()=>{
  const s=new Store(':memory:');try{
    const m=manifest([task(),task(),task({prompt:'Different'})]),p=previewImport(s,project,m);
    expect(p.counts).toEqual({ready:1,duplicate:1,conflict:1,unsupported:0});expect(()=>applyImport(s,project,m,p.preview)).toThrow('Resolve conflicts');expect(s.tasks()).toHaveLength(0);
    const broken=manifest([task(),task({id:'bad',name:'Bad',project:'/another'})]),b=previewImport(s,project,broken);
    expect(b.rows[1].reasons[0]).toContain('Project differs');expect(()=>applyImport(s,project,broken,b.preview)).toThrow();expect(s.tasks()).toHaveLength(0);
  }finally{s.close();}
});
test('stale preview detects concurrent edits, deletes, creations and altered payloads',()=>{
  const s=new Store(':memory:');try{
    const m=manifest(),p=previewImport(s,project,m);
    const unrelated=s.save({...task({name:'Unrelated',prompt:'Other'}),enabled:false,misfire:'skip'});
    expect(()=>applyImport(s,project,m,p.preview)).toThrow('stale');
    const p2=previewImport(s,project,m);s.delete(unrelated.id);expect(()=>applyImport(s,project,m,p2.preview)).toThrow('stale');
    expect(()=>applyImport(s,project,manifest([task({name:'Changed label'})]),p.preview)).toThrow('stale');
  }finally{s.close();}
});
test('SQLite failure rolls back tasks and ledger together, and idempotency survives a restart',()=>{
  const root=mkdtempSync(join(tmpdir(),'import-fixture-')),path=join(root,'tasks.sqlite');let s=new Store(path);
  try{
    const m=manifest(),p=previewImport(s,project,m);
    s.db.exec("CREATE TRIGGER fail_fixture BEFORE INSERT ON task_imports BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
    expect(()=>applyImport(s,project,m,p.preview)).toThrow('fixture rollback');expect(s.tasks()).toHaveLength(0);expect(s.db.query('SELECT * FROM task_imports').all()).toHaveLength(0);
    s.db.exec('DROP TRIGGER fail_fixture');const first=applyImport(s,project,m,p.preview);s.close();s=new Store(path);
    expect(applyImport(s,project,m,p.preview).imported).toEqual([]);expect(s.tasks().map(t=>t.id)).toEqual(first.imported);
  }finally{s.close();rmSync(root,{recursive:true});}
});
test('invalid timezone, project, schedule, adapter issue and bounds are explicit without echoing payloads',()=>{
  const s=new Store(':memory:');try{
    for(const fields of [{timezone:'unknown'},{project:'relative'},{schedule:{kind:'cron',value:'* * * * *'}},{issues:['SOURCE_ENVIRONMENT_REQUIRES_REVIEW','private-secret']}]){
      const p=previewImport(s,project,manifest([task(fields)]));expect(p.rows[0].status).toBe('unsupported');expect(JSON.stringify(p)).not.toContain('private-secret');
    }
    expect(()=>previewImport(s,project,manifest(Array.from({length:101},()=>task())))).toThrow('1–100');
    expect(()=>previewImport(s,project,{version:2,sources:[]})).toThrow('version 1');
    expect(()=>previewImport(s,project,manifest([task({prompt:'x'.repeat(65536)})]))).toThrow('64 KiB');
  }finally{s.close();}
});
test('Windows drive, slash, UNC and case normalization works without remapping POSIX projects',()=>{
  expect(projectKey('C:\\Work Space\\项目\\')).toBe(projectKey('c:/work space/项目'));
  expect(projectKey('\\\\?\\C:\\Work Space\\项目')).toBe(projectKey('c:/work space/项目'));
  expect(projectKey('\\\\?\\UNC\\SERVER\\Share\\Project')).toBe(projectKey('\\\\server\\share\\project'));
  expect(projectKey('/A/project')).not.toBe(projectKey('/a/project'));
  const s=new Store(':memory:');try{expect(previewImport(s,'C:\\Work Space\\项目',manifest([task({project:'c:/work space/项目'})])).counts.ready).toBe(1);}finally{s.close();}
});
test('importing and ticking cannot dispatch; enabling and manual run require explicit executor selection',async()=>{
  const s=new Store(':memory:');let submitted=0;
  const e=new Engine(s,{async create(){submitted++;return 'fixture';},async submit(){submitted++;},async inspect(){return {status:'running'};},async abort(){}});
  try{
    const m=manifest(),p=previewImport(s,project,m);applyImport(s,project,m,p.preview);const t=s.tasks()[0];
    await e.tick();expect(submitted).toBe(0);expect(()=>e.runNow(t.id,'fixture-key')).toThrow('执行者');
    expect(()=>s.save({...t,enabled:true},t.id,t.revision)).toThrow('执行者');
    const enabled=s.save({...t,enabled:true,executor:'workbench',acknowledgeExternalSchedule:true},t.id,t.revision);expect(enabled.origin?.executor).toBe('workbench');expect(enabled.next).not.toBeNull();
  }finally{await e.stop();s.close();}
});
test('HTTP import inherits auth/CSRF, previews, applies, retries, and returns no prompt',async()=>{
  const s=new Store(':memory:'),e=new Engine(s,{async create(){throw Error('must not run');},async submit(){},async inspect(){return {status:'running'};},async abort(){}}),page=await startServer(e,project);
  const u=new URL(page.url),headers={Authorization:`Bearer ${u.hash.slice(1)}`,Origin:u.origin,'X-Task-CSRF':u.hash.slice(1),'Content-Type':'application/json'};
  const post=(path:string,value:unknown,h=headers)=>fetch(u.origin+'/api/import/'+path,{method:'POST',headers:h,body:JSON.stringify(value)});
  try{
    expect((await post('preview',manifest(),{} as any)).status).toBe(401);
    expect((await post('apply',{}, {...headers,'X-Task-CSRF':''})).status).toBe(403);
    const p=await (await post('preview',manifest())).json();expect(p.counts.ready).toBe(1);expect(s.tasks()).toHaveLength(0);
    const applied=await post('apply',{manifest:manifest(),preview:p.preview});expect(applied.status).toBe(201);expect(await applied.text()).not.toContain('Read fixture only');
    expect((await (await post('apply',{manifest:manifest(),preview:p.preview})).json()).imported).toEqual([]);expect(s.tasks()).toHaveLength(1);
    expect((await post('preview',manifest(),{...headers,Origin:'https://example.com'})).status).toBe(403);
  }finally{page.stop();await e.stop();s.close();}
});
