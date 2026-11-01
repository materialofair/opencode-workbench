#!/usr/bin/env python3
"""Read selected scheduler exports; never execute, stop or modify source jobs."""
import argparse
import datetime
import hashlib
import json
import ntpath
import os
import plistlib
import re
import shlex
import socket
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def command(argv, project):
    """Only direct, unambiguous OpenCode run invocations are transferable."""
    if not argv or ntpath.basename(argv[0]).lower() not in ('opencode', 'opencode.exe'):
        return '', None, ['UNSUPPORTED_COMMAND']
    if len(argv) < 3 or argv[1] != 'run':
        return '', None, ['UNSUPPORTED_COMMAND']
    prompts, model, issues = [], None, []
    i = 2
    while i < len(argv):
        token = argv[i]
        if token in ('--model', '-m') and i + 1 < len(argv):
            parts = argv[i + 1].split('/', 1)
            if len(parts) == 2 and all(parts):
                model = dict(providerID=parts[0], modelID=parts[1])
            else:
                issues.append('UNSUPPORTED_MODEL')
            i += 2
            continue
        if token.startswith('-') or token in ('&&', '||', ';', '|', '>', '>>', '<', '&') or '$' in token or '`' in token or '%' in token:
            issues.append('UNSUPPORTED_COMMAND_OPTIONS')
        prompts.append(token)
        i += 1
    if not project:
        issues.append('MISSING_PROJECT')
    return ' '.join(prompts), model, issues


def task(task_id, project, name, argv, timezone, schedule, enabled, issues=None):
    prompt, model, command_issues = command(argv, project)
    value = dict(id=str(task_id), project=project, name=str(name)[:100], prompt=prompt,
                 timezone=timezone or '', schedule=schedule, enabled=enabled,
                 issues=list(issues or []) + command_issues)
    if not timezone:
        value['issues'].append('MISSING_TIMEZONE')
    if model:
        value['model'] = model
    return value


def daily(hour, minute, weekdays):
    if not isinstance(hour, int) or not 0 <= hour <= 23 or not isinstance(minute, int) or not 0 <= minute <= 59:
        return None
    return dict(kind='daily', time=f'{hour:02}:{minute:02}', weekdays=sorted(set(weekdays)))


