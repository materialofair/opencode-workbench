"""Offline XLSX analysis and creation. Never evaluates formulas or edits input files."""
from __future__ import annotations
import copy
import datetime as dt
import hashlib
import io
import math
import os
import posixpath
import re
import tempfile
import zipfile
import warnings
from pathlib import Path
from defusedxml import ElementTree as ET
import openpyxl
import xlsxwriter

MAX_FILE = 64 * 1024 * 1024
MAX_UNPACKED = 128 * 1024 * 1024
MAX_MEMBERS = 5000
MAX_CELLS = 100000
MAX_XML_NODES = 500000
MAX_SQREF_RANGES = 20000
MAX_XML_ATTRIBUTE = 65536
MAX_SHARED_STRINGS = 200000
MAX_STYLE_RECORDS = 10000
NS = {'c':'http://schemas.openxmlformats.org/drawingml/2006/chart', 'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
FORMATS = {'header': {'bold':True,'bg_color':'#17324D','font_color':'#FFFFFF','text_wrap':True}, 'integer':{'num_format':'#,##0'}, 'number':{'num_format':'#,##0.00'}, 'percent':{'num_format':'0.0%'}, 'currency':{'num_format':'#,##0.00;[Red](#,##0.00)'}, 'date':{'num_format':'yyyy-mm-dd'}, 'wrap':{'text_wrap':True}, 'total':{'bold':True,'top':1,'num_format':'#,##0.00'}}
SAFE_FUNCTIONS = set('SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF COUNTIFS SUMIF SUMIFS IF IFS IFERROR AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS MOD INT SUBTOTAL SUMPRODUCT INDEX MATCH XLOOKUP VLOOKUP HLOOKUP LEFT RIGHT MID LEN TRIM CONCAT CONCATENATE TEXT DATE YEAR MONTH DAY EOMONTH TODAY'.split())


def _int(v, low, high, name):
    if isinstance(v, bool) or not isinstance(v,int) or not low <= v <= high:
        raise ValueError(f'{name} must be an integer in [{low}, {high}]')
    return v


def _json(v):
    if isinstance(v,(dt.datetime,dt.date,dt.time)): return v.isoformat()
    if isinstance(v,float) and not math.isfinite(v): return str(v)
    if v is None or isinstance(v,(str,int,float,bool)): return v
    return {'unsupported_type':type(v).__name__}


def _formula_details(value):
    if isinstance(value,str): return 'normal', {'type':'normal'}, value
    kind=getattr(value,'t',None)
    if kind=='array': return 'array', {'type':'array','ref':getattr(value,'ref',None)}, getattr(value,'text',None)
    if kind=='dataTable': return 'dataTable', {'type':'dataTable',**{key:_json(getattr(value,key,None)) for key in ('ref','ca','dt2D','dtr','r1','r2','del1','del2')}}, None
    return 'unsupported', {'type':'unsupported','class':type(value).__name__}, None


def _load_book(path, data_only):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        book=openpyxl.load_workbook(path,data_only=data_only,keep_links=False)
    notes=[{'category':warning.category.__name__,'message':str(warning.message)[:1000]} for warning in caught[:200]]
    if len(caught)>200: notes.append({'category':'Truncation','message':'Library warnings truncated after 200 entries'})
    return book,notes


def _rich_text(node):
    if node is None: return ''
    paragraphs=node.findall('.//a:p',NS)
    if paragraphs: return '\n'.join(''.join(run.text or '' for run in paragraph.findall('.//a:t',NS)) for paragraph in paragraphs)
    return ''.join(run.text or '' for run in node.findall('.//a:t',NS))


def _text(v, name='text', limit=32767):
    if not isinstance(v,str) or len(v)>limit or any(ord(c)<32 and c not in '\t\r\n' for c in v):
        raise ValueError(f'invalid {name}')
    return v


def _archive(path, data=None):
    p=Path(path)
    if p.suffix.lower() not in ('.xlsx','.xlsm','.xltx','.xltm'):
        raise ValueError('Only OOXML XLSX/XLSM/XLTX/XLTM inspection is supported; XLS/XLSB require an explicit separate converter')
    if data is None:
        if not p.is_file() or p.stat().st_size>MAX_FILE: raise ValueError('Workbook missing or exceeds 64 MiB')
    elif len(data)>MAX_FILE: raise ValueError('Workbook exceeds 64 MiB')
    z=zipfile.ZipFile(p if data is None else io.BytesIO(data))
    try:
        infos=z.infolist()
        if len(infos)>MAX_MEMBERS or sum(i.file_size for i in infos)>MAX_UNPACKED: raise ValueError('Archive exceeds resource budget')
        names=[i.filename for i in infos]
        if len(set(names))!=len(names): raise ValueError('Duplicate archive members')
        for i in infos:
            if i.flag_bits&1 or i.filename.startswith(('/', '\\')) or '\\' in i.filename or '..' in i.filename.split('/'):
                raise ValueError('Unsafe archive member')
            if i.file_size>32*1024*1024 or (i.file_size>1024*1024 and i.file_size/max(i.compress_size,1)>200):
                raise ValueError('Suspicious archive expansion')
        if 'xl/workbook.xml' not in names: raise ValueError('Missing workbook part')
        # Streaming preflight releases elements before a full OOXML loader sees them.
        # ZIP byte limits alone do not bound XML nodes or normal-mode range expansion.
        cell_count=0; sheet_count=0; node_count=0; sqref_count=0; string_count=0; style_count=0
        for info in infos:
            if not info.filename.endswith(('.xml','.rels')): continue
            stack=[]; part_kind=None
            with z.open(info) as stream:
                for event,node in ET.iterparse(stream,events=('start','end')):
                    local=node.tag.split('}')[-1]
                    if event=='start':
                        node_count+=1
                        if node_count>MAX_XML_NODES: raise ValueError('Workbook exceeds XML node budget')
                        if not stack:
                            part_kind=local
                            if part_kind in ('worksheet','chartsheet'):
                                sheet_count+=1
                                if sheet_count>100: raise ValueError('Workbook exceeds 100 sheets')
                        if len(node.attrib)>100 or any(len(v)>MAX_XML_ATTRIBUTE for v in node.attrib.values()): raise ValueError('Workbook exceeds XML attribute budget')
                        for key,value in node.attrib.items():
                            if key.split('}')[-1]=='sqref':
                                for token in re.finditer(r'\S+',value):
                                    sqref_count+=1
                                    if sqref_count>MAX_SQREF_RANGES: raise ValueError('Workbook exceeds sqref range budget')
                                    try:
                                        bounds=openpyxl.utils.cell.range_boundaries(token.group())
                                        if None in bounds: raise ValueError()
                                    except (TypeError,ValueError) as error: raise ValueError('Invalid sqref range') from error
                        if part_kind=='worksheet':
                            if local=='c': cell_count+=1
                            elif local in ('mergeCell','hyperlink'):
                                try:
                                    c1,r1,c2,r2=openpyxl.utils.cell.range_boundaries(node.get('ref',''))
                                    if None in (r1,r2,c1,c2) or not 1<=r1<=r2<=1048576 or not 1<=c1<=c2<=16384: raise ValueError('Invalid bounds')
                                except (TypeError,ValueError) as error: raise ValueError('Invalid merge/hyperlink range in workbook') from error
                                cell_count+=(r2-r1+1)*(c2-c1+1)
                            if cell_count>200000: raise ValueError('Workbook exceeds 200000 stored cells plus merged expansion and hyperlink expansion; split or use a streaming adapter')
                        elif part_kind=='sst' and local=='si':
                            string_count+=1
                            if string_count>MAX_SHARED_STRINGS: raise ValueError('Workbook exceeds shared string budget')
                        elif part_kind=='styleSheet' and local in ('xf','dxf'):
                            style_count+=1
                            if style_count>MAX_STYLE_RECORDS: raise ValueError('Workbook exceeds style record budget')
                        stack.append(node)
                    else:
                        stack.pop()
                        if stack: stack[-1].remove(node)
                        node.clear()
        return z, names
    except BaseException:
        z.close(); raise


def _chart_role(node):
    if node is None: return None
    caches=[]
    for cache in node.iter():
        kind=cache.tag.split('}')[-1]
        if kind not in ('numCache','strCache','numLit','strLit'): continue
        points=cache.findall('c:pt',NS)
        caches.append({'kind':kind,'format_code':cache.findtext('c:formatCode',default=None,namespaces=NS),'points':[{'index':p.get('idx'),'value':p.findtext('c:v',default='',namespaces=NS)[:1000]} for p in points[:200]],'truncated':len(points)>200})
    return {'references':[(x.text or '')[:8192] for x in node.findall('.//c:f',NS)[:20]],'caches':caches,'literal_text':[(x.text or '')[:1000] for x in node.findall('c:v',NS)]}


def _attributes(node, names):
    values={}
    for name in names:
        child=node.find('c:'+name,NS)
        if child is not None: values[name]=dict(child.attrib)
    return values


def _charts(z, names):
    result=[]
    for name in names:
        if not name.endswith('.xml'): continue
        root=ET.fromstring(z.read(name))
        if root.tag!='{http://schemas.openxmlformats.org/drawingml/2006/chart}chartSpace':
            if root.tag.split('}')[-1] in ('chartSpace','chartEx'):
                result.append({'part':name,'title':'','plots':[],'axes':[],'format_namespace':root.tag.split('}')[0].lstrip('{'),'supported':False,'warnings':['Unsupported modern or unknown chart format; inventory only, no semantic interpretation']})
            continue
        plots=[]; warnings=[]
        plot=root.find('.//c:plotArea',NS)
        if plot is not None:
            for node in plot:
                kind=node.tag.split('}')[-1]
                if kind.endswith('Chart'):
                    series=[]
                    for ser in node.findall('c:ser',NS)[:20]:
                        roles={key:_chart_role(ser.find('c:'+tag,NS)) for key,tag in [('name','tx'),('categories','cat'),('values','val'),('x_values','xVal'),('y_values','yVal'),('bubble_size','bubbleSize')]}
                        refs=[ref for role in roles.values() if role for ref in role['references']]
                        caches=[cache for role in roles.values() if role for cache in role['caches']]
                        series.append({'references':refs,'caches':caches,**roles,**_attributes(ser,['idx','order','invertIfNegative','smooth'])})
                    plots.append({'type':kind,'series':series,'series_truncated':len(node.findall('c:ser',NS))>20,'axis_ids':[x.get('val') for x in node.findall('c:axId',NS)],**_attributes(node,['barDir','grouping','scatterStyle','varyColors','gapWidth','overlap','holeSize','firstSliceAng'])})
                    if kind not in ('barChart','lineChart','pieChart','scatterChart','areaChart'): warnings.append('Chart family '+kind+' inventoried but not fully interpreted')
                    if node.findall('.//c:multiLvlStrRef',NS): warnings.append('Multi-level category labels require manual review')
        axes=[]
        for kind in ('catAx','valAx','dateAx','serAx'):
            for ax in root.findall('.//c:'+kind,NS):
                entry={'type':kind,'id':ax.find('c:axId',NS).get('val') if ax.find('c:axId',NS) is not None else None,'title':_rich_text(ax.find('c:title',NS)),**_attributes(ax,['crossAx','axPos','numFmt','crosses','crossesAt','majorUnit','minorUnit','baseTimeUnit','majorTimeUnit','minorTimeUnit','delete'])}
                scaling=ax.find('c:scaling',NS)
                if scaling is not None: entry['scaling']=_attributes(scaling,['min','max','orientation','logBase'])
                axes.append(entry)
        if len(plots)>1: warnings.append('Combination chart: inspect plot axis_ids and axes; visual fidelity is not validated')
        if len(axes)>2: warnings.append('Multiple axes: relationships are reported; visual alignment is not validated')
        title=root.find('.//c:chart/c:title',NS)
        title_data=_chart_role(title)
        chart_node=root.find('c:chart',NS)
        visibility=_attributes(chart_node,['plotVisOnly','dispBlanksAs','showDLblsOverMax']) if chart_node is not None else {}
        result.append({'part':name,'title':_rich_text(title), 'title_data':title_data,'visibility':visibility,'plots':plots,'axes':axes,'warnings':warnings})
    return result


REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
SHEET_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'


def _relationships(z, part, names):
    relpath=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
    if relpath not in names: return {}
    rels={}
    for rel in ET.fromstring(z.read(relpath)):
        target=rel.get('Target',''); external=rel.get('TargetMode')=='External'
        resolved=None
        if not external:
            resolved=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(part),target))
            if resolved.startswith('../') or resolved not in names: resolved=None
        rels[rel.get('Id')]={'target':target,'part':resolved,'external':external,'type':rel.get('Type','')}
    return rels


