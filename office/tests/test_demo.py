import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.targets.append(dict(attrs).get('href'))


class PreviewNavigationTests(unittest.TestCase):
    def test_preview_links_real_outputs_and_never_replaces_bundle(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'new-bundle'
            process = subprocess.run([sys.executable, str(root / 'office/demo.py'), str(out)], capture_output=True, text=True, timeout=20)
            self.assertEqual(process.returncode, 0, process.stderr)
            html = (out / 'index.html').read_text()
            parser = Links(); parser.feed(html)
            self.assertGreaterEqual(len(parser.targets), 8)
            for target in parser.targets:
                self.assertNotIn('://', target)
                self.assertTrue((out / target).is_file(), target)
            self.assertNotIn('<script', html)
            manifest = json.loads((out / 'manifest.json').read_text())
            self.assertEqual(manifest['preview_index']['sha256'], hashlib.sha256(html.encode()).hexdigest())
            retry = subprocess.run([sys.executable, str(root / 'office/demo.py'), str(out)], capture_output=True, timeout=20)
            self.assertNotEqual(retry.returncode, 0)
            self.assertEqual((out / 'index.html').read_text(), html)


if __name__ == '__main__':
    unittest.main()