def cron(text, project, timezone):
    tasks, zone = [], timezone
    for index, line in enumerate(text.splitlines()):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('CRON_TZ='):
            zone = line.partition('=')[2].strip().strip('"\'')
            continue
        # Keep other crontab environment semantics explicit rather than discard them.
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', line):
            raise ValueError('Crontab environment assignments need manual review; export selected lines without relying on them')
        parts = line.split(None, 5)
        if len(parts) != 6:
            tasks.append(task(f'line-{index + 1}', project, f'Cron line {index + 1}', [], zone, None, 'unknown', ['UNSUPPORTED_CRON']))
            continue
        minute, hour, dom, month, dow, script = parts
        issues, schedule = [], None
        try:
            # General cron/DST semantics do not match fixed absolute intervals.
            # Only daily/weekly wall-clock rules map without guessing calendar fields.
            days = list(range(7)) if dow == '*' else [int(d) % 7 for d in dow.split(',')]
            if dom != '*' or month != '*' or not minute.isdigit() or not hour.isdigit() or any(not d.isdigit() or not 0 <= int(d) <= 7 for d in dow.split(',')) and dow != '*':
                raise ValueError()
            schedule = daily(int(hour), int(minute), days)
            if schedule is None:
                raise ValueError()
        except ValueError:
            issues.append('UNSUPPORTED_CRON')
        lexer = shlex.shlex(script, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        argv = list(lexer)
        cwd = project
        if len(argv) >= 3 and argv[0] == 'cd' and argv[2] == '&&':
            cwd, argv = argv[1], argv[3:]
        # A shell command needs explicit review of expansions, redirection and % stdin.
        if '%' in script:
            issues.append('UNSUPPORTED_CRON_STDIN')
        tasks.append(task(f'line-{index + 1}', cwd, f'Cron line {index + 1}', argv, zone, schedule, 'unknown', issues))
    return tasks


def launchd(data, project, timezone):
    issues, schedule = [], None
    cal, interval = data.get('StartCalendarInterval'), data.get('StartInterval')
    if isinstance(cal, dict) and interval is None and set(cal) <= {'Hour', 'Minute', 'Weekday'}:
        weekday = cal.get('Weekday')
        if weekday is not None and (type(weekday) is not int or not 0 <= weekday <= 7):
            issues.append('UNSUPPORTED_LAUNCHD_SCHEDULE')
        else:
            # Omitted hour/minute are wildcards, never default them to zero.
            schedule = daily(cal.get('Hour'), cal.get('Minute'), list(range(7)) if weekday is None else [weekday % 7])
    # StartInterval resets, sleep coalescing and calendar misfires differ from Workbench.
    # Preserve these as review blockers instead of pretending equal execution semantics.
    if schedule is None:
        issues.append('UNSUPPORTED_LAUNCHD_SCHEDULE')
    if any(data.get(k) for k in ['RunAtLoad', 'KeepAlive', 'StartOnMount', 'WatchPaths', 'QueueDirectories', 'LaunchEvents']):
        issues.append('ADDITIONAL_LAUNCHD_TRIGGERS')
    if data.get('EnvironmentVariables'):
        issues.append('SOURCE_ENVIRONMENT_REQUIRES_REVIEW')
    # launchd coalesces sleep misses; Workbench imports use skip. State this loss explicitly.
    issues.append('LAUNCHD_MISFIRE_REQUIRES_REVIEW')
    return [task(data.get('Label', 'unlabelled'), data.get('WorkingDirectory', project), data.get('Label', 'Launchd task'),
                 data.get('ProgramArguments', [data.get('Program', '')]), timezone, schedule, 'unknown', issues)]


def windows(xml, project, timezone):
    root = ET.fromstring(xml)
    for element in root.iter():
        element.tag = element.tag.split('}')[-1]
    issues = []
    actions = root.findall('./Actions/Exec')
    triggers = root.findall('./Triggers/*')
    schedule = None
    if len(actions) != 1 or len(root.findall('./Actions/*')) != 1:
        issues.append('UNSUPPORTED_WINDOWS_ACTIONS')
    if len(triggers) == 1 and triggers[0].tag == 'TimeTrigger':
        at = triggers[0].findtext('StartBoundary', '')
        try:
            if datetime.datetime.fromisoformat(at.replace('Z', '+00:00')).utcoffset() is None:
                raise ValueError()
            schedule = dict(kind='once', at=at)
        except ValueError:
            issues.append('MISSING_TIMEZONE_OFFSET')
        if triggers[0].find('Repetition') is not None:
            issues.append('UNSUPPORTED_WINDOWS_REPETITION')
    else:
        issues.append('UNSUPPORTED_WINDOWS_TRIGGER')
    # Task Scheduler conditions, principals, missed-run and action argument quoting
    # require review; XML is useful discovery but never an automatic shell conversion.
    issues.append('WINDOWS_EXECUTION_CONTEXT_REQUIRES_REVIEW')
    action = actions[0] if actions else ET.Element('Exec')
    argv = [action.findtext('Command', '')]
    if action.findtext('Arguments'):
        issues.append('WINDOWS_ARGUMENTS_REQUIRE_STRUCTURED_ARGV')
    enabled_text = root.findtext('./Settings/Enabled')
    enabled = enabled_text == 'true' if enabled_text in ('true', 'false') else 'unknown'
    return [task(root.findtext('./RegistrationInfo/URI', 'windows-task'), action.findtext('WorkingDirectory', project),
                 'Windows scheduled task', argv, timezone, schedule, enabled, issues)]


def workbench(path, project, selected):
    # URI read-only connection refuses missing files and never runs migrations/PRAGMAs.
    connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        version = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if version != ('1',):
            raise ValueError('Unsupported Workbench schema')
        if len(selected) > 100:
            raise ValueError('Select at most 100 tasks')
        query = 'SELECT id,data FROM tasks'
        if selected:
            query += ' WHERE id IN (' + ','.join('?' for _ in selected) + ')'
        values = connection.execute(query + ' LIMIT 101', selected).fetchall()
        if len(values) > 100:
            raise ValueError('Select a batch of at most 100 tasks')
        out = []
        canonical_project = ntpath.normpath(project).lower() if ntpath.isabs(project) and not os.path.isabs(project) else os.path.realpath(project)
        expected_project = hashlib.sha256(canonical_project.encode()).hexdigest()[:24]
        mismatched_project = bool(re.fullmatch(r'[0-9a-f]{24}', path.parent.name)) and path.parent.name != expected_project
        for task_id, raw in values:
            value = json.loads(raw)
            out.append(dict(id=task_id, project=project, **{k:value[k] for k in ['name','prompt','timezone','schedule','enabled']},
                            **({'model':value['model']} if value.get('model') else {}),
                            **({'issues':['PROJECT_ID_MISMATCH']} if mismatched_project else {})))
        return out
    finally:
        connection.close()


def collect(args):
    path = Path(args.path)
    if not path.is_file() or path.stat().st_size > (20_000_000 if args.kind == 'workbench' else 65536):
        raise ValueError('Select an existing bounded source file')
    if not (os.path.isabs(args.project) or ntpath.isabs(args.project)):
        raise ValueError('Project must be an absolute path, verified from the source')
    if args.kind == 'workbench':
        tasks = workbench(path, args.project, args.task_id)
    elif args.kind == 'cron':
        tasks = cron(path.read_text(encoding='utf8'), args.project, args.timezone)
    elif args.kind == 'launchd':
        tasks = launchd(plistlib.loads(path.read_bytes()), args.project, args.timezone)
    elif args.kind == 'windows-task':
        tasks = windows(path.read_bytes(), args.project, args.timezone)
    else:
        # Plugin schemas are not guessed. Accept an explicitly reviewed portable manifest.
        value = json.loads(path.read_text(encoding='utf8'))
        if value.get('version') != 1 or not isinstance(value.get('sources'), list):
            raise ValueError('Plugin requires a reviewed version 1 manifest')
        return value
    if args.task_id and args.kind != 'workbench':
        tasks = [t for t in tasks if t['id'] in args.task_id]
    source_id = args.source_id or hashlib.sha256((socket.gethostname() + ':' + str(path.resolve())).encode()).hexdigest()[:24]
    return dict(version=1, sources=[dict(kind=args.kind, id=source_id, tasks=tasks)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', required=True, choices=['workbench','cron','launchd','windows-task','plugin'])
    parser.add_argument('--path', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--timezone', help='IANA timezone verified from the source; never guessed')
    parser.add_argument('--source-id', help='Stable non-secret source namespace; reuse on subsequent imports')
    parser.add_argument('--task-id', action='append', default=[])
    parser.add_argument('--output', help='Explicitly save a private manifest; default prints only metadata')
    args = parser.parse_args()
    try:
        manifest = collect(args)
        summary = [dict(kind=s['kind'], sourceID=s['id'], tasks=[dict(id=t['id'], schedule=t.get('schedule'), timezone=t.get('timezone'), enabled=t.get('enabled'), issues=t.get('issues', [])) for t in s['tasks']]) for s in manifest['sources']]
        if args.output:
            # Exclusive create: never overwrite a source/export or follow an output symlink.
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf8') as stream:
                json.dump(manifest, stream, ensure_ascii=False)
        print(json.dumps(dict(version=1, sources=summary, saved=bool(args.output)), ensure_ascii=False))
    except Exception:
        # File contents and parser errors can contain prompts or credentials.
        print('Collection failed: check source format, permissions, selection and output path locally; no source was changed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
