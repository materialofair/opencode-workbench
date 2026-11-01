# Existing task import

Import is a local, additive workflow. Discovery is read-only and separate from import. The agent uses `skills/import-scheduled-tasks`; the plugin never shells out to a scheduler or reads an arbitrary path supplied over HTTP. Source jobs are never stopped, edited or deleted. Imports always start disabled with no chosen executor.

## Adaptation and identity

The project-local Store retains its schema-1 tasks JSON and adds a `task_imports` identity ledger. Existing databases need no rewriting. Imported task JSON adds `origin` (kind, stable source ID, original task ID, source revision fingerprint, original state, executor). Normal edits preserve origin. Deleting the task retains its ledger entry to prevent accidental resurrection. Existing scheduler execution and task types are retained.

The adapters normalize to version-1 JSON: sources contain kind/id/tasks; each task includes original id, absolute project, name, prompt, IANA timezone, schedule, original enabled (true/false/unknown), optional model and optional blocking issues. Only once with explicit offset, minute intervals, and daily/weekly wall-clock schedules are supported. Missing timezone/project or unsupported semantics block import. Names and prompts are never inferred from system labels or unrelated sessions. Rules are not silently approximated.

`collect.py` reads a selected schema-1 Workbench SQLite database, crontab export, launchd plist (binary or XML), Windows Task Scheduler XML, or an explicitly reviewed plugin manifest. It does not enumerate a computer or invoke scheduler commands. Dry collection reports metadata; a private manifest file is created only with `--output`, using exclusive create and POSIX mode 0600. Windows users must choose a directory protected by their user ACL. Known source schemas are bounded and loaded read-only; unknown plugin formats require an adapter based on actual implementation. CLI failures do not echo source payloads. The collector and management page do not transmit manifests externally; using an OpenCode agent/tool may place selected content in the host model/session, so follow that provider’s data policy and exclude credentials.

Simple cron daily/weekly rules and direct `opencode run` commands can normalize; environment assignments, shell wrappers, command options that change agent/session behavior, cron stdin, monthly rules and interval assumptions block conversion. CRON_TZ is recognized, otherwise the caller must verify timezone. Cron line numbers are file-local IDs, so preserve the export or assign reviewed stable IDs before repeated migration. DST and cron implementation differences need explicit review.

Launchd/calendar and Windows XML discovery deliberately retains blockers for missed-run behavior, execution identity, arguments, conditions and extra triggers. These adapters provide evidence, not a claim that unlike schedulers execute identically. A reviewed structured manifest can represent a chosen Workbench behavior after differences are understood. Selecting a different runtime OS does not make unknown semantics supported.

The semantic checks follow Apple's [Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html) for sleep/missed triggers, and Microsoft's [Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema) and [task principal](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps) documentation for trigger/action structure and execution identity. Native runtime behavior still requires target-machine verification.

## Review and conflicts

| Check | Result |
| --- | --- |
| Same source kind + source ID + task ID, same source revision | duplicate, preserve existing edits |
| Same source identity, changed name/state/content | conflict, never overwrite |
| Same project + exact prompt/model/timezone/normalized schedule | duplicate, even across sources |
| Same prompt/model or case-insensitive name, different remaining content | conflict, manual review |
| Wrong project, invalid input, adapter issues | unsupported |
| Repeated identical entry within batch | duplicate |
| Repeated source ID within batch with different content | conflict |
| Previously imported but deleted task | duplicate tombstone, never resurrect |

Fingerprints use SHA-256 over canonical parsed fields; stored hashes are local metadata, not anonymization suitable for publication. Project paths are absolute and normalized; Windows uses case-insensitive path identity, POSIX remains case-sensitive. Resolve project aliases to the actual OpenCode directory during discovery. A path on another machine is never automatically remapped. Source IDs should be stable and non-secret. The collector defaults to a hash of hostname and resolved source path.

`previewImport` returns safe task summaries without prompt/model data, per-row reasons and a preview digest bound to exact manifest and current tasks. `applyImport` recomputes inside `BEGIN IMMEDIATE`; changed state invalidates review. Conflict/unsupported rows reject the entire batch. Successful retries are idempotent, including after a lost response. A same-source retry retains edits and disabled state. Semantic duplicates with different source IDs do not acquire ledger entries because they were skipped, not imported.

## Interfaces

- OpenCode tool `import_scheduled_tasks`: `manifest` JSON string, `dryRun` defaults true, `preview` required for writes. Active scheduled sessions cannot recursively import.
- `POST /api/import/preview`: manifest object. No task writes.
- `POST /api/import/apply`: `{manifest, preview}`. Atomic disabled import.
- The manager offers “导入旧任务”, a preview, explicit disabled commit, provenance display, and executor acknowledgement before enabling an imported task. No automatic execution or host session occurs during import. The UI only shows this feature when the backend advertises import support; an existing running host keeps its original UI operations until safely reloaded. Immediate execution is blocked while executor is unassigned.

HTTP uses the existing loopback-only Host/Origin/Bearer/CSRF protections and 64-KiB request bound. Limits are 20 sources/100 tasks per batch. All imported tasks belong to the currently loaded OpenCode project. To enable one later, normal save must include `executor: "workbench"` and `acknowledgeExternalSchedule: true`; the UI makes this explicit. The acknowledgement does not stop the original scheduler. Import sets misfire=skip; enabling recalculates next time/interval anchor, and does not backfill old events.

## Local discovery on 2026-11-01

Read-only inspection on the development Mac found the currently enabled OpenCode plugins (auth, agent customization, Feishu) and one browser MCP, with no declared scheduler plugin. No direct OpenCode executable/project match was found in user/system launchd plists. Wrapper-based or differently named schedulers remain unproven. The OpenCode core SQLite schema was inspected without reading messages; it contained no scheduler table. Existing Workbench state under Desktop application data contained four project databases, three disabled once tasks in Asia/Shanghai, and one empty database. Project ownership and user intent of those records were not assumed; no actual task was migrated or executed. Task names, prompts, source paths and identifiers are intentionally omitted here.

`crontab -l` was denied by the execution environment (EPERM). Cron coverage is unknown, not empty. No system permission, scheduler, global plugin configuration or persistent access setting was changed. This observation is not an exhaustive inventory: unknown project-local plugins, indirect wrappers and inaccessible cron may contain additional jobs. Complete discovery of those sources requires further read-only evidence; parser tests use synthetic inputs only.
