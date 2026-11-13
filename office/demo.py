"""Generate a new review bundle from synthetic, explicitly labeled data. Offline."""
import json
import html
import hashlib
from pathlib import Path
import sys
from office_engine.html import render_html
from office_engine.excel import generate_workbook, inspect_workbook

if len(sys.argv)!=2: raise SystemExit('Usage: office/.venv/bin/python office/demo.py NEW_DIRECTORY')
out=Path(sys.argv[1]); out.mkdir(parents=False,exist_ok=False)
examples=Path(__file__).parent/'examples'
reports={}
links=[]
for path in sorted(examples.glob('*.json')):
    example=json.loads(path.read_text())
    reports[path.stem]=render_html(example,out/(path.stem+'.html'))
    links.append((path.stem+'.html',example['title'],example.get('subtitle',''),example.get('interaction','static')))
chart={'type':'bar','title':'示例：季度收入（万元）','unit':'万元','categories':['Q1','Q2','Q3','Q4'],'series':[{'name':'2026示例数据','values':[120,155,143,190]}]}
spec={'sheets':[{'name':'预算示例','rows':[['季度','预算','实际','差额'],['Q1',130,120,{'formula':'=C2-B2','cached':-10}],['Q2',150,155,{'formula':'=C3-B3','cached':5}],['Q3',160,143,{'formula':'=C4-B4','cached':-17}],['Q4',180,190,{'formula':'=C5-B5','cached':10}]],'freeze':[1,1],'autofilter':True}], 'charts':[chart]}
reports['workbook']=generate_workbook(spec,out/'quarterly-example.xlsx')
reports['workbook_inspection']=inspect_workbook(out/'quarterly-example.xlsx')
reports['shared_chart_html']=render_html({'version':1,'scenario':'dashboard','title':'双端一致性示例','subtitle':'全部为合成示例数据，不是公司经营数据。','sections':[{'type':'chart','title':chart['title'],'chart':chart}]},out/'shared-chart.html')
def title_markup(title):
    for separator in ('：', '，'):
        if separator in title:
            topic, detail = title.split(separator, 1)
            return '<span class="title-topic">' + html.escape(topic + separator) + '</span><span class="title-detail">' + html.escape(detail) + '</span>'
    return html.escape(title)

navigation=''.join('<li><a href="'+html.escape(name,quote=True)+'"><span class="number">'+str(index).zfill(2)+'</span><span><strong>'+title_markup(title)+'</strong><small>'+html.escape(subtitle)+'</small></span><span class="mode">'+('表格交互' if mode=='first-party-table' else '静态报告')+' ↗</span></a></li>' for index,(name,title,subtitle,mode) in enumerate(links,1))
index_html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'"><title>办公产物预览</title><style>body{margin:0;background:#f2f3ee;color:#17332f;font:16px/1.6 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1040px;margin:auto;padding:48px 24px}header{border-bottom:3px solid #17332f;padding-bottom:30px}h1{font-size:clamp(32px,6vw,64px);line-height:1.12;margin:16px 0}header p{max-width:64ch;color:#536761}ul{list-style:none;padding:0;margin:28px 0}li{border-bottom:1px solid #bac8c0}a{color:inherit;text-decoration:none}li a{display:grid;grid-template-columns:48px 1fr 110px;gap:20px;padding:24px 8px;align-items:start}li a:hover,li a:focus-visible{background:#e3e9e2;outline:2px solid #316f5a;outline-offset:2px}strong{font-size:21px;line-height:1.4;display:block;overflow-wrap:anywhere;text-wrap:balance}small{display:block;color:#536761;margin-top:8px;overflow-wrap:anywhere}.number,.mode{font-size:12px;color:#536761}.resources{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px}.resources a{border:1px solid #748c7d;padding:10px 16px}.note{font-size:13px;color:#536761;margin-top:30px}@media(max-width:600px){main{padding:28px 18px}li a{grid-template-columns:28px 1fr;gap:12px}.mode{grid-column:2}.title-topic,.title-detail{display:block}}@media print{body{background:white}main{padding:0}li{break-inside:avoid}a{color:black}}</style></head><body><main><header><span>OFFICE / 本地示例导航</span><h1>先选阅读任务，<br>再看交付形式。</h1><p>这些页面与工作簿全部使用明确标注的合成数据。点击查看不同场景；表格交互版支持本地搜索与排序，不连接任何服务。</p></header><ul>'+navigation+'</ul><div class="resources"><a href="quarterly-example.xlsx">原生图表 Excel ↗</a><a href="shared-chart.html">Excel / HTML 同源图表 ↗</a><a href="manifest.json">生成与来源记录 ↗</a></div><p class="note">浏览器检查、视觉复核、业务正确性分别验收。示例不是公司数据，不代表内网 GLM 或任意复杂文件已经通过验收。</p></main></body></html>'
(out/'index.html').write_text(index_html,encoding='utf-8')
reports['preview_index']={'path':'index.html','sha256':hashlib.sha256(index_html.encode()).hexdigest(),'purpose':'Local navigation, not a validation verdict'}
(out/'manifest.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(out.resolve())
