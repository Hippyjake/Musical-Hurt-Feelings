const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me = JSON.parse(localStorage.getItem('mhf_me') || 'null');
let pin = sessionStorage.getItem('mhf_pin') || '';
let S = null;
const sig = {};

async function api(path, body) {
  const r = await fetch('/api/' + path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
function part(id, key, html) { if (sig[id] === key) return false; sig[id] = key; $('#' + id).innerHTML = html; return true; }
let toastTimer;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2500); }

// When the phase changes, let the browser glide the cards to their new spots.
// Browsers without view transitions (or with reduced motion on) just redraw.
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function phaseOf(st) { const c = st.songs.find(s => s.id === st.current); return !c ? 'queue' : c.revealed ? 'reveal' : 'voting'; }
let stateETag = null;
async function poll({signal, isCurrent}) {
  const pid = me ? me.id : '';
  const headers = stateETag ? {'If-None-Match': stateETag} : {};
  const r = await fetch('/api/state?player_id=' + pid, {signal, headers, cache:'no-store'});
  if (!isCurrent()) return;
  if (r.status === 304) return; // No state parsing or redraw when nothing changed.
  if (!r.ok) throw new Error('Could not refresh the game.');
  const next = await r.json();
  if (!isCurrent()) return;
  stateETag = r.headers.get('ETag');
  S = next;
  const draw = () => { if (isCurrent()) render(); };
  if (me && phase && phaseOf(S) !== phase && document.startViewTransition && !calm.matches) {
    const t = document.startViewTransition(draw);
    t.ready.catch(() => {});
    t.finished.catch(() => {});
    await t.finished.catch(() => {});
  } else draw();
}
const poller = createSmartRefresh({poll, visible: () => !document.hidden});
function refresh() { stateETag = null; poller.refresh(); }
document.addEventListener('visibilitychange', () => poller.visibilityChanged());
window.addEventListener('offline', () => poller.networkChanged(false));
window.addEventListener('online', () => poller.networkChanged(true));
window.addEventListener('pagehide', () => poller.stop());
window.addEventListener('pageshow', () => poller.start());

function results(c) {
  const r = c.results;
  if (!r.votes.length) return '<p class="muted">No votes were cast.</p>';
  return `<div class="big">${r.avg.toFixed(1)}<small>/10</small></div>` +
    S.categories.map(k => `<div class="res"><span>${esc(k.name)}</span><div class="bar"><i style="width:${r.cat[k.id] * 10}%"></i></div><b>${r.cat[k.id].toFixed(1)}</b></div>`).join('') +
    `<details open><summary>Who gave what</summary>` +
    `<p class="muted">${S.categories.map(k => esc(k.name)).join(', ')}</p>` +
    r.votes.map(v => `<p><b>${esc(v.name)}</b>: ${S.categories.map(k => v.scores[k.id]).join(', ')}</p>`).join('') + `</details>`;
}

// How close the submitter's guess landed. Only shown after the reveal.
function verdict(c) {
  const p = c.prediction;
  if (p == null || !c.results.votes.length) return '';
  const off = p - c.results.avg;
  const tag = Math.abs(off) <= 0.5 ? 'spot on 🎯' : Math.abs(off) <= 1.5 ? 'close' : off > 0 ? 'delusional 🤡' : 'too humble 😇';
  return `<p class="prediction">${esc(c.submitter)} predicted ${p.toFixed(1)}, ${tag}</p>`;
}

function nowView(c) {
  if (!c) return ['none', '<h2>Now playing</h2><p class="muted">Waiting for the host to pick a song.</p>'];
  const by = c.revealed ? `picked by <b class="picker">${esc(c.submitter)}</b>` : c.own ? 'your pick' : 'mystery pick';
  const head = `<h2>${esc(c.title)}</h2><p class="muted">${c.artist ? esc(c.artist) + ', ' : ''}${by}${c.link ? ` (<a href="${esc(c.link)}" target="_blank" rel="noopener">listen</a>)` : ''}</p>`;
  if (c.revealed) return ['rev' + c.id + JSON.stringify(c.results) + c.prediction, head + verdict(c) + results(c)];
  if (c.own) {
    const v = c.prediction != null ? c.prediction : 5;
    return ['own' + c.id + (c.prediction != null ? 1 : 0), head +
      `<p><b>Your song is on trial!</b> Poker face. Don't give yourself away.</p>` +
      `<div class="slider"><label for="pred">Call your shot: what will the room give it?</label><b id="pv">${v.toFixed(1)}</b><input id="pred" type="range" min="0" max="10" step="0.5" value="${v}" oninput="$('#pv').textContent=(+this.value).toFixed(1)"></div>` +
      `<button onclick="predict(${c.id})">${c.prediction != null ? 'Update prediction' : 'Save prediction'}</button><div id="voters" class="chips"></div>`];
  }
  const sliders = S.categories.map(k => {
    const v = c.mine && c.mine[k.id] != null ? c.mine[k.id] : 5;
    return `<div class="slider"><label for="k${k.id}">${esc(k.name)}</label><b id="v${k.id}">${v}</b><input id="k${k.id}" data-k="${k.id}" type="range" min="0" max="10" value="${v}" oninput="$('#v${k.id}').textContent=this.value"></div>`;
  }).join('');
  return ['sc' + c.id + (c.mine ? 1 : 0), head + sliders + `<button onclick="send(${c.id})">${c.mine ? 'Update scores' : 'Save scores'}</button><div id="voters" class="chips"></div>`];
}