def _drawing_map(z, names):
    """Resolve relationships by IDs, never sheet/chart filename numbering."""
    mapping={}; bookrels=_relationships(z,'xl/workbook.xml',names)
    root=ET.fromstring(z.read('xl/workbook.xml'))
    for sheet in root.findall('{'+SHEET_NS+'}sheets/{'+SHEET_NS+'}sheet'):
        relation=bookrels.get(sheet.get('{'+REL_NS+'}id'),{})
        part=relation.get('part'); entry={'part':part,'objects':[],'warnings':[]}
        mapping[sheet.get('name')]=entry
        if not part:
            entry['warnings'].append('Worksheet relationship missing or external'); continue
        sheetroot=ET.fromstring(z.read(part)); rels=_relationships(z,part,names)
        for drawing in sheetroot.findall('{'+SHEET_NS+'}drawing'):
            rel=rels.get(drawing.get('{'+REL_NS+'}id'),{})
            drawing_part=rel.get('part')
            if not drawing_part:
                entry['warnings'].append('Drawing relationship missing or external'); continue
            drawrels=_relationships(z,drawing_part,names)
            for anchor in ET.fromstring(z.read(drawing_part)):
                anchor_type=anchor.tag.split('}')[-1]
                if anchor_type not in ('twoCellAnchor','oneCellAnchor','absoluteAnchor'): continue
                geometry={'type':anchor_type,'coordinate_base':0,'offset_unit':'EMU'}
                for item in anchor:
                    kind=item.tag.split('}')[-1]
                    if kind in ('from','to'):
                        geometry[kind]={x.tag.split('}')[-1]:int(x.text) for x in item if (x.text or '').lstrip('-').isdigit()}
                    elif kind in ('pos','ext'): geometry[kind]=dict(item.attrib)
                for item in anchor.iter():
                    kind=item.tag.split('}')[-1]
                    rid=item.get('{'+REL_NS+'}id') if kind=='chart' else (item.get('{'+REL_NS+'}embed') or item.get('{'+REL_NS+'}link')) if kind=='blip' else None
                    if rid:
                        target=drawrels.get(rid,{})
                        entry['objects'].append({'kind':'chart' if kind=='chart' else 'image','drawing_part':drawing_part,'relationship_id':rid,'part':target.get('part'),'target':target.get('target'),'external':target.get('external',False),'anchor':geometry})
                if len(entry['objects'])>200:
                    entry['objects']=entry['objects'][:200]; entry['warnings'].append('Drawing objects truncated at 200'); break
    return mapping


