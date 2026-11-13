import ast
import json
import socket
import unittest
from unittest.mock import patch
from office_engine import design


class DesignReferenceTests(unittest.TestCase):
    def test_local_search_provenance_and_no_network(self):
        with patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')):
            result = design.search_design('trend', 'chart', 2)
        self.assertEqual(result['status'], 'references-found')
        self.assertLessEqual(result['count'], 2)
        self.assertEqual(result['source']['commit'], design.COMMIT)
        self.assertEqual(len(result['source']['sha256']), 64)
        self.assertEqual(len(result['source']['corpus_sha256']), 8)
        self.assertEqual(result['visual_review'], 'pending-human-review')
        self.assertIn('Microsoft YaHei', result['font_stack'])
        self.assertTrue(all(row['entry'] for row in result['results']))

    def test_abstention_not_random_palette(self):
        result = design.search_design('xyzzzyqwertyzzzz', 'color')
        self.assertEqual(result['status'], 'no-match')
        self.assertEqual(result['results'], [])

    def test_external_assets_removed(self):
        result = design.search_design('editorial', 'typography', 5)
        self.assertGreater(result['count'], 0)
        for row in result['results']:
            for key, value in row['fields'].items():
                self.assertIsNone(design._BLOCKED_FIELD.search(key))
                self.assertIsNone(design._EXTERNAL.search(value))
        self.assertNotIn('fonts.googleapis', json.dumps(result))

    def test_input_bounds_and_no_extra_actions(self):
        for domain in ('../style', 'google-fonts', 'gsap', 'react', 'shell', None, [], {}):
            with self.assertRaises(ValueError): design.search_design('trend', domain)
        for query in ('', ' ' * 5, 'x' * 257, 'https://example.com', 'a\x00b', None):
            with self.assertRaises(ValueError): design.search_design(query, 'chart')
        for limit in (True, 0, 6, 2.5, '3', None):
            with self.assertRaises(ValueError): design.search_design('trend', 'chart', limit)
        for option in ('persist', 'output', 'outputdir', 'command', 'url'):
            with self.assertRaises(ValueError):
                design.design_reference({'query': 'trend', 'domain': 'chart', option: 'bad'})

    def test_every_allowed_domain(self):
        for domain in design.DOMAINS:
            result = design.search_design('accessible dashboard', domain)
            self.assertIn(result['status'], ('references-found', 'no-match'))

    def test_hash_failure_and_output_budget(self):
        manifest = json.loads((design.REFERENCES / 'manifest.json').read_text())
        relative = 'third-party/design-skills/ui-ux-pro-max/scripts/core.py'
        for source in manifest['sources']:
            for record in source['files']:
                if record['local_path'] == relative: record['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'integrity'):
            design._verified(relative, manifest)
        with patch.object(design, 'MAX_REPORT', 10):
            with self.assertRaisesRegex(ValueError, 'report exceeds'):
                design.search_design('trend', 'chart')

    def test_upstream_imports_are_audited_stdlib_only(self):
        tree = ast.parse((design.REFERENCES / 'ui-ux-pro-max/scripts/core.py').read_text())
        modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import): modules.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom): modules.add(node.module)
        self.assertEqual(modules, {'csv', 'difflib', 're', 'pathlib', 'math', 'collections'})


if __name__ == '__main__': unittest.main()