function render() {
  if (me && !S.players.some(p => p.id === me.id && p.name === me.name)) { me = null; localStorage.removeItem('mhf_me'); }
  $('#join').hidden = !!me;
  if (!me && !$('#name').value) $('#name').value = localStorage.getItem('mhf_name') || '';
  showAwards();
  $('#game').hidden = !me;
  $('#who').innerHTML = me ? `Playing as ${esc(me.name)}<button class="link" onclick="leave()">not you?</button>` : '';
  if (!me) return;

  const c = S.songs.find(s => s.id === S.current);
  const [k, html] = nowView(c);
  if (part('now', k, html)) {
    enter($('#now'));
    if (c && c.revealed) countUp($('#now .big'), c.results.avg);
  }
  voterChips(c);

  setPhase(!c ? 'queue' : c.revealed ? 'reveal' : 'voting');

  const q = S.songs.filter(s => !s.revealed);
  part('queue-list', JSON.stringify([q.map(s => s.id), S.current, !!pin]),
    '<h2>Song queue</h2>' + (q.length ? q.map(s =>
      `<div class="row"><span>${esc(s.title)}${s.artist ? ' by ' + esc(s.artist) : ''}<small>${s.own ? 'Your pick' : 'Mystery pick'}</small></span>` +
      '<span class="acts">' + (s.id === S.current ? '<em>Playing now</em>' : pin ? `<button class="sm" onclick="host('current',{song_id:${s.id}})">Play</button>` : '') +
      (pin ? `<button class="sm ghost" onclick="removeSong(${s.id})">Remove</button>` : '') + '</span></div>').join('')
      : '<p class="muted">No songs yet. Submit the first one.</p>'));

  const r = S.songs.filter(s => s.revealed).sort((a, b) => b.results.avg - a.results.avg);
  part('board', JSON.stringify(r.map(s => [s.id, s.results.avg])),
    '<h2>Leaderboard</h2><p><a href="/leaderboard">See every score</a></p>' + (r.length ? r.map((s, i) =>
      `<div class="row"><span>${i + 1}. ${esc(s.title)}<small>Submitted by ${esc(s.submitter)}</small></span><b>${s.results.avg.toFixed(1)}</b></div>`).join('')
      : '<p class="muted">Revealed songs show up here.</p>'));

  $('#host').classList.toggle('on', !!pin);
  part('host', JSON.stringify([!!pin, S.current, c && c.revealed, S.players.map(p => p.id)]),
    pin ? (c && !c.revealed ? `<button style="margin-top:0" onclick="host('reveal')">Reveal scores</button>` : '<p class="muted">Pick a song from the queue to start the next round.</p>') +
      `<details ontoggle="hostOpen=this.open"${hostOpen ? ' open' : ''}><summary>Host controls</summary>` +
      '<h3>Players</h3>' + S.players.map(p => `<div class="row"><span>${esc(p.name)}</span><button class="sm ghost" onclick="removePlayer(${p.id})">Remove</button></div>`).join('') +
      '<button class="ghost" onclick="stepDown()">Step down as host</button>' +
      '<div class="zone"><button class="danger" onclick="newNight()">Save tonight and start a new night</button>' +
      '<button class="danger" onclick="resetGame()">Delete everything</button></div></details>'
    : '<button class="ghost" style="margin:0" onclick="unlock()">Host controls</button>');
}

// Who has voted on the current song. Everyone gets a chip so the picker stays
// secret; theirs ticks when they save a prediction.
// Kept in its own box so the sliders above it never redraw mid-vote.
let chipSeen = {};
function voterChips(c) {
  const box = $('#voters');
  if (!box || !c) return;
  const done = new Set(c.voters || []);
  const list = S.players;
  const key = JSON.stringify(list.map(p => [p.id, p.name, done.has(p.id)]));
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  // Chips that just flipped to done get a little bounce (not on first draw).
  const before = chipSeen.song === c.id ? chipSeen.done : null;
  chipSeen = {song: c.id, done};
  box.innerHTML = list.length
    ? list.map(p => `<span class="chip${done.has(p.id) ? ' done' : ''}${before && done.has(p.id) && !before.has(p.id) ? ' pop' : ''}">${esc(p.name)} ${done.has(p.id) ? '✓' : '…'}</span>`).join('')
    : '<span class="muted">Waiting for more players to join.</span>';
}