def _sheet_metadata(ws):
    validations=list(ws.data_validations.dataValidation) if ws.data_validations else []
    dv=[{'range':str(v.sqref),'type':v.type,'operator':v.operator,'formula1':(v.formula1 or '')[:8192],'formula2':(v.formula2 or '')[:8192],'allow_blank':v.allowBlank,'show_error':v.showErrorMessage} for v in validations[:200]]
    cf=[]; count=0
    for region in ws.conditional_formatting:
        for rule in ws.conditional_formatting[region]:
            count+=1
            if count>200: continue
            item={'range':str(region.sqref),'type':rule.type,'operator':rule.operator,'priority':rule.priority,'stop_if_true':rule.stopIfTrue,'formulas':[(x or '')[:8192] for x in rule.formula[:20]]}
            for kind in ('colorScale','dataBar','iconSet'):
                obj=getattr(rule,kind,None)
                if obj is not None: item[kind]={'thresholds':[{'type':x.type,'value':_json(x.val)} for x in obj.cfvo[:20]]}
            cf.append(item)
    return {'data_validations':dv,'data_validations_truncated':len(validations)>200,'conditional_formats':cf,'conditional_formats_truncated':count>200}


def inspect_workbook(path, options=None):
    if options is None: options={}
    _known_fields(options,{'sheets','start_row','start_col','max_rows','max_cols','max_cells','max_cell_chars'},'inspection options')
    max_rows=_int(options.get('max_rows',100),1,2000,'max_rows')
    max_cols=_int(options.get('max_cols',50),1,200,'max_cols')
    start_row=_int(options.get('start_row',1),1,1048576,'start_row')
    start_col=_int(options.get('start_col',1),1,16384,'start_col')
    budget=_int(options.get('max_cells',10000),1,MAX_CELLS,'max_cells')
    char_limit=_int(options.get('max_cell_chars',1000),1,32767,'max_cell_chars')
    selection=options.get('sheets')
    if selection is not None and (not isinstance(selection,list) or not selection or len(selection)>100 or any(not isinstance(x,str) for x in selection) or len(set(selection))!=len(selection)): raise ValueError('sheets must be a nonempty list of distinct exact sheet names')
    if Path(path).suffix.lower() not in ('.xlsx','.xlsm','.xltx','.xltm'): raise ValueError('Only OOXML XLSX/XLSM/XLTX/XLTM inspection is supported; XLS/XLSB require an explicit separate converter')
    if not Path(path).is_file() or Path(path).stat().st_size>MAX_FILE: raise ValueError('Workbook missing or exceeds 64 MiB')
    with open(path,'rb') as source_file:
        before=os.fstat(source_file.fileno())
        source_bytes=source_file.read(MAX_FILE+1)
        after=os.fstat(source_file.fileno())
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns): raise ValueError('Source changed while taking workbook snapshot; retry after editing stops')
    z,names=_archive(path,source_bytes)
    try:
        feature_prefixes={'charts':'xl/charts/','drawings':'xl/drawings/','pivot_tables':'xl/pivotTables/','pivot_caches':'xl/pivotCache/','external_links':'xl/externalLinks/','embeddings':'xl/embeddings/','slicers':'xl/slicers/','connections':'xl/connections'}
        features={k:[n for n in names if n.startswith(v) and not n.endswith('/')] for k,v in feature_prefixes.items()}
        features['macros']=[n for n in names if 'vbaProject' in n]
        external=[]
        for n in names:
            if n.endswith('.rels'):
                for rel in ET.fromstring(z.read(n)):
                    if rel.get('TargetMode')=='External': external.append({'part':n,'type':rel.get('Type'),'target':rel.get('Target'),'risk':'external_resource_not_fetched'})
        charts=_charts(z,names); drawings=_drawing_map(z,set(names))
    finally: z.close()
    wb,library_warnings=_load_book(io.BytesIO(source_bytes),False)
    cached=None
    sheets=[]; missing=0; sampled=0; remaining_chars=2_000_000
    try:
        if selection is not None and any(name not in wb.sheetnames for name in selection): raise ValueError('Unknown sheet selection: '+', '.join(name for name in selection if name not in wb.sheetnames))
        cached,cache_warnings=_load_book(io.BytesIO(source_bytes),True)
        for warning in cache_warnings:
            if warning not in library_warnings: library_warnings.append(warning)
        for name in wb.sheetnames:
            ws=wb[name]
            if selection is not None and ws.title not in selection: continue
            if isinstance(ws,openpyxl.chartsheet.Chartsheet):
                info=drawings.get(ws.title,{'objects':[],'warnings':[]})
                sheets.append({'name':ws.title,'kind':'chartsheet','state':ws.sheet_state,'dimensions':None,'cells':[],'formulas':[],'requested_window':None,'sampled_range':None,'window_complete':True,'truncated':False,'truncation_reasons':[],'chart_parts':[o['part'] for o in info['objects'] if o['kind']=='chart' and o['part']],'drawing_objects':info['objects'],'drawing_warnings':info['warnings'],'note':'Chart-only sheet has no worksheet cell grid'})
                continue
            vals=[]; formulas=[]; spans=[]; sheet_sampled=0
            end_row=min(ws.max_row,start_row+max_rows-1,1048576); end_col=min(ws.max_column,start_col+max_cols-1,16384)
            window_count=max(0,end_row-start_row+1)*max(0,end_col-start_col+1)
            if start_row<=end_row and start_col<=end_col:
                for row in ws.iter_rows(min_row=start_row,max_row=end_row,min_col=start_col,max_col=end_col):
                    row_first=None; row_last=None
                    for c in row:
                        if sampled>=budget: break
                        sampled+=1; sheet_sampled+=1
                        row_first=row_first or c.coordinate; row_last=c.coordinate
                        if c.value is None: continue
                        formula_type,formula_metadata,expression=_formula_details(c.value) if c.data_type=='f' else (None,None,None)
                        value=expression if c.data_type=='f' else _json(c.value); clipped=False
                        if isinstance(value,str):
                            limit=min(char_limit,remaining_chars); clipped=len(value)>limit; value=value[:limit]; remaining_chars-=len(value)
                        item={'cell':c.coordinate,'value':value,'type':c.data_type,'format':c.number_format,'text_truncated':clipped}
                        if c.data_type=='f':
                            cv=_json(cached[ws.title][c.coordinate].value)
                            if isinstance(cv,str): cv=cv[:min(char_limit,remaining_chars)]; remaining_chars-=len(cv)
                            item['formula_type']=formula_type; item['formula_metadata']=formula_metadata
                            item['cached_value']=cv; item['cache_status']='missing' if cv is None else 'unverified'
                            formulas.append({'cell':c.coordinate,'formula':value,'formula_type':formula_type,'formula_metadata':formula_metadata,'cached_value':cv,'cache_status':item['cache_status'],'text_truncated':clipped})
                            missing+=int(cv is None)
                        vals.append(item)
                    if row_first: spans.append(row_first+':'+row_last)
                    if sampled>=budget: break
            reasons=[]
            if start_row>1 or start_col>1: reasons.append('window_starts_after_A1')
            if end_row<ws.max_row: reasons.append('rows_after_window')
            if end_col<ws.max_column: reasons.append('columns_after_window')
            if window_count>sheet_sampled: reasons.append('cell_budget_exhausted')
            if any(c['text_truncated'] for c in vals): reasons.append('cell_text_truncated')
            drawing_info=drawings.get(ws.title,{'part':None,'objects':[],'warnings':[]})
            chart_parts=[o['part'] for o in drawing_info['objects'] if o['kind']=='chart' and o['part']]
            sheets.append({'name':ws.title,'kind':'worksheet','state':ws.sheet_state,'dimensions':{'rows':ws.max_row,'columns':ws.max_column},'requested_window':{'start_row':start_row,'start_col':start_col,'max_rows':max_rows,'max_cols':max_cols,'coordinate_base':1},'sampled_range':{'first_cell':spans[0].split(':')[0] if spans else None,'last_cell':spans[-1].split(':')[-1] if spans else None,'cell_count':sheet_sampled,'row_spans':spans},'window_complete':window_count==sheet_sampled,'merged_ranges':[str(r) for r in ws.merged_cells.ranges], 'tables':[{'name':t.name,'ref':t.ref} for t in ws.tables.values()], 'freeze_panes':str(ws.freeze_panes) if ws.freeze_panes else None,'autofilter':ws.auto_filter.ref,'cells':vals,'formulas':formulas,'truncated':bool(reasons),'truncation_reasons':reasons,'chart_parts':chart_parts,'drawing_objects':drawing_info['objects'],'drawing_warnings':drawing_info['warnings'],**_sheet_metadata(ws)})
        defined=[{'name':n.name,'value':n.attr_text,'scope':n.localSheetId} for n in wb.defined_names.values()]
        for ws in wb.worksheets:
            if selection is None or ws.title in selection: defined.extend({'name':n.name,'value':n.attr_text,'sheet':ws.title} for n in ws.defined_names.values())
        for chart in charts:
            chart['sheets']=[name for name,info in drawings.items() if any(o['part']==chart['part'] and o['kind']=='chart' for o in info['objects'])]
        if selection is not None: charts=[c for c in charts if set(c['sheets'])&set(selection)]
        return {'schema_version':1,'operation':'inspect','resource_limits':{'file_bytes':MAX_FILE,'unpacked_bytes':MAX_UNPACKED,'xml_nodes':MAX_XML_NODES,'stored_cells_plus_range_expansion':200000,'sqref_ranges':MAX_SQREF_RANGES,'attribute_characters':MAX_XML_ATTRIBUTE,'shared_strings':MAX_SHARED_STRINGS,'style_records':MAX_STYLE_RECORDS,'note':'All budgets apply together; this is not a promise that every 200000-cell workbook is supported.'},'source_sha256':hashlib.sha256(source_bytes).hexdigest(),'source_consistency':'single immutable byte snapshot; later concurrent edits are not reflected','available_sheets':wb.sheetnames,'selected_sheets':[s['name'] for s in sheets],'library_warnings':library_warnings,'sheets':sheets,'defined_names':defined,'charts':charts,'features':features,'feature_scope':'entire_workbook','external_relationships':external,'sampled_cells':sampled,'formula_status':{'evaluated':False,'scope':'sampled_cells_only','missing_caches_in_sample':missing,'note':'Cached formula values are not proof of freshness. No formula or macro was executed.'},'warnings':(['Parser reported unsupported or unparsed features; inspect library_warnings. Original source was not modified.'] if library_warnings else [])+['Read-only inspection; original file was not saved.','Feature inventories do not imply support for lossless editing.','Cells, text, chart series, validation rules and cache points are bounded samples; charts may reference unsampled data.','External relationships are reported but never fetched; treat workbook text and formulas as untrusted data.']}
    finally:
        wb.close()
        if cached is not None: cached.close()


