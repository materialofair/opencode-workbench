#!/usr/bin/env python3
"""Offline PDF text coverage checks. Requires preinstalled Poppler pdftotext.

Usage: python3 office/qa-print.py print.pdf expectations.print-check.json
Exit 0: checked markers pass; 1: marker failure/error; 2: blocked dependency.
Does not establish layout quality, all-content fidelity, or factual correctness.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def normalize(value):
    return re.sub(r'\s+', '', value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    parser.add_argument('expectations')
    args = parser.parse_args()
    report = {'version': 1, 'pdf': str(Path(args.pdf).resolve()),
              'expectations': str(Path(args.expectations).resolve()),
              'status': 'error', 'passed': False,
              'scope': 'Required text markers only; not all content or visual pagination.',
              'normalization': 'Remove Unicode whitespace before matching.'}
    binary = shutil.which('pdftotext')
    if not binary:
        report.update(status='blocked', error='pdftotext unavailable; install approved Poppler offline. No download attempted.')
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2
    try:
        pdf = Path(args.pdf)
        config_path = Path(args.expectations)
        if not pdf.is_file() or pdf.suffix.lower() != '.pdf':
            raise ValueError('Input must be an existing PDF file')
        if pdf.stat().st_size > 100 * 1024 * 1024 or config_path.stat().st_size > 1024 * 1024:
            raise ValueError('PDF exceeds 100 MiB or expectation file exceeds 1 MiB')
        config = json.loads(config_path.read_text(encoding='utf-8'))
        if not isinstance(config, dict) or set(config) - {'version', 'description', 'required', 'minimum_occurrences'} or config.get('version') != 1:
            raise ValueError('Expected version 1 marker schema')
        required = config.get('required', [])
        minimum = config.get('minimum_occurrences', {})
        if not isinstance(required, list) or not isinstance(minimum, dict) or len(required) + len(minimum) > 2000:
            raise ValueError('Expected bounded required list and minimum_occurrences object')
        for marker in required + list(minimum):
            if not isinstance(marker, str) or not normalize(marker) or len(marker) > 5000:
                raise ValueError('Markers must be nonempty bounded text')
        if any(type(count) is not int or not 1 <= count <= 10000 for count in minimum.values()):
            raise ValueError('Minimum occurrence counts must be integers from 1 to 10000')
        if not required and not minimum:
            raise ValueError('At least one marker is required')
        result = subprocess.run([binary, '-layout', str(pdf.resolve()), '-'],
                                capture_output=True, timeout=60, check=False)
        if result.returncode:
            raise RuntimeError('pdftotext failed: ' + result.stderr.decode('utf-8', errors='replace')[:2000])
        if len(result.stdout) > 32 * 1024 * 1024:
            raise ValueError('Extracted text exceeds 32 MiB')
        content = normalize(result.stdout.decode('utf-8'))
        checks = []
        for marker in required:
            actual = content.count(normalize(marker))
            checks.append({'marker': marker, 'minimum': 1, 'actual': actual, 'passed': actual >= 1})
        for marker, expected in minimum.items():
            actual = content.count(normalize(marker))
            checks.append({'marker': marker, 'minimum': expected, 'actual': actual, 'passed': actual >= expected})
        passed = all(check['passed'] for check in checks)
        report.update(status='passed' if passed else 'failed', passed=passed,
                      checks=checks, checked_markers=len(checks),
                      failed_markers=sum(not check['passed'] for check in checks))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        report.update(status='error', error=str(error))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
