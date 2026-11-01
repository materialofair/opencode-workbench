import {readFileSync,mkdirSync,writeFileSync,copyFileSync,cpSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export function applyPatch(source:string,patch:string) {
  const original=source.split('\n'),out:string[]=[];let cursor=0;
  const lines=patch.split('\n');
  for(let i=0;i<lines.length;i++) {
    const h=lines[i].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);if(!h)continue;
    const start=Number(h[1])-1;if(start<cursor)throw new Error('Overlapping patch hunk');out.push(...original.slice(cursor,start));cursor=start;
    for(i++;i<lines.length&&!lines[i].startsWith('@@ ');i++) {
      const line=lines[i];if(!line || line.startsWith('\\'))continue;
      if(line[0]===' '||line[0]==='-') {if(original[cursor]!==line.slice(1))throw new Error(`Patch source mismatch at line ${cursor+1}`);cursor++;}
      if(line[0]===' '||line[0]==='+')out.push(line.slice(1));
    }
    i--;
  }
  out.push(...original.slice(cursor));return out.join('\n')+'\n';
}
export function applyQuotePatch(source:string){
  let result=source;
  // Patch only the pinned quote path; keep direct-parent identity and chat scope.
  const start=result.indexOf('async function fetchQuotedMessage('),end=result.indexOf('// src/feishu/markdown.ts',start);
  if(start<0||end<0)throw new Error('Quote patch source changed');
  result=result.slice(0,start)+result.slice(end);
  const oldQuote='const quoted = await fetchQuotedMessage(feishuClient, parentId, log);';
  if(!result.includes(oldQuote))throw new Error('Quote caller changed');
  result=result.replace(oldQuote,'const quoted = workbenchQuotePrefix(await workbenchResolveQuote(feishuClient, parentId, { currentMessageID: messageId, chatID: workbenchQuoteChats.get(messageId), cache: workbenchQuoteCache }));');
  const prefixStart=result.indexOf('      quotePrefix = `',result.indexOf('async function buildPromptParts('));
  const prefixEnd=result.indexOf('`;',prefixStart);
  if(prefixStart<0||prefixEnd<0)throw new Error('Quote prefix changed');
  result=result.slice(0,prefixStart)+'      quotePrefix = quoted;'+result.slice(prefixEnd+2);
  const gate='const chatId = message.chat_id;\n        if (!chatId) return;';
  if(!result.includes(gate)||!result.includes('  initDedup(resolvedConfig.dedupTtl);')||!result.includes('      this.continuationMessageIds.push(sent.messageId);'))throw new Error('Quote integration source changed');
  result=result.replace(gate,gate+'\n        workbenchQuoteChats.set(message.message_id, String(chatId)); if (workbenchQuoteChats.size > 200) workbenchQuoteChats.delete(workbenchQuoteChats.keys().next().value);');
  result=result.replace('  initDedup(resolvedConfig.dedupTtl);','  try { workbenchQuoteCache = new WorkbenchQuoteCache(ctx.directory); } catch { log("warn", "Quote receipt storage unavailable; direct REST reads remain enabled"); }\n  initDedup(resolvedConfig.dedupTtl);');
  result=result.replace('    for (let i = 1; i < finalPages.length; i++) {','    try { workbenchQuoteCache?.remember(this.messageId, this.chatId, this.replyText); } catch { this.log("warn", "Quote receipt storage unavailable"); }\n    for (let i = 1; i < finalPages.length; i++) {');
  result=result.replace('      this.continuationMessageIds.push(sent.messageId);','      this.continuationMessageIds.push(sent.messageId);\n      try { workbenchQuoteCache?.remember(sent.messageId, this.chatId, finalPages[i].text); } catch { this.log("warn", "Quote receipt storage unavailable"); }');
  result='import { QuoteCache as WorkbenchQuoteCache, resolveQuote as workbenchResolveQuote, quotePrefix as workbenchQuotePrefix } from "./quote.mjs";\nlet workbenchQuoteCache; const workbenchQuoteChats = new Map();\n'+result;
  return result;
}
export function prepare() {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const upstream=dirname(fileURLToPath(import.meta.resolve('opencode-feishu')));
  const source=readFileSync(join(upstream,'index.js'),'utf8');
  const p=JSON.parse(readFileSync(join(root,'third-party/opencode-feishu/provenance.json'),'utf8'));
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  if(hash(source)!==p.upstreamBundleSha256)throw new Error('Upstream bundle hash mismatch; review version before adapting');
  const adapted=applyPatch(source,readFileSync(join(root,'adapters/feishu/desktop.patch'),'utf8'));
  if(hash(adapted)!==p.localAdaptedBundleSha256)throw new Error('Adapted bundle hash mismatch');
  // New project safeguards are separate from the preserved historical desktop diff.
  let result=adapted.replace('const configPath = join(homedir(), ".config", "opencode", "plugins", "feishu.json");','const configPath = process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG || join(homedir(), ".config", "opencode", "plugins", "feishu.json");');
  result=result.replace('  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;','  if (process.env.OPENCODE_WORKBENCH_FEISHU_TELEMETRY !== "1") return;\n  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;');
  // Keep the upstream/local historical hash chain intact; apply this new
  // Windows-only owner guard after verifying the preserved adaptation.
  result=result.replace('realpathSync(resolvedConfig.directory) !== realpathSync(ctx.directory)', '(process.platform === "win32" ? realpathSync(resolvedConfig.directory).toLowerCase() !== realpathSync(ctx.directory).toLowerCase() : realpathSync(resolvedConfig.directory) !== realpathSync(ctx.directory))');
  // New opt-in entry policy, after the historical hash chain. Existing deployed
  // adapters are never overwritten by this builder.
  result=result.replace('  directory: z.string().optional(),\n  model:', '  directory: z.string().optional(),\n  allowedSenderIDs: z.array(z.string().min(1)).min(1).max(200).optional(),\n  allowedChatIDs: z.array(z.string().min(1)).min(1).max(200).optional(),\n  model:');
  result=result.replace('const chatId = message.chat_id;\n        if (!chatId) return;', 'const chatId = message.chat_id;\n        if (!chatId) return;\n        if (!workbenchFeishuAllowed(config, String(data.sender?.sender_id?.open_id ?? ""), String(chatId))) return;');
  result=result.replace('const evt = data;\n        const action =', 'const evt = data;\n        if (!workbenchFeishuAllowed(config, String(evt.operator?.open_id ?? ""), String(evt.context?.open_chat_id ?? evt.open_chat_id ?? ""))) return { toast: { type: "warning", content: "Not authorized for this bot project" } };\n        const action =');
  result=result.replace('const chatId = data.chat_id;\n        if (chatId && onBotAdded)', 'const chatId = data.chat_id;\n        if (config.allowedChatIDs && !config.allowedChatIDs.includes(String(chatId))) return;\n        if (chatId && onBotAdded)');
  if(!result.includes('allowedSenderIDs: z.array')||!result.includes('workbenchFeishuAllowed(config, String(data.sender')||!result.includes('workbenchFeishuAllowed(config, String(evt.operator'))throw new Error('Feishu policy patch no longer matches the pinned source');
  result+='\nfunction workbenchFeishuAllowed(config, sender, chat) { return (!config.allowedSenderIDs || config.allowedSenderIDs.includes(sender)) && (!config.allowedChatIDs || config.allowedChatIDs.includes(chat)); }\n';
  const target=join(root,'.data','feishu');mkdirSync(join(target,'dist'),{recursive:true,mode:0o700});
  result=applyQuotePatch(result);
  // User parts must not latch the assistant ID. Tool turns create successive
  // assistant messages, so rotate the active ID from authoritative metadata.
  const eventCase='async function handleEvent(event, deps) {';
  if(!result.includes(eventCase))throw new Error('Event patch source changed');
  result=result.replace(eventCase,eventCase+'\n  const info = event.type === "message.updated" ? event.properties?.info : undefined;\n  if (info?.id && info.role) { workbenchMessageRoles.set(info.id, info.role); if (workbenchMessageRoles.size > 1000) workbenchMessageRoles.delete(workbenchMessageRoles.keys().next().value); const pending = pendingBySession.get(info.sessionID); if (pending && info.role === "assistant") pending.expectedMessageId = info.id; }');
  result=result.replace('async function handleMessagePartUpdated(_event, part, payload, log) {','async function handleMessagePartUpdated(_event, part, payload, log) {\n  if (workbenchMessageRoles.get(part.messageID) !== "assistant") return;');
  result='const workbenchMessageRoles = new Map(); const workbenchApprovalRequests = new Map();\n'+result;
  for(const [handler,kind] of [['handlePermissionRequested','permission_reply'],['handleQuestionRequested','question_reply']]) {
    const signature=`function ${handler}(request, chatId, deps, chatType, sessionId) {`;
    if(!result.includes(signature))throw new Error('Approval registration source changed');
    result=result.replace(signature,signature+`\n  workbenchApprovalRequests.set(String(request.id ?? ""), {kind:${JSON.stringify(kind)},chatID:chatId,sessionID:sessionId,at:Date.now(),used:false}); if(workbenchApprovalRequests.size>500)workbenchApprovalRequests.delete(workbenchApprovalRequests.keys().next().value);`);
  }
  const callback='  const value = parseCardActionValue(action.actionValue, deps.log);';
  const callbackStart=result.indexOf('async function handleCardAction('),callbackPosition=result.indexOf(callback,callbackStart);
  if(callbackPosition<0)throw new Error('Approval callback source changed');
  const scopeGuard=`
  if (value && ["permission_reply","question_reply","abort_reply"].includes(value.action)) {
    if (!action.chatId || getChatIdBySession(value.sessionId) !== action.chatId) return buildToast("warning", "This request belongs to another conversation");
    if (value.action !== "abort_reply") {
      const pending=workbenchApprovalRequests.get(value.requestId);
      if(!pending || pending.used || pending.kind!==value.action || pending.chatID!==action.chatId || pending.sessionID!==value.sessionId || Date.now()-pending.at>600000) return buildToast("warning", "This request is stale or does not belong to this conversation");
      pending.used=true;
    }
  }`;
  result=result.slice(0,callbackPosition)+result.slice(callbackPosition).replace(callback,callback+scopeGuard);
  execFileSync(process.execPath,['build',join(root,'adapters/feishu/quote.ts'),'--target=node','--outfile='+join(target,'dist','quote.mjs')],{stdio:'pipe'});
  writeFileSync(join(target,'dist','index.desktop.js'),result,{mode:0o600});
  copyFileSync(join(root,'adapters/feishu/compact-markdown.mjs'),join(target,'dist','compact-markdown.mjs'));
  cpSync(join(upstream,'..','prompts'),join(target,'prompts'),{recursive:true});
  console.log('Prepared pinned upstream Feishu adapter locally; no configuration read or gateway started.');
}
if(import.meta.main)prepare();