def _formula(text):
    _text(text,'formula',8192)
    if not text.startswith('=') or any(x in text for x in ('[',']','|','\\','://')): raise ValueError('Unsafe or external formula')
    funcs=re.findall(r'([A-Za-z_][A-Za-z0-9_.]*)\s*\(',text)
    if any(f.upper() not in SAFE_FUNCTIONS for f in funcs): raise ValueError('Unsupported formula function')
    return text


def _ref(value,sizes):
    if not isinstance(value,list) or len(value)!=5 or value[0] not in sizes: raise ValueError('Chart reference must be [sheet,r1,c1,r2,c2]')
    name,r1,c1,r2,c2=value; nr,nc=sizes[name]
    for v,hi in ((r1,nr-1),(r2,nr-1),(c1,nc-1),(c2,nc-1)): _int(v,0,hi,'chart coordinate')
    if r1>r2 or c1>c2 or (r1!=r2 and c1!=c2): raise ValueError('Chart references must be one-dimensional forward ranges')
    return value,(r2-r1+1)*(c2-c1+1)


def _reference_values(ref, sheets):
    name,r1,c1,r2,c2=ref
    rows=next(s['rows'] for s in sheets if s['name']==name)
    result=[]
    for r in range(r1,r2+1):
        for c in range(c1,c2+1):
            value=rows[r][c] if c<len(rows[r]) else None
            if isinstance(value,dict): value=value.get('cached') if 'formula' in value else value.get('value')
            result.append(value)
    return result


