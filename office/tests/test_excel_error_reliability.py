"""Regression: saved errors and ambiguous chart caches must not appear reliable."""
import copy
import tempfile
import unittest
import zipfile
from pathlib import Path
from defusedxml import ElementTree as ET
import xlsxwriter
from office_engine.excel import inspect_workbook


class ErrorReliabilityTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def book(self,formula=False):
        p=self.root/'case.xlsx';wb=xlsxwriter.Workbook(p);ws=wb.add_worksheet('Data');ws.write_row('A1',['X','Y']);ws.write('A2',1)
        if formula: ws.write_formula('B2','=1/0',None,'#DIV/0!')
        else:ws.write('B2',10)
        c=wb.add_chart({'type':'column'});c.add_series({'categories':['Data',1,0,1,0],'values':['Data',1,1,1,1]});ws.insert_chart('D1',c);wb.close();return p
    def patch_cache(self,p,fn):
        with zipfile.ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
        root=ET.fromstring(parts['xl/charts/chart1.xml']);ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'};fn(root.find('.//c:val/c:numRef/c:numCache',ns),ns);parts['xl/charts/chart1.xml']=ET.tostring(root)
        with zipfile.ZipFile(p,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
    def test_formula_error_cache_is_not_a_normal_saved_value(self):
        r=inspect_workbook(self.book(True));f=r['sheets'][0]['formulas'][0];p=r['charts'][0]['plots'][0]['series'][0]['values']['sources'][0]['points'][0]
        self.assertEqual(f['cache_status'],'error');self.assertEqual(f['cached_error'],'#DIV/0!');self.assertEqual(p['source_reliability'],'formula_cache_error');self.assertEqual(p['chart_cache_comparison'],'not_comparable_source_error');self.assertEqual(p['source_error'],'#DIV/0!')
    def test_duplicate_cache_indices_are_not_last_value_wins(self):
        p=self.book()
        def change(cache,ns):
            first=cache.find('c:pt',ns);duplicate=copy.deepcopy(first);first.find('c:v',ns).text='999';cache.append(duplicate)
        self.patch_cache(p,change);r=inspect_workbook(p);role=r['charts'][0]['plots'][0]['series'][0]['values'];self.assertEqual(role['caches'][0]['duplicate_indices'],[0]);self.assertEqual(role['sources'][0]['points'][0]['chart_cache_comparison'],'not_comparable_ambiguous_cache');self.assertEqual(r['summary']['sampled_chart_source_disagreements'],0)

    def test_invalid_cache_index_does_not_count_as_a_match(self):
        p=self.book()
        self.patch_cache(p,lambda cache,ns:cache.find('c:ptCount',ns).set('val','0'))
        r=inspect_workbook(p);role=r['charts'][0]['plots'][0]['series'][0]['values'];self.assertEqual(role['caches'][0]['invalid_or_out_of_range_index_count'],1);self.assertEqual(role['sources'][0]['points'][0]['chart_cache_comparison'],'not_comparable_ambiguous_cache')
    def test_chart_only_error_is_separate_from_source_data(self):
        p=self.book();self.patch_cache(p,lambda cache,ns:setattr(cache.find('c:pt/c:v',ns),'text','#N/A'))
        r=inspect_workbook(p);point=r['charts'][0]['plots'][0]['series'][0]['values']['sources'][0]['points'][0];self.assertEqual(point['value'],10);self.assertEqual(point['chart_cache_comparison'],'not_comparable_chart_cache_error');self.assertEqual(point['chart_cached_error'],'#N/A');self.assertEqual(r['charts'][0]['source_summary']['chart_cache_error_points'],1)
    def test_plain_error_cell_is_not_a_numeric_difference(self):
        p=self.book()
        with zipfile.ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
        root=ET.fromstring(parts['xl/worksheets/sheet1.xml']);ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};cell=root.find('.//s:c[@r="B2"]',ns);cell.set('t','e');cell.find('s:v',ns).text='#REF!';parts['xl/worksheets/sheet1.xml']=ET.tostring(root)
        with zipfile.ZipFile(p,'w') as z:
            for n,b in parts.items():z.writestr(n,b)
        r=inspect_workbook(p);point=r['charts'][0]['plots'][0]['series'][0]['values']['sources'][0]['points'][0];self.assertEqual(point['source_reliability'],'stored_cell_error');self.assertEqual(point['chart_cache_comparison'],'not_comparable_source_error');self.assertEqual(r['summary']['sampled_chart_source_disagreements'],0)

if __name__=='__main__':unittest.main()
