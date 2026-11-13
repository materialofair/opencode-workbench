# Project-local office installation lifecycle

The installer is a **linked-source installation**, not a standalone bundle. Its wrapper imports the adapter by a platform-correct absolute file URL. Keep the source checkout, the built adapter, local Python environment, browser/runtime dependencies and pinned design corpus at that location. Changing source files may affect the running tools immediately; the manifest is an ownership/provenance record, **not** a runtime integrity gate or release pin. No network setup is performed here.

All commands default to dry-run. Review the JSON change list, then add `--apply` to the same command. Supply an existing project directory. No global install mode exists.

```sh
bun scripts/install-office.ts --project /path/to/project
bun scripts/install-office.ts --project /path/to/project --apply
bun scripts/install-office.ts --project /path/to/project --upgrade
bun scripts/install-office.ts --project /path/to/project --upgrade --apply
bun scripts/install-office.ts --project /path/to/project --uninstall
bun scripts/install-office.ts --project /path/to/project --uninstall --apply
```

## Ownership and upgrades

`.opencode/office-artifacts.install.json` records the fixed set of managed project-relative file paths, SHA-256 hashes, lengths, source location and adapter hash. Do not hand-edit this file. It is not cryptographically signed and does not defend against someone controlling the project. Manifest paths are still restricted to the installer's fixed allowlist, preventing a corrupted record from targeting arbitrary project files, PPT skills or external paths.

An upgrade checks **all** managed files before writing. Any changed owned file, conflicting unowned file, symbolic link/junction, hardlink, non-file target or invalid manifest stops the entire operation without replacing files. Preserve your edits elsewhere and reconcile them yourself; there is no force/overwrite option. Missing owned files may be recreated by upgrade. Running plain install against a different recorded release/source requires `--upgrade`.

To move the source checkout, retain the project manifest, build/prepare the new checkout offline, and run its installer with `--upgrade`. The preview shows wrapper replacement and the new source dependency. The recorded old file hashes must still match. Uninstall can run from another copy of this script even when the original adapter/corpus has disappeared; it does not load those sources.

## Legacy installations

Existing files without an ownership manifest are never silently claimed. After reviewing them, explicitly use `--adopt-legacy` (with `--apply` only after the dry-run). Every existing managed file must match this release byte-for-byte. Files missing from an older installation can be added. Mismatched legacy files must be reconciled manually; an old source URL is a mismatch too. Adoption is not an override and cannot be combined with uninstall. Uninstall without a manifest leaves everything untouched.

## Removal and recovery

Uninstall removes only recorded files whose bytes still match their recorded hashes. Modified files remain and are listed under `preserved`; a reduced manifest retains those records. Missing files are listed under `missing`. Unowned files and **all user data directories** remain; even empty skill/plugin directories are not deleted. Once no records remain, the installer removes its own manifest. To finish later, restore a retained file to its recorded version and rerun uninstall, or manage your changed file manually. Never delete the manifest to force removal.

Apply uses an exclusive cooperative lock, rechecks snapshots, stages writes beside their destinations and replaces files individually. Ordinary write failures trigger best-effort rollback, only while destinations still match the installer's changes. This is **not** a multi-file crash-atomic transaction or protection from a hostile concurrent local writer. Do not edit installation files concurrently. A process crash/power failure may leave a lock, staging files or a partial state. Inspect these and compare the manifest before retrying; do not blindly delete a lock or adopt a partial installation. The error identifies rollback failures when it can.

Paths use Node's native path/file-URL handling, including spaces and Windows conventions; symlink/junction checks are explicit. Automated lifecycle tests were run on macOS temporary projects, **not on Windows**. No real user installation, model configuration, permissions, global config, PPT skill or user artifact is touched by tests.
