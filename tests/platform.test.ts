import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/store';
import {browserCommand,directoryKey,projectID,stateDirectory,expandOwnerDirectory,protectStateDirectory} from '../src/platform';

test('Windows project identity handles drive, slash, case and long path aliases without changing POSIX identities',()=>{
  const directory='C:\\Work Space\\项目';
  for(const alias of [directory,'c:/work space/项目','\\\\?\\C:\\Work Space\\项目'])expect(projectID(alias,'win32')).toBe(projectID(directory,'win32'));
  expect(directoryKey('\\\\?\\UNC\\server\\share\\Project','win32')).toBe('\\\\server\\share\\project');
  const posix='/fixture/Case-Sensitive';expect(projectID(posix,'darwin')).toBe(createHash('sha256').update(posix).digest('hex').slice(0,24));
  expect(projectID(posix,'darwin')).not.toBe(projectID(posix.toLowerCase(),'darwin'));
});
test.skipIf(process.platform!=='win32')('native Windows state ACL protects SQLite files with only current user and SYSTEM',()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench native ACL 中文-'));let store:Store|undefined;
  try{
    protectStateDirectory(root);
    store=new Store(join(root,'tasks.sqlite'));
    store.save({name:'Native ACL fixture',prompt:'Synthetic only',timezone:'UTC',schedule:{kind:'interval',minutes:1},enabled:false,misfire:'skip'});
    const script=`$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $items=@(Get-Item -LiteralPath $env:WORKBENCH_ACL_FIXTURE)+@(Get-ChildItem -LiteralPath $env:WORKBENCH_ACL_FIXTURE -Force); $ok=$true; foreach($item in $items){$acl=Get-Acl -LiteralPath $item.FullName; $ids=@($acl.Access | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); if($item.PSIsContainer -and !$acl.AreAccessRulesProtected){$ok=$false}; if($ids -notcontains $sid -or $ids -notcontains 'S-1-5-18' -or @($ids | Where-Object {$_ -ne $sid -and $_ -ne 'S-1-5-18'}).Count -ne 0){$ok=$false}}; @{privateAcl=$ok;items=$items.Count}|ConvertTo-Json -Compress`;
    const result=JSON.parse(execFileSync(join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,WORKBENCH_ACL_FIXTURE:root}}).trim());
    expect(result.privateAcl).toBe(true);expect(result.items).toBeGreaterThanOrEqual(2);
  }finally{store?.close();rmSync(root,{recursive:true});}
});
test('Windows state is local app data unless XDG explicitly overrides; POSIX state location is unchanged',()=>{
  const project='C:\\Work\\项目',id=projectID(project,'win32');
  expect(stateDirectory(project,{LOCALAPPDATA:'C:\\Local Data'},'C:\\Profiles\\fixture','win32')).toBe(`C:\\Local Data\\opencode-workbench\\${id}`);
  expect(stateDirectory(project,{},'C:\\Profiles\\fixture','win32')).toContain('AppData\\Local\\opencode-workbench');
  expect(stateDirectory(project,{XDG_STATE_HOME:'D:\\Private State'},'C:\\Profiles\\fixture','win32')).toBe(`D:\\Private State\\opencode-workbench\\${id}`);
  expect(stateDirectory('/project',{},'/fixture','darwin')).toBe(`/fixture/.local/state/opencode-workbench/${projectID('/project','darwin')}`);
  expect(expandOwnerDirectory('~\\项目',{},'C:\\Profiles\\fixture')).toBe('C:\\Profiles\\fixture\\项目');
  expect(expandOwnerDirectory('${FIXTURE_OWNER}/项目',{FIXTURE_OWNER:'C:/Work Space'},'/fixture')).toBe('C:/Work Space/项目');
});
test('browser launch is an argument vector with a fixed Windows system executable, preserving capability fragment',()=>{
  const url='http://127.0.0.1:43210/#fixture_capability_only';
  expect(browserCommand(url,'win32',{SystemRoot:'C:\\Windows'})).toEqual({file:'C:\\Windows\\System32\\rundll32.exe',args:['C:\\Windows\\System32\\url.dll,FileProtocolHandler',url]});
  expect(browserCommand(url,'darwin')).toEqual({file:'/usr/bin/open',args:[url]});
  expect(browserCommand(url,'linux')).toEqual({file:'xdg-open',args:[url]});
  expect(()=>browserCommand('https://remote.invalid/#fixture_capability_only','win32',{SystemRoot:'C:\\Windows'})).toThrow();
  expect(()=>browserCommand(url,'win32',{})).toThrow();
});
test('Windows state ACL uses numeric SID, removes inherited access, and fails closed on ACL error',()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench-acl-'));const calls:{file:string;args:string[]}[]=[];
  try{
    const execute=(file:string,args:string[])=>{calls.push({file,args});return file.endsWith('whoami.exe')?'"fixture","S-1-5-21-100-200-300-400"':'';};
    protectStateDirectory(root,'win32',{SystemRoot:'C:\\Windows'},execute);
    expect(calls[1].args).toEqual([root,'/reset','/q']);
    expect(calls[2].args).toEqual([root,'/inheritance:r','/grant:r','*S-1-5-21-100-200-300-400:(OI)(CI)F','*S-1-5-18:(OI)(CI)F','/q']);
    expect(()=>protectStateDirectory(root,'win32',{SystemRoot:'C:\\Windows'},()=>{throw new Error('simulated ACL refusal');})).toThrow('No scheduler was started');
  }finally{rmSync(root,{recursive:true});}
});
