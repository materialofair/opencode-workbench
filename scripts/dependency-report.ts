import {readFileSync,writeFileSync} from 'node:fs';
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const packages=Object.entries(lock.packages).filter(([path])=>path).map(([path,p]:[string,any])=>{
  const name=path.split('node_modules/').at(-1)!;
  // These platform-specific development binaries omit license metadata from
  // the npm lock. A pointer is deliberately not an assertion of an SPDX license.
  const license=p.license??(/^opencode-(?:darwin|linux|windows)-/.test(name)?'see package LICENSE':'UNKNOWN');
  return {package:name,version:p.version,license,dev:!!p.dev,optional:!!p.optional};
}).sort((a,b)=>a.package.localeCompare(b.package)||a.version.localeCompare(b.version));
writeFileSync('docs/DEPENDENCIES.json',JSON.stringify({source:'package-lock.json',packages},null,2)+'\n');
console.log(`Recorded ${packages.length} locked dependency licenses.`);
