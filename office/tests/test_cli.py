import tempfile
import unittest
from pathlib import Path
from office_engine.__main__ import scoped, run

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
