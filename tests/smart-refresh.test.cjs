const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSmartRefresh} = require('../static/js/smart-refresh.js');
function setup({abortable = false} = {}) {
  let now = 0, id = 0, hidden = false, applied = 0, live = 0, peak = 0;
  const timers = new Map(), requests = [];
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const setTimer = (fn, delay) => { timers.set(++id, {fn, at: now + delay}); return id; };
  async function tick(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = end; await flush();
  }
  const poll = ({signal, isCurrent}) => new Promise((resolve, reject) => {
    live++; peak = Math.max(peak, live);
    let done = false;
    const finish = error => {
      if (done) return;
      done = true; live--;
      if (error) reject(error); else { if (isCurrent()) applied++; resolve(); }
    };
    requests.push({signal, finish});
    if (abortable) signal.addEventListener('abort', () => finish(new Error('aborted')), {once:true});
  });
  const scheduler = createSmartRefresh({poll, visible: () => !hidden, setTimer, clearTimer: n => timers.delete(n)});
  return {scheduler, requests, tick, flush, hide(value) { hidden=value; scheduler.visibilityChanged(); },
    applied: () => applied, peak: () => peak};
}
test('foreground refresh is scheduled 1000ms after completion, never overlapping', async () => {
  const h=setup(); h.scheduler.start(); await h.tick(0);
  await h.tick(5000); assert.equal(h.requests.length,1);
  h.requests[0].finish(); await h.flush(); await h.tick(999); assert.equal(h.requests.length,1);
  await h.tick(1); assert.equal(h.requests.length,2); assert.equal(h.peak(),1); h.scheduler.stop();
});
test('hidden tabs wait 15000ms; waking refreshes immediately', async () => {
  const h=setup({abortable:true}); h.scheduler.start(); await h.tick(0);
  h.hide(true); await h.flush(); assert.equal(h.requests[0].signal.aborted,true);
  await h.tick(14999); assert.equal(h.requests.length,1); await h.tick(1); assert.equal(h.requests.length,2);
  h.requests[1].finish(); await h.flush(); h.hide(false); await h.tick(0); assert.equal(h.requests.length,3); h.scheduler.stop();
});
test('actions cancel stale reads and coalesce into one immediate fresh read', async () => {
  const h=setup(); h.scheduler.start(); await h.tick(0);
  h.scheduler.refresh(); h.scheduler.refresh(); assert.equal(h.requests[0].signal.aborted,true);
  await h.tick(50); assert.equal(h.requests.length,1);
  h.requests[0].finish(); await h.flush(); assert.equal(h.applied(),0);
  await h.tick(0); assert.equal(h.requests.length,2); h.requests[1].finish(); await h.flush();
  assert.equal(h.applied(),1); assert.equal(h.peak(),1); h.scheduler.stop();
});
test('Wi-Fi failures back off 2,4,8,16,30 seconds and reset after success', async () => {
  const h=setup(); h.scheduler.start(); await h.tick(0);
  for (const delay of [2000,4000,8000,16000,30000,30000]) {
    h.requests.at(-1).finish(new Error('Wi-Fi down')); await h.flush(); const count=h.requests.length;
    await h.tick(delay-1); assert.equal(h.requests.length,count); await h.tick(1); assert.equal(h.requests.length,count+1);
  }
  h.requests.at(-1).finish(); await h.flush(); const count=h.requests.length;
  await h.tick(1000); assert.equal(h.requests.length,count+1); h.scheduler.stop();
});
test('a stuck fetch aborts at 10000ms and retries after 2000ms', async () => {
  const h=setup({abortable:true}); h.scheduler.start(); await h.tick(0);
  await h.tick(9999); assert.equal(h.requests[0].signal.aborted,false); await h.tick(1);
  assert.equal(h.requests[0].signal.aborted,true); await h.tick(1999); assert.equal(h.requests.length,1);
  await h.tick(1); assert.equal(h.requests.length,2); h.scheduler.stop();
});
test('offline pauses requests; online wakes immediately', async () => {
  const h=setup({abortable:true}); h.scheduler.start(); await h.tick(0); h.scheduler.networkChanged(false); await h.flush();
  await h.tick(60000); assert.equal(h.requests.length,1); h.scheduler.networkChanged(true); await h.tick(0);
  assert.equal(h.requests.length,2); h.scheduler.stop();
});
test('pagehide cancels reads; pageshow restarts without accepting stale data', async () => {
  const h=setup(); h.scheduler.start(); await h.tick(0); h.scheduler.stop(); h.requests[0].finish(); await h.flush();
  await h.tick(60000); assert.equal(h.requests.length,1); assert.equal(h.applied(),0);
  h.scheduler.start(); await h.tick(0); assert.equal(h.requests.length,2); h.scheduler.stop();
});
