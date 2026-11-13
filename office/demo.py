"""Generate a new review bundle from synthetic, explicitly labeled data. Offline."""
import json
from pathlib import Path
import sys
from office_engine.html import render_html
from office_engine.excel import generate_workbook, inspect_workbook

if len(sys.argv)!=2: raise SystemExit('Usage: office/.venv/bin/python office/demo.py NEW_DIRECTORY')
out=Path(sys.argv[1]); out.mkdir(parents=False,exist_ok=False)
examples=Path(__file__).parent/'examples'
reports={}
for path in sorted(examples.glob('*.json')):
    reports[path.stem]=render_html(json.loads(path.read_text()),out/(path.stem+'.html'))
chart={'type':'bar','title':'示例：季度收入（万元）','unit':'万元','categories':['Q1','Q2','Q3','Q4'],'series':[{'name':'2026示例数据','values':[120,155,143,190]}]}
spec={'sheets':[{'name':'预算示例','rows':[['季度','预算','实际','差额'],['Q1',130,120,{'formula':'=C2-B2','cached':-10}],['Q2',150,155,{'formula':'=C3-B3','cached':5}],['Q3',160,143,{'formula':'=C4-B4','cached':-17}],['Q4',180,190,{'formula':'=C5-B5','cached':10}]],'freeze':[1,1],'autofilter':True}], 'charts':[chart]}
reports['workbook']=generate_workbook(spec,out/'quarterly-example.xlsx')
reports['workbook_inspection']=inspect_workbook(out/'quarterly-example.xlsx')
reports['shared_chart_html']=render_html({'version':1,'scenario':'dashboard','title':'双端一致性示例','subtitle':'全部为合成示例数据，不是公司经营数据。','sections':[{'type':'chart','title':chart['title'],'chart':chart}]},out/'shared-chart.html')
(out/'manifest.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(out.resolve())
