import copy
import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path
import openpyxl
import xlsxwriter
from office_engine.excel import generate_workbook, inspect_workbook


def fixture():
    return {'sheets':[{'name':'Sales','rows':[['Month','Revenue','Rate'],['Jan',100,.2],['Feb',150,.3],['Total',{'formula':'=SUM(B2:B3)','cached':250,'format':'total'},None]],'freeze':[1,1],'columns':[{'width':22},{'format':'currency'},{'format':'percent'}],'autofilter':True,'validations':[{'range':[1,0,2,0],'values':['Jan','Feb','Mar']}],'conditional_formats':[{'range':[1,1,2,1],'type':'data_bar'}],'charts':[{'type':'column','title':'Sales trend','series':[{'name':'Revenue','categories':['Sales',1,0,2,0],'values':['Sales',1,1,2,1]}]}]},{'name':'Detail','rows':[['Safe string','Pending'],['=HYPERLINK("https://bad")',{'formula':'=1+1'}],['https://example.test',None]]}]}


class ExcelTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def test_roundtrip(self):
        p=self.root/'a.xlsx'; generated=generate_workbook(fixture(),p)
        original=p.read_bytes(); report=inspect_workbook(p)
        self.assertEqual(p.read_bytes(),original)
        self.assertEqual(generated['formula_count'],2)
        self.assertEqual(len(generated['recalc_pending']),1)
        self.assertIsNone(report['sheets'][1]['formulas'][0]['cached_value'])
        self.assertEqual(report['sheets'][0]['formulas'][0]['cached_value'],250)
        self.assertEqual(report['charts'][0]['plots'][0]['type'],'barChart')
        self.assertIn('Sales!',report['charts'][0]['plots'][0]['series'][0]['references'][0])
        wb=openpyxl.load_workbook(p)
        self.assertEqual(wb['Detail']['A2'].data_type,'s')
        self.assertIsNone(wb['Detail']['A3'].hyperlink)
        self.assertEqual(len(wb['Sales'].data_validations.dataValidation),1)
        self.assertEqual(len(wb['Sales'].conditional_formatting),1)
        wb.close()
    def test_no_overwrite(self):
        p=self.root/'a.xlsx'; generate_workbook(fixture(),p); before=p.read_bytes()
        with self.assertRaises(FileExistsError): generate_workbook(fixture(),p)
        self.assertEqual(before,p.read_bytes())
    def test_sampling(self):
        p=self.root/'a.xlsx'; generate_workbook(fixture(),p)
        r=inspect_workbook(p,{'max_cells':2})
        self.assertEqual(r['sampled_cells'],2); self.assertTrue(r['sheets'][0]['truncated'])
    def test_shared_charts(self):
        spec={'charts':[{'type':t,'title':'季度趋势','categories':['甲','乙'],'series':[{'name':'营收','values':[2,7]}]} for t in ['bar','line','pie']]}
        p=self.root/'a.xlsx'; generate_workbook(spec,p); r=inspect_workbook(p)
        self.assertEqual(len(r['charts']),3)
        self.assertEqual(r['sheets'][0]['cells'][5]['value'],7)
    def test_bad_specs_leave_no_output(self):
        cases=[]
        for formula in ['=HYPERLINK("https://evil")','=WEBSERVICE("x")',"='[outside.xlsx]Sheet1'!A1",'=cmd|foo!A1']:
            s=fixture(); s['sheets'][0]['rows'][3][1]={'formula':formula}; cases.append(s)
        s=fixture(); s['sheets'][0]['charts'][0]['series'][0]['values']=['Sales',0,0,99,0]; cases.append(s)
        s=fixture(); s['sheets'][1]['name']='sales'; cases.append(s)
        s=fixture(); s['sheets'][0]['merges']=[{'range':[0,0,1,1],'value':'Loss'}]; cases.append(s)
        for i,s in enumerate(cases):
            with self.subTest(i=i):
                p=self.root/f'{i}.xlsx'
                with self.assertRaises(ValueError): generate_workbook(s,p)
                self.assertFalse(p.exists())
        self.assertEqual(list(self.root.iterdir()),[])
    def test_zip_traversal_and_entities(self):
        for name,xml in [('../evil','<x/>'),('x.xml','<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>')]:
            p=self.root/'bad.xlsx'
            with zipfile.ZipFile(p,'w') as z:
                z.writestr('xl/workbook.xml','<x/>'); z.writestr(name,xml)
            with self.assertRaises(Exception): inspect_workbook(p)
    def test_native_chart_types(self):
        s=fixture(); base=s['sheets'][0]['charts'][0]
        s['sheets'][0]['charts']=[{**copy.deepcopy(base),'type':t,'anchor':f'H{2+i*22}'} for i,t in enumerate(['bar','line','pie','scatter','column','area'])]
        s['sheets'][0]['charts'][3]['series'][0]['categories']=['Sales',1,1,2,1]
        p=self.root/'types.xlsx'; generate_workbook(s,p); r=inspect_workbook(p)
        self.assertEqual(len(r['charts']),6)
        self.assertEqual({c['plots'][0]['type'] for c in r['charts']},{'barChart','lineChart','pieChart','scatterChart','areaChart'})
    def test_title_injection(self):
        s=fixture(); s['sheets'][0]['charts'][0]['title']='=[external.xlsx]Sheet!A1'
        with self.assertRaises(ValueError): generate_workbook(s,self.root/'bad.xlsx')
        self.assertFalse((self.root/'bad.xlsx').exists())
    def test_text_truncation(self):
        p=self.root/'a.xlsx'; generate_workbook({'sheets':[{'name':'Text','rows':[['x'*100]]}]},p)
        c=inspect_workbook(p,{'max_cell_chars':10})['sheets'][0]['cells'][0]
        self.assertEqual(c['value'],'x'*10); self.assertTrue(c['text_truncated'])
    def test_shared_chart_rejects_nonfinite(self):
        spec={'charts':[{'type':'bar','categories':['A'],'series':[{'name':'x','values':[float('nan')]}]}]}
        with self.assertRaises(ValueError): generate_workbook(spec,self.root/'bad.xlsx')
    def test_pie_semantics(self):
        for values in ([0,0],[-1,3]):
            spec={'charts':[{'type':'pie','categories':['A','B'],'series':[{'name':'x','values':values}]}]}
            with self.assertRaises(ValueError): generate_workbook(spec,self.root/'bad.xlsx')
        spec={'charts':[{'type':'pie','categories':['A'],'series':[{'name':'x','values':[1]},{'name':'y','values':[2]}]}]}
        with self.assertRaises(ValueError): generate_workbook(spec,self.root/'bad.xlsx')
    def test_shared_unit_and_vertical_bar(self):
        spec={'charts':[{'type':'bar','unit':'万元','categories':['甲','乙'],'series':[{'name':'营收','values':[2,7]}]}]}
        p=self.root/'unit.xlsx'; generate_workbook(spec,p)
        with zipfile.ZipFile(p) as z:
            xml=z.read('xl/charts/chart1.xml').decode()
            self.assertIn('barDir val="col"',xml); self.assertIn('万元',xml)
    def test_stored_cell_budget(self):
        p=self.root/'oversized.xlsx'
        # Stored sparse cells can exhaust normal-mode parser memory despite a small ZIP.
        xml='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>'+''.join(f'<c r="A{i}"/>' for i in range(200001))+'</row></sheetData></worksheet>'
        with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_STORED) as z:
            z.writestr('xl/workbook.xml','<x/>'); z.writestr('xl/worksheets/sheet1.xml',xml)
        with self.assertRaisesRegex(ValueError,'200000 stored cells'): inspect_workbook(p)
    def test_unsupported_formats(self):
        with self.assertRaises(ValueError): inspect_workbook(self.root/'old.xls')
    def test_hidden_merged_names(self):
        p=self.root/'a.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws['A1']='Merged'; ws.merge_cells('A1:C1'); wb.create_sheet('Hidden').sheet_state='hidden'
        from openpyxl.workbook.defined_name import DefinedName
        wb.defined_names.add(DefinedName('Example',attr_text="'Sheet'!$A$1")); wb.save(p); wb.close()
        r=inspect_workbook(p); self.assertEqual(r['sheets'][1]['state'],'hidden'); self.assertIn('A1:C1',r['sheets'][0]['merged_ranges']); self.assertEqual(r['defined_names'][0]['name'],'Example')



class ExcelComplexTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def rewrite_zip(self,path,transform):
        with zipfile.ZipFile(path) as z: parts={n:z.read(n) for n in z.namelist()}
        parts=transform(parts)
        with zipfile.ZipFile(path,'w') as z:
            for n,blob in parts.items(): z.writestr(n,blob)
    def budget_model(self):
        p=self.root/'budget.xlsx'; wb=xlsxwriter.Workbook(p)
        inputs=wb.add_worksheet('假设'); inputs.write_row(0,0,['Department','Headcount','Cost']); inputs.write_row(1,0,['研发',5,200]); inputs.write_row(2,0,['销售',3,150])
        out=wb.add_worksheet('年度预算'); out.merge_range('A1:D1','年度经营预算'); out.merge_range('B2:C2','人员费用'); out.write_row(2,0,['部门','人数','单价','预算']); out.write_row(3,0,['研发',5,200]); out.write_formula('D4',"='假设'!B2*'假设'!C2",None,1000); out.write_row(4,0,['销售',3,150]); out.write_formula('D5',"='假设'!B3*'假设'!C3",None,450); out.write('A6','合计'); out.write_formula('D6','=SUM(D4:D5)',None,1450)
        out.activate(); inputs.hide(); out.freeze_panes(3,1)
        out.data_validation('B4:B5',{'validate':'integer','criteria':'>=','value':0})
        out.conditional_format('D4:D5',{'type':'cell','criteria':'>','value':800,'format':wb.add_format({'bg_color':'#ffcccc'})})
        chart=wb.add_chart({'type':'column'}); chart.add_series({'name':'年度预算万元','categories':"='年度预算'!$A$4:$A$5",'values':"='年度预算'!$D$4:$D$5"}); out.insert_chart('F3',chart)
        wb.close(); return p
    def test_budget_window_selection_and_metadata(self):
        p=self.budget_model(); r=inspect_workbook(p,{'sheets':['年度预算'],'start_row':4,'start_col':2,'max_rows':2,'max_cols':3})
        self.assertEqual(r['available_sheets'],['假设','年度预算']); self.assertEqual(r['selected_sheets'],['年度预算'])
        s=r['sheets'][0]; self.assertEqual(s['sampled_range']['row_spans'],['B4:D4','B5:D5']); self.assertEqual(s['sampled_range']['cell_count'],6)
        self.assertTrue(s['window_complete']); self.assertTrue(s['truncated']); self.assertEqual([f['cached_value'] for f in s['formulas']],[1000,450])
        self.assertEqual(s['data_validations'][0]['type'],'whole'); self.assertEqual(s['conditional_formats'][0]['type'],'cellIs')
        self.assertIn('B2:C2',s['merged_ranges']); self.assertEqual(r['charts'][0]['sheets'],['年度预算'])
        self.assertEqual(r['charts'][0]['plots'][0]['series'][0]['name']['literal_text'],['年度预算万元'])
    def test_partial_window_and_empty_window(self):
        p=self.budget_model(); r=inspect_workbook(p,{'sheets':['年度预算'],'start_row':4,'start_col':2,'max_rows':2,'max_cols':3,'max_cells':4})
        s=r['sheets'][0]; self.assertEqual(s['sampled_range']['row_spans'],['B4:D4','B5:B5']); self.assertFalse(s['window_complete']); self.assertIn('cell_budget_exhausted',s['truncation_reasons'])
        empty=inspect_workbook(p,{'sheets':['年度预算'],'start_row':200})['sheets'][0]
        self.assertEqual(empty['sampled_range']['cell_count'],0); self.assertIsNone(empty['sampled_range']['first_cell']); self.assertTrue(empty['window_complete'])
        with self.assertRaisesRegex(ValueError,'Unknown sheet'): inspect_workbook(p,{'sheets':['missing']})
        with self.assertRaises(ValueError): inspect_workbook(p,{'start_col':0})
    def test_relationships_after_nonstandard_part_rename(self):
        p=self.budget_model()
        def transform(parts):
            result={}
            for n,data in parts.items():
                n=n.replace('sheet2.xml','budget.xml').replace('chart1.xml','revenue.xml')
                if n.endswith(('.xml','.rels')): data=data.replace(b'sheet2.xml',b'budget.xml').replace(b'chart1.xml',b'revenue.xml')
                result[n]=data
            return result
        self.rewrite_zip(p,transform); r=inspect_workbook(p)
        self.assertEqual(len(r['charts']),1); self.assertEqual(r['charts'][0]['part'],'xl/charts/revenue.xml')
        self.assertEqual(r['sheets'][0]['chart_parts'],[]); out=r['sheets'][1]
        self.assertEqual(out['chart_parts'],['xl/charts/revenue.xml']); anchor=out['drawing_objects'][0]['anchor']
        self.assertEqual(anchor['from']['col'],5); self.assertEqual(anchor['from']['row'],2)
    def test_merged_expansion_refused_before_loader(self):
        p=self.budget_model()
        def transform(parts):
            parts['xl/worksheets/sheet2.xml']=parts.pop('xl/worksheets/sheet2.xml').replace(b'A1:D1',b'A1:XFD1048576')
            return parts
        self.rewrite_zip(p,transform)
        from unittest.mock import patch
        with patch('office_engine.excel.openpyxl.load_workbook',side_effect=AssertionError('Must not load')):
            with self.assertRaisesRegex(ValueError,'merged expansion'): inspect_workbook(p)
    def test_nonstandard_sheet_merged_budget(self):
        p=self.budget_model()
        def transform(parts):
            result={}
            for n,data in parts.items():
                if n=='xl/worksheets/sheet2.xml': data=data.replace(b'A1:D1',b'A1:XFD1048576')
                n=n.replace('sheet2.xml','renamed.xml')
                if n.endswith(('.xml','.rels')): data=data.replace(b'sheet2.xml',b'renamed.xml')
                result[n]=data
            return result
        self.rewrite_zip(p,transform)
        with self.assertRaisesRegex(ValueError,'merged expansion'): inspect_workbook(p)
    def test_date_axis_multiseries_and_scatter_roles(self):
        import datetime
        p=self.root/'lab.xlsx'; wb=xlsxwriter.Workbook(p); ws=wb.add_worksheet('实验'); ws.write_row(0,0,['Date','Pressure','Temperature'])
        fmt=wb.add_format({'num_format':'yyyy-mm-dd'})
        for i in range(1,4): ws.write_datetime(i,0,datetime.datetime(2026,11,i),fmt); ws.write_number(i,1,i*2); ws.write_number(i,2,i*4)
        line=wb.add_chart({'type':'line'}); line.set_x_axis({'date_axis':True,'num_format':'yyyy-mm-dd'}); line.set_y_axis({'name':'MPa','min':0,'max':20})
        for c in (1,2): line.add_series({'name':['实验',0,c],'categories':['实验',1,0,3,0],'values':['实验',1,c,3,c]})
        ws.insert_chart('F2',line)
        scatter=wb.add_chart({'type':'scatter'}); scatter.add_series({'name':'相关性','categories':['实验',1,1,3,1],'values':['实验',1,2,3,2]}); ws.insert_chart('F25',scatter); wb.close()
        r=inspect_workbook(p); self.assertEqual(len(r['charts']),2)
        line=r['charts'][0]; self.assertEqual(len(line['plots'][0]['series']),2); self.assertIn('dateAx',{a['type'] for a in line['axes']})
        self.assertEqual(line['plots'][0]['series'][0]['name']['caches'][0]['points'][0]['value'],'Pressure')
        axis=next(a for a in line['axes'] if a['type']=='valAx'); self.assertEqual(axis['scaling']['max']['val'],'20'); self.assertIn('crossAx',axis)
        ser=r['charts'][1]['plots'][0]['series'][0]; self.assertIsNotNone(ser['x_values']); self.assertIsNotNone(ser['y_values']); self.assertIsNone(ser['categories'])
    def test_external_resource_risk_and_hidden_sheet(self):
        p=self.budget_model()
        def transform(parts):
            n='xl/worksheets/_rels/sheet1.xml.rels'
            parts[n]=b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://outside.invalid/private" TargetMode="External"/></Relationships>'
            return parts
        self.rewrite_zip(p,transform); r=inspect_workbook(p)
        self.assertEqual(r['sheets'][0]['state'],'hidden'); self.assertEqual(r['external_relationships'][0]['risk'],'external_resource_not_fetched')
    def test_unknown_chart_options_fail_closed(self):
        for field,value in [('subtype','stacked'),('y2_axis',True)]:
            s=fixture(); s['sheets'][0]['charts'][0][field]=value
            with self.assertRaisesRegex(ValueError,'Unknown native chart fields'): generate_workbook(s,self.root/'bad.xlsx')
        s=fixture(); s['sheets'][0]['charts'][0]['series'][0]['y2_axis']=True
        with self.assertRaisesRegex(ValueError,'Unknown native chart series'): generate_workbook(s,self.root/'bad.xlsx')
        s={'charts':[{'type':'bar','categories':['A'],'series':[{'name':'x','values':[1],'y2_axis':True}]}]}
        with self.assertRaisesRegex(ValueError,'Unknown shared chart series'): generate_workbook(s,self.root/'bad.xlsx')
    def test_scatter_and_pie_values_validated(self):
        s=fixture(); s['sheets'][0]['charts'][0]['type']='scatter'
        with self.assertRaisesRegex(ValueError,'Scatter X'): generate_workbook(s,self.root/'bad.xlsx')
        s=fixture(); s['sheets'][0]['charts'][0]['type']='pie'; s['sheets'][0]['rows'][1][1]=-1
        with self.assertRaisesRegex(ValueError,'Native pie'): generate_workbook(s,self.root/'bad.xlsx')
        s=fixture(); s['sheets'][0]['charts'][0]['series'][0]['values']=['Sales',1,0,2,0]
        with self.assertRaisesRegex(ValueError,'Chart value ranges'): generate_workbook(s,self.root/'bad.xlsx')
    def test_all_generation_objects_reject_unknown_fields(self):
        cases=[]
        s=fixture(); s['hidden']=True; cases.append(s)
        s=fixture(); s['sheets'][0]['hidden']=True; cases.append(s)
        s=fixture(); s['sheets'][0]['rows'][1][0]={'value':'Jan','hyperlink':'https://bad'}; cases.append(s)
        s=fixture(); s['sheets'][0]['columns'][0]['hidden']=True; cases.append(s)
        s=fixture(); s['sheets'][0]['merges']=[{'range':[1,0,2,0],'unknown':True}]; cases.append(s)
        s=fixture(); s['sheets'][0]['validations'][0]['error_title']='No'; cases.append(s)
        s=fixture(); s['sheets'][0]['conditional_formats'][0]['color']='red'; cases.append(s)
        for i,s in enumerate(cases):
            with self.subTest(i=i):
                with self.assertRaisesRegex(ValueError,'Unknown'): generate_workbook(s,self.root/'bad.xlsx')
                self.assertFalse((self.root/'bad.xlsx').exists())
        s=fixture(); s['sheets'][0]['rows'][1][0]={'value':'a','formula':'=1'}
        with self.assertRaisesRegex(ValueError,'exactly one'): generate_workbook(s,self.root/'bad.xlsx')
    def test_image_anchor_without_rendering(self):
        import io, struct, zlib, warnings
        def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\0'))+chunk(b'IEND',b'')
        p=self.root/'images.xlsx'; wb=xlsxwriter.Workbook(p); ws=wb.add_worksheet('图片'); ws.write('A1','Logo'); ws.insert_image('C4','logo.png',{'image_data':io.BytesIO(png)}); wb.close()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning); r=inspect_workbook(p)
        obj=r['sheets'][0]['drawing_objects'][0]
        self.assertEqual(obj['kind'],'image'); self.assertEqual(obj['anchor']['from']['col'],2); self.assertEqual(obj['anchor']['from']['row'],3); self.assertTrue(obj['part'].startswith('xl/media/'))
    def test_combined_secondary_axes_warning(self):
        p=self.root/'combo.xlsx'; wb=xlsxwriter.Workbook(p); ws=wb.add_worksheet('组合'); ws.write_row(0,0,['x','a','b']); ws.write_row(1,0,[1,10,100]); ws.write_row(2,0,[2,20,120])
        a=wb.add_chart({'type':'column'}); a.add_series({'values':['组合',1,1,2,1],'categories':['组合',1,0,2,0]})
        b=wb.add_chart({'type':'line'}); b.add_series({'values':['组合',1,2,2,2],'categories':['组合',1,0,2,0],'y2_axis':True}); a.combine(b); ws.insert_chart('F2',a); wb.close()
        chart=inspect_workbook(p)['charts'][0]; self.assertEqual(len(chart['plots']),2); self.assertTrue(any('Combination' in w for w in chart['warnings'])); self.assertTrue(any('Multiple axes' in w for w in chart['warnings']))

if __name__=='__main__': unittest.main()
