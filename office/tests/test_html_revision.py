import base64
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from office_engine.html import render_html, extract_html_source, revise_html, META_PREFIX, META_SUFFIX

class HtmlRevisionTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name);self.source=self.root/'original.html';self.output=self.root/'revised.html'
        self.spec={'version':1,'title':'甲乙','title_lines':['甲','乙'],'sections':[{'type':'table','title':'明细','headers':['项目','金额','备注'],'rows':[['A',30,None],['B',40,'']]},{'type':'text','body':'<script>not executed</script>'}]}
        self.manifest=render_html(self.spec,self.source)
    def change(self,**kw):
        return revise_html(self.source,self.output,kw.get('sha',self.manifest['sha256']),kw.get('changes',[{'path':'/sections/0/rows/0/1','old':30,'value':31}]))
    def test_roundtrip_lossless_and_inert(self):
        result=extract_html_source(self.source)
        self.assertEqual(result['spec'],self.spec);self.assertEqual(result['input_sha256'],self.manifest['sha256'])
        self.assertEqual(result['source_integrity'],'consistency_not_authentication')
        self.assertNotIn('<script>',self.source.read_text());self.assertEqual(self.source.read_text().count(META_PREFIX),1)
        self.assertEqual(result['spec']['sections'][0]['rows'][0][2],None)
    def test_revision_scope_and_input_unchanged(self):
        before=self.source.read_bytes();result=self.change();new=extract_html_source(self.output)['spec']
        expected=copy.deepcopy(self.spec);expected['sections'][0]['rows'][0][1]=31
        self.assertEqual(new,expected);self.assertEqual(self.source.read_bytes(),before)
        self.assertEqual(result['changes'],[{'path':'/sections/0/rows/0/1','old':30,'value':31}])
        self.assertEqual(result['qa'],'pending_browser_and_visual_review')
    def test_titles_require_explicit_consistent_changes(self):
        with self.assertRaises(ValueError):self.change(changes=[{'path':'/title','old':'甲乙','value':'甲丙'}])
        self.assertFalse(self.output.exists())
        self.change(changes=[{'path':'/title','old':'甲乙','value':'甲丙'},{'path':'/title_lines/1','old':'乙','value':'丙'}])
        self.assertEqual(extract_html_source(self.output)['spec']['title'],'甲丙')
    def test_stale_hash_old_value_type_and_control_paths_rejected(self):
        for changes in [[{'path':'/sections/0/rows/0/1','old':29,'value':31}],[{'path':'/sections/0/rows/0/1','old':30,'value':'31'}],[{'path':'/version','old':1,'value':2}],[{'path':'/sections/00/rows/0/1','old':30,'value':31}],[{'path':'/sections/0/rows/9/1','old':30,'value':31}],[{'path':'/sections/0/rows/0/1','old':30,'value':float('nan')}],[],[{'path':'/title','old':'甲乙','value':'甲乙'}]*2]:
            with self.assertRaises(ValueError):self.change(changes=changes)
            self.assertFalse(self.output.exists())
        with self.assertRaises(ValueError):self.change(sha='0'*64)
    def test_no_overwrite(self):
        self.output.write_text('existing')
        with self.assertRaises(FileExistsError):self.change()
        self.assertEqual(self.output.read_text(),'existing')
    def test_tamper_duplicate_missing_utf8_rejected(self):
        original=self.source.read_bytes();text=original.decode();start=text.index(META_PREFIX);end=text.index(META_SUFFIX,start)+len(META_SUFFIX);marker=text[start:end]
        for raw in [text.replace('<h1>','<h1 class="manual">').encode(),text.replace(marker,'').encode(),text.replace('</head>',marker+'</head>').encode(),original+b'\xff',text.replace('content="'+marker.split('content="')[1],'content="!'+marker.split('content="')[1]).encode()]:
            self.source.write_bytes(raw)
            with self.assertRaises((ValueError,UnicodeError)):extract_html_source(self.source)
        self.source.write_bytes(original)
    def test_noncanonical_duplicate_json_and_nan_rejected(self):
        text=self.source.read_text();start=text.index(META_PREFIX)+len(META_PREFIX);end=text.index(META_SUFFIX,start)
        decoded=base64.urlsafe_b64decode(text[start:end]);obj=json.loads(decoded)
        for content in [json.dumps(obj,ensure_ascii=False,indent=2).encode(),b'{"format_version":1,"format_version":1}',b'{"spec":NaN}']:
            self.source.write_text(text[:start]+base64.urlsafe_b64encode(content).decode()+text[end:])
            with self.assertRaises(ValueError):extract_html_source(self.source)
    def test_current_engine_match_not_merely_checksums(self):
        text=self.source.read_text();start=text.index(META_PREFIX);payload_start=start+len(META_PREFIX);end=text.index(META_SUFFIX,payload_start)
        envelope=json.loads(base64.urlsafe_b64decode(text[payload_start:end]));stripped=text[:start]+text[end+len(META_SUFFIX):];changed=stripped.replace('<h1>','<h1 class="manual">')
        envelope['document_sha256']=hashlib.sha256(changed.encode()).hexdigest();payload=base64.urlsafe_b64encode(json.dumps(envelope,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).decode()
        self.source.write_text(changed.replace('</head>',META_PREFIX+payload+META_SUFFIX+'</head>'))
        with self.assertRaisesRegex(ValueError,'current engine'):extract_html_source(self.source)
    def test_budgets_before_output(self):
        with patch('office_engine.html.MAX_SOURCE_SPEC',20):
            with self.assertRaises(ValueError):render_html(self.spec,self.output)
        self.assertFalse(self.output.exists())
        with patch('office_engine.html.MAX_HTML_BYTES',20):
            with self.assertRaises(ValueError):render_html(self.spec,self.output)
            with self.assertRaises(ValueError):extract_html_source(self.source)
        self.assertFalse(self.output.exists())
    def test_interactive_still_exactly_one_script(self):
        spec=copy.deepcopy(self.spec);spec['interaction']='first-party-table';path=self.root/'interactive.html';render_html(spec,path)
        self.assertEqual(path.read_text().count('<script>'),1)
        self.assertEqual(extract_html_source(path)['spec'],spec)

if __name__=='__main__':unittest.main()
