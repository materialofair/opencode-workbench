import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nextAt, validate, type TaskInput } from './schedule';
export type Task = TaskInput & { id: string; revision: number; anchor: number; next: number | null; created: number; updated: number };
export type RunStatus = 'submitting' | 'submitted' | 'running' | 'waiting_approval' | 'waiting_input' | 'succeeded' | 'failed' | 'uncertain' | 'interrupted' | 'skipped';
export const ACTIVE = ['submitting','submitted','running','waiting_approval','waiting_input','uncertain'];
export type Run = { id: string; taskID: string; taskName: string; slot: string; status: RunStatus; sessionID: string | null; created: number; updated: number; note: string; revision: number; version: number };
export class Store {
  db: Database;
  constructor(path: string) {
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
    this.db = new Database(path, { create: true });
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,slot TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(task_id,slot));
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, until_ms INTEGER NOT NULL);`);
    const version = this.db.query("SELECT value FROM meta WHERE key='schema'").get() as {value:string}|null;
    if (version && version.value !== '1') throw new Error('不支持此数据库版本；请恢复匹配的插件版本');
    this.db.query("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();
  }
  tasks() { return (this.db.query('SELECT data FROM tasks ORDER BY rowid DESC').all() as {data:string}[]).map(r => JSON.parse(r.data) as Task); }
  task(id: string) { const r = this.db.query('SELECT data FROM tasks WHERE id=?').get(id) as {data:string}|null; return r ? JSON.parse(r.data) as Task : undefined; }
  put(t: Task) { this.db.query('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(t.id, JSON.stringify(t)); }
  save(input: unknown, id?: string, expected?: number, now = Date.now()) {
    const v = validate(input);
    return this.db.transaction(() => {
      const old = id ? this.task(id) : undefined;
      if (id && !old) throw new Error('任务不存在');
      if (old && old.revision !== expected) throw new Error('任务已变更，请刷新后重试');
      const next = v.enabled ? nextAt(v.schedule,v.timezone,now,now) : null;
      if (v.enabled && next === null) throw new Error('单次任务必须选择将来的时间');
      const t: Task = { ...v, id: old?.id ?? randomUUID(), revision: (old?.revision ?? 0)+1, anchor: now, next, created: old?.created ?? now, updated: now };
      this.put(t); return t;
    })();
  }
  delete(id: string) { this.db.query('DELETE FROM tasks WHERE id=?').run(id); }
  runs() { return (this.db.query('SELECT data FROM runs ORDER BY rowid DESC LIMIT 1000').all() as {data:string}[]).map(r => JSON.parse(r.data) as Run); }
  run(id:string) { const r=this.db.query('SELECT data FROM runs WHERE id=?').get(id) as {data:string}|null; return r?JSON.parse(r.data) as Run:undefined; }
  active() { return (this.db.query('SELECT data FROM runs').all() as {data:string}[]).map(r=>JSON.parse(r.data) as Run).filter(r=>ACTIVE.includes(r.status)); }
  putRun(r: Run) { this.db.query('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify(r),r.id); }
  claim(t: Task, slot: string, status: RunStatus, note = '', now=Date.now()): Run | null {
    const r: Run={id:randomUUID(),taskID:t.id,taskName:t.name,revision:t.revision,version:0,slot,status,sessionID:null,created:now,updated:now,note};
    const result=this.db.query('INSERT OR IGNORE INTO runs VALUES(?,?,?,?)').run(r.id,t.id,slot,JSON.stringify(r));
    return result.changes ? r : null;
  }
  lease(owner: string, now=Date.now()) {
    this.db.query('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE lease.owner=excluded.owner OR lease.until_ms < ?').run(owner,now+30000,now);
    return (this.db.query('SELECT owner FROM lease').get() as {owner:string}).owner===owner;
  }
  release(owner:string) { this.db.query('DELETE FROM lease WHERE owner=?').run(owner); }
  close() { this.db.close(); }
}
