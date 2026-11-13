// End-of-night awards, computed in the browser from revealed songs and their votes.
const Awards = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const linkKey = u => {
    if (!u) return '';
    const m = u.match(/spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/) || u.match(/[?&]v=([\w-]{11})/) || u.match(/youtu\.be\/([\w-]{11})/);
    return m ? m[1] : u;
  };
  const same = (a, b) => Math.abs(a - b) < 1e-9;

  function compute(songs) {
    const given = {}, byWork = {};
    songs.forEach(s => {
      const w = byWork[linkKey(s.link) || 's' + s.id] ||= {title: s.title, votes: []};
      s.results.votes.forEach(v => {
        const vals = Object.values(v.scores);
        if (!vals.length) return;
        const p = given[v.name.toLowerCase()] ||= {name: v.name, vals: [], songs: 0};
        p.vals.push(...vals);
        p.songs++;
        w.votes.push({name: v.name, avg: mean(vals)});
      });
    });
    const out = [];
    const people = Object.values(given).map(p => ({name: p.name, avg: mean(p.vals), n: p.songs}));
    if (people.length >= 2) {
      const lo = Math.min(...people.map(p => p.avg)), hi = Math.max(...people.map(p => p.avg));
      if (!same(lo, hi)) {
        const pick = x => people.filter(p => same(p.avg, x));
        const line = (ps, x) => `Averaged ${x.toFixed(1)} over ${ps[0].n} song${ps[0].n === 1 ? '' : 's'}`;
        const l = pick(lo), h = pick(hi);
        out.push({title: 'The Simon Cowell', winner: l.map(p => p.name).join(' & '), detail: line(l, lo) + ', the toughest judge'});
        out.push({title: 'The Hype Man', winner: h.map(p => p.name).join(' & '), detail: line(h, hi) + ', the most generous'});
      }
    }
    let best = null;
    Object.values(byWork).forEach(w => {
      if (w.votes.length < 2) return;
      const m = mean(w.votes.map(v => v.avg));
      const sd = Math.sqrt(mean(w.votes.map(v => (v.avg - m) ** 2)));
      if (sd > 1e-9 && (!best || sd > best.sd)) best = {w, sd};
    });
    if (best) {
      const v = [...best.w.votes].sort((a, b) => b.avg - a.avg);
      out.push({title: 'The Controversial Pick', winner: best.w.title,
        detail: `${v[0].name} gave it ${v[0].avg.toFixed(1)}, ${v[v.length - 1].name} gave it ${v[v.length - 1].avg.toFixed(1)}`});
    }
    return out;
  }

  function render(el, awards, heading) {
    el.innerHTML = awards.length ? `<h2>${esc(heading)}</h2>` + awards.map(a =>
      `<div class="award"><b>${esc(a.title)}</b><span class="win">${esc(a.winner)}</span><small>${esc(a.detail)}</small></div>`).join('') : '';
  }

  return {compute, render};
})();
