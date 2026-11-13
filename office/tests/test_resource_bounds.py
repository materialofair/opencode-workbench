"""Independent adversarial preflight tests. Never load oversized workbooks.

ZIP_STORED intentionally avoids triggering compression-ratio checks, so these
fixtures exercise semantic expansion and XML cardinality budgets directly.
"""
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import openpyxl
from office_engine.excel import _archive

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

class ResourceBoundsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        baseline = self.root / 'base.xlsx'
        wb = openpyxl.Workbook(); wb.active['A1'] = 'synthetic'; wb.save(baseline)
        with zipfile.ZipFile(baseline) as archive:
            self.parts = {name: archive.read(name) for name in archive.namelist()}
        self.serial = 0

    def tearDown(self):
        self.temp.cleanup()

    def workbook(self, additions=None, sheet_tail=''):
        self.serial += 1
        out = self.root / f'fixture-{self.serial}.xlsx'
        parts = dict(self.parts)
        if sheet_tail:
            parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(b'</worksheet>', sheet_tail.encode() + b'</worksheet>')
        parts.update(additions or {})
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as archive:
            for name, contents in parts.items(): archive.writestr(name, contents)
        return out

    def refused(self, path):
        # A regression must stop in preflight, not fall back to object loading.
        with patch('office_engine.excel.openpyxl.load_workbook', side_effect=AssertionError('Oversized workbook reached loader')):
            with self.assertRaises(ValueError):
                archive, _ = _archive(path)
                archive.close()

    def test_hyperlink_maximum_range_is_rejected_before_loading(self):
        self.refused(self.workbook(sheet_tail='<hyperlinks><hyperlink ref="A1:XFD1048576" location="Sheet!A1"/></hyperlinks>'))

    def test_repeated_hyperlink_expansion_is_cumulative(self):
        # Each reference is below 200k, but total binding work is 208k.
        links = '<hyperlink ref="A1:Z4000" location="Sheet!A1"/>' * 2
        self.refused(self.workbook(sheet_tail='<hyperlinks>' + links + '</hyperlinks>'))

    def test_small_hyperlink_expansion_remains_supported(self):
        path = self.workbook(sheet_tail='<hyperlinks><hyperlink ref="A1:Z10" location="Sheet!A1"/></hyperlinks>')
        archive, _ = _archive(path); archive.close()

    def test_sqref_token_flood_below_attribute_length_limit(self):
        # 60,002 characters < 65,536, yet 20,001 CellRange objects.
        refs = ' '.join(['A1'] * 20001)
        self.refused(self.workbook(sheet_tail='<dataValidations count="1"><dataValidation type="list" sqref="' + refs + '"><formula1>"yes,no"</formula1></dataValidation></dataValidations>'))

    def test_sqref_counts_accumulate_across_attributes(self):
        refs = ' '.join(['A1'] * 11000)
        rule = '<dataValidation type="list" sqref="' + refs + '"><formula1>"yes,no"</formula1></dataValidation>'
        self.refused(self.workbook(sheet_tail='<dataValidations count="2">' + rule * 2 + '</dataValidations>'))

    def test_oversized_single_xml_attribute(self):
        self.refused(self.workbook({'customXml/attribute.xml': ('<root note="' + 'x' * 65537 + '"/>').encode()}))

    def test_xml_node_budget_accumulates_across_parts(self):
        chunk = b'<root>' + b'<item/>' * 250001 + b'</root>'
        self.refused(self.workbook({'customXml/first.xml': chunk, 'customXml/second.xml': chunk}))

    def test_shared_string_count(self):
        content = ('<sst xmlns="' + NS + '" count="200001" uniqueCount="200001">').encode() + b'<si/>' * 200001 + b'</sst>'
        self.refused(self.workbook({'xl/sharedStrings.xml': content}))

    def test_style_record_count(self):
        content = ('<styleSheet xmlns="' + NS + '"><cellXfs count="10001">').encode() + b'<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' * 10001 + b'</cellXfs></styleSheet>'
        self.refused(self.workbook({'xl/styles.xml': content}))

if __name__ == '__main__': unittest.main()
