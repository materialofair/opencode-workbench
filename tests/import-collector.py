import argparse
import importlib.util
import hashlib
import json
import os
import plistlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'skills/import-scheduled-tasks/scripts/collect.py'
spec = importlib.util.spec_from_file_location('collector', SCRIPT)
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class Collectors(unittest.TestCase):
    def test_cron_mapping_timezone_and_exact_command(self):
        rows = c.cron('CRON_TZ=Asia/Shanghai\n30 9 * * 1,3,5 cd /fixture/project && opencode run -m fixture/model "Read fixture"', '/fixture/project', None)
        self.assertEqual(rows[0]['schedule'], dict(kind='daily', time='09:30', weekdays=[1,3,5]))
        self.assertEqual(rows[0]['model'], dict(providerID='fixture',modelID='model'))
        self.assertEqual(rows[0]['prompt'], 'Read fixture')
        self.assertEqual(rows[0]['timezone'], 'Asia/Shanghai')
        self.assertEqual(rows[0]['issues'], [])
        self.assertEqual(rows[0]['enabled'], 'unknown')

    def test_cron_shell_and_schedule_are_not_silently_dropped(self):
        for line in ['*/5 * * * * opencode run fixture', '0 9 1 * * opencode run fixture', '0 9 * * * opencode run fixture; touch /tmp/no', '0 9 * * * opencode run --agent special fixture', '0 9 * * * sh wrapper.sh', '@reboot opencode run fixture']:
            with self.subTest(line=line):
                self.assertTrue(c.cron(line, '/fixture/project', 'UTC')[0]['issues'])
        with self.assertRaises(ValueError):
            c.cron('TOKEN=synthetic-secret\n0 9 * * * opencode run fixture', '/fixture/project', 'UTC')
        self.assertIn('MISSING_TIMEZONE', c.cron('0 9 * * * opencode run fixture', '/fixture/project', None)[0]['issues'])

    def test_launchd_wildcards_misfire_and_environment(self):
        data = dict(Label='fixture.launchd',ProgramArguments=['opencode','run','Read fixture'],WorkingDirectory='/fixture/project',StartCalendarInterval=dict(Hour=9,Minute=30,Weekday=7))
        row = c.launchd(data, '/fixture/project', 'UTC')[0]
        self.assertEqual(row['schedule'], dict(kind='daily',time='09:30',weekdays=[0]))
        self.assertIn('LAUNCHD_MISFIRE_REQUIRES_REVIEW', row['issues'])
        row = c.launchd({**data,'StartCalendarInterval':dict(Hour=9),'RunAtLoad':True,'EnvironmentVariables':{'TOKEN':'synthetic-secret'}}, '/fixture/project', 'UTC')[0]
        self.assertIn('UNSUPPORTED_LAUNCHD_SCHEDULE', row['issues'])
        self.assertIn('ADDITIONAL_LAUNCHD_TRIGGERS', row['issues'])
        self.assertIn('SOURCE_ENVIRONMENT_REQUIRES_REVIEW', row['issues'])
        self.assertNotIn('synthetic-secret', json.dumps(row))

    def test_windows_xml_utf16_and_context_are_explicit(self):
        xml = '<?xml version="1.0" encoding="UTF-16"?><Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><URI>fixture</URI></RegistrationInfo><Triggers><TimeTrigger><StartBoundary>2030-01-01T09:00:00+08:00</StartBoundary></TimeTrigger></Triggers><Settings><Enabled>false</Enabled></Settings><Actions><Exec><Command>C:\\bin\\opencode.exe</Command><Arguments>run "Read fixture"</Arguments><WorkingDirectory>C:\\Project</WorkingDirectory></Exec></Actions></Task>'
        row = c.windows(xml.encode('utf-16'), 'C:\\Project', 'Asia/Shanghai')[0]
        self.assertEqual(row['schedule'], dict(kind='once',at='2030-01-01T09:00:00+08:00'))
        self.assertFalse(row['enabled'])
        self.assertIn('WINDOWS_ARGUMENTS_REQUIRE_STRUCTURED_ARGV', row['issues'])
        self.assertIn('WINDOWS_EXECUTION_CONTEXT_REQUIRES_REVIEW', row['issues'])

    def test_workbench_read_only_selection_and_missing_source(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'tasks.sqlite'
            db = sqlite3.connect(path)
            db.executescript("CREATE TABLE meta(key TEXT,value TEXT); INSERT INTO meta VALUES('schema','1'); CREATE TABLE tasks(id TEXT,data TEXT);")
            fixture = dict(name='Fixture',prompt='Private synthetic fixture',schedule=dict(kind='interval',minutes=5),timezone='UTC',enabled=True)
            for task_id in ['old-a','old-b']:
                db.execute('INSERT INTO tasks VALUES(?,?)',(task_id,json.dumps(fixture)))
            db.commit(); db.close()
            before = path.read_bytes()
            rows = c.workbench(path, '/fixture/project', ['old-b'])
            self.assertEqual([r['id'] for r in rows], ['old-b'])
            self.assertEqual(path.read_bytes(), before)
            with self.assertRaises(sqlite3.OperationalError):
                c.workbench(Path(folder)/'missing.sqlite','/fixture/project',[])
            self.assertFalse((Path(folder)/'missing.sqlite').exists())
            wrong = Path(folder)/('0'*24)
            wrong.mkdir()
            copied = wrong/'tasks.sqlite'
            copied.write_bytes(before)
            self.assertIn('PROJECT_ID_MISMATCH',c.workbench(copied,'/fixture/project',['old-a'])[0]['issues'])
            correct = Path(folder)/hashlib.sha256(os.path.realpath('/fixture/project').encode()).hexdigest()[:24]
            correct.mkdir()
            copied = correct/'tasks.sqlite'
            copied.write_bytes(before)
            self.assertNotIn('issues',c.workbench(copied,'/fixture/project',['old-a'])[0])

    def test_cli_redaction_private_export_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'fixture.cron'; output = Path(folder)/'private.json'; project = Path(folder)/'project'; project.mkdir()
            source.write_text('0 9 * * * opencode run "Private synthetic fixture"')
            args = [sys.executable,str(SCRIPT),'--kind','cron','--path',str(source),'--project',str(project),'--timezone','UTC']
            result = subprocess.run(args,capture_output=True,text=True)
            self.assertEqual(result.returncode,0)
            self.assertNotIn('Private synthetic fixture',result.stdout)
            first = json.loads(result.stdout)
            result = subprocess.run(args+['--output',str(output)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0)
            self.assertEqual(json.loads(result.stdout)['sources'][0]['sourceID'],first['sources'][0]['sourceID'])
            self.assertIn('Private synthetic fixture',output.read_text())
            if os.name != 'nt':
                self.assertEqual(output.stat().st_mode & 0o777,0o600)
            before = output.read_bytes()
            result = subprocess.run(args+['--output',str(output)],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('Private synthetic fixture',result.stderr)
            self.assertEqual(output.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
