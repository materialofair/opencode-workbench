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
    def test_zero_pie_rejected(self):
        s=self.spec();s['sections'][0]['chart'].update(type='pie',series=[{'name':'x','values':[0,0]}])
        with self.assertRaises(ValueError):self.render(s)

if __name__=='__main__':unittest.main()
