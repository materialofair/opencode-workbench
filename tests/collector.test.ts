import {test,expect} from 'bun:test';
test('read-only Python collectors handle synthetic cron, launchd, Windows XML and SQLite exports',async()=>{
  const python=process.platform==='win32'?['py','-3']:['python3'];
  const p=Bun.spawn([...python,'tests/import-collector.py'],{stdout:'pipe',stderr:'pipe'});
  const [out,err]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);
  if(await p.exited!==0)throw new Error(err||out);expect(err).toContain('OK');
});
