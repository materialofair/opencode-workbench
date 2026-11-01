import {test,expect} from 'bun:test';
import {validate,nextAt,latestDue} from '../src/schedule';
const daily={kind:'daily' as const,time:'09:00',weekdays:[0,1,2,3,4,5,6]};
test('daily uses project-selected IANA zone, independent of machine timezone',()=>{
  expect(new Date(nextAt(daily,'Asia/Shanghai',Date.parse('2026-11-01T00:59Z'))!).toISOString()).toBe('2026-11-01T01:00:00.000Z');
  expect(new Date(nextAt(daily,'America/New_York',Date.parse('2026-11-01T00:59Z'))!).toISOString()).toBe('2026-11-01T14:00:00.000Z');
});
test('DST spring gap skipped and fall duplicate runs once',()=>{
  const s={...daily,time:'02:30'};
  expect(new Date(nextAt(s,'America/New_York',Date.parse('2026-03-08T05:00Z'))!).toISOString()).toBe('2026-03-09T06:30:00.000Z');
  expect(new Date(nextAt({...daily,time:'01:30'},'America/New_York',Date.parse('2026-11-01T05:30Z'))!).toISOString()).toBe('2026-11-02T06:30:00.000Z');
});
test('weekly rule, interval anchoring and coalesced catchup',()=>{
  expect(new Date(nextAt({...daily,weekdays:[1]},'UTC',Date.parse('2026-11-02T09:00Z'))!).toISOString()).toBe('2026-11-09T09:00:00.000Z');
  expect(nextAt({kind:'interval',minutes:5},'UTC',900000,0)).toBe(1200000);
  expect(latestDue({kind:'interval',minutes:5},'UTC',300000,999999,0)).toBe(900000);
});
test('reject invalid zone, clock time, bare local timestamp and interval',()=>{
  const v={name:'x',prompt:'read',enabled:true,misfire:'skip',timezone:'UTC',schedule:daily};
  for(const change of [{timezone:'Mars/Bad'},{schedule:{...daily,time:'25:00'}},{schedule:{kind:'once',at:'2026-11-01T09:00'}},{schedule:{kind:'interval',minutes:0}}]) expect(()=>validate({...v,...change})).toThrow();
});
