import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {executeHtmlValidation,validateHtmlPaths} from './validate';

// The installer embeds this adapter by absolute URL. No credentials/model changes.
const engine = fileURLToPath(new URL('../../office/', import.meta.url));
const localPython = join(engine, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function workerEnvironment(): NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={PYTHONPATH:engine,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1'};
  for(const key of ['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL'])if(process.env[key]!==undefined)env[key]=process.env[key];
  return env;
}
export async function executeOffice(root: string, request: unknown, signal?: AbortSignal): Promise<string> {
  if(signal?.aborted) throw new Error('Office operation cancelled before execution');
  const encoded = JSON.stringify(request);
  if (Buffer.byteLength(encoded) > 1_048_576) throw new Error('Office request exceeds 1 MiB');
  const python = process.env.OPENCODE_OFFICE_PYTHON || localPython;
  if (!existsSync(python)) throw new Error('Office Python environment missing. Follow docs/OFFICE.md offline setup.');
  return await new Promise((accept, reject) => {
    const child = spawn(python, ['-m', 'office_engine', '--root', realpathSync(root)], {
      cwd: engine, shell: false, env: workerEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '', settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort',cancel); if(error) reject(error); else accept(out); };
    const cancel = () => { child.kill('SIGKILL'); finish(new Error('Office operation cancelled; inspect output before retry')); };
    signal?.addEventListener('abort',cancel,{once:true});
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Office execution exceeded 120 seconds; check output before retry')); }, 120_000);
    child.stdout.on('data', bytes => { out += bytes; if(Buffer.byteLength(out) > 8_388_608) {child.kill('SIGKILL');finish(new Error('Office report exceeds 8 MiB'));} });
    child.stderr.on('data', bytes => { if(err.length < 2048) err += bytes; });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if(code !== 0) { finish(new Error(out || `Office engine failed (${code}): ${err}`)); return; }
      try { const result = JSON.parse(out); if(result.ok !== true) throw new Error('Invalid office result'); finish(); } catch { finish(new Error('Invalid office engine response')); }
    });
    child.stdin.on('error', () => {});
    if(signal?.aborted) cancel();
    else child.stdin.end(encoded);
  });
}
export const OfficeArtifacts: Plugin = async ctx => ({tool: {
  office_design_reference: tool({description:'Search pinned local design references for composition, typography, color, charts or usability. No network, font downloads or file writes. Results are suggestions with provenance, never an aesthetic score.',args:{query:tool.schema.string().min(1).max(256),domain:tool.schema.enum(['style','color','chart','typography','landing','product','ux','web']),limit:tool.schema.number().int().min(1).max(5).default(3)},execute:async(args,context)=>executeOffice(ctx.directory,{operation:'design_reference',query:args.query,domain:args.domain,limit:args.limit},context.abort)}),
  office_validate_html: tool({description:'Validate project HTML in fresh offline Chromium contexts. Static mode disables page JavaScript; opt-in first-party-table permits only the pinned local table runtime after strict preflight and external CSP enforcement. Arbitrary scripts unsupported. NEW evidence directory; not an OS sandbox or aesthetic acceptance.',args:{input:tool.schema.string().max(4096),output:tool.schema.string().max(4096).describe('New project-relative evidence directory; parent must exist'),mode:tool.schema.enum(['static','first-party-table']).default('static')},execute:async(args,context)=>{validateHtmlPaths(ctx.directory,args.input,args.output);await context.ask({permission:'read',patterns:[args.input],always:[],metadata:{operation:'office_validate_html'}});if(context.abort.aborted)return JSON.stringify({ok:false,status:'cancelled',error:'Cancelled before output approval'});await context.ask({permission:'edit',patterns:[args.output+'/**'],always:[],metadata:{operation:'office_validate_html'}});return executeHtmlValidation(ctx.directory,args.input,args.output,context.abort,args.mode);}}),
  office_capabilities: tool({description:'Read the local versioned office protocol, supported fields and complete runnable examples BEFORE generating specs. No project files or network access.',args:{topic:tool.schema.enum(['overview','inspect','excel','html','design']).default('overview'),example:tool.schema.enum(['dashboard','research','project','comparison','operations']).optional()},execute:async args=>{const protocol=JSON.parse(readFileSync(join(engine,'capabilities.json'),'utf8'));const result:any=args.topic==='overview'?protocol:{protocol_version:protocol.protocol_version,[args.topic]:protocol[args.topic],shared_chart:protocol.shared_chart,outputs:protocol.outputs};if(args.example)result.example=JSON.parse(readFileSync(join(engine,'examples',args.example+'.json'),'utf8'));return JSON.stringify(result);}}),
  office_inspect_excel: tool({description: 'Read-only local workbook analysis with charts, formulas, cached values and feature risk inventory. Never executes macros or recalculates formulas.', args: {input: tool.schema.string(), options: tool.schema.string().optional().describe('Optional bounded inspection options as JSON')}, execute: async (args, context) => { await context.ask({permission:'read',patterns:[args.input],always:[],metadata:{operation:'office_inspect_excel'}}); if(context.abort.aborted)throw new Error('Office operation cancelled'); return executeOffice(ctx.directory, {operation: 'inspect_excel', input: args.input, options: args.options ? JSON.parse(args.options) : undefined}, context.abort); }}),
  office_generate_excel: tool({description: 'Generate a NEW local XLSX from validated JSON: multiple sheets, native charts, formulas and styles. Never overwrites. Formula cache is not a calculation engine.', args: {spec: tool.schema.string().max(1_000_000), output: tool.schema.string()}, execute: async (args, context) => { await context.ask({permission:'edit',patterns:[args.output],always:[],metadata:{operation:'office_generate_excel'}}); if(context.abort.aborted)throw new Error('Office operation cancelled'); return executeOffice(ctx.directory, {operation: 'generate_excel', spec: JSON.parse(args.spec), output: args.output}, context.abort); }}),
  office_render_html: tool({description: 'Render a NEW self-contained offline HTML report using scenario layouts, structured sections and SVG charts. No PPT conversion or external requests.', args: {spec: tool.schema.string().max(1_000_000), output: tool.schema.string()}, execute: async (args, context) => { await context.ask({permission:'edit',patterns:[args.output],always:[],metadata:{operation:'office_render_html'}}); if(context.abort.aborted)throw new Error('Office operation cancelled'); return executeOffice(ctx.directory, {operation: 'render_html', spec: JSON.parse(args.spec), output: args.output}, context.abort); }}),
}});
