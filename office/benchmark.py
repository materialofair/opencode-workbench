"""Bounded synthetic XLSX inspection benchmark; not production certification.
Run: office/.venv/bin/python office/benchmark.py --output office/evidence/benchmark
Each measurement runs in a fresh subprocess with a 45-second timeout.
"""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from pathlib import Path


def worker(path):
    import resource
    from office_engine.excel import inspect_workbook
    start=time.perf_counter()
    report=inspect_workbook(path,{'max_rows':100,'max_cols':10,'max_cells':1000})
    elapsed=time.perf_counter()-start
    rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_bytes=rss if sys.platform=='darwin' else rss*1024
    return {'inspect_seconds':round(elapsed,4),'process_peak_rss_bytes':rss_bytes,'sampled_cells':report['sampled_cells'],'charts':len(report['charts']),'source_sha256':report['source_sha256']}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--worker'); parser.add_argument('--output',default='office/evidence/benchmark'); args=parser.parse_args()
    if args.worker:
        print(json.dumps(worker(args.worker))); return
    import xlsxwriter
    out=Path(args.output).resolve(); out.mkdir(parents=True,exist_ok=True)
    results=[]
    for cells in (1000,10000,100000):
        path=out/f'numeric-formula-{cells}.xlsx'; wb=xlsxwriter.Workbook(path); ws=wb.add_worksheet('Benchmark'); rows=cells//10
        for r in range(rows):
            for c in range(10):
                value=(r+1)*(c+1)
                if c==9 and r%2==0: ws.write_formula(r,c,f'=A{r+1}*10',None,value)
                else: ws.write_number(r,c,value)
        chart=wb.add_chart({'type':'line'}); chart.add_series({'name':'Synthetic values','categories':['Benchmark',0,0,min(rows-1,99),0],'values':['Benchmark',0,1,min(rows-1,99),1]}); ws.insert_chart('L2',chart); wb.close()
        start=time.perf_counter()
        try:
            proc=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--worker',str(path)],capture_output=True,text=True,timeout=45,check=False)
            result=json.loads(proc.stdout) if proc.returncode==0 else {'error':proc.stderr[-2000:],'returncode':proc.returncode}
        except subprocess.TimeoutExpired: result={'error':'timeout','timeout_seconds':45}
        result.update({'stored_cells':cells,'rows':rows,'columns':10,'fixture_bytes':path.stat().st_size,'subprocess_wall_seconds':round(time.perf_counter()-start,4)}); results.append(result)
    report={'platform':platform.platform(),'machine':platform.machine(),'python':sys.version.split()[0],'executable':sys.executable,'engine_sha256':hashlib.sha256((Path(__file__).parent/'office_engine/excel.py').read_bytes()).hexdigest(),'producer':{'library':'XlsxWriter','version':xlsxwriter.__version__},'method':'One fresh process per size; dense numeric cells with 5% cached SUM-free formulas, one 100-point line chart; read-only inspect with 1000-cell output window. Peak RSS includes Python/imports; elapsed inspect excludes import. One run per size, no statistical confidence or production representative claim. Timeout 45 seconds per measurement. No network.','results':results}
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n'); print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
