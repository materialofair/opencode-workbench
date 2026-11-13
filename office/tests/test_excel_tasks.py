"""Task-oriented inspection assertions: locating data, trust and continuing reads."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from defusedxml import ElementTree as ET
import openpyxl
import xlsxwriter
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.data_source import MultiLevelStrRef,MultiLevelStrData,Level,StrVal,AxDataSource
from office_engine.excel import inspect_workbook


class ExcelTaskTests(unittest.TestCase):
    def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def fixture(self):
        path=self.root/'data.xlsx'; wb=xlsxwriter.Workbook(path); ws=wb.add_worksheet("O'Brien data"); ws.write_row(0,0,['Quarter','Revenue']); ws.write_row(1,0,['Q1',10]); ws.write_row(2,0,['Q2',20]); ws.write_row(3,0,['Q3',30]); chart=wb.add_chart({'type':'column'}); chart.add_series({'name':'Revenue','categories':"='O''Brien data'!$A$2:$A$4",'values':"='O''Brien data'!$B$2:$B$4"}); ws.insert_chart('D2',chart); wb.close(); return path
    def patch(self,path,fn):
        with zipfile.ZipFile(path) as z: files={n:z.read(n) for n in z.namelist()}
        files['xl/charts/chart1.xml']=fn(files['xl/charts/chart1.xml'])
        with zipfile.ZipFile(path,'w') as z:
            for n,b in files.items(): z.writestr(n,b)
    def test_agent_locates_revenue_series_without_guessing_cache(self):
        report=inspect_workbook(self.fixture(),{'max_cells':1}); role=report['charts'][0]['plots'][0]['series'][0]['values']; source=role['sources'][0]
        self.assertEqual(source['sheet'],"O'Brien data"); self.assertEqual(source['range'],'B2:B4'); self.assertEqual([p['cell'] for p in source['points']],['B2','B3','B4']); self.assertEqual([p['value'] for p in source['points']],[10,20,30]); self.assertTrue(all(p['chart_cache_comparison']=='equal_stored_values_not_freshness_proof' for p in source['points'])); self.assertEqual(role['cache_status'],'stored_unverified'); self.assertEqual(report['sampled_cells'],1); self.assertLessEqual(report['chart_source_sampling']['sampled_cells'],2000)
    def test_changed_chart_cache_detected_as_saved_value_disagreement(self):
        path=self.fixture()
        def change(blob):
            root=ET.fromstring(blob); ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}; root.find('.//c:val/c:numRef/c:numCache/c:pt/c:v',ns).text='999'; return ET.tostring(root)
        self.patch(path,change); report=inspect_workbook(path); source=report['charts'][0]['plots'][0]['series'][0]['values']['sources'][0]
        self.assertEqual(report['summary']['sampled_chart_source_disagreements'],1); self.assertEqual(report['charts'][0]['source_summary']['disagreement_examples'][0]['cell'],'B2')
        self.assertEqual(source['points'][0]['chart_cache_comparison'],'different_stored_values'); self.assertEqual(source['points'][0]['value'],10); self.assertEqual(source['points'][0]['chart_cached_value'],'999')
    def test_sparse_cache_indexes_are_not_shifted_or_zero_filled(self):
        path=self.fixture()
        def change(blob):
            root=ET.fromstring(blob); ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}; cache=root.find('.//c:val/c:numRef/c:numCache',ns); points=cache.findall('c:pt',ns); cache.remove(points[1]); points[2].find('c:v',ns).text=''; return ET.tostring(root)
        self.patch(path,change); role=inspect_workbook(path)['charts'][0]['plots'][0]['series'][0]['values']; cache=role['caches'][0]
        self.assertEqual(cache['declared_point_count'],3); self.assertEqual(cache['missing_indices_in_first_200'],[1]); self.assertEqual([p['point_index'] for p in cache['points']],[0,2]); self.assertEqual(cache['points'][1]['value_state'],'empty')
        pts=role['sources'][0]['points']; self.assertEqual(pts[1]['chart_cache_comparison'],'no_chart_cache_point'); self.assertEqual(pts[2]['chart_cache_comparison'],'empty_or_blank_requires_review')
    def test_missing_formula_cache_not_promoted_to_reliable_data(self):
        path=self.root/'formula.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws.append(['x','y']);ws.append([1,'=10+5']); chart=BarChart(); chart.add_data(Reference(ws,min_col=2,min_row=1,max_row=2),titles_from_data=True); chart.set_categories(Reference(ws,min_col=1,min_row=2,max_row=2));ws.add_chart(chart,'D2');wb.save(path);wb.close()
        role=inspect_workbook(path)['charts'][0]['plots'][0]['series'][0]['values']; point=role['sources'][0]['points'][0]; self.assertEqual(role['cache_status'],'missing');self.assertEqual(point['source_reliability'],'formula_cache_missing');self.assertIsNone(point['value']);self.assertEqual(point['formula'],'=10+5')
    def test_agent_reads_tail_with_returned_request(self):
        path=self.root/'long.xlsx';wb=xlsxwriter.Workbook(path);ws=wb.add_worksheet('Ledger')
        for r in range(250):ws.write_row(r,0,[r+1,'Tail sentinel' if r==249 else 'row'])
        wb.close(); first=inspect_workbook(path,{'max_rows':10,'max_cols':2});nav=first['sheets'][0]['navigation'];next_req=next(x for x in nav['continuations'] if x['purpose']=='next_row_window_same_columns');second=inspect_workbook(path,next_req['options']);tail=inspect_workbook(path,nav['tail_read']['options'])
        self.assertEqual(second['sheets'][0]['sampled_range']['first_cell'],'A11');self.assertNotEqual(first['sheets'][0]['sampled_range'],second['sheets'][0]['sampled_range']);self.assertEqual(first['source_sha256'],tail['source_sha256']);self.assertTrue(any(c['value']=='Tail sentinel' for c in tail['sheets'][0]['cells']))
    def test_partial_row_resume_does_not_skip_unread_cells(self):
        path=self.root/'wide.xlsx';wb=xlsxwriter.Workbook(path);ws=wb.add_worksheet('Wide');ws.write_row(0,0,[1,2,3,4,5]);ws.write_row(1,0,[6,7,8,9,10]);wb.close()
        first=inspect_workbook(path,{'max_cols':5,'max_rows':2,'max_cells':3});request=first['sheets'][0]['navigation']['continuations'][0];self.assertEqual(request['purpose'],'finish_partial_row');resumed=inspect_workbook(path,request['options']);self.assertEqual([c['cell'] for c in resumed['sheets'][0]['cells']],['D1','E1'])
    def test_multilevel_labels_retain_order_and_original_indices(self):
        path=self.root/'levels.xlsx';wb=openpyxl.Workbook();ws=wb.active
        for row in [['Region','Product','Value'],['East','A',1],['East','B',2],['West','A',3]]:ws.append(row)
        chart=BarChart();chart.add_data(Reference(ws,min_col=3,min_row=1,max_row=4),titles_from_data=True);levels=[Level(pt=[StrVal(idx=i,v=v) for i,v in enumerate(vals)]) for vals in [['A','B','A'],['East','East','West']]];chart.series[0].cat=AxDataSource(multiLvlStrRef=MultiLevelStrRef(f="'Sheet'!$A$2:$B$4",multiLvlStrCache=MultiLevelStrData(lvl=levels)));ws.add_chart(chart,'E2');wb.save(path);wb.close()
        role=inspect_workbook(path)['charts'][0]['plots'][0]['series'][0]['categories'];stored=role['multi_level_caches'][0]['levels'];self.assertEqual([[p['value'] for p in lvl['points']] for lvl in stored],[['A','B','A'],['East','East','West']]);self.assertEqual(role['sources'][0]['point_mapping'],'two_dimensional_no_chart_point_mapping');self.assertIsNone(role['sources'][0]['points'][0]['point_index'])
    def test_source_read_budget_is_enforced_and_tail_is_actionable(self):
        path=self.root/'budget.xlsx';wb=xlsxwriter.Workbook(path);ws=wb.add_worksheet('Data')
        for r in range(500):ws.write_row(r,0,[r,r*2])
        for i in range(12):
            chart=wb.add_chart({'type':'line'});chart.add_series({'name':'N','categories':['Data',0,0,499,0],'values':['Data',0,1,499,1]});ws.insert_chart(i*20,3,chart)
        wb.close(); report=inspect_workbook(path);self.assertEqual(report['chart_source_sampling']['sampled_cells'],2000)
        last=report['charts'][-1]['plots'][0]['series'][0]['values']['sources'][0];self.assertEqual(last['sampled_cells'],0);self.assertTrue(last['truncated']);self.assertTrue(last['read_options'])
    def test_dates_compare_using_workbook_epoch_and_page_ids_are_stable(self):
        import datetime
        path=self.root/'dates.xlsx';wb=xlsxwriter.Workbook(path,{'date_1904':True});ws=wb.add_worksheet('Dates');fmt=wb.add_format({'num_format':'yyyy-mm-dd'});ws.write_datetime('A1',datetime.datetime(2026,1,1),fmt);ws.write('B1',10);chart=wb.add_chart({'type':'line'});chart.add_series({'categories':['Dates',0,0,0,0],'values':['Dates',0,1,0,1]});ws.insert_chart('D1',chart);wb.close()
        first=inspect_workbook(path);second=inspect_workbook(path);p=first['charts'][0]['plots'][0]['series'][0]['categories']['sources'][0]['points'][0]
        self.assertEqual(p['chart_cache_comparison'],'equal_stored_values_not_freshness_proof');self.assertIn('epoch',p['comparison_representation']);self.assertEqual(first['sheets'][0]['page_id'],second['sheets'][0]['page_id']);self.assertEqual(first['sheets'][0]['navigation']['tail_read']['expected_source_sha256'],first['source_sha256'])
    def test_truncated_chart_cache_does_not_raise_false_disagreement(self):
        path=self.root/'long-label.xlsx';wb=xlsxwriter.Workbook(path);ws=wb.add_worksheet('Labels');ws.write('A1','L'*1500);ws.write('B1',3);chart=wb.add_chart({'type':'column'});chart.add_series({'categories':['Labels',0,0,0,0],'values':['Labels',0,1,0,1]});ws.insert_chart('D1',chart);wb.close()
        report=inspect_workbook(path);role=report['charts'][0]['plots'][0]['series'][0]['categories'];point=role['sources'][0]['points'][0]
        self.assertTrue(role['caches'][0]['points'][0]['text_truncated']);self.assertTrue(point['text_truncated']);self.assertTrue(point['chart_cached_value_truncated']);self.assertEqual(point['chart_cache_comparison'],'not_comparable_truncated_cache');self.assertEqual(report['summary']['sampled_chart_source_disagreements'],0);self.assertEqual(role['sources'][0]['read_request']['expected_source_sha256'],report['source_sha256'])
    def test_continuation_rejects_changed_source_snapshot(self):
        path=self.fixture();first=inspect_workbook(path);request=first['sheets'][0]['navigation']['tail_read'];self.assertEqual(request['options']['expected_source_sha256'],first['source_sha256']);inspect_workbook(path,request['options'])
        source_request=first['charts'][0]['plots'][0]['series'][0]['values']['sources'][0]['read_request'];self.assertEqual(source_request['options']['expected_source_sha256'],first['source_sha256'])
        with zipfile.ZipFile(path,'a') as z:z.comment=b'changed after first inspection'
        with self.assertRaisesRegex(ValueError,'Source snapshot mismatch'):inspect_workbook(path,request['options'])
        with self.assertRaisesRegex(ValueError,'Source snapshot mismatch'):inspect_workbook(path,source_request['options'])
        new=inspect_workbook(path);self.assertNotEqual(first['source_sha256'],new['source_sha256'])
        with self.assertRaisesRegex(ValueError,'64-character'):inspect_workbook(path,{'expected_source_sha256':'wrong'})
    def test_small_relative_but_real_numeric_difference_not_hidden(self):
        path=self.root/'large-values.xlsx';wb=xlsxwriter.Workbook(path);ws=wb.add_worksheet('Large');ws.write_row('A1',[1,1000000000000]);chart=wb.add_chart({'type':'column'});chart.add_series({'categories':['Large',0,0,0,0],'values':['Large',0,1,0,1]});ws.insert_chart('D1',chart);wb.close()
        def change(blob):
            root=ET.fromstring(blob);ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'};root.find('.//c:val/c:numRef/c:numCache/c:pt/c:v',ns).text='1000000000001';return ET.tostring(root)
        self.patch(path,change);report=inspect_workbook(path);self.assertEqual(report['summary']['sampled_chart_source_disagreements'],1)
    def test_external_and_named_reference_not_resolved(self):
        for ref,status in [("'[outside.xlsx]Data'!$B$2:$B$4",'external_reference_not_fetched'),('RevenueName','unsupported_reference_expression'),("Sheet!A1:A2,Sheet!B1:B2",'unsupported_reference_expression')]:
            path=self.fixture()
            def change(blob):
                root=ET.fromstring(blob);ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'};root.find('.//c:val/c:numRef/c:f',ns).text=ref;return ET.tostring(root)
            self.patch(path,change);source=inspect_workbook(path)['charts'][0]['plots'][0]['series'][0]['values']['sources'][0];self.assertEqual(source['status'],status);self.assertNotIn('points',source)

if __name__=='__main__':unittest.main()
