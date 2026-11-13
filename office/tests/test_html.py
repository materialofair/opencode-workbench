import copy
import tempfile
import unittest
from pathlib import Path
from office_engine.html import render_html

class HtmlTests(unittest.TestCase):
    def spec(self):
        return {'version':1,'scenario':'dashboard','title':'季度经营报告','sections':[{'type':'chart','chart':{'type':'bar','title':'收入','categories':['一月','二月'],'series':[{'name':'实际','values':[30,-5]},{'name':'预算','values':[25,35]}]}}]}
    def render(self,spec):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'out.html'
            result=render_html(spec,p)
            return result,p.read_text()
    def test_all_scenarios(self):
        for scenario in ['dashboard','research','project','comparison','operations']:
            s=self.spec();s['scenario']=scenario
            result,html=self.render(s)
            self.assertEqual(result['scenario'],scenario)
            self.assertIn('Content-Security-Policy',html)
            self.assertIn('<svg',html)
            self.assertIn('Chart data',html)
            self.assertEqual(result['network_dependencies'],[])
    def test_escaping(self):
        s=self.spec();s['title']='</title><script>alert(1)</script>'
        s['sections'].append({'type':'text','body':'<img src=https://evil.test onerror=alert(1)>'})
        _,html=self.render(s)
        self.assertNotIn('<script>',html)
        self.assertNotIn('<img ',html)
        self.assertIn('&lt;script&gt;',html)
    def test_all_blocks(self):
        s=self.spec();s['sections'] += [{'type':'kpis','items':[{'label':'完成率','value':'95%'}]},{'type':'table','headers':['部门','金额'],'rows':[['研发',3]]},{'type':'timeline','items':[{'date':'11月','title':'交付'}]},{'type':'callout','body':'待审批'},{'type':'board','columns':[{'title':'进行中','items':[{'title':'需求复核','tag':'研发'}]}]}]
        _,html=self.render(s)
        self.assertIn('需求复核',html)
        self.assertIn('95%',html)
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'out.html';p.write_text('original')
            with self.assertRaises(FileExistsError):render_html(self.spec(),p)
            self.assertEqual(p.read_text(),'original')
    def test_validation(self):
        invalid=[]
        s=self.spec();s['sections'][0]['chart']['series'][0]['values']=[float('nan'),2];invalid.append(s)
        s=self.spec();s['sections'][0]['chart']['series'][0]['values']=[3];invalid.append(s)
        s=self.spec();s['scenario']='../../evil';invalid.append(s)
        s=self.spec();s['sections']=[{'type':'raw-html','body':'<script/>'}];invalid.append(s)
        s=self.spec();s['sections']=[{'type':'table','headers':['one'],'rows':[['two','three']]}];invalid.append(s)
        for s in invalid:
            with self.assertRaises(ValueError):self.render(s)
    def test_pie_and_line(self):
        for kind in ['pie','line']:
            s=self.spec();chart=s['sections'][0]['chart'];chart['type']=kind;chart['series']=[{'name':'收入','values':[30,70]}]
            _,html=self.render(s);self.assertIn('<svg',html)
    def test_invalid_spec_creates_no_file(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'out.html';s=self.spec();s['sections'].append({'type':'unsupported'})
            with self.assertRaises(ValueError):render_html(s,p)
            self.assertFalse(p.exists())
    def test_chart_ids_are_unique(self):
        s=self.spec();s['sections'].append(copy.deepcopy(s['sections'][0]))
        _,html=self.render(s)
        self.assertEqual(html.count('id="chart-0-title"'),1)
        self.assertEqual(html.count('id="chart-1-title"'),1)
    def test_empty_chart_and_table(self):
        s=self.spec();s['sections']=[{'type':'chart','chart':{'type':'line','categories':[],'series':[]}},{'type':'table','headers':['数据'],'rows':[]}]
        _,html=self.render(s)
        self.assertIn('未将缺失数据解释为零',html)
        self.assertIn('暂无记录',html)
    def test_long_labels_preserved_in_data_table(self):
        s=self.spec();label='长中文标签'*40
        s['sections'][0]['chart']['categories']=[label,'普通']
        _,html=self.render(s)
        self.assertIn(label,html)
    def test_negative_chart_zero_axis(self):
        s=self.spec();chart=s['sections'][0]['chart'];chart['series']=[{'name':'负数','values':[-10,-20]}]
        _,html=self.render(s)
        self.assertIn('class="zero-axis" x1="72" y1="40.0"',html)
        self.assertNotIn('height="-',html)
        chart['series']=[{'name':'混合','values':[-10,10]}]
        _,html=self.render(s)
        self.assertIn('class="zero-axis" x1="72" y1="155.0"',html)
    def test_comparison_example_arithmetic(self):
        import json
        spec=json.loads((Path(__file__).parents[1]/'examples/comparison.json').read_text())
        rows=next(s['rows'] for s in spec['sections'] if s['type']=='table' and s['title'].startswith('评分矩阵'))
        for col in range(2,5):
            expected=sum(float(row[1].rstrip('%'))/100*row[col] for row in rows[:-1])
            self.assertAlmostEqual(expected,rows[-1][col])
    def test_closed_details_print_data_is_independent(self):
        _,html=self.render(self.spec())
        self.assertIn('<details>',html)
        self.assertNotIn('<details open',html)
        self.assertIn('</details><div class="print-chart-data">',html)
        self.assertIn('图表原始数据（打印）',html)
        self.assertIn('details{display:none}.print-chart-data{display:block}',html)
    def test_null_table_cell_is_blank_not_zero(self):
        s=self.spec();s['sections']=[{'type':'table','headers':['空','零','布尔'],'rows':[[None,0,False]]}]
        _,html=self.render(s)
        self.assertIn('<td></td><td>0</td><td>false</td>',html)
        self.assertNotIn('None',html)
    def test_unknown_intent_is_rejected_at_every_level(self):
        bad=[]
        s=self.spec();s['interactive']=True;bad.append(s)
        s=self.spec();s['sections'][0]['layout']='masonry';bad.append(s)
        s=self.spec();s['sections'][0]['chart']['y2_axis']=True;bad.append(s)
        s=self.spec();s['sections'][0]['chart']['series'][0]['color']='red';bad.append(s)
        for block in [
            {'type':'kpis','items':[{'label':'A','value':1,'trend':2}]},
            {'type':'timeline','items':[{'date':'now','title':'A','owner':'B'}]},
            {'type':'board','columns':[{'title':'A','items':[],'limit':3}]},
            {'type':'board','columns':[{'title':'A','items':[{'title':'B','priority':'high'}]}]},
            {'type':'table','headers':['A'],'rows':[],'sort':True},
        ]:
            s=self.spec();s['sections']=[block];bad.append(s)
        for spec in bad:
            with self.subTest(spec=spec):
                with self.assertRaisesRegex(ValueError,'unsupported fields'):
                    self.render(spec)
    def test_all_business_examples_reproduce_exactly(self):
        import json
        root=Path(__file__).parents[1]/'examples'
        for name in ['dashboard','research','project','comparison','operations']:
            spec=json.loads((root/(name+'.json')).read_text())
            _,html=self.render(spec)
            self.assertEqual(html,(root/(name+'.html')).read_text())
    def test_sources_strict_and_escaped(self):
        s=self.spec();s['sections']=[{'type':'text','body':'结论','source_ids':['E1']},{'type':'sources','items':[{'id':'E1','title':'<证据>','url':'https://example.com/evidence','note':'原创合成测试'}]}]
        _,html=self.render(s)
        self.assertIn('href="#source-E1"',html)
        self.assertIn('id="source-E1"',html)
        self.assertIn('&lt;证据&gt;',html)
        self.assertIn('rel="noopener noreferrer"',html)
        for url in ['javascript:alert(1)','data:text/html,x','file:///tmp/x','https:'+'//fixture-user:not-a-secret@example.invalid','https://example.com/has space']:
            s['sections'][1]['items'][0]['url']=url
            with self.assertRaises(ValueError):self.render(s)
    def test_source_references_and_duplicates_rejected(self):
        for sections in [
            [{'type':'text','body':'x','source_ids':['missing']}],
            [{'type':'sources','items':[{'id':'E1','title':'a'},{'id':'E1','title':'b'}]}],
            [{'type':'sources','items':[{'id':'E1','title':'a','verified':True}]}],
            [{'type':'sources','items':[{'id':'bad id','title':'a'}]}],
        ]:
            s=self.spec();s['sections']=sections
            with self.assertRaises(ValueError):self.render(s)
    def test_wide_table_print_preserves_all_fields(self):
        s=self.spec();headers=['field'+str(i) for i in range(24)];s['sections']=[{'type':'table','headers':headers,'rows':[[str(i) for i in range(24)]]}]
        _,html=self.render(s)
        self.assertIn('class="wide-table-print"',html)
        self.assertIn('<dt>field23</dt><dd>23</dd>',html)
    def test_stress_examples_reproduce_exactly(self):
        import json
        root=Path(__file__).parents[1]/'examples/stress'
        for path in root.glob('*.json'):
            if path.name.endswith('.print-check.json'):
                continue
            _,html=self.render(json.loads(path.read_text()))
            self.assertEqual(html,path.with_suffix('.html').read_text())
    def test_first_party_runtime_is_fixed_hashed_and_explicit(self):
        import hashlib,base64
        s=self.spec();s['interaction']='first-party-table';s['sections']=[{'type':'table','headers':['项','数'],'rows':[['<script>alert(1)</script>',3],['空',None]]}]
        _,html=self.render(s)
        runtime=(Path(__file__).parents[1]/'first-party-table.js').read_text()
        digest=base64.b64encode(hashlib.sha256(runtime.encode()).digest()).decode()
        self.assertEqual(html.count('<script>'),1)
        self.assertIn("script-src 'sha256-"+digest+"'",html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;',html)
        self.assertIn('class="interactive-print"',html)
        self.assertIn('data-office-number="3"',html)
    def test_interactive_mode_and_flags_are_strict(self):
        s=self.spec();s['interaction']='arbitrary-javascript'
        with self.assertRaises(ValueError):self.render(s)
        s=self.spec();s['sections']=[{'type':'table','headers':['A'],'rows':[],'interactive':True}]
        with self.assertRaises(ValueError):self.render(s)
        s['interaction']='first-party-table';s['sections'][0]['interactive']='yes'
        with self.assertRaises(ValueError):self.render(s)
    def test_long_ascii_identifiers_can_wrap(self):
        s=self.spec();s['sections']=[{'type':'text','body':'Source SHA256: '+'a'*64+'; formula caches remain unverified. https://example.invalid/'+'b'*200}]
        _,html=self.render(s)
        self.assertIn('white-space:pre-line;overflow-wrap:anywhere',html)
    def test_zero_pie_rejected(self):
        s=self.spec();s['sections'][0]['chart'].update(type='pie',series=[{'name':'x','values':[0,0]}])
        with self.assertRaises(ValueError):self.render(s)

class CompositionTests(unittest.TestCase):
    spec = HtmlTests.spec
    render = HtmlTests.render
    def test_semantic_roles_and_widths_are_bounded(self):
        for role in ['lead','evidence','aside','action','reference']:
            for width in ['full','half','main','rail']:
                spec=self.spec();spec['sections'][0].update(role=role,width=width)
                _,markup=self.render(spec)
                self.assertIn('role-'+role,markup)
        for key,value in [('role','javascript'),('width','huge')]:
            spec=self.spec();spec['sections'][0][key]=value
            with self.assertRaises(ValueError):self.render(spec)
    def test_research_navigation_targets_real_headings(self):
        spec=self.spec();spec['scenario']='research';spec['sections'][0]['title']='<证据>'
        _,markup=self.render(spec)
        self.assertIn('href="#section-0">&lt;证据&gt;</a>',markup)
        self.assertIn('id="section-0"',markup)
        self.assertIn('class="skip-link"',markup)
    def test_aside_record_preserves_all_fields_and_escaping(self):
        spec=self.spec();spec['sections']=[{'type':'table','role':'aside','width':'rail','headers':['信号','责任人','行动'],'rows':[['<风险>','甲','跟进'],['超时',None,'复盘']]}]
        _,markup=self.render(spec)
        self.assertIn('<dt>责任人</dt><dd>甲</dd>',markup)
        self.assertIn('&lt;风险&gt;',markup)
        self.assertIn('<dt>行动</dt><dd>复盘</dd>',markup)
        spec['interaction']='first-party-table';_,markup=self.render(spec)
        self.assertIn('data-office-table',markup)
        self.assertIn('class="interactive-print"',markup)

class AxisTitleTests(unittest.TestCase):
    spec = HtmlTests.spec
    render = HtmlTests.render
    def test_nice_ticks_zero_and_bounds(self):
        import math
        from office_engine.html import nice_axis
        self.assertEqual([x[1] for x in nice_axis([-45,131])[2]],['-50','0','50','100','150'])
        self.assertEqual([x[1] for x in nice_axis([860])[2]],['0','200','400','600','800','1000'])
        for values in [[0,0],[-9,-2],[-.04,.071],[1e-250,2e-250],[-1e15,1e15],[.1,.2]]:
            low,high,ticks=nice_axis(values)
            self.assertLessEqual(low,min(values));self.assertGreaterEqual(high,max(values))
            self.assertTrue(all(math.isfinite(n) for n,_ in ticks))
            self.assertIn((0.0,'0'),ticks);self.assertLessEqual(len(ticks),8)
        for values in [[float('inf')],[float('nan')],[10**400],[5e-324]]:
            with self.assertRaises(ValueError):nice_axis(values)
    def test_chart_keeps_real_values_and_no_false_zero(self):
        spec=self.spec();spec['sections'][0]['chart']['series']=[{'name':'raw','values':[-45,131]}]
        _,markup=self.render(spec)
        self.assertIn('>-50</text>',markup);self.assertIn('>0</text>',markup)
        self.assertIn('raw: 131</title>',markup);self.assertIn('raw: -45</title>',markup)
        self.assertNotIn('>-1</text>',markup)
    def test_pie_has_complete_responsive_html_category_legend(self):
        spec=self.spec();chart=spec['sections'][0]['chart'];chart.update(type='pie',categories=['长类别'+ '甲'*60,'其他'],series=[{'name':'样本','values':[3,1]}])
        _,markup=self.render(spec)
        self.assertIn('class="pie-container"',markup)
        self.assertIn('class="legend pie-legend"',markup)
        self.assertIn('长类别'+'甲'*60,markup)
        self.assertIn('<strong>75.0%</strong>',markup)
        self.assertIn('<strong>25.0%</strong>',markup)
        self.assertNotIn('x="440"',markup)
        self.assertNotIn('可横向滚动的图表',markup)
    def test_title_lines_exact_escaped_and_bounded(self):
        spec=self.spec();spec['title']='甲<乙>丙';spec['title_lines']=['甲','<乙>丙']
        _,markup=self.render(spec)
        self.assertIn('<span class="title-line">甲</span><span class="title-line">&lt;乙&gt;丙</span>',markup)
        for lines in [[],['甲'],['甲','','<乙>丙'],['甲','<','乙','>丙'],'甲<乙>丙']:
            spec['title_lines']=lines
            with self.assertRaises(ValueError):self.render(spec)

if __name__=='__main__':unittest.main()
