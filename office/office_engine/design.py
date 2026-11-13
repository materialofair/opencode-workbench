"""Read-only, bounded offline design retrieval. No upstream CLI is executed."""
import hashlib
import json
from pathlib import Path
import re
import types

ROOT = Path(__file__).resolve().parents[2]
REFERENCES = ROOT / 'third-party/design-skills'
COMMIT = '6ae86f61f520d6ca229d2f40e070410638c908c5'
REPOSITORY = 'nextlevelbuilder/ui-ux-pro-max-skill'
DOMAINS = frozenset(('style', 'color', 'chart', 'typography', 'landing', 'product', 'ux', 'web'))
CJK_FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
MAX_QUERY = 256
MAX_LIMIT = 5
MAX_FILE = 2_000_000
MAX_REPORT = 100_000
_EXTERNAL = re.compile(r'https?://|www\.|@import|url\s*\(|fonts\.google|fonts\.gstatic|<script|<link', re.I)
_BLOCKED_FIELD = re.compile(r'url|import|snippet|code|tailwind|library recommendation|heading font|body font', re.I)


def _verified(relative, manifest):
    path = ROOT / relative
    if path.is_symlink() or not path.resolve().is_relative_to(REFERENCES.resolve()):
        raise ValueError('Reference path escapes pinned reference directory')
    records = {item['local_path']: item for source in manifest['sources']
               if source['repository'] == REPOSITORY and source['commit'] == COMMIT
               for item in source['files']}
    record = records.get(relative)
    if not record or path.stat().st_size > MAX_FILE:
        raise ValueError('Missing or oversized pinned design reference')
    data = path.read_bytes()
    if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
        raise ValueError('Pinned design reference integrity mismatch')
    return data, record['sha256']


def search_design(query, domain, limit=3):
    """Return references, never an automatically selected design or aesthetic score."""
    if not isinstance(domain, str) or domain not in DOMAINS:
        raise ValueError('Unsupported design domain; use: ' + ', '.join(sorted(DOMAINS)))
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY:
        raise ValueError('Design query must contain 1 to 256 characters')
    if any(ord(c) < 32 for c in query) or _EXTERNAL.search(query):
        raise ValueError('Design query must be plain text, not a URL or asset instruction')
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ValueError('Design limit must be an integer from 1 to 5')
    manifest = json.loads((REFERENCES / 'manifest.json').read_text(encoding='utf-8'))
    relative = 'third-party/design-skills/ui-ux-pro-max/scripts/core.py'
    source, core_hash = _verified(relative, manifest)
    # Only the audited, hash-pinned stdlib core is loaded, not search.py or installers.
    core = types.ModuleType('_office_offline_design_core')
    core.__file__ = str(ROOT / relative)
    exec(compile(source, core.__file__, 'exec'), core.__dict__)
    filename = core.CSV_CONFIG[domain]['file']
    _, csv_hash = _verified('third-party/design-skills/ui-ux-pro-max/data/' + filename, manifest)
    # Some calibrated queries consult product/style context in addition to the selected CSV.
    corpus_hashes = {}
    for dependency in sorted({core.CSV_CONFIG[name]['file'] for name in DOMAINS}):
        _, corpus_hashes[dependency] = _verified('third-party/design-skills/ui-ux-pro-max/data/' + dependency, manifest)
    raw = core.search(query.strip(), domain=domain, max_results=limit, diagnostics=True)
    if raw.get('error'):
        raise ValueError('Offline design reference cannot be read')
    results = []
    for index, row in enumerate(raw['results'], 1):
        fields = {key: value for key, value in row.items()
                  if not _BLOCKED_FIELD.search(key) and not _EXTERNAL.search(str(value))}
        identity = next((str(row[key]) for key in ('Style ID', 'Pattern ID', 'Font Pairing Name',
                        'Product Type', 'Data Type', 'Issue') if row.get(key)), 'result-' + str(index))
        results.append({'entry': identity, 'fields': fields})
    result = {
        'status': 'references-found' if results else 'no-match',
        'query': query.strip(), 'domain': domain, 'count': len(results), 'results': results,
        'source': {'repository': REPOSITORY, 'commit': COMMIT, 'file': filename,
                   'sha256': csv_hash, 'core_sha256': core_hash, 'corpus_sha256': corpus_hashes, 'license': 'MIT'},
        'font_stack': CJK_FONT_STACK,
        'reason': raw.get('diagnostics', {}).get('reason', 'no-match'),
        'visual_review': 'pending-human-review',
        'notes': ['References are evidence for a design decision, not a finished design or aesthetic score.',
                  'No fonts or other external assets are loaded. Installed CJK fonts vary by machine.',
                  'Corpus is primarily English; a no-match is not permission to invent a palette.'],
    }
    if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > MAX_REPORT:
        raise ValueError('Design reference report exceeds 100000 bytes; reduce limit')
    return result


def design_reference(request):
    if not isinstance(request, dict) or set(request) - {'operation', 'query', 'domain', 'limit'}:
        raise ValueError('Design reference accepts only query, domain and limit')
    return search_design(request.get('query'), request.get('domain'), request.get('limit', 3))
