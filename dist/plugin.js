// src/plugin.ts
import { tool } from "@opencode-ai/plugin";
import { realpathSync, mkdirSync as mkdirSync2 } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// src/sqlite.ts
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);

class Database {
  native;
  bun;
  constructor(path, _options) {
    this.bun = typeof globalThis.Bun !== "undefined";
    const Runtime = this.bun ? require2("bun:sqlite").Database : require2("node:sqlite").DatabaseSync;
    this.native = new Runtime(path, this.bun ? { create: true } : {});
  }
  exec(sql) {
    this.native.exec(sql);
  }
  query(sql) {
    const s = this.bun ? this.native.query(sql) : this.native.prepare(sql);
    return { get: (...v) => s.get(...v), all: (...v) => s.all(...v), run: (...v) => s.run(...v) };
  }
  transaction(fn) {
    if (this.bun)
      return this.native.transaction(fn);
    return () => {
      this.native.exec("BEGIN IMMEDIATE");
      try {
        const value = fn();
        this.native.exec("COMMIT");
        return value;
      } catch (e) {
        this.native.exec("ROLLBACK");
        throw e;
      }
    };
  }
  close() {
    this.native.close();
  }
}

// src/store.ts
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// src/schedule.ts
var formats = new Map;
function localParts(at, timezone) {
  let f = formats.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
    formats.set(timezone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
function validate(value) {
  if (!value || typeof value !== "object")
    throw new Error("任务格式无效");
  const v = value;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100)
    throw new Error("任务名称需为 1–100 字符");
  if (typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 16000)
    throw new Error("指令需为 1–16000 字符");
  if (typeof v.timezone !== "string" || v.timezone.length > 100)
    throw new Error("时区无效");
  try {
    localParts(Date.now(), v.timezone);
  } catch {
    throw new Error("请使用有效 IANA 时区");
  }
  if (typeof v.enabled !== "boolean" || !["skip", "latest"].includes(v.misfire))
    throw new Error("启用状态或补跑策略无效");
  const s = v.schedule;
  if (!s || typeof s !== "object")
    throw new Error("时间规则无效");
  let schedule;
  if (s.kind === "once") {
    if (typeof s.at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(s.at) || !Number.isFinite(Date.parse(s.at)))
      throw new Error("单次时间必须包含 UTC 或时区偏移");
    schedule = { kind: "once", at: new Date(s.at).toISOString() };
  } else if (s.kind === "interval") {
    if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 525600)
      throw new Error("间隔需为 1–525600 分钟");
    schedule = { kind: "interval", minutes: s.minutes };
  } else if (s.kind === "daily") {
    if (typeof s.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) || !Array.isArray(s.weekdays) || !s.weekdays.length || !s.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      throw new Error("每天时间或星期无效");
    schedule = { kind: "daily", time: s.time, weekdays: [...new Set(s.weekdays)].sort() };
  } else
    throw new Error("不支持的时间规则");
  let model;
  if (v.model !== undefined) {
    if (!v.model || !["providerID", "modelID"].every((k) => typeof v.model[k] === "string" && v.model[k].trim().length > 0 && v.model[k].length <= 200 && !/[\u0000-\u001f]/.test(v.model[k])))
      throw new Error("模型需同时填写有效的 Provider ID 与模型 ID");
    model = { providerID: v.model.providerID.trim(), modelID: v.model.modelID.trim() };
  }
  return { name: v.name.trim(), prompt: v.prompt, timezone: v.timezone, schedule, enabled: v.enabled, misfire: v.misfire, ...model ? { model } : {} };
}
function nextAt(s, zone, after, anchor = after) {
  if (s.kind === "once")
    return Date.parse(s.at) > after ? Date.parse(s.at) : null;
  if (s.kind === "interval") {
    const step = s.minutes * 60000;
    return anchor + (Math.floor((after - anchor) / step) + 1) * step;
  }
  const current = localParts(after, zone);
  for (let t = Math.floor(after / 60000) * 60000 + 60000, end = t + 9 * 86400000;t < end; t += 60000) {
    const p = localParts(t, zone);
    if (p.time === s.time && s.weekdays.includes(p.weekday) && !(p.date === current.date && current.time >= s.time))
      return t;
  }
  throw new Error("无法计算下次时间");
}
function latestDue(s, zone, due, now, anchor) {
  if (s.kind === "once")
    return due;
  if (s.kind === "interval")
    return anchor + Math.floor((now - anchor) / (s.minutes * 60000)) * s.minutes * 60000;
  let candidate = due;
  let cursor = Math.max(due - 1, now - 9 * 86400000);
  for (let n = 0;n < 10; n++) {
    const t = nextAt(s, zone, cursor, anchor);
    if (t === null || t > now)
      break;
    candidate = t;
    cursor = t;
  }
  return candidate;
}

