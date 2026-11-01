import {test,expect} from 'bun:test';
test('compiled plugin works under Node Desktop runtime with SQLite, HTTP and injected client',async()=>{
  const proc=Bun.spawn(['node','scripts/node-smoke.mjs'],{stdout:'pipe',stderr:'pipe'});const [out,err]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text()]);const code=await proc.exited;
  if(code!==0)throw new Error(err||out);expect(JSON.parse(out)).toEqual({runtime:'node',toolRegistered:true,sqliteCRUD:true,httpAuth:true,submittedOnce:true,terminalStatus:'succeeded'});
},15000);
