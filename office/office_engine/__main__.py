"""Bounded JSON CLI. All paths are scoped to an explicitly selected project."""
import argparse
import json
import os
from pathlib import Path
import sys

MAX_REQUEST = 1_048_576
MAX_REPORT = 8_388_607

def encode_report(result):
    output=bytearray()
    encoder=json.JSONEncoder(ensure_ascii=False,allow_nan=False,default=str)
    for chunk in encoder.iterencode(result):
        data=chunk.encode('utf-8')
        if len(output)+len(data)>MAX_REPORT: raise ValueError('Office report exceeds 8 MiB; request a smaller sheet/window/cell budget')
        output.extend(data)
    return output


def scoped(root, value, output=False):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise ValueError('Expected a project-relative file path')
    raw = Path(value)
    if raw.is_absolute() or '..' in raw.parts:
        raise ValueError('Absolute and parent paths are not allowed')
    path = (root / raw).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('Path escapes project')
    if output and (path.exists() or (root/raw).is_symlink()):
        raise ValueError('Output already exists; choose a new filename')
    if output and not path.parent.is_dir():
        raise ValueError('Output parent directory must already exist')
    return path

def run(request, root):
    if not isinstance(request, dict):
        raise ValueError('Request must be an object')
    operation = request.get('operation')
    if operation == 'inspect_excel':
        from .excel import inspect_workbook
        result = inspect_workbook(scoped(root, request.get('input')), request.get('options'))
    elif operation == 'design_reference':
        from .design import design_reference
        result = design_reference(request)
    elif operation in ('generate_excel', 'render_html'):
        output = scoped(root, request.get('output'), output=True)
        if operation == 'generate_excel':
            from .excel import generate_workbook
            result = generate_workbook(request.get('spec'), output)
        else:
            from .html import render_html
            result = render_html(request.get('spec'), output)
    else:
        raise ValueError('Unknown operation')
    return {'ok': True, 'operation': operation, 'result': result}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        root = Path(args.root).resolve(strict=True)
        if not root.is_dir():
            raise ValueError('Project root must be a directory')
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError('Request exceeds 1 MiB')
        request = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON value')))
        result = run(request, root)
        encoded=encode_report(result)
        sys.stdout.buffer.write(encoded+b'\n')
    except Exception as error:
        print(json.dumps({'ok': False, 'error': type(error).__name__, 'message': str(error)[:1000]}, ensure_ascii=False))
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