// src/store.ts
var ACTIVE = ["submitting", "submitted", "running", "waiting_approval", "waiting_input", "uncertain"];

class Store {
  db;
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 448 });
    }
    this.db = new Database(path, { create: true });
    if (path !== ":memory:")
      chmodSync(path, 384);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,slot TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(task_id,slot));
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, until_ms INTEGER NOT NULL);`);
    const version = this.db.query("SELECT value FROM meta WHERE key='schema'").get();
    if (version && version.value !== "1")
      throw new Error("不支持此数据库版本；请恢复匹配的插件版本");
    this.db.query("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();
  }
  tasks() {
    return this.db.query("SELECT data FROM tasks ORDER BY rowid DESC").all().map((r) => JSON.parse(r.data));
  }
  task(id) {
    const r = this.db.query("SELECT data FROM tasks WHERE id=?").get(id);
    return r ? JSON.parse(r.data) : undefined;
  }
  put(t) {
    this.db.query("INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(t.id, JSON.stringify(t));
  }
  save(input, id, expected, now = Date.now()) {
    const v = validate(input);
    return this.db.transaction(() => {
      const old = id ? this.task(id) : undefined;
      if (id && !old)
        throw new Error("任务不存在");
      if (old && old.revision !== expected)
        throw new Error("任务已变更，请刷新后重试");
      const next = v.enabled ? nextAt(v.schedule, v.timezone, now, now) : null;
      if (v.enabled && next === null)
        throw new Error("单次任务必须选择将来的时间");
      const t = { ...v, id: old?.id ?? randomUUID(), revision: (old?.revision ?? 0) + 1, anchor: now, next, created: old?.created ?? now, updated: now };
      this.put(t);
      return t;
    })();
  }
  delete(id) {
    this.db.query("DELETE FROM tasks WHERE id=?").run(id);
  }
  runs() {
    return this.db.query("SELECT data FROM runs ORDER BY rowid DESC LIMIT 1000").all().map((r) => JSON.parse(r.data));
  }
  run(id) {
    const r = this.db.query("SELECT data FROM runs WHERE id=?").get(id);
    return r ? JSON.parse(r.data) : undefined;
  }
  active() {
    return this.db.query("SELECT data FROM runs").all().map((r) => JSON.parse(r.data)).filter((r) => ACTIVE.includes(r.status));
  }
  putRun(r) {
    this.db.query("UPDATE runs SET data=? WHERE id=?").run(JSON.stringify(r), r.id);
  }
  claim(t, slot, status, note = "", now = Date.now()) {
    const r = { id: randomUUID(), taskID: t.id, taskName: t.name, revision: t.revision, version: 0, slot, status, sessionID: null, created: now, updated: now, note };
    const result = this.db.query("INSERT OR IGNORE INTO runs VALUES(?,?,?,?)").run(r.id, t.id, slot, JSON.stringify(r));
    return result.changes ? r : null;
  }
  lease(owner, now = Date.now()) {
    this.db.query("INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE lease.owner=excluded.owner OR lease.until_ms < ?").run(owner, now + 30000, now);
    return this.db.query("SELECT owner FROM lease").get().owner === owner;
  }
  release(owner) {
    this.db.query("DELETE FROM lease WHERE owner=?").run(owner);
  }
  close() {
    this.db.close();
  }
}

// src/engine.ts
import { randomUUID as randomUUID2 } from "node:crypto";
class Engine {
  store;
  host;
  concurrency;
  now;
  owner = randomUUID2();
  stopped = false;
  ticking = false;
  leader = false;
  timer;
  pending = new Set;
  constructor(store, host, concurrency = 2, now = () => Date.now()) {
    this.store = store;
    this.host = host;
    this.concurrency = concurrency;
    this.now = now;
  }
  start() {
    this.timer = setInterval(() => {
      if (!this.stopped && this.leader)
        this.leader = this.store.lease(this.owner, this.now());
      this.tick().catch(() => {});
    }, 1000);
    this.timer.unref();
    return this.tick();
  }
  update(r, status, note = "") {
    const current = this.store.run(r.id);
    if (!current || current.version !== r.version)
      return;
    r.status = status;
    r.note = note;
    r.updated = this.now();
    r.version++;
    this.store.putRun(r);
  }
  async tick() {
    if (this.stopped || this.ticking)
      return;
    this.ticking = true;
    try {
      this.leader = this.store.lease(this.owner, this.now());
      if (!this.leader)
        return;
      for (const r of this.store.active())
        if (r.sessionID && !this.isDispatching(r.id)) {
          try {
            const snap = await this.host.inspect(r.sessionID);
            if (this.stopped)
              return;
            if ((r.status === "waiting_approval" || r.status === "waiting_input") && ["running", "uncertain"].includes(snap.status))
              continue;
            this.update(r, snap.status, snap.note);
          } catch {}
        } else if (!r.sessionID && !this.isDispatching(r.id))
          this.update(r, "uncertain", "提交过程被中断；不会自动重发");
      if (this.stopped || !this.store.lease(this.owner, this.now()))
        return;
      for (const t of this.store.tasks()) {
        const now = this.now();
        if (!t.enabled || t.next === null || t.next > now)
          continue;
        const due = latestDue(t.schedule, t.timezone, t.next, now, t.anchor);
        const late = now - t.next > 60000;
        this.store.db.transaction(() => {
          const fresh = this.store.task(t.id);
          if (!fresh || fresh.revision !== t.revision || fresh.next !== t.next)
            return;
          const next = nextAt(t.schedule, t.timezone, now, t.anchor);
          t.next = next;
          t.enabled = next !== null;
          t.updated = now;
          this.store.put(t);
          if (late && (t.misfire === "skip" || now - due > 86400000)) {
            this.store.claim(t, `scheduled:${due}`, "skipped", "错过时间：按策略跳过（补跑上限 24 小时）", now);
            return;
          }
          this.enqueue(t, `scheduled:${due}`, late ? "合并错过触发，仅补跑最新一次" : "");
        })();
      }
    } finally {
      this.ticking = false;
    }
  }
  dispatching = new Set;
  isDispatching(id) {
    return this.dispatching.has(id);
  }
  enqueue(t, slot, note = "") {
    const active = this.store.active();
    const busy = active.length >= this.concurrency || active.some((r2) => r2.taskID === t.id);
    const r = this.store.claim(t, slot, busy ? "skipped" : "submitting", busy ? "已达并发上限或同一任务仍在执行" : note, this.now());
    if (r && !busy) {
      this.dispatching.add(r.id);
      const p = Promise.resolve().then(() => this.dispatch(r, t));
      this.pending.add(p);
      p.finally(() => {
        this.pending.delete(p);
        this.dispatching.delete(r.id);
      });
    }
    return r;
  }
  runNow(id, key) {
    if (this.stopped || !this.store.lease(this.owner, this.now()))
      throw new Error("另一个 OpenCode 进程拥有调度器，请在该进程管理");
    const t = this.store.task(id);
    if (!t)
      throw new Error("任务不存在");
    const existing = this.store.runs().find((r) => r.taskID === id && r.slot === `manual:${key}`);
    if (existing)
      return existing;
    return this.store.db.transaction(() => this.enqueue(t, `manual:${key}`))();
  }
  async dispatch(r, t) {
    if (this.stopped || !this.store.lease(this.owner, this.now())) {
      this.update(r, "interrupted", "调度已停止或所有权改变，未提交");
      return;
    }
    try {
      r.sessionID = await this.host.create(`定时任务 · ${t.name} · ${r.id.slice(0, 8)}`, t.model);
      if (this.stopped || !this.store.lease(this.owner, this.now())) {
        this.update(r, "interrupted", "调度停止或所有权改变，未提交指令");
        return;
      }
      this.update(r, "submitted", "已创建会话，正在提交指令");
      await this.host.submit(r.sessionID, t.prompt, t.model);
      const current = this.store.active().find((x) => x.id === r.id);
      if (current?.status === "submitted")
        this.update(current, "submitted", "宿主已接受；等待运行证据");
    } catch {
      const current = this.store.active().find((x) => x.id === r.id);
      if (current)
        this.update(current, r.sessionID ? "uncertain" : "failed", r.sessionID ? "提交结果待确认；不会自动重发" : "创建会话失败，未提交任务");
    }
  }
  async event(event) {
    if (this.stopped)
      return;
    const p = event.properties ?? {};
    const sid = p.sessionID ?? p.info?.sessionID;
    if (!sid)
      return;
    const r = this.store.active().find((x) => x.sessionID === sid);
    if (!r)
      return;
    if (["permission.asked", "permission.updated", "permission.v2.asked"].includes(event.type))
      this.update(r, "waiting_approval", "请在 OpenCode 中审批；页面不会代为批准");
    else if (["question.asked", "question.v2.asked"].includes(event.type))
      this.update(r, "waiting_input", "请在 OpenCode 会话中回答问题");
    else if (["permission.replied", "permission.v2.replied", "question.replied", "question.rejected", "question.v2.replied", "question.v2.rejected"].includes(event.type))
      this.update(r, "running", "宿主收到审批或问答回应");
    else if (event.type === "session.error")
      this.update(r, "failed", "OpenCode 会话报告错误；请在宿主查看详情");
    else if (event.type === "session.status" && p.status?.type !== "idle") {
      if (!["waiting_approval", "waiting_input"].includes(r.status))
        this.update(r, "running");
    } else if (event.type === "session.idle" || event.type === "session.status" && p.status?.type === "idle") {
      try {
        const s = await this.host.inspect(sid);
        if (!this.stopped)
          this.update(r, s.status, s.note);
      } catch {}
    }
  }
  async cancel(id) {
    const r = this.store.active().find((x) => x.id === id);
    if (!r)
      throw new Error("此运行已结束");
    if (this.isDispatching(id))
      throw new Error("正在提交，请稍后中止");
    if (r.sessionID)
      await this.host.abort(r.sessionID);
    if (this.stopped)
      return;
    const current = this.store.run(r.id);
    if (current && current.status !== "succeeded")
      this.update(current, "interrupted", "用户中止；已发生的外部操作不会撤销");
  }
  async stop() {
    if (this.stopped)
      return;
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.pending]);
    this.store.release(this.owner);
  }
}

// src/host.ts
function reviewRules(permission) {
  const result = [{ permission: "*", pattern: "*", action: "ask" }];
  if (Array.isArray(permission))
    for (const rule of permission) {
      if (rule?.action === "deny" && typeof rule.permission === "string" && typeof rule.pattern === "string")
        result.push({ permission: rule.permission, pattern: rule.pattern, action: "deny" });
    }
  if (permission === "deny")
    result.push({ permission: "*", pattern: "*", action: "deny" });
  if (permission && typeof permission === "object" && !Array.isArray(permission))
    for (const [name, value] of Object.entries(permission)) {
      if (value === "deny")
        result.push({ permission: name, pattern: "*", action: "deny" });
      else if (value && typeof value === "object") {
        for (const [pattern, action] of Object.entries(value))
          if (action === "deny")
            result.push({ permission: name, pattern, action: "deny" });
      }
    }
  return result;
}
function injectedHost(ctx) {
  const { client, directory } = ctx;
  const query = { directory };
  const agentsBySession = new Map;
  return {
    async create(title, model) {
      const c = await client.config.get({ query, signal: AbortSignal.timeout(1e4) });
      if (c.error || !c.data)
        throw new Error("无法读取宿主权限配置");
      const config = c.data;
      const agent = config.default_agent || "build";
      const a = await client.app.agents({ query, signal: AbortSignal.timeout(1e4) });
      if (a.error || !a.data)
        throw new Error("无法读取宿主 Agent 权限");
      const selected = a.data.find((x) => x.name === agent);
      if (!selected)
        throw new Error("找不到宿主默认 Agent，未提交任务");
      const rules = [...reviewRules(config.permission), ...reviewRules(selected.permission).filter((r2) => r2.action === "deny")];
      const body = { title, agent, permission: rules, ...model ? { model: { id: model.modelID, providerID: model.providerID } } : {} };
      const r = await client.session.create({ query, body, signal: AbortSignal.timeout(1e4) });
      if (r.error || !r.data?.id)
        throw new Error("无法创建 OpenCode 会话");
      agentsBySession.set(r.data.id, agent);
      return r.data.id;
    },
    async submit(id, prompt, model) {
      const r = await client.session.promptAsync({ path: { id }, query, body: { agent: agentsBySession.get(id), ...model ? { model } : {}, parts: [{ type: "text", text: prompt }] }, signal: AbortSignal.timeout(1e4) });
      agentsBySession.delete(id);
      if (r.error)
        throw new Error("OpenCode 未确认提交");
    },
    async inspect(id) {
      const [s, m] = await Promise.all([client.session.status({ query, signal: AbortSignal.timeout(5000) }), client.session.messages({ path: { id }, query, signal: AbortSignal.timeout(5000) })]);
      if (s.error || m.error)
        throw new Error("无法读取运行状态");
      const messages = m.data ?? [];
      const assistants = messages.filter((x) => x.info.role === "assistant");
      if (assistants.some((x) => x.info.role === "assistant" && x.info.error))
        return { status: "failed", note: "OpenCode 会话报告执行错误；请在宿主查看详情" };
      const active = s.data?.[id];
      if (active && active.type !== "idle")
        return { status: "running" };
      const last = assistants.at(-1)?.info;
      if (last?.role === "assistant" && last.time.completed && last.finish && !["tool-calls", "unknown"].includes(last.finish))
        return { status: "succeeded" };
      return { status: "uncertain", note: "未取得终态证据；不会自动重发，请到 OpenCode 会话核查" };
    },
    async abort(id) {
      const r = await client.session.abort({ path: { id }, query, signal: AbortSignal.timeout(1e4) });
      if (r.error)
        throw new Error("宿主未确认中止");
    }
  };
}

// src/server.ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
var assets = new URL("../public/", import.meta.url);
var sharedHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY" };
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req) {
  const reader = req.body?.getReader();
  if (!reader)
    throw new Error("缺少请求内容");
  let size = 0;
  const chunks = [];
  while (true) {
    const r = await reader.read();
    if (r.done)
      break;
    size += r.value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new Error("请求内容过大");
    }
    chunks.push(r.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function startServer(engine, directory, demo = false) {
  const token = randomBytes(32).toString("base64url");
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...sharedHeaders, "Content-Type": "application/json; charset=utf-8" } });
  let port = 0;
  async function handle(req) {
    const u = new URL(req.url);
    const origin = `http://127.0.0.1:${port}`;
    if (u.origin !== origin || req.headers.get("host") !== `127.0.0.1:${port}`)
      return json({ error: "Host rejected" }, 403);
    const suppliedOrigin = req.headers.get("origin");
    if (suppliedOrigin && suppliedOrigin !== origin)
      return json({ error: "Origin rejected" }, 403);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "Cross-site request rejected" }, 403);
    if (u.pathname.startsWith("/api/")) {
      if (!equal(req.headers.get("authorization") ?? "", `Bearer ${token}`))
        return json({ error: "页面授权已失效，请重新对 OpenCode 说“打开定时任务管理”" }, 401);
      if (req.method !== "GET" && (suppliedOrigin !== origin || !equal(req.headers.get("x-task-csrf") ?? "", token)))
        return json({ error: "CSRF rejected" }, 403);
      try {
        if (u.pathname === "/api/state" && req.method === "GET")
          return json({ tasks: engine.store.tasks(), runs: engine.store.runs(), directory, leader: engine.leader, demo, concurrency: engine.concurrency, now: Date.now(), lifecycle: "调度随此 OpenCode 后端运行。真正退出、休眠、关机时不能准点执行。" });
        if (u.pathname === "/api/tasks" && req.method === "POST") {
          const v = await body(req);
          return json(engine.store.save(v), 201);
        }
        const match = u.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(\/run)?$/);
        if (match) {
          const id = match[1];
          if (match[2] && req.method === "POST") {
            const key = req.headers.get("idempotency-key") ?? "";
            if (!/^[a-zA-Z0-9-]{16,80}$/.test(key))
              return json({ error: "缺少有效去重键" }, 400);
            return json(engine.runNow(id, key), 202);
          }
          if (!match[2] && req.method === "PUT") {
            const v = await body(req);
            return json(engine.store.save(v, id, v.revision));
          }
          if (!match[2] && req.method === "DELETE") {
            if (engine.store.active().some((r) => r.taskID === id))
              return json({ error: "此任务仍有运行，请先中止后再删除" }, 409);
            engine.store.delete(id);
            return json({ ok: true });
          }
        }
        const cancel = u.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
        if (cancel && req.method === "POST") {
          await engine.cancel(cancel[1]);
          return json({ ok: true });
        }
        return json({ error: "接口不存在" }, 404);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "请求失败" }, 400);
      }
    }
    if (req.method !== "GET")
      return json({ error: "Method rejected" }, 405);
    const names = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
    const asset = names[u.pathname];
    if (!asset)
      return json({ error: "Not found" }, 404);
    return new Response(readFileSync(fileURLToPath(new URL(asset[0], assets))), { headers: { ...sharedHeaders, "Content-Type": asset[1] } });
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      let size = 0;
      if (Number(incoming.headers["content-length"] ?? 0) > 65536) {
        outgoing.writeHead(413);
        outgoing.end();
        incoming.resume();
        return;
      }
      for await (const chunk of incoming) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > 65536) {
          outgoing.writeHead(413);
          outgoing.end();
          return;
        }
        chunks.push(b);
      }
      const method = incoming.method ?? "GET";
      const headers = new Headers;
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          for (const item of value)
            headers.append(name, item);
        else if (value !== undefined)
          headers.set(name, value);
      }
      const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, { method, headers, ...!["GET", "HEAD"].includes(method) ? { body: Buffer.concat(chunks) } : {} });
      const response = await handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent)
        outgoing.writeHead(500, sharedHeaders);
      outgoing.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 1e4;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/#${token}`, stop: () => {
    server.closeAllConnections();
    server.close();
  } };
}

