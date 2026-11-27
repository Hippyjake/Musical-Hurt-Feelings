// Single-flight scheduler. Injected clocks make timing and races testable without a browser.
function createSmartRefresh({poll, visible = () => true, setTimer = setTimeout,
  clearTimer = clearTimeout, activeMs = 1000, hiddenMs = 15000,
  timeoutMs = 10000, maxBackoffMs = 30000}) {
  let running = false, online = true, timer = null, flight = null;
  let generation = 0, failures = 0, nextDelay = null;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const schedule = delay => {
    clear();
    if (running && online) timer = setTimer(run, delay);
  };
  async function run() {
    timer = null;
    if (!running || !online || flight) return;
    const controller = new AbortController(), token = generation;
    flight = controller;
    const isCurrent = () => running && online && generation === token && !controller.signal.aborted;
    const timeout = setTimer(() => controller.abort(), timeoutMs);
    try {
      await poll({signal: controller.signal, isCurrent});
      if (isCurrent()) failures = 0;
      else if (generation === token && running && online) failures++;
    } catch (e) {
      // Superseded requests are not network failures; genuine failures back off.
      if (generation === token && running && online) failures++;
    } finally {
      clearTimer(timeout);
      flight = null;
      if (!running || !online) return;
      const base = visible() ? activeMs : hiddenMs;
      const delay = nextDelay !== null ? nextDelay :
        failures ? Math.max(base, Math.min(maxBackoffMs, activeMs * 2 ** Math.min(failures, 5))) : base;
      nextDelay = null;
      schedule(delay);
    }
  }
  function queue(delay) {
    generation++;
    failures = 0;
    clear();
    nextDelay = delay;
    if (flight) flight.abort();
    else { nextDelay = null; schedule(delay); }
  }
  return {
    start() { if (!running) { running = true; queue(0); } },
    refresh() { queue(0); },
    visibilityChanged() { queue(visible() ? 0 : hiddenMs); },
    networkChanged(value) { online = value; queue(0); },
    stop() { running = false; generation++; clear(); nextDelay = null; if (flight) flight.abort(); }
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = {createSmartRefresh};
