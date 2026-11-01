import {test,expect} from 'bun:test';
// Run Playwright with Node, matching Desktop's runtime. Bun 1.2 Windows child
// process pipes can stall Chromium startup; the assertions remain in the runner.
test('React UI creates, edits, pauses, executes, shows approval, cancels and deletes safely',async()=>{
  const proc=Bun.spawn(['node','.data/ui-runner.js'],{stdout:'pipe',stderr:'pipe'});
  const [out,err]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text()]);
  if(await proc.exited!==0)throw new Error(err||out);
  expect(JSON.parse(out)).toEqual({runtime:'node',uiCRUD:true,approvalAndCancel:true,xssTextOnly:true});
},60000);