// src/plugin.ts
import { spawn } from "node:child_process";
var TaskManager = async (ctx) => {
  const directory = realpathSync(ctx.directory);
  const id = createHash("sha256").update(directory).digest("hex").slice(0, 24);
  const root = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode-workbench", id);
  mkdirSync2(root, { recursive: true, mode: 448 });
  const store = new Store(join(root, "tasks.sqlite"));
  const engine = new Engine(store, injectedHost({ ...ctx, directory }));
  const page = await startServer(engine, directory);
  let startupTimer = setTimeout(() => void engine.start().catch(() => {}), 0);
  let disposed = false;
  const dispose = async () => {
    if (disposed)
      return;
    disposed = true;
    clearTimeout(startupTimer);
    page.stop();
    await engine.stop();
    store.close();
  };
  return {
    dispose,
    event: async ({ event }) => {
      if (event.type === "server.instance.disposed" && event.properties?.directory === directory) {
        await dispose();
        return;
      }
      await engine.event(event);
    },
    "permission.ask": async (input, output) => {
      if (store.active().some((r) => r.sessionID === input.sessionID) && output.status === "allow")
        output.status = "ask";
    },
    tool: { open_task_manager: tool({
      description: "在本机默认浏览器中打开当前 OpenCode 项目的定时任务管理页面。只打开页面，不创建或执行任务。",
      args: {},
      async execute(_args, context) {
        if (disposed)
          throw new Error("任务管理已停止，请重新打开项目");
        if (store.active().some((r) => r.sessionID === context.sessionID))
          throw new Error("定时任务不能递归打开管理器");
        const command = process.platform === "darwin" ? ["open", page.url] : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", page.url] : ["xdg-open", page.url];
        const code = await new Promise((resolve, reject) => {
          const proc = spawn(command[0], command.slice(1), { stdio: "ignore" });
          proc.once("error", () => reject(new Error("本机浏览器启动失败")));
          proc.once("exit", (code2) => resolve(code2 ?? 1));
        });
        if (code !== 0)
          throw new Error("无法打开默认浏览器，请检查本机浏览器后再次调用");
        return "已打开当前项目的定时任务管理页面。调度仅在 OpenCode 后端运行时有效；审批请在 OpenCode 会话处理。";
      }
    }) }
  };
};
export {
  TaskManager
};