def _range(v,nr,nc):
    if not isinstance(v,list) or len(v)!=4: raise ValueError('range must be [r1,c1,r2,c2]')
    for x,hi in zip(v,[nr-1,nc-1,nr-1,nc-1]): _int(x,0,hi,'range coordinate')
    if v[0]>v[2] or v[1]>v[3]: raise ValueError('Reversed range')
    return v


def _known_fields(value,allowed,label):
    if not isinstance(value,dict): raise ValueError(label+' must be an object')
    unknown=set(value)-allowed
    if unknown: raise ValueError('Unknown '+label+' fields: '+', '.join(sorted(unknown)))


def _shared_charts(spec):
    spec=copy.deepcopy(spec)
    shared=spec.pop('charts',[])
    if not isinstance(shared,list) or len(shared)>20: raise ValueError('At most 20 shared charts')
    for index,chart in enumerate(shared):
        _known_fields(chart,{'type','title','categories','series','unit'},'shared chart')
        name=f'ChartData{index+1}'
        if any(s.get('name','').casefold()==name.casefold() for s in spec.get('sheets',[])): raise ValueError('Reserved chart-data sheet name collision')
        categories=chart.get('categories'); series=chart.get('series')
        if chart.get('type') not in ('bar','line','pie') or not isinstance(categories,list) or not 1<=len(categories)<=2000 or not isinstance(series,list) or not 1<=len(series)<=20: raise ValueError('Invalid shared chart')
        if chart['type']=='pie' and (len(series)!=1 or not isinstance(series[0].get('values'),list) or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in series[0]['values']) or sum(series[0]['values'])<=0): raise ValueError('Pie chart requires exactly one nonnegative, nonzero-total series')
        for category in categories: _text(category,'category',255)
        rows=[['Category']+[_text(x.get('name'),'series name',255) for x in series]]
        for i,category in enumerate(categories):
            row=[category]
            for ser in series:
                _known_fields(ser,{'name','values'},'shared chart series')
                values=ser.get('values')
                if not isinstance(values,list) or len(values)!=len(categories): raise ValueError('Shared chart lengths differ')
                v=values[i]
                if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v): raise ValueError('Shared chart requires finite numbers')
                row.append(v)
            rows.append(row)
        native={'type':'column' if chart['type']=='bar' else chart['type'],'title':chart.get('title',''),'anchor':'H2','series':[{'name':ser['name'],'categories':[name,1,0,len(categories),0],'values':[name,1,i+1,len(categories),i+1]} for i,ser in enumerate(series)]}
        if 'unit' in chart: native['unit']=_text(chart['unit'],'chart unit',100)
        spec.setdefault('sheets',[]).append({'name':name,'rows':rows,'freeze':[1,1],'charts':[native]})
    return spec


