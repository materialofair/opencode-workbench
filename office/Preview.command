#!/bin/sh
# Double-click on macOS to generate and open a NEW synthetic example bundle.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON="$HERE/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then printf '%s\n' 'Office Python environment is missing. Follow docs/OFFICE.md offline setup.'; exit 1; fi
mkdir -p "$HERE/evidence"
BASE=$(mktemp -d "$HERE/evidence/preview-XXXXXX")
"$PYTHON" "$HERE/demo.py" "$BASE/reports"
printf '\nExamples: %s\n' "$BASE/reports"
if command -v open >/dev/null 2>&1; then open "$BASE/reports/dashboard.html"; open "$BASE/reports"; fi
