const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let pick = '';
const fmt = t => new Date(t * 1000).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
function picker(S) {
  const opts = S.nights.map(n => `<option value="${n.id}">${n.current ? 'Tonight' : fmt(n.started)}</option>`).join('') + '<option value="all">All nights</option>';
  const sel = $('#night');
  if (sel.dataset.o !== opts) { sel.dataset.o = opts; sel.innerHTML = opts; }
  const cur = S.nights.find(n => n.current);
  sel.value = pick || String(cur ? cur.id : 'all');
}
const linkKey = u => {
  if (!u) return '';
  const m = u.match(/spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/) || u.match(/[?&]v=([\w-]{11})/) || u.match(/youtu\.be\/([\w-]{11})/);
  return m ? m[1] : u;
};
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function draw(S) {
  picker(S);
  const all = S.night === 'all', cats = S.categories;
  const aw = Awards.compute(S.songs);
  Awards.render($('#awards'), aw, 'Awards');
  $('#awards').hidden = !aw.length;
  if (!S.songs.length) {
    $('#rank').innerHTML = $('#votes').innerHTML = '<p class="muted">Scores appear here once the host reveals a song.</p>';
    return;
  }
  const groups = {};
  S.songs.forEach(s => { const k = linkKey(s.link) || 's' + s.id; (groups[k] = groups[k] || []).push(s); });
  const rows = Object.values(groups).map(list => {
    const votes = list.flatMap(s => s.results.votes);
    return {
      list, votes, title: list[0].title,
      avg: mean(votes.flatMap(v => Object.values(v.scores))),
      cat: Object.fromEntries(cats.map(k => [k.id, mean(votes.map(v => v.scores[k.id] ?? 0))])),
      by: [...new Set(list.map(s => s.submitter))].join(', ')
    };
  }).sort((a, b) => b.avg - a.avg);

  const head = cats.map(k => `<th>${esc(k.name)}</th>`).join('');
  const note = g => g.list.length > 1 ? `played ${g.list.length} times` : all ? fmt(g.list[0].night_started) : '';
  $('#rank').innerHTML = `<table><tr><th>#</th><th>Song</th>${head}<th>Average</th></tr>` +
    rows.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.title)}<small>Submitted by ${esc(g.by)}${note(g) ? ', ' + note(g) : ''}</small></td>` +
      cats.map(k => `<td>${g.cat[k.id].toFixed(1)}</td>`).join('') + `<td><b>${g.avg.toFixed(1)}</b></td></tr>`).join('') + '</table>';

  const span = cats.length + 1;
  $('#votes').innerHTML = `<table class="v"><tr><th>Scored by</th>${head}</tr>` +
    rows.map(g => `<tr class="g"><td colspan="${span}">${esc(g.title)}${g.list.length > 1 ? `<small>${g.list.length} submissions combined</small>` : ''}</td></tr>` +
      (g.votes.length ? g.votes.map(v => `<tr><td>${esc(v.name)}</td>${cats.map(k => `<td>${v.scores[k.id] ?? ''}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${span}" class="muted">No votes</td></tr>`)).join('') + '</table>';
}

async function load() {
  try { draw(await (await fetch('/api/leaderboard?night=' + encodeURIComponent(pick))).json()); } catch (e) {}
}
load();
setInterval(load, 3000);