def generate_workbook(spec, output):
    _known_fields(spec,{'sheets','charts'},'workbook spec')
    if 'sheets' in spec and (not isinstance(spec['sheets'],list) or any(not isinstance(x,dict) for x in spec['sheets'])): raise ValueError('sheets must be an array of objects')
    spec=_shared_charts(spec)
    if not isinstance(spec,dict) or not isinstance(spec.get('sheets'),list) or not 1<=len(spec['sheets'])<=50: raise ValueError('Provide 1..50 sheets')
    out=Path(output)
    if out.suffix.lower()!='.xlsx': raise ValueError('Generation output must be .xlsx')
    if out.exists(): raise FileExistsError('Refusing to overwrite an existing output')
    sizes={}; names=set(); total=0
    for s in spec['sheets']:
        _known_fields(s,{'name','rows','header','freeze','autofilter','columns','merges','validations','conditional_formats','charts'},'sheet')
        for flag in ('header','autofilter'):
            if flag in s and not isinstance(s[flag],bool): raise ValueError(flag+' must be boolean')
        for array in ('columns','merges','validations','conditional_formats','charts'):
            if array in s and (not isinstance(s[array],list) or len(s[array])>1000): raise ValueError(array+' must be an array with at most 1000 entries')
        name=_text(s.get('name'),'sheet name',31)
        if not name or re.search(r"[\[\]:*?/\\]",name) or name.startswith("'") or name.endswith("'") or name.casefold() in names: raise ValueError('Invalid or duplicate sheet name')
        names.add(name.casefold())
        rows=s.get('rows')
        if not isinstance(rows,list) or not rows or any(not isinstance(r,list) for r in rows): raise ValueError('rows must be a nonempty array of arrays')
        nr=len(rows); nc=max(map(len,rows),default=0)
        _int(nr,1,100000,'row count'); _int(nc,1,1000,'column count')
        total+=nr*nc
        if total>MAX_CELLS: raise ValueError('Generation exceeds 100000-cell budget')
        sizes[name]=(nr,nc)
    if not out.parent.is_dir(): raise ValueError('Output directory must already exist')
    fd,tmp=tempfile.mkstemp(prefix='.office-',suffix='.xlsx',dir=out.parent); os.close(fd)
    wb=None; pending=[]; formula_count=0
    try:
        wb=xlsxwriter.Workbook(tmp,{'strings_to_formulas':False,'strings_to_urls':False,'tmpdir':str(out.parent)})
        formats={k:wb.add_format(v) for k,v in FORMATS.items()}
        wb.set_calc_mode('auto')
        for s in spec['sheets']:
            ws=wb.add_worksheet(s['name']); nr,nc=sizes[s['name']]
            ws.hide_gridlines(2); ws.set_default_row(21); ws.set_column(0,nc-1,18)
            for r,row in enumerate(s['rows']):
                for c,cell in enumerate(row):
                    fmt=None; value=cell
                    if isinstance(cell,dict):
                        _known_fields(cell,{'value','formula','cached','format'},'cell')
                        if ('formula' in cell)==('value' in cell): raise ValueError('Cell requires exactly one of value or formula')
                        if 'cached' in cell and 'formula' not in cell: raise ValueError('cached is only valid with formula')
                        fmtname=cell.get('format')
                        if fmtname is not None and fmtname not in formats: raise ValueError('Unknown named format')
                        fmt=formats.get(fmtname)
                        if 'formula' in cell:
                            formula_count+=1; formula=_formula(cell['formula'])
                            cache=cell.get('cached','')
                            if not isinstance(cache,(str,int,float,bool)) or isinstance(cache,float) and not math.isfinite(cache): raise ValueError('Invalid cached formula value')
                            if isinstance(cache,str): _text(cache,'cached value')
                            if 'cached' not in cell: pending.append({'sheet':s['name'],'row':r,'column':c})
                            ws.write_formula(r,c,formula,fmt,cache); continue
                        if 'value' not in cell: raise ValueError('Cell object requires value or formula')
                        value=cell['value']
                    if value is None: ws.write_blank(r,c,None,fmt)
                    elif isinstance(value,bool): ws.write_boolean(r,c,value,fmt)
                    elif isinstance(value,(int,float)):
                        if not math.isfinite(value): raise ValueError('Nonfinite number')
                        ws.write_number(r,c,value,fmt)
                    elif isinstance(value,str): ws.write_string(r,c,_text(value),fmt)
                    else: raise ValueError('Unsupported cell value')
            if s.get('header',True): ws.set_row(0,30,formats['header'])
            if 'freeze' in s:
                f=s['freeze']
                if not isinstance(f,list) or len(f)!=2: raise ValueError('freeze requires [row,col]')
                ws.freeze_panes(_int(f[0],0,nr,'freeze row'),_int(f[1],0,nc,'freeze col'))
            if s.get('autofilter'): ws.autofilter(0,0,nr-1,nc-1)
            for c,col in enumerate(s.get('columns',[])):
                _known_fields(col,{'width','format'},'column')
                if c>=nc or not isinstance(col,dict): raise ValueError('Invalid column')
                width=col.get('width',18)
                if not isinstance(width,(int,float)) or not 1<=width<=100: raise ValueError('Column width must be 1..100')
                fmtname=col.get('format')
                if fmtname is not None and fmtname not in formats: raise ValueError('Unknown column format')
                ws.set_column(c,c,width,formats.get(fmtname))
            for merge in s.get('merges',[]):
                _known_fields(merge,{'range','value','format'},'merge')
                rg=_range(merge['range'],nr,nc)
                # Avoid silently destroying populated data in merged cells.
                for rr in range(rg[0],rg[2]+1):
                    for cc in range(rg[1],rg[3]+1):
                        if (rr,cc)!=(rg[0],rg[1]) and cc<len(s['rows'][rr]) and s['rows'][rr][cc] is not None: raise ValueError('Merge overlaps data')
                fmtname=merge.get('format','header')
                if fmtname not in formats: raise ValueError('Unknown merge format')
                fmt=formats[fmtname]
                if ws.merge_range(*rg,_text(merge.get('value','')),fmt)!=0: raise ValueError('Invalid merged range')
            for v in s.get('validations',[]):
                _known_fields(v,{'range','values'},'validation')
                rg=_range(v['range'],nr,nc); opts={'validate':'list','source':v.get('values')}
                if not isinstance(opts['source'],list) or not opts['source'] or any(not isinstance(x,str) for x in opts['source']) or sum(len(x)+1 for x in opts['source'])>255: raise ValueError('Validation requires a short literal list')
                for value in opts['source']: _text(value,'validation value',255)
                if any(',' in value or '"' in value for value in opts['source']): raise ValueError('Validation list values cannot contain comma or quote')
                if ws.data_validation(*rg,opts)!=0: raise ValueError('Invalid validation')
            for cf in s.get('conditional_formats',[]):
                _known_fields(cf,{'range','type'},'conditional format')
                rg=_range(cf['range'],nr,nc)
                if cf.get('type') not in ('3_color_scale','2_color_scale','data_bar'): raise ValueError('Unsupported conditional formatting')
                ws.conditional_format(*rg,{'type':cf['type']})
            if len(s.get('charts',[]))>20: raise ValueError('At most 20 native charts per sheet')
            for cs in s.get('charts',[]):
                _known_fields(cs,{'type','title','anchor','series','unit'},'native chart')
                if cs.get('type') not in ('bar','line','pie','scatter','column','area'): raise ValueError('Unsupported native chart type')
                chart=wb.add_chart({'type':'bar' if cs['type']=='column' else cs['type']})
                if cs['type']=='column': chart=wb.add_chart({'type':'column'})
                series=cs.get('series')
                if not isinstance(series,list) or not 1<=len(series)<=20: raise ValueError('Charts require 1..20 series')
                if cs['type']=='pie' and len(series)!=1: raise ValueError('Native pie chart requires one series')
                for ser in series:
                    _known_fields(ser,{'name','categories','values'},'native chart series')
                    vals,n=_ref(ser.get('values'),sizes); cats,m=_ref(ser.get('categories'),sizes)
                    if m!=n: raise ValueError('Chart category/value lengths differ')
                    numbers=_reference_values(vals,spec['sheets'])
                    if any(v is not None and (isinstance(v,bool) or not isinstance(v,(int,float))) for v in numbers): raise ValueError('Chart value ranges require numbers or blank/pending formula cells')
                    if cs['type']=='pie' and (any(v is None or v<0 for v in numbers) or sum(numbers)<=0): raise ValueError('Native pie chart requires known nonnegative values with positive sum')
                    if cs['type']=='scatter':
                        xs=_reference_values(cats,spec['sheets'])
                        if any(isinstance(v,bool) or not isinstance(v,(int,float)) for v in xs): raise ValueError('Scatter X values must be numeric; supply cached values for formulas')
                    entry={'values':vals,'categories':cats}
                    if 'name' in ser:
                        title=_text(ser['name'],'series name',255)
                        if title.startswith('='): raise ValueError('Series name cannot be a formula')
                        entry['name']=title
                    chart.add_series(entry)
                if 'title' in cs:
                    title=_text(cs['title'],'chart title',255)
                    if title.startswith('='): raise ValueError('Chart title cannot be a formula')
                    chart.set_title({'name':title})
                if 'unit' in cs:
                    unit=_text(cs['unit'],'chart unit',100)
                    if unit.startswith('='): raise ValueError('Unit cannot be a formula')
                    if cs['type']!='pie': chart.set_y_axis({'name':unit})
                chart.set_style(10); chart.set_size({'width':720,'height':400})
                anchor=cs.get('anchor','H2')
                if not isinstance(anchor,str) or not re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]{0,6}',anchor): raise ValueError('Invalid chart anchor')
                anchor_row,anchor_col=xlsxwriter.utility.xl_cell_to_rowcol(anchor)
                if anchor_row>=1048576 or anchor_col>=16384: raise ValueError('Chart anchor exceeds Excel grid bounds')
                if ws.insert_chart(anchor,chart)!=0: raise ValueError('Chart insertion failed')
        wb.close(); wb=None
        # Atomic no-clobber publication; link fails even if another writer raced us.
        os.link(tmp,out); os.unlink(tmp)
        return {'schema_version':1,'operation':'generate','path':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'sheets':len(sizes),'formula_count':formula_count,'recalc_pending':pending,'formula_cache_status':'recalc_pending' if pending else ('caller_supplied_unverified' if formula_count else 'not_applicable'),'warnings':['No formulas were evaluated. Caller-provided caches are not independently verified.']+(['Missing formula caches are placeholders; recalculate in an approved spreadsheet application before using results.'] if pending else [])}
    finally:
        if wb is not None:
            try: wb.close()
            except Exception: pass
        if os.path.exists(tmp): os.unlink(tmp)
