export type Schedule = { kind: 'once'; at: string } | { kind: 'interval'; minutes: number } | { kind: 'daily'; time: string; weekdays: number[] };
export type ModelRef = {providerID:string;modelID:string};
export type TaskInput = { model?: ModelRef; name: string; prompt: string; timezone: string; schedule: Schedule; enabled: boolean; misfire: 'skip' | 'latest' };
const formats = new Map<string, Intl.DateTimeFormat>();
export function localParts(at: number, timezone: string) {
  let f = formats.get(timezone);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }); formats.set(timezone, f); }
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday) };
}
export function validate(value: unknown): TaskInput {
  if (!value || typeof value !== 'object') throw new Error('任务格式无效');
  const v = value as TaskInput;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) throw new Error('任务名称需为 1–100 字符');
  if (typeof v.prompt !== 'string' || !v.prompt.trim() || v.prompt.length > 16000) throw new Error('指令需为 1–16000 字符');
  if (typeof v.timezone !== 'string' || v.timezone.length > 100) throw new Error('时区无效');
  try { localParts(Date.now(), v.timezone); } catch { throw new Error('请使用有效 IANA 时区'); }
  if (typeof v.enabled !== 'boolean' || !['skip','latest'].includes(v.misfire)) throw new Error('启用状态或补跑策略无效');
  const s = v.schedule;
  if (!s || typeof s !== 'object') throw new Error('时间规则无效');
  let schedule: Schedule;
  if (s.kind === 'once') {
    if (typeof s.at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(s.at) || !Number.isFinite(Date.parse(s.at))) throw new Error('单次时间必须包含 UTC 或时区偏移');
    schedule = { kind: 'once', at: new Date(s.at).toISOString() };
  } else if (s.kind === 'interval') {
    if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 525600) throw new Error('间隔需为 1–525600 分钟');
    schedule = { kind: 'interval', minutes: s.minutes };
  } else if (s.kind === 'daily') {
    if (typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) || !Array.isArray(s.weekdays) || !s.weekdays.length || !s.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('每天时间或星期无效');
    schedule = { kind: 'daily', time: s.time, weekdays: [...new Set(s.weekdays)].sort() };
  } else throw new Error('不支持的时间规则');
  let model:ModelRef|undefined;
  if(v.model!==undefined){
    if(!v.model || !['providerID','modelID'].every(k=>typeof (v.model as any)[k]==='string' && (v.model as any)[k].trim().length>0 && (v.model as any)[k].length<=200 && !/[\u0000-\u001f]/.test((v.model as any)[k])))throw new Error('模型需同时填写有效的 Provider ID 与模型 ID');
    model={providerID:v.model.providerID.trim(),modelID:v.model.modelID.trim()};
  }
  return { name: v.name.trim(), prompt: v.prompt, timezone: v.timezone, schedule, enabled: v.enabled, misfire: v.misfire, ...(model?{model}:{}) };
}
// Daily wall-clock schedules skip nonexistent DST times and run once on repeated dates.
export function nextAt(s: Schedule, zone: string, after: number, anchor = after): number | null {
  if (s.kind === 'once') return Date.parse(s.at) > after ? Date.parse(s.at) : null;
  if (s.kind === 'interval') { const step = s.minutes * 60000; return anchor + (Math.floor((after - anchor) / step) + 1) * step; }
  const current = localParts(after, zone);
  for (let t = Math.floor(after / 60000) * 60000 + 60000, end = t + 9 * 86400000; t < end; t += 60000) {
    const p = localParts(t, zone);
    if (p.time === s.time && s.weekdays.includes(p.weekday) && !(p.date === current.date && current.time >= s.time)) return t;
  }
  throw new Error('无法计算下次时间');
}
export function latestDue(s: Schedule, zone: string, due: number, now: number, anchor: number): number {
  if (s.kind === 'once') return due;
  if (s.kind === 'interval') return anchor + Math.floor((now - anchor) / (s.minutes * 60000)) * s.minutes * 60000;
  let candidate = due;
  // Scan only the latest 9 days; old missed dates are deliberately coalesced.
  let cursor = Math.max(due - 1, now - 9 * 86400000);
  for (let n = 0; n < 10; n++) { const t = nextAt(s, zone, cursor, anchor); if (t === null || t > now) break; candidate = t; cursor = t; }
  return candidate;
}
