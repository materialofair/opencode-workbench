import { randomUUID } from 'node:crypto';
import { latestDue, nextAt } from './schedule';
import { Store, ACTIVE, type Run, type RunStatus, type Task } from './store';
import type { Host } from './host';
export class Engine {
  owner=randomUUID(); stopped=false; ticking=false; leader=false;
  timer?: ReturnType<typeof setInterval>;
  pending=new Set<Promise<void>>();
  constructor(public store: Store, public host: Host, public concurrency=2, public now=()=>Date.now()) {}
  start() { this.timer=setInterval(()=>{if(!this.stopped && this.leader)this.leader=this.store.lease(this.owner,this.now());void this.tick().catch(()=>{});},1000); this.timer.unref(); return this.tick(); }
  update(r:Run,status:RunStatus,note='') {
    const current=this.store.run(r.id);
    if(!current || current.version!==r.version) return;
    r.status=status; r.note=note; r.updated=this.now(); r.version++; this.store.putRun(r);
  }
  async tick() {
    if(this.stopped || this.ticking) return;
    this.ticking=true;
    try {
      this.leader=this.store.lease(this.owner,this.now()); if(!this.leader) return;
      // Reconciliation never resubmits. Lost acknowledgements are deliberately uncertain.
      for(const r of this.store.active()) if(r.sessionID && !this.isDispatching(r.id)) {
        try {
          const snap=await this.host.inspect(r.sessionID);
          if(this.stopped) return;
          // Busy doesn't mean an approval/question was answered. Keep waiting until a
          // reply event or a terminal snapshot proves the state changed.
          if((r.status==='waiting_approval'||r.status==='waiting_input') && ['running','uncertain'].includes(snap.status)) continue;
          this.update(r,snap.status,snap.note);
        } catch { /* preserve last known state on backend outage */ }
      } else if(!r.sessionID && !this.isDispatching(r.id)) this.update(r,'uncertain','提交过程被中断；不会自动重发');
      if(this.stopped || !this.store.lease(this.owner,this.now())) return;
      for(const t of this.store.tasks()) {
        const now=this.now(); if(!t.enabled || t.next===null || t.next>now) continue;
        const due=latestDue(t.schedule,t.timezone,t.next,now,t.anchor);
        const late=now-t.next>60000;
        this.store.db.transaction(()=>{
          const fresh=this.store.task(t.id);
          if(!fresh || fresh.revision!==t.revision || fresh.next!==t.next) return;
          const next=nextAt(t.schedule,t.timezone,now,t.anchor);
          t.next=next; t.enabled=next!==null; t.updated=now; this.store.put(t);
          if(late && (t.misfire==='skip' || now-due>86400000)) {
            this.store.claim(t,`scheduled:${due}`,'skipped','错过时间：按策略跳过（补跑上限 24 小时）',now); return;
          }
          this.enqueue(t,`scheduled:${due}`,late?'合并错过触发，仅补跑最新一次':'');
        })();
      }
    } finally { this.ticking=false; }
  }
  private dispatching=new Set<string>();
  isDispatching(id:string) { return this.dispatching.has(id); }
  enqueue(t:Task,slot:string,note='') {
    const active=this.store.active();
    const busy=active.length>=this.concurrency || active.some(r=>r.taskID===t.id);
    const r=this.store.claim(t,slot,busy?'skipped':'submitting',busy?'已达并发上限或同一任务仍在执行':note,this.now());
    if(r && !busy) {
      this.dispatching.add(r.id);
      // Microtask runs after the claim and next schedule commit atomically.
      const p=Promise.resolve().then(()=>this.dispatch(r,t)); this.pending.add(p); void p.finally(()=>{this.pending.delete(p);this.dispatching.delete(r.id);});
    }
    return r;
  }
  runNow(id:string,key:string) {
    if(this.stopped || !this.store.lease(this.owner,this.now())) throw new Error('另一个 OpenCode 进程拥有调度器，请在该进程管理');
    const t=this.store.task(id); if(!t) throw new Error('任务不存在');
    const existing=this.store.runs().find(r=>r.taskID===id && r.slot===`manual:${key}`); if(existing) return existing;
    return this.store.db.transaction(()=>this.enqueue(t,`manual:${key}`))();
  }
  async dispatch(r:Run,t:Task) {
    if(this.stopped || !this.store.lease(this.owner,this.now())) { this.update(r,'interrupted','调度已停止或所有权改变，未提交'); return; }
    try {
      r.sessionID=await this.host.create(`定时任务 · ${t.name} · ${r.id.slice(0,8)}`);
      if(this.stopped || !this.store.lease(this.owner,this.now())) { this.update(r,'interrupted','调度停止或所有权改变，未提交指令'); return; }
      this.update(r,'submitted','已创建会话，正在提交指令');
      await this.host.submit(r.sessionID,t.prompt);
      // Events may have already moved the persisted run forward. Never downgrade.
      const current=this.store.active().find(x=>x.id===r.id);
      if(current?.status==='submitted') this.update(current,'submitted','宿主已接受；等待运行证据');
    } catch {
      const current=this.store.active().find(x=>x.id===r.id);
      if(current) this.update(current,r.sessionID?'uncertain':'failed',r.sessionID?'提交结果待确认；不会自动重发':'创建会话失败，未提交任务');
    }
  }
  async event(event:{type:string;properties?:any}) {
    if(this.stopped) return;
    const p=event.properties ?? {}; const sid=p.sessionID ?? p.info?.sessionID;
    if(!sid) return;
    const r=this.store.active().find(x=>x.sessionID===sid); if(!r) return;
    if(['permission.asked','permission.updated','permission.v2.asked'].includes(event.type)) this.update(r,'waiting_approval','请在 OpenCode 中审批；页面不会代为批准');
    else if(['question.asked','question.v2.asked'].includes(event.type)) this.update(r,'waiting_input','请在 OpenCode 会话中回答问题');
    else if(['permission.replied','permission.v2.replied','question.replied','question.rejected','question.v2.replied','question.v2.rejected'].includes(event.type)) this.update(r,'running','宿主收到审批或问答回应');
    else if(event.type==='session.error') this.update(r,'failed','OpenCode 会话报告错误；请在宿主查看详情');
    else if(event.type==='session.status' && p.status?.type!=='idle') {
      if(!['waiting_approval','waiting_input'].includes(r.status)) this.update(r,'running');
    } else if(event.type==='session.idle' || (event.type==='session.status' && p.status?.type==='idle')) {
      try { const s=await this.host.inspect(sid); if(!this.stopped) this.update(r,s.status,s.note); } catch {}
    }
  }
  async cancel(id:string) {
    const r=this.store.active().find(x=>x.id===id); if(!r) throw new Error('此运行已结束');
    if(this.isDispatching(id)) throw new Error('正在提交，请稍后中止');
    if(r.sessionID) await this.host.abort(r.sessionID);
    if(this.stopped)return;
    const current=this.store.run(r.id);
    if(current && current.status!=='succeeded')this.update(current,'interrupted','用户中止；已发生的外部操作不会撤销');
  }
  async stop() {
    if(this.stopped) return; this.stopped=true; clearInterval(this.timer);
    await Promise.allSettled([...this.pending]);
    this.store.release(this.owner);
  }
}
