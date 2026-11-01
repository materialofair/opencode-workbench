// Test-only executable; never installed as BrowserSkill or shipped as a binary.
export {};
const endpoint=process.env.WORKBENCH_BROWSER_FIXTURE_RPC,token=process.env.WORKBENCH_BROWSER_FIXTURE_TOKEN;
if(!endpoint||new URL(endpoint).hostname!=='127.0.0.1'||!token)throw new Error('Isolated browser fixture endpoint required');
const response=await fetch(endpoint+'/command',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(process.argv.slice(2).filter(x=>x!=='--json'))});
const result=await response.json();console.log(JSON.stringify(result));if(!response.ok)process.exitCode=1;
