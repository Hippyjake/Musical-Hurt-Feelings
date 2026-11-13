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
function part(id, key, html) { if (sig[id] !== key) { sig[id] = key; $('#' + id).innerHTML = html; } }
let toastTimer;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2500); }

async function poll() { try { S = await api('state?player_id=' + (me ? me.id : '')); render(); } catch (e) {} }

function results(c) {
  const r = c.results;
  if (!r.votes.length) return '<p class="muted">No votes were cast.</p>';
  return `<div class="big">${r.avg.toFixed(1)}<small>/10</small></div>` +
    S.categories.map(k => `<div class="res"><span>${esc(k.name)}</span><div class="bar"><i style="width:${r.cat[k.id] * 10}%"></i></div><b>${r.cat[k.id].toFixed(1)}</b></div>`).join('') +
    `<details><summary>Who gave what</summary>` +
    `<p class="muted">${S.categories.map(k => esc(k.name)).join(', ')}</p>` +
    r.votes.map(v => `<p><b>${esc(v.name)}</b>: ${S.categories.map(k => v.scores[k.id]).join(', ')}</p>`).join('') + `</details>`;
}

function nowView(c) {
  if (!c) return ['none', '<h2>Now playing</h2><p class="muted">Waiting for the host to pick a song.</p>'];
  const head = `<h2>${esc(c.title)}</h2><p class="muted">${c.artist ? esc(c.artist) + ', ' : ''}submitted by ${esc(c.submitter)}${c.link ? ` (<a href="${esc(c.link)}" target="_blank" rel="noopener">listen</a>)` : ''}</p>`;
  if (c.revealed) return ['rev' + c.id + JSON.stringify(c.results), head + results(c)];
  if (c.player_id === me.id) return ['own' + c.id + c.voted, head + `<p>Your song is up. Brace yourself.</p><p class="muted">${c.voted} of ${c.eligible} voted</p>`];
  const sliders = S.categories.map(k => {
    const v = c.mine && c.mine[k.id] != null ? c.mine[k.id] : 5;
    return `<div class="slider"><label for="k${k.id}">${esc(k.name)}</label><b id="v${k.id}">${v}</b><input id="k${k.id}" data-k="${k.id}" type="range" min="0" max="10" value="${v}" oninput="$('#v${k.id}').textContent=this.value"></div>`;
  }).join('');
  return ['sc' + c.id + (c.mine ? 1 : 0), head + sliders + `<button onclick="send(${c.id})">${c.mine ? 'Update scores' : 'Save scores'}</button><p class="muted"><span id="vc">${c.voted}</span> of ${c.eligible} voted</p>`];
}

function render() {
  if (me && !S.players.some(p => p.id === me.id)) { me = null; localStorage.removeItem('mhf_me'); }
  $('#join').hidden = !!me;
  if (!me && !$('#name').value) $('#name').value = localStorage.getItem('mhf_name') || '';
  showAwards();
  $('#game').hidden = !me;
  $('#who').innerHTML = me ? `Playing as ${esc(me.name)}<button class="link" onclick="leave()">not you?</button>` : '';
  if (!me) return;

  const c = S.songs.find(s => s.id === S.current);
  const [k, html] = nowView(c);
  part('now', k, html);
  const vc = $('#vc'); if (vc && c) vc.textContent = c.voted;

  const q = S.songs.filter(s => !s.revealed);
  part('queue', JSON.stringify([q.map(s => s.id), S.current, !!pin]),
    '<h2>Song queue</h2>' + (q.length ? q.map(s =>
      `<div class="row"><span>${esc(s.title)}${s.artist ? ' by ' + esc(s.artist) : ''}<small>Submitted by ${esc(s.submitter)}</small></span>` +
      '<span class="acts">' + (s.id === S.current ? '<em>Playing now</em>' : pin ? `<button class="sm" onclick="host('current',{song_id:${s.id}})">Play</button>` : '') +
      (pin ? `<button class="sm ghost" onclick="removeSong(${s.id})">Remove</button>` : '') + '</span></div>').join('')
      : '<p class="muted">No songs yet. Submit the first one.</p>'));

  const r = S.songs.filter(s => s.revealed).sort((a, b) => b.results.avg - a.results.avg);
  part('board', JSON.stringify(r.map(s => [s.id, s.results.avg])),
    '<h2>Leaderboard</h2><p><a href="/leaderboard">See every score</a></p>' + (r.length ? r.map((s, i) =>
      `<div class="row"><span>${i + 1}. ${esc(s.title)}<small>Submitted by ${esc(s.submitter)}</small></span><b>${s.results.avg.toFixed(1)}</b></div>`).join('')
      : '<p class="muted">Revealed songs show up here.</p>'));

  part('host', JSON.stringify([!!pin, S.current, c && c.revealed, c && c.voted, S.players.map(p => p.id)]),
    pin ? '<h2>Host controls</h2>' +
      (c && !c.revealed ? `<p class="muted">${c.voted} of ${c.eligible} voted</p><button onclick="host('reveal')">Reveal scores</button>` : '<p class="muted">Pick a song from the queue to start the next round.</p>') +
      '<h2 style="margin-top:16px">Players</h2>' + S.players.map(p => `<div class="row"><span>${esc(p.name)}</span><button class="sm ghost" onclick="removePlayer(${p.id})">Remove</button></div>`).join('') +
      '<button onclick="newNight()">Save tonight and start a new night</button>' +
      '<button class="ghost" onclick="resetGame()">Delete everything</button>' +
      '<button class="ghost" onclick="stepDown()">Step down as host</button>'
    : '<button class="ghost" style="margin:0" onclick="unlock()">Host controls</button>');
}

let awardsKey = null;
async function showAwards() {
  const box = $('#awards'), L = S.last_night;
  if (me || !L || S.songs.length || Date.now() / 1000 - L.ended > 12 * 3600) { box.hidden = true; return; }
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
  try { me = await api('join', {name: $('#name').value}); localStorage.setItem('mhf_me', JSON.stringify(me)); localStorage.setItem('mhf_name', me.name); poll(); }
  catch (e) { toast(e.message); }
}
function leave() { me = null; localStorage.removeItem('mhf_me'); render(); }

async function addSong(form) {
  const f = Object.fromEntries(new FormData(form));
  try { await api('songs', {...f, player_id: me.id}); form.reset(); toast('Song submitted.'); poll(); }
  catch (e) { toast(e.message); }
}

async function send(id) {
  const scores = {};
  document.querySelectorAll('#now input[type=range]').forEach(i => scores[i.dataset.k] = i.value);
  try { await api('score', {player_id: me.id, song_id: id, scores}); toast('Scores saved.'); poll(); }
  catch (e) { toast(e.message); }
}

async function host(action, extra = {}) {
  try { await api('host/' + action, {pin, ...extra}); poll(); }
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

poll();
setInterval(poll, 2000);
