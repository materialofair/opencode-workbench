"""Synthetic OOXML semantic fixtures, not a claim of Excel visual fidelity."""
import datetime
import io
import os
import json
import shutil
import hashlib
import struct
import tempfile
import unittest
import warnings
import zipfile
import zlib
from pathlib import Path
import openpyxl
import xlsxwriter
from openpyxl.chart import BubbleChart, RadarChart, Reference, Series
from office_engine.excel import inspect_workbook


def png():
    def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\0'))+chunk(b'IEND',b'')


class ChartFidelityTests(unittest.TestCase):
    def setUp(self): self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
    def tearDown(self):
        if os.environ.get('OFFICE_CHART_EVIDENCE'):
            dest=Path(os.environ['OFFICE_CHART_EVIDENCE'])/self._testMethodName; dest.mkdir(parents=True,exist_ok=True)
            for p in self.root.glob('*.xlsx'):
                shutil.copy2(p,dest/p.name)
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore',UserWarning)
                    try: report=inspect_workbook(p)
                    except Exception as error: report={'error':str(error)}
                (dest/(p.stem+'.report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2))
                (dest/'case.json').write_text(json.dumps({'case':self._testMethodName,'source':'synthetic fixture generated with pinned XlsxWriter/openpyxl; no production data','xlsx':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'types':[plot['type'] for chart in report.get('charts',[]) for plot in chart['plots']],'warnings':[w for c in report.get('charts',[]) for w in c['warnings']]},ensure_ascii=False,indent=2))
        self.temp.cleanup()
    def book(self,name='fixture'):
        p=self.root/(name+'.xlsx'); wb=xlsxwriter.Workbook(p); src=wb.add_worksheet('数据 来源'); view=wb.add_worksheet('图表页')
        src.write_row(0,0,['Date','Revenue','Margin'])
        for i in range(1,5):
            src.write_datetime(i,0,datetime.datetime(2026,11,i),wb.add_format({'num_format':'yyyy-mm-dd'})); src.write_number(i,1,i*10); src.write_number(i,2,i*.1)
        return p,wb,src,view
    def series(self,col=1,**kwargs):
        return {'name':['数据 来源',0,col],'categories':['数据 来源',1,0,4,0],'values':['数据 来源',1,col,4,col],**kwargs}
    def test_stacked_grouped_and_percent_stacked(self):
        p,wb,src,ws=self.book()
        for i,subtype in enumerate(['stacked','percent_stacked',None]):
            chart=wb.add_chart({'type':'column',**({'subtype':subtype} if subtype else {})}); chart.add_series(self.series()); chart.add_series(self.series(2)); ws.insert_chart(i*22,0,chart)
        wb.close(); r=inspect_workbook(p)
        self.assertEqual([c['plots'][0]['grouping']['val'] for c in r['charts']],['stacked','percentStacked','clustered'])
        self.assertTrue(all(c['sheets']==['图表页'] for c in r['charts']))
        self.assertEqual(r['sheets'][0]['chart_parts'],[])
    def test_combination_secondary_axis_cross_references(self):
        p,wb,src,ws=self.book(); col=wb.add_chart({'type':'column'}); col.add_series(self.series()); line=wb.add_chart({'type':'line'}); line.add_series(self.series(2,y2_axis=True)); col.combine(line); col.set_y2_axis({'num_format':'0.0%','min':0,'max':1}); ws.insert_chart('B3',col); wb.close()
        chart=inspect_workbook(p)['charts'][0]; self.assertEqual(len(chart['plots']),2)
        ids={a['id'] for a in chart['axes']}
        for plot in chart['plots']: self.assertTrue(set(plot['axis_ids'])<=ids)
        for axis in chart['axes']: self.assertIn(axis['crossAx']['val'],ids)
        self.assertTrue(any('Multiple axes' in w for w in chart['warnings']))
    def test_date_axis_formula_series_name_and_cross_sheet(self):
        p,wb,src,ws=self.book(); src.write_formula('B1','="Revenue"',None,'Revenue'); chart=wb.add_chart({'type':'line'}); chart.add_series(self.series()); chart.add_series(self.series(2)); chart.set_x_axis({'date_axis':True,'major_unit':1,'major_unit_type':'days','num_format':'yyyy-mm-dd'}); ws.insert_chart('B2',chart); wb.close()
        result=inspect_workbook(p); chart=result['charts'][0]; ser=chart['plots'][0]['series'][0]
        self.assertEqual(ser['name']['references'],["'数据 来源'!$B$1"]); self.assertEqual(ser['name']['caches'][0]['points'][0]['value'],'Revenue')
        self.assertIn("'数据 来源'!",ser['values']['references'][0]); axis=next(a for a in chart['axes'] if a['type']=='dateAx'); self.assertEqual(axis['majorTimeUnit']['val'],'days'); self.assertEqual(axis['numFmt']['formatCode'],'yyyy-mm-dd')
    def test_doughnut_metadata_and_explicit_boundary(self):
        p,wb,src,ws=self.book(); chart=wb.add_chart({'type':'doughnut'}); chart.add_series(self.series()); chart.set_hole_size(65); chart.set_rotation(30); ws.insert_chart('A1',chart); wb.close()
        chart=inspect_workbook(p)['charts'][0]; plot=chart['plots'][0]; self.assertEqual(plot['type'],'doughnutChart'); self.assertEqual(plot['holeSize']['val'],'65'); self.assertEqual(plot['firstSliceAng']['val'],'30'); self.assertTrue(any('not fully interpreted' in w for w in chart['warnings']))
    def test_bubble_and_radar_roles_with_explicit_boundaries(self):
        p=self.root/'openpyxl-types.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws.title='Lab'
        for row in [['x','y','size'],[1,10,4],[2,20,8],[3,12,6]]: ws.append(row)
        bubble=BubbleChart(); bubble.series.append(Series(values=Reference(ws,min_col=2,min_row=2,max_row=4),xvalues=Reference(ws,min_col=1,min_row=2,max_row=4),zvalues=Reference(ws,min_col=3,min_row=2,max_row=4),title='Bubble'))
        radar=RadarChart(); radar.type='filled'; radar.add_data(Reference(ws,min_col=2,max_col=3,min_row=1,max_row=4),titles_from_data=True); radar.set_categories(Reference(ws,min_col=1,min_row=2,max_row=4)); ws.add_chart(bubble,'E2'); ws.add_chart(radar,'E25'); wb.save(p); wb.close()
        charts=inspect_workbook(p)['charts']; bytype={c['plots'][0]['type']:c for c in charts}; ser=bytype['bubbleChart']['plots'][0]['series'][0]
        self.assertIsNotNone(ser['x_values']); self.assertIsNotNone(ser['y_values']); self.assertIsNotNone(ser['bubble_size']); self.assertTrue(bytype['bubbleChart']['warnings']); self.assertTrue(bytype['radarChart']['warnings'])
    def test_multilevel_categories_are_not_silently_flattened(self):
        from openpyxl.chart.data_source import MultiLevelStrRef,MultiLevelStrData,Level,StrVal,AxDataSource
        p=self.root/'multilevel.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws.title='数据 来源'
        for row in [['Region','Product','Sales'],['East','A',10],['East','B',20],['West','A',30],['West','B',40]]: ws.append(row)
        chart=openpyxl.chart.BarChart(); chart.add_data(Reference(ws,min_col=3,min_row=1,max_row=5),titles_from_data=True)
        levels=[Level(pt=[StrVal(idx=i,v=v) for i,v in enumerate(values)]) for values in [['A','B','A','B'],['East','East','West','West']]]
        chart.series[0].cat=AxDataSource(multiLvlStrRef=MultiLevelStrRef(f="'数据 来源'!$A$2:$B$5",multiLvlStrCache=MultiLevelStrData(lvl=levels)))
        ws.add_chart(chart,'E2'); wb.save(p); wb.close()
        with zipfile.ZipFile(p) as z: self.assertIn(b'multiLvlStrRef',z.read('xl/charts/chart1.xml'))
        chart=inspect_workbook(p)['charts'][0]; self.assertTrue(any('Multi-level' in w for w in chart['warnings'])); self.assertEqual(chart['plots'][0]['series'][0]['categories']['references'],["'数据 来源'!$A$2:$B$5"])
    def test_empty_cache_does_not_create_data(self):
        p=self.root/'uncached.xlsx'; wb=openpyxl.Workbook(); ws=wb.active
        ws.append(['X','Y']); ws.append([1,'=2+2']); ws.append([2,'=3+3']); chart=openpyxl.chart.LineChart(); chart.add_data(Reference(ws,min_col=2,min_row=1,max_row=3),titles_from_data=True); chart.set_categories(Reference(ws,min_col=1,min_row=2,max_row=3)); ws.add_chart(chart,'E2'); wb.save(p); wb.close()
        report=inspect_workbook(p); ser=report['charts'][0]['plots'][0]['series'][0]; self.assertEqual(ser['values']['caches'],[]); self.assertEqual(report['formula_status']['missing_caches_in_sample'],2)
    def test_image_and_chart_mixed_anchors(self):
        p,wb,src,ws=self.book(); ws.insert_image('A3','logo.png',{'image_data':io.BytesIO(png()),'object_position':1}); chart=wb.add_chart({'type':'line'}); chart.add_series(self.series()); ws.insert_chart('E5',chart); ws.insert_image('B27','logo2.png',{'image_data':io.BytesIO(png()),'object_position':2}); wb.close()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning); report=inspect_workbook(p)
        objects=report['sheets'][1]['drawing_objects']; self.assertEqual(len(objects),3)
        anchors={(o['kind'],o['anchor']['from']['row'],o['anchor']['from']['col']) for o in objects}; self.assertEqual(anchors,{('image',2,0),('chart',4,4),('image',26,1)})
    def test_generation_anchor_grid_limits(self):
        from office_engine.excel import generate_workbook
        for anchor in ('XFE1','ZZZ1','A1048577'):
            spec={'sheets':[{'name':'A','rows':[['x','y'],[1,2]],'charts':[{'type':'column','anchor':anchor,'series':[{'categories':['A',1,0,1,0],'values':['A',1,1,1,1]}]}]}]}
            with self.assertRaisesRegex(ValueError,'grid bounds'): generate_workbook(spec,self.root/'bad.xlsx')
            self.assertFalse((self.root/'bad.xlsx').exists())
        spec['sheets'][0]['charts'][0]['anchor']='XFD1'; generate_workbook(spec,self.root/'valid.xlsx'); self.assertEqual(len(inspect_workbook(self.root/'valid.xlsx')['charts']),1)
    def test_unknown_modern_chart_namespace_inventory(self):
        p,wb,src,ws=self.book(); wb.close()
        with zipfile.ZipFile(p,'a') as z: z.writestr('xl/charts/chartEx1.xml','<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart/></cx:chartSpace>')
        report=inspect_workbook(p); self.assertEqual(len(report['charts']),1); chart=report['charts'][0]; self.assertFalse(chart['supported']); self.assertTrue(any('Unsupported' in w for w in chart['warnings']))
    def test_hidden_data_and_empty_cell_policy_are_reported(self):
        """Regression: retain hidden-data and empty-cell rendering policy."""
        p,wb,src,ws=self.book(); src.set_row(2,None,None,{'hidden':True}); chart=wb.add_chart({'type':'line'}); chart.add_series(self.series()); chart.show_hidden_data(); chart.show_blanks_as('span'); ws.insert_chart('A1',chart); wb.close()
        report=inspect_workbook(p)['charts'][0]
        self.assertNotIn('plotVisOnly',report['visibility'])  # XlsxWriter omits this element for show_hidden_data.
        self.assertEqual(report['visibility']['dispBlanksAs']['val'],'span')
    def test_explicit_hidden_data_policy_is_retained(self):
        p,wb,src,ws=self.book(); chart=wb.add_chart({'type':'line'}); chart.add_series(self.series()); ws.insert_chart('A1',chart); wb.close()
        with zipfile.ZipFile(p) as z: parts={name:z.read(name) for name in z.namelist()}
        parts['xl/charts/chart1.xml']=parts['xl/charts/chart1.xml'].replace(b'<c:plotVisOnly val="1"/>',b'<c:plotVisOnly val="0"/>')
        with zipfile.ZipFile(p,'w') as z:
            for name,data in parts.items(): z.writestr(name,data)
        self.assertEqual(inspect_workbook(p)['charts'][0]['visibility']['plotVisOnly']['val'],'0')
    def test_formula_chart_title_reference_is_retained(self):
        """Regression: retain chart title strRef/cache without rich text."""
        p,wb,src,ws=self.book(); chart=wb.add_chart({'type':'line'}); chart.add_series(self.series()); chart.set_title({'name':"='数据 来源'!$B$1"}); ws.insert_chart('A1',chart); wb.close()
        report=inspect_workbook(p)['charts'][0]
        self.assertEqual(report['title_data']['references'],["'数据 来源'!$B$1"])

if __name__=='__main__': unittest.main()
