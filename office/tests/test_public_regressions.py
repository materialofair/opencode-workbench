"""Original minimal reproductions of issues found in the Apache POI corpus.
No external workbook bytes are copied or redistributed by these tests.
Source evidence pinned at e0658769cb7f7da25ec09178805e04069dedc6ed.
"""
import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path
import openpyxl
import xlsxwriter
from openpyxl.chart import BarChart, Reference
from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula
from office_engine.excel import inspect_workbook


class PublicCorpusRegressions(unittest.TestCase):
    def setUp(self): self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def rewrite(self,path,part,transform):
        with zipfile.ZipFile(path) as z: parts={name:z.read(name) for name in z.namelist()}
        parts[part]=transform(parts[part])
        with zipfile.ZipFile(path,'w') as z:
            for name,data in parts.items(): z.writestr(name,data)
    def test_array_expression_and_reference_preserved(self):
        path=self.root/'matrix.xlsx'; wb=openpyxl.Workbook(); ws=wb.active
        ws.append([1,2,3]); ws.append([4,5,6]); ws['E1']=ArrayFormula(ref='E1:G2',text='=A1:C2*2'); wb.save(path); wb.close()
        before=hashlib.sha256(path.read_bytes()).hexdigest(); report=inspect_workbook(path)
        record=report['sheets'][0]['formulas'][0]; cell=next(c for c in report['sheets'][0]['cells'] if c['cell']=='E1')
        for item in (record,cell):
            self.assertEqual(item['formula_type'],'array'); self.assertEqual(item['formula_metadata']['type'],'array'); self.assertEqual(item['formula_metadata']['ref'],'E1:G2')
        self.assertEqual(record['formula'],'=A1:C2*2'); self.assertEqual(cell['value'],'=A1:C2*2'); self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())
    def test_data_table_formula_metadata_without_fabricated_expression(self):
        path=self.root/'datatable.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws['A1']=3; ws['B1']=4; ws['C1']=DataTableFormula(ref='C1:E4',ca=True,dt2D=True,r1='A1',r2='B1'); wb.save(path); wb.close()
        report=inspect_workbook(path); record=report['sheets'][0]['formulas'][0]
        self.assertEqual(record['formula_type'],'dataTable'); self.assertIsNone(record['formula']); self.assertEqual(record['formula_metadata']['ref'],'C1:E4'); self.assertEqual(record['formula_metadata']['r1'],'A1'); self.assertEqual(record['formula_metadata']['r2'],'B1'); self.assertTrue(record['formula_metadata']['dt2D'])
    def chart_book(self):
        path=self.root/'chartsheet.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws.title='Source'; ws.append(['Label','Value']); ws.append(['A',5]); ws.append(['B',8]); chart=BarChart(); chart.add_data(Reference(ws,min_col=2,min_row=1,max_row=3),titles_from_data=True); chart.set_categories(Reference(ws,min_col=1,min_row=2,max_row=3)); cs=wb.create_chartsheet('Summary'); cs.add_chart(chart); wb.save(path); wb.close(); return path
    def test_chartsheet_has_explicit_record(self):
        report=inspect_workbook(self.chart_book()); self.assertEqual(report['available_sheets'],['Source','Summary']); self.assertEqual(len(report['sheets']),2)
        sheet=report['sheets'][1]; self.assertEqual(sheet['kind'],'chartsheet'); self.assertIsNone(sheet['dimensions']); self.assertIsNone(sheet['sampled_range']); self.assertEqual(sheet['cells'],[]); self.assertEqual(sheet['formulas'],[]); self.assertTrue(sheet['window_complete']); self.assertEqual(len(sheet['chart_parts']),1)
    def test_chartsheet_selection_keeps_chart_and_sheet(self):
        report=inspect_workbook(self.chart_book(),{'sheets':['Summary'],'start_row':50,'start_col':9}); self.assertEqual(report['selected_sheets'],['Summary']); self.assertEqual(len(report['sheets']),1); self.assertEqual(report['sampled_cells'],0); self.assertEqual(report['charts'][0]['sheets'],['Summary']); self.assertTrue(report['sheets'][0]['drawing_objects'])
    def test_chart_title_rich_runs_do_not_invent_spaces(self):
        path=self.root/'rich.xlsx'; wb=xlsxwriter.Workbook(path); ws=wb.add_worksheet(); ws.write_column('A1',[1,2]); chart=wb.add_chart({'type':'column'}); chart.add_series({'values':'=Sheet1!$A$1:$A$2'}); chart.set_title({'name':'Alpha Beta'}); ws.insert_chart('D2',chart); wb.close()
        def split(data):
            self.assertIn(b'<a:t>Alpha Beta</a:t>',data)
            return data.replace(b'<a:t>Alpha Beta</a:t>',b'<a:t>Alpha </a:t></a:r><a:r><a:t>Beta</a:t>')
        self.rewrite(path,'xl/charts/chart1.xml',split); self.assertEqual(inspect_workbook(path)['charts'][0]['title'],'Alpha Beta')
    def test_unsupported_extension_warning_is_visible_and_source_unchanged(self):
        path=self.root/'extension.xlsx'; wb=openpyxl.Workbook(); wb.active['A1']='Safe'; wb.save(path); wb.close()
        self.rewrite(path,'xl/worksheets/sheet1.xml',lambda data:data.replace(b'</worksheet>',b'<extLst><ext uri="{00000000-0000-0000-0000-000000000099}"><unknown xmlns="urn:example:unsupported"/></ext></extLst></worksheet>'))
        before=path.read_bytes(); report=inspect_workbook(path)
        self.assertTrue(any('extension' in x['message'].lower() for x in report['library_warnings'])); self.assertTrue(report['warnings']); self.assertEqual(path.read_bytes(),before)

if __name__=='__main__': unittest.main()

class SnapshotConsistencyTests(unittest.TestCase):
    def test_formula_and_cache_use_same_snapshot_if_path_changes(self):
        import io
        from unittest.mock import patch
        import office_engine.excel as engine
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'book.xlsx'
            def make(value):
                target=io.BytesIO();book=xlsxwriter.Workbook(target,{'in_memory':True});sheet=book.add_worksheet('Data');sheet.write_formula('A1','=1+1',None,value);book.close();return target.getvalue()
            original=make(2);replacement=make(999);path.write_bytes(original);real=engine._load_book;calls=[]
            def swap(snapshot,data_only):
                result=real(snapshot,data_only);calls.append(data_only)
                if not data_only:path.write_bytes(replacement)
                return result
            with patch.object(engine,'_load_book',side_effect=swap): report=engine.inspect_workbook(path)
            self.assertEqual(calls,[False,True]);self.assertEqual(report['source_sha256'],hashlib.sha256(original).hexdigest());self.assertEqual(report['sheets'][0]['formulas'][0]['cached_value'],2);self.assertIn('snapshot',report['source_consistency'])
