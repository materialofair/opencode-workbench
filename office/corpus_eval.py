"""Evaluate a local, explicitly licensed public OOXML corpus. No downloads/network.
Every file is inspected in a fresh subprocess with a 30-second timeout.
Comparison uses raw OOXML chart/array-formula metadata and separate openpyxl loading.
This is not Excel calculation, visual fidelity, GLM or enterprise deployment validation.
"""
import argparse
import hashlib
import json
import posixpath
import subprocess
import sys
import time
from pathlib import Path


def evaluate(path):
    import warnings
    import zipfile
    from defusedxml import ElementTree as ET
    import openpyxl
    from office_engine.excel import inspect_workbook
    ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart','s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        start=time.perf_counter(); report=inspect_workbook(path); elapsed=time.perf_counter()-start
        oracle=openpyxl.load_workbook(path,data_only=False,keep_links=False)
        sheet_compare={'source':oracle.sheetnames,'reported':report['available_sheets'],'equal':oracle.sheetnames==report['available_sheets']}
        chart_counts={ws.title:len(ws._charts) for ws in oracle._sheets}
        source_point_checks=0; source_point_gaps=[]
        for chart in report['charts']:
            roles=[chart.get('title_data')]
            for plot in chart['plots']:
                for series in plot['series']: roles.extend(series.get(key) for key in ('name','categories','values','x_values','y_values','bubble_size'))
            for role in roles:
                if not role: continue
                for source in role.get('sources',[]):
                    if source.get('status')!='local_range': continue
                    if source.get('read_options',{}).get('expected_source_sha256')!=report['source_sha256']: source_point_gaps.append({'kind':'source_read_request_missing_snapshot_binding','reference':source['reference']})
                    for point in source.get('points',[]):
                        cell=oracle[source['sheet']][point['cell']]
                        if cell.data_type=='f': continue  # No independent calculation oracle is available.
                        value=cell.value
                        if hasattr(value,'isoformat'): value=value.isoformat()
                        elif value is not None and not isinstance(value,(str,int,float,bool)): value=str(value)
                        if point.get('text_truncated') and isinstance(value,str): value=value[:1000]
                        source_point_checks+=1
                        if point['value']!=value: source_point_gaps.append({'kind':'chart_source_point_difference','sheet':source['sheet'],'cell':point['cell'],'reported':point['value'],'openpyxl':value})
        oracle.close()
    gaps=list(source_point_gaps); source_charts={}; source_arrays=[]; chart_sheets=[]
    with zipfile.ZipFile(path) as z:
        relationships={r.get('Id'):posixpath.normpath(r.get('Target').lstrip('/') if r.get('Target','').startswith('/') else posixpath.join('xl',r.get('Target',''))) for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')) if r.get('TargetMode')!='External'}
        workbook=ET.fromstring(z.read('xl/workbook.xml'))
        part_sheets={relationships.get(sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')):sh.get('name') for sh in workbook.findall('s:sheets/s:sheet',ns)}
        for name in z.namelist():
            if not name.endswith('.xml'): continue
            root=ET.fromstring(z.read(name)); local=root.tag.split('}')[-1]
            if local=='chartSpace':
                source_charts[name]={'types':[n.tag.split('}')[-1] for n in root.findall('.//c:plotArea/*',ns) if n.tag.split('}')[-1].endswith('Chart')],'series_references':[n.text for n in root.findall('.//c:ser//c:f',ns)]}
            if local=='chartsheet': chart_sheets.append(name)
            if local=='worksheet':
                for cell in root.findall('.//s:c',ns):
                    f=cell.find('s:f',ns)
                    if f is not None and f.get('t')=='array': source_arrays.append({'part':name,'sheet':part_sheets.get(name),'cell':cell.get('r'),'formula':f.text,'range':f.get('ref')})
    reported={c['part']:c for c in report['charts']}
    for part,original in source_charts.items():
        if part not in reported: gaps.append({'kind':'missing_chart','part':part}); continue
        actual=reported[part]; refs=[r for plot in actual['plots'] for ser in plot['series'] for r in ser['references']]
        if sorted(refs)!=sorted(original['series_references']): gaps.append({'kind':'series_reference_difference','part':part,'source_count':len(original['series_references']),'reported_count':len(refs)})
        if [p['type'] for p in actual['plots']]!=original['types']: gaps.append({'kind':'chart_type_difference','part':part})
    for name,count in chart_counts.items():
        linked=sum(name in c['sheets'] for c in report['charts'])
        if count!=linked: gaps.append({'kind':'chart_association_difference_vs_openpyxl','sheet':name,'openpyxl':count,'reported':linked})
    if chart_sheets and len(report['sheets'])<len(report['available_sheets']): gaps.append({'kind':'chartsheet_missing_from_sheet_records','chartsheet_parts':chart_sheets,'available_count':len(report['available_sheets']),'sheet_record_count':len(report['sheets'])})
    sample_formulas=[{**f,'sheet':s['name']} for s in report['sheets'] for f in s['formulas']]
    for formula in source_arrays:
        candidates=[f for f in sample_formulas if f['cell']==formula['cell'] and f['sheet']==formula['sheet']]
        for candidate in candidates:
            if candidate.get('formula')!='='+str(formula['formula']) or candidate.get('formula_type')!='array' or candidate.get('formula_metadata',{}).get('ref')!=formula['range']: gaps.append({'kind':'array_formula_expression_or_range_difference','source':formula,'reported':candidate})
    warning_messages=list(dict.fromkeys(str(w.message) for w in caught))
    for message in warning_messages:
        if 'not supported' in message and not any(message==w.get('message') for w in report.get('library_warnings',[])): gaps.append({'kind':'unreported_unsupported_feature_warning','message':message})
    assertions=[]
    if Path(path).name=='WithThreeCharts.xlsx':
        counts=[len(s['chart_parts']) for s in report['sheets']]
        titles=sorted(c['title'] for c in report['charts'])
        assertions=[{'source':'Apache POI TestXSSFChart.testGetCharts at pinned commit','assertion':'sheet chart distribution is [0,2,1]','passed':counts==[0,2,1],'actual':counts},{'source':'Apache POI TestXSSFChart.testGetCharts at pinned commit','assertion':'three titles are empty, Pie Chart Title Thingy, Sheet 3 Chart with Title','passed':titles==sorted(['','Pie Chart Title Thingy','Sheet 3 Chart with Title']),'actual':titles}]
    return {'file':Path(path).name,'status':'gap' if gaps or any(not a['passed'] for a in assertions) else 'passed_comparisons','inspect_seconds':round(elapsed,4),'sheet_comparison':sheet_compare,'chart_counts_openpyxl':chart_counts,'independent_chart_source_points_compared':source_point_checks,'raw_chart_count':len(source_charts),'reported_chart_count':len(reported),'array_formulas_source':source_arrays,'gaps':gaps,'upstream_assertions':assertions,'library_warnings':list(dict.fromkeys(str(w.message) for w in caught)),'engine_report':report}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--worker');parser.add_argument('--corpus',default='office/evidence/public-corpus');args=parser.parse_args()
    if args.worker:
        try: result=evaluate(args.worker)
        except Exception as error: result={'file':Path(args.worker).name,'status':'error','error_type':type(error).__name__,'error':str(error)}
        print(json.dumps(result,ensure_ascii=False));return
    root=Path(args.corpus); manifest=json.loads((root/'manifest.json').read_text());results=[]
    for item in manifest['files']:
        path=root/item['name']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']: raise ValueError('Fixture hash changed: '+item['name'])
        try:
            proc=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--worker',str(path.resolve())],capture_output=True,text=True,timeout=30)
            result=json.loads(proc.stdout) if proc.returncode==0 else {'file':item['name'],'status':'worker_error','error':proc.stderr[-2000:]}
        except subprocess.TimeoutExpired: result={'file':item['name'],'status':'timeout','timeout_seconds':30}
        (root/(item['name']+'.evaluation.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        result.pop('engine_report',None);results.append(result);print(item['name'],result['status'],result.get('gaps',result.get('error','')),flush=True)
    report={'commit':manifest['commit'],'source':'Externally maintained Apache POI public regression fixtures, not our synthetic workbooks or user enterprise data','engine_sha256':hashlib.sha256((Path(__file__).parent/'office_engine/excel.py').read_bytes()).hexdigest(),'comparison_limits':'Raw XML metadata plus a separately loaded openpyxl workbook are structural cross-checks, not independent Excel calculation or rendered visual validation. Missing/unsupported metadata is reported; no macros, formulas, external links or network fetches are executed.','results':results}
    (root/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
