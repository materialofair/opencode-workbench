"""Rehearse an exact committed source snapshot with LOCAL npm cache and wheels.
No downloads, global installs, user configuration changes, or existing directory reuse.
Requires pre-provisioned compatible Node, npm, Bun, Python, Git and Chromium for optional QA.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tarfile
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,help='New directory; must not exist')
    parser.add_argument('--npm-cache',required=True,help='Already populated local npm cache')
    parser.add_argument('--wheelhouse',required=True,help='Already populated local wheel directory')
    parser.add_argument('--ref',default='HEAD',help='Exact committed revision; uncommitted edits are intentionally excluded')
    parser.add_argument('--browser-qa',action='store_true',help='Use pre-provisioned matching Chromium; never install it')
    args=parser.parse_args(); source=Path(__file__).resolve().parent.parent
    cache=Path(args.npm_cache).resolve(strict=True); wheels=Path(args.wheelhouse).resolve(strict=True)
    if not cache.is_dir() or not wheels.is_dir(): raise ValueError('Cache and wheelhouse must be existing directories')
    revision=subprocess.check_output(['git','rev-parse','--verify',args.ref+'^{commit}'],cwd=source,text=True).strip()
    node=subprocess.check_output(['node','-p','process.versions.node'],text=True).strip(); version=tuple(int(x) for x in node.split('.'))
    if not ((version[0]==22 and version>=(22,22,2)) or (version[0]==24 and version>=(24,15,0)) or version[0]>=26): raise ValueError('Pre-provision Node 22.22.2+, 24.15.0+, or 26+. No runtime will be downloaded.')
    out=Path(args.output).resolve(); out.mkdir(parents=False,exist_ok=False); repo=out/'repo';repo.mkdir()
    report={'source_commit':revision,'node':node,'npm_mode':'--offline --ignore-scripts','pip_mode':'--no-index --require-hashes','preprovisioned_host_tools':True,'uncommitted_edits_included':False,'stages':[],'success':False,'scope':'Developer offline package-manager rehearsal; not target intranet or network-isolation certification'}
    # Fresh config/home: never consume the user's npm/pip credentials or configuration.
    home=out/'isolated-home';home.mkdir()
    config=out/'empty-npmrc';config.write_text('');config.chmod(0o600)
    env={key:os.environ[key] for key in ('PATH','TMPDIR','TEMP','TMP','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL') if key in os.environ}
    env.update(HOME=str(home),USERPROFILE=str(home),XDG_CONFIG_HOME=str(home/'config'),XDG_DATA_HOME=str(home/'data'),XDG_CACHE_HOME=str(home/'cache'),XDG_STATE_HOME=str(home/'state'),APPDATA=str(home/'appdata'),LOCALAPPDATA=str(home/'localappdata'),NPM_CONFIG_USERCONFIG=str(config),NPM_CONFIG_GLOBALCONFIG=str(config),PIP_CONFIG_FILE=os.devnull,PIP_NO_INDEX='1',PIP_DISABLE_PIP_VERSION_CHECK='1',npm_config_offline='true',PYTHONDONTWRITEBYTECODE='1')
    if args.browser_qa:
        default_browser=(Path.home()/'Library/Caches/ms-playwright') if sys.platform=='darwin' else (Path(os.environ.get('LOCALAPPDATA',''))/'ms-playwright') if os.name=='nt' else Path(os.environ.get('XDG_CACHE_HOME',str(Path.home()/'.cache')))/'ms-playwright'
        browsers=Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH',str(default_browser))).resolve()
        if browsers.is_dir(): env['PLAYWRIGHT_BROWSERS_PATH']=str(browsers)
    report['isolated_config_home']=True
    def run(name,command,cwd=repo):
        start=time.monotonic(); path=out/(name+'.log')
        with path.open('w',encoding='utf-8') as log:
            result=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180,check=False)
        report['stages'].append({'name':name,'returncode':result.returncode,'seconds':round(time.monotonic()-start,3),'log':path.name})
        if result.returncode: raise RuntimeError('Stage failed: '+name+'; inspect local log')
    try:
        archive=out/'source.tar';subprocess.run(['git','archive','--format=tar','--output',str(archive),revision],cwd=source,check=True)
        report['archive_sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                target=(repo/member.name).resolve()
                if not target.is_relative_to(repo) or member.issym() or member.islnk() or not (member.isfile() or member.isdir()): raise ValueError('Source archive contains an unsupported path or member')
            for member in tar.getmembers():
                target=repo/member.name
                if member.isdir(): target.mkdir(parents=True,exist_ok=True)
                else:
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with tar.extractfile(member) as src, target.open('xb') as dst: shutil.copyfileobj(src,dst)
                    target.chmod(member.mode & 0o777)
        run('npm-offline',['npm','ci','--offline','--ignore-scripts','--cache',str(cache)])
        run('python-environment',[sys.executable,'-m','venv','office/.venv'])
        python=repo/'office/.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        run('python-offline',[str(python),'-m','pip','install','--no-index','--find-links',str(wheels),'--require-hashes','-r','office/requirements-offline.lock'])
        run('build',['bun','scripts/build-office.ts'])
        run('typecheck',['bun','run','typecheck'])
        env['PYTHONPATH']=str(repo/'office')
        run('python-tests',[str(python),'-m','unittest','discover','-s','office/tests','-v'])
        run('tool-tests',['bun','test','./tests/office.test.ts'])
        trial=out/'trial-project';trial.mkdir()
        run('install-preview',['bun','scripts/install-office.ts','--project',str(trial)])
        if list(trial.iterdir()): raise RuntimeError('Installer preview unexpectedly wrote files')
        run('install-apply',['bun','scripts/install-office.ts','--project',str(trial),'--apply'])
        run('examples',[str(python),'office/demo.py',str(out/'examples')])
        if args.browser_qa:
            run('browser-qa',['node','office/qa-html.mjs',str(out/'examples/dashboard.html'),str(out/'browser-qa')])
        report['success']=True
    except Exception as error:
        report['error']=str(error);raise
    finally:
        (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