// Phase-aware layout. The song form opens when nothing is playing and folds away
// once a song starts, unless someone is in the middle of filling it in.
let phase = null, hostOpen = false;
function setPhase(p) {
  if (p === phase) return;
  phase = p;
  $('#game').dataset.phase = p;
  const c = S.songs.find(s => s.id === S.current);
  const avg = c && c.revealed && c.results.votes.length ? c.results.avg : null;
  $('#game').dataset.verdict = avg == null ? '' : avg >= 7.5 ? 'hit' : avg < 5 ? 'roast' : 'mid';
  const f = $('#submit'), form = f.querySelector('form');
  const busy = [...form.querySelectorAll('input')].some(e => e.value || e === document.activeElement);
  if (!busy) f.open = p === 'queue';
}

// Replay the slide-in on a card whose contents just changed.
function enter(el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }

// Roll the big reveal number up from 0 to the final average.
function countUp(el, to) {
  if (!el || calm.matches) return;
  const num = el.firstChild, t0 = performance.now(), ms = 900;
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    num.textContent = (to * e).toFixed(1);
    if (k < 1) requestAnimationFrame(step);
  };
  num.textContent = '0.0';
  requestAnimationFrame(step);
}

let awardsKey = null, awardsTimer;
async function showAwards() {
  clearTimeout(awardsTimer);
  const box = $('#awards'), L = S.last_night;
  if (me || !L || S.songs.length || Date.now() / 1000 - L.ended > 12 * 3600) { box.hidden = true; return; }
  // Unchanged state no longer redraws, so preserve the existing 12-hour expiry.
  awardsTimer = setTimeout(() => { box.hidden = true; }, Math.max(0, (L.ended + 12 * 3600) * 1000 - Date.now()));
  if (awardsKey !== L.id) {
    awardsKey = L.id;
    try {
      const r = await api('leaderboard?night=' + L.id);
      Awards.render(box, Awards.compute(r.songs), "Last night's awards");
    } catch (e) { awardsKey = null; }
  }
  box.hidden = !box.innerHTML;
}

async function join() {
  try { me = await api('join', {name: $('#name').value}); localStorage.setItem('mhf_me', JSON.stringify(me)); localStorage.setItem('mhf_name', me.name); refresh(); }
  catch (e) { toast(e.message); }
}
function leave() { me = null; localStorage.removeItem('mhf_me'); render(); refresh(); }

async function addSong(form) {
  const f = Object.fromEntries(new FormData(form));
  try { await api('songs', {...f, player_id: me.id}); form.reset(); $('#submit').open = false; toast('Song submitted.'); refresh(); }
  catch (e) { toast(e.message); }
}

async function send(id) {
  const scores = {};
  document.querySelectorAll('#now input[type=range]').forEach(i => scores[i.dataset.k] = i.value);
  try { await api('score', {player_id: me.id, song_id: id, scores}); toast('Scores saved.'); refresh(); }
  catch (e) { toast(e.message); }
}

async function predict(id) {
  try { await api('predict', {player_id: me.id, song_id: id, value: $('#pred').value}); toast('Prediction saved.'); refresh(); }
  catch (e) { toast(e.message); }
}

async function host(action, extra = {}) {
  try { await api('host/' + action, {pin, ...extra}); refresh(); }
  catch (e) {
    toast(e.message);
    if (e.message === 'Wrong PIN') { pin = ''; sessionStorage.removeItem('mhf_pin'); render(); }
  }
}
function unlock() {
  const p = prompt('Host PIN');
  if (p) { pin = p; sessionStorage.setItem('mhf_pin', p); host('check'); }
}
async function lookup(inp) {
  const f = inp.form.elements, v = inp.value.trim();
  if (!v) return;
  try {
    const r = await api('lookup?url=' + encodeURIComponent(v));
    inp.value = r.link;
    if (!f.title.value) f.title.value = r.title;
    if (!f.artist.value) f.artist.value = r.artist;
    if (!r.title) toast('Could not fetch details. Fill them in.');
  } catch (e) { toast(e.message); }
}
function removePlayer(id) { if (confirm('Remove this player and their unrevealed songs and votes?')) host('remove_player', {player_id: id}); }
function stepDown() { pin = ''; sessionStorage.removeItem('mhf_pin'); render(); toast('You are no longer the host.'); }
function removeSong(id) { if (confirm('Remove this song from the queue?')) host('remove', {song_id: id}); }
function newNight() { if (confirm("Save tonight's results and start a new game night? Everyone will need to join again.")) host('newnight'); }
function resetGame() { if (confirm('Delete everything, including saved past nights? A backup is saved first.')) host('reset'); }

poller.start();
