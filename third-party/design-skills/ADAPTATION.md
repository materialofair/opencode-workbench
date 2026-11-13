# Offline composition integration

The original files and licenses are unmodified. manifest.json records upstream commits and SHA-256 hashes. The installer distributes a minimal subset, so not every manifest entry is installed. The manifest separates retained files from excluded_source_files, retaining original hashes for traceability. Unused framework stacks and upstream CLI scripts are not distributed; only the eight permitted domains, core.py and provenance metadata remain.

The office-visual-composition workflow and office_engine/design.py wrapper are original integration code. Anthropic frontend-design (Apache-2.0) informs deliberate visual direction; UI/UX Pro Max (MIT) supplies local CSV references and its audited stdlib core.py BM25 search; Vercel web-interface-guidelines (MIT) informs accessibility and interface review. Original notices accompany each reference. No upstream text is presented as project-authored work.

The wrapper permits eight explicit design domains, bounds queries/results, checks selected reference hashes, and removes fields containing remote assets, imports, code snippets, font-loading instructions, and font-family prescriptions. Typography is adapted to installed system CJK fallback fonts; it does not download or bundle fonts. Search abstention is preserved. References do not constitute screenshot review or a visual-quality score.

No upstream CLI, installer, design-system persistence, Impeccable network engine, telemetry, permission expansion, font download, or package installation is invoked. The installed references are inert material under one composition skill, not independently activated skills. The plugin continues to use its verified installation source for executable retrieval.
