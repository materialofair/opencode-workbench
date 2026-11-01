import {createHash, randomUUID} from 'node:crypto';
import {posix, win32} from 'node:path';
import {validate, type TaskInput} from './schedule';
import {type Store, type Task, type ImportOrigin} from './store';

// Transport is portable JSON. No endpoint executes commands or reads arbitrary files.
export type ImportManifest = {version:1; sources:{kind:'workbench'|'cron'|'launchd'|'windows-task'|'plugin'; id:string; tasks:{id:string; project:string; name:string; prompt:string; timezone:string; schedule:unknown; enabled:boolean|'unknown'; model?:unknown; issues?:string[]}[]}[]};
type Candidate = {key:string; fingerprint:string; input:TaskInput; origin:ImportOrigin};
type Row = {source:string; taskID:string; name?:string; status:'ready'|'duplicate'|'conflict'|'unsupported'; reasons:string[]; existingTaskID?:string; schedule?:TaskInput['schedule']; timezone?:string; originalEnabled?:boolean|'unknown'};
export type ImportPreview = {preview:string; rows:Row[]; counts:Record<Row['status'],number>; enabled:false; executor:'unassigned'};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const issueCodes=new Set(['PROJECT_ID_MISMATCH','UNSUPPORTED_COMMAND','UNSUPPORTED_MODEL','UNSUPPORTED_COMMAND_OPTIONS','MISSING_PROJECT','MISSING_TIMEZONE','UNSUPPORTED_CRON','UNSUPPORTED_CRON_STDIN','UNSUPPORTED_LAUNCHD_SCHEDULE','ADDITIONAL_LAUNCHD_TRIGGERS','SOURCE_ENVIRONMENT_REQUIRES_REVIEW','LAUNCHD_MISFIRE_REQUIRES_REVIEW','UNSUPPORTED_WINDOWS_ACTIONS','MISSING_TIMEZONE_OFFSET','UNSUPPORTED_WINDOWS_REPETITION','UNSUPPORTED_WINDOWS_TRIGGER','WINDOWS_EXECUTION_CONTEXT_REQUIRES_REVIEW','WINDOWS_ARGUMENTS_REQUIRE_STRUCTURED_ARGV']);
function identity(value:unknown,label:string):string {
  if(typeof value!=='string'||!value.trim()||value.length>512||/[\u0000-\u001f]/.test(value))throw new Error(`Invalid ${label}`);
  return value;
}
export function projectKey(value:string) {
  if(win32.isAbsolute(value) && !posix.isAbsolute(value))return 'win:'+win32.normalize(value).replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'').replace(/[\\/]+$/,'').toLowerCase();
  if(!posix.isAbsolute(value))throw new Error('Project must be an absolute path');
  return 'posix:'+posix.normalize(value).replace(/\/$/,'');
}
function signature(input:TaskInput,project:string,contentOnly=false) {
  return hash([project, input.prompt, input.model?.providerID??'',input.model?.modelID??'',...(contentOnly?[]:[input.timezone,input.schedule])]);
}
function parse(value:unknown):ImportManifest {
  if(!value||typeof value!=='object'||JSON.stringify(value).length>65536)throw new Error('Import manifest is invalid or exceeds 64 KiB');
  const v=value as ImportManifest;
  if(v.version!==1||!Array.isArray(v.sources)||!v.sources.length||v.sources.length>20)throw new Error('Expected version 1 and 1–20 sources');
  let total=0;
  for(const s of v.sources){
    if(!s||!['workbench','cron','launchd','windows-task','plugin'].includes(s.kind))throw new Error('Unsupported source kind');
    identity(s.id,'source ID');
    if(!Array.isArray(s.tasks))throw new Error('Expected source tasks');
    total+=s.tasks.length;
    for(const t of s.tasks){if(!t||typeof t!=='object')throw new Error('Invalid source task');identity(t.id,'source task ID');}
  }
  if(total<1||total>100)throw new Error('Import 1–100 tasks per batch');
  return v;
}
function plan(store:Store,directory:string,manifest:unknown) {
  const v=parse(manifest),project=projectKey(directory),tasks=store.tasks();
  const rows:Row[]=[],candidates:Candidate[]=[];
  const seen=new Map<string,string>(), fingerprints=new Set<string>(), contents=new Set<string>(), names=new Set<string>();
  for(const source of v.sources)for(const raw of source.tasks){
    const key=hash([source.kind,source.id,raw.id]);
    const row:Row={source:`${source.kind}:${source.id}`,taskID:raw.id,status:'unsupported',reasons:[]};rows.push(row);
    let input:TaskInput;
    try{
      if(projectKey(identity(raw.project,'project'))!==project)throw new Error('Project differs from the current OpenCode project; open that project to import');
      if(raw.enabled!==true&&raw.enabled!==false&&raw.enabled!=='unknown')throw new Error('Original enabled state must be true, false or unknown');
      if(raw.issues!==undefined&&(!Array.isArray(raw.issues)||raw.issues.some(x=>typeof x!=='string')))throw new Error('Invalid adapter issues');
      if(raw.issues?.length)throw new Error('Adapter requires review: '+[...new Set(raw.issues.map(x=>issueCodes.has(x)?x:'UNKNOWN_ADAPTER_ISSUE'))].join(', '));
      input=validate({...raw,enabled:false,misfire:'skip'});
      row.name=input.name;row.schedule=input.schedule;row.timezone=input.timezone;row.originalEnabled=raw.enabled;
    }catch(e){row.reasons.push(e instanceof Error?e.message:'Invalid task');continue;}
    const fingerprint=signature(input,project),content=signature(input,project,true);
    // Include name/status in the source revision while semantic matching ignores them.
    const revision=hash([fingerprint,input.name,raw.enabled]);
    const prior=store.db.query('SELECT fingerprint,task_id FROM task_imports WHERE source_key=?').get(key) as {fingerprint:string;task_id:string}|null;
    if(prior){
      row.existingTaskID=prior.task_id;
      row.status=prior.fingerprint===revision?'duplicate':'conflict';
      row.reasons.push(prior.fingerprint===revision?(store.task(prior.task_id)?'This source task was already imported; existing edits are preserved':'Previously imported task was deleted; automatic resurrection is blocked'):'This source task changed since import; existing task will not be overwritten');continue;
    }
    if(seen.has(key)){row.status=seen.get(key)===revision?'duplicate':'conflict';row.reasons.push('Source task ID repeats within this batch'+(row.status==='conflict'?' with different content':''));continue;}
    seen.set(key,revision);
    const exact=tasks.find(t=>signature(t,project)===fingerprint);
    if(exact||fingerprints.has(fingerprint)){row.status='duplicate';row.existingTaskID=exact?.id;row.reasons.push('Same project, prompt, model, timezone and schedule already exist');continue;}
    const similar=tasks.find(t=>signature(t,project,true)===content||t.name.toLowerCase()===input.name.toLowerCase());
    if(similar||contents.has(content)||names.has(input.name.toLowerCase())){row.status='conflict';row.existingTaskID=similar?.id;row.reasons.push('Same prompt/model or name has a different schedule or content; review manually');continue;}
    row.status='ready';row.reasons.push('Will create a disabled task; the original scheduler remains unchanged');
    fingerprints.add(fingerprint);contents.add(content);names.add(input.name.toLowerCase());
    candidates.push({key,fingerprint:revision,input,origin:{kind:source.kind,sourceID:source.id,taskID:raw.id,fingerprint:revision,originalEnabled:raw.enabled,executor:'unassigned'}});
  }
  const counts={ready:0,duplicate:0,conflict:0,unsupported:0};for(const r of rows)counts[r.status]++;
  // Binds review to exact input and current task data, including concurrent edits.
  const preview=hash([v,tasks,rows]);
  return {result:{preview,rows,counts,enabled:false as const,executor:'unassigned' as const},candidates};
}
export function previewImport(store:Store,directory:string,manifest:unknown):ImportPreview {return plan(store,directory,manifest).result;}
export function applyImport(store:Store,directory:string,manifest:unknown,preview:string) {
  return store.db.transaction(()=>{
    const p=plan(store,directory,manifest);
    // A lost response can safely be retried after the first transaction committed.
    if(p.result.counts.duplicate===p.result.rows.length)return {...p.result,imported:[] as string[]};
    if(p.result.preview!==preview)throw new Error('Import preview is stale or missing; run dry-run again');
    if(p.result.counts.conflict||p.result.counts.unsupported)throw new Error('Resolve conflicts and unsupported tasks before importing; no tasks were written');
    const now=Date.now(),imported:string[]=[];
    for(const c of p.candidates){
      const task:Task={...c.input,id:randomUUID(),revision:1,anchor:now,next:null,created:now,updated:now,origin:c.origin};
      store.put(task);store.db.query('INSERT INTO task_imports VALUES(?,?,?)').run(c.key,c.fingerprint,task.id);imported.push(task.id);
    }
    return {...p.result,imported};
  })();
}
