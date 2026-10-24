const s = io();
const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cv = $('board'), ctx = cv.getContext('2d');
const COLORS = ['#17203a', '#ffffff', '#ef476f', '#ff9f1c', '#ffe14d', '#2ec4b6', '#118ab2', '#7b2cbf', '#8d5524'];
let st = null, color = COLORS[0], size = 6, last = null, banner = '';

/* ---------- canvas ---------- */
const clearBoard = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); };
const seg = g => {
  ctx.strokeStyle = g.c; ctx.lineWidth = g.w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.lineTo(g.x1, g.y1); ctx.stroke();
};
const canDraw = () => st && st.state === 'drawing' && st.drawer === s.id;
const pos = e => {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
};
const stroke = (a, b) => {
  const g = { x0: a.x, y0: a.y, x1: b.x, y1: b.y, c: color, w: size };
  seg(g); s.emit('draw', g);
};
cv.onpointerdown = e => { if (!canDraw()) return; cv.setPointerCapture(e.pointerId); last = pos(e); stroke(last, last); };
cv.onpointermove = e => { if (!last) return; const p = pos(e); stroke(last, p); last = p; };
cv.onpointerup = cv.onpointercancel = () => { last = null; };
clearBoard();

/* ---------- tools ---------- */
$('tools').innerHTML =
  COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('') +
  [3, 6, 12, 22].map(n => `<button class="sz" data-s="${n}" aria-label="Brush ${n}"><i style="width:${Math.min(n, 22)}px;height:${Math.min(n, 22)}px"></i></button>`).join('') +
  '<button id="clear">Clear</button>';
$('tools').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.c) color = b.dataset.c;
  if (b.dataset.s) size = +b.dataset.s;
  if (b.id === 'clear') { clearBoard(); s.emit('clear'); }
};

/* ---------- overlay ---------- */
const show = html => { $('overlay').innerHTML = html; $('overlay').hidden = false; };
const hide = () => { $('overlay').hidden = true; };
$('overlay').onclick = e => {
  const w = e.target.dataset && e.target.dataset.w;
  if (w) { s.emit('choose', w); hide(); }
};

/* ---------- join / start / chat ---------- */
$('go').onclick = () => {
  s.emit('join', { name: $('name').value, room: $('room').value });
  $('join').hidden = true; $('game').hidden = false;
};
$('start').onclick = () => s.emit('start');
$('msg').onkeydown = e => {
  if (e.key === 'Enter' && e.target.value.trim()) { s.emit('chat', e.target.value); e.target.value = ''; }
};

/* ---------- server events ---------- */
s.on('state', p => {
  st = p;
  $('code').textContent = 'Room ' + p.code;
  $('roundInfo').textContent = p.round ? `Round ${p.round}/${p.rounds}` : 'Lobby';
  $('players').innerHTML = p.players.map(x =>
    `<li class="${x.id === p.drawer && p.state !== 'lobby' ? 'drawer' : ''} ${x.guessed ? 'got' : ''}">` +
    `<span>${esc(x.name)}${x.id === s.id ? ' (you)' : ''}</span><b>${x.score}</b></li>`).join('');
  $('start').hidden = !(p.state === 'lobby' && p.host === s.id);
  $('tools').hidden = !canDraw();
  if (p.state === 'lobby') {
    $('hint').textContent = ''; $('timer').textContent = '';
    show(`${banner}<p>Share room code <b>${p.code}</b>. The host starts the game once 2 or more players have joined.</p>`);
  } else {
    banner = '';
    if (p.state === 'choosing') {
      $('hint').textContent = '';
      if (p.drawer !== s.id) {
        const d = p.players.find(x => x.id === p.drawer);
        show(`<p>${esc(d ? d.name : 'Someone')} is choosing a word…</p>`);
      }
    } else if (p.state === 'drawing') hide();
  }
});
s.on('choices', words => show('<p>Pick a word to draw</p>' + words.map(w => `<button data-w="${esc(w)}">${esc(w)}</button>`).join('')));
s.on('hint', h => { $('hint').textContent = h; });
s.on('tick', n => { $('timer').textContent = n + 's'; });
s.on('reveal', d => show(`<p>The word was <b>${esc(d.word)}</b></p>`));
s.on('over', board => {
  banner = '<h2>Final scores</h2><ol>' + board.map(b => `<li>${esc(b.name)}: ${b.score}</li>`).join('') + '</ol>';
});
s.on('draw', seg);
s.on('clear', clearBoard);
s.on('strokes', list => { clearBoard(); list.forEach(seg); });
s.on('chat', m => {
  const p = document.createElement('p');
  p.className = (m.sys ? 'sys ' : '') + (m.secret ? 'secret' : '');
  p.innerHTML = (m.sys ? '' : `<b>${esc(m.name)}:</b> `) + esc(m.text);
  $('log').appendChild(p); $('log').scrollTop = 1e9;
});
s.on('err', msg => { alert(msg); location.reload(); });
