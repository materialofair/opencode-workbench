// Test-only loader: delegate to the actual published entry and diagnose skipped
// ownership/configuration without printing paths or any credential values.
import type {Plugin} from '@opencode-ai/plugin';
import {existsSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {directoryKey,expandOwnerDirectory} from '../../src/platform';
export const BrowserFixture:Plugin=async ctx=>{
 const marker=process.env.WORKBENCH_BROWSER_FIXTURE_LOAD_MARKER;if(marker)writeFileSync(marker,JSON.stringify({entered:true}));
 const file=process.env.OPENCODE_WORKBENCH_BROWSER_CONFIG,entry=process.env.WORKBENCH_BROWSER_FIXTURE_ENTRY;
 if(!file||!entry||!existsSync(file))throw new Error('Isolated browser fixture environment/configuration missing');
 const raw=JSON.parse(readFileSync(file,'utf8')),owner=realpathSync(expandOwnerDirectory(raw.directory)),actual=realpathSync(ctx.directory);
 const a=statSync(owner,{bigint:true}),b=statSync(actual,{bigint:true});
 const module=await import(entry);const exported=Object.keys(module).sort();
 if(JSON.stringify(exported)!==JSON.stringify(['BrowserTools']))throw new Error('Unexpected published browser plugin exports: '+JSON.stringify(exported));
 const hooks=await module.BrowserTools(ctx);
 if(marker)writeFileSync(marker,JSON.stringify({entered:true,imported:true,toolRegistered:!!hooks.tool?.workbench_browser,ownerKeysEqual:directoryKey(owner)===directoryKey(actual),ownerPhysicalEqual:a.dev===b.dev&&a.ino===b.ino}));
 if(!hooks.tool?.workbench_browser)throw new Error('Published browser plugin skipped: '+JSON.stringify({platform:process.platform,enabled:raw.enabled===true,configExists:true,ownerKeysEqual:directoryKey(owner)===directoryKey(actual),ownerPhysicalEqual:a.dev===b.dev&&a.ino===b.ino,ownerHasFileIdentity:a.ino!==0n&&b.ino!==0n}));
 return hooks;
};
