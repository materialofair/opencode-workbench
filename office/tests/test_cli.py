import tempfile
import unittest
from pathlib import Path
from office_engine.__main__ import scoped, run, encode_report

class BoundaryTests(unittest.TestCase):
    def test_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            for path in ('../outside.xlsx','/tmp/out.xlsx',''):
                with self.assertRaises(ValueError): scoped(root,path,True)
            (root/'existing.xlsx').touch()
            with self.assertRaises(ValueError): scoped(root,'existing.xlsx',True)
            (root/'outside').symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(ValueError): scoped(root,'outside/output.xlsx',True)
            self.assertEqual(scoped(root,'new.xlsx',True),root/'new.xlsx')
    def test_unknown_operation(self):
        with self.assertRaises(ValueError): run({'operation':'shell'},Path('.').resolve())

if __name__=='__main__':unittest.main()

class ReportBudgetTests(unittest.TestCase):
    def test_report_budget_rejects_before_writing_partial_json(self):
        from unittest.mock import patch
        import office_engine.__main__ as cli
        with patch.object(cli,'MAX_REPORT',100):
            with self.assertRaisesRegex(ValueError,'smaller'):encode_report({'repeated':['x'*50]*3})
    def test_report_roundtrip_and_nonfinite(self):
        import json
        value={'ok':True,'中文':'原始数据'};self.assertEqual(json.loads(encode_report(value)),value)
        with self.assertRaises(ValueError):encode_report({'value':float('nan')})
