import {test,expect} from 'bun:test';
import {mkdtempSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../src/store';
test('SQLite close finalizes statements so a persistent database can be renamed and reopened immediately',()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench-sqlite-close-'));let store:Store|undefined;
  try{
    const original=join(root,'tasks.sqlite'),moved=join(root,'moved.sqlite');store=new Store(original);
    const task=store.save({name:'Close fixture',prompt:'Fixture only',timezone:'UTC',schedule:{kind:'interval',minutes:1},enabled:false,misfire:'skip'});
    expect(store.tasks().length).toBe(1);store.close();store.close();store=undefined;renameSync(original,moved);
    store=new Store(moved);expect(store.task(task.id)?.name).toBe('Close fixture');
  }finally{store?.close();rmSync(root,{recursive:true,maxRetries:5,retryDelay:50});}
});
