const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const WORDS = ('apple,bridge,castle,dragon,guitar,rocket,pizza,volcano,penguin,umbrella,camera,bicycle,robot,' +
  'sandwich,island,ghost,tiger,piano,lighthouse,snowman,spider,cactus,helicopter,rainbow,pirate,mushroom,' +
  'dinosaur,balloon,candle,anchor,butterfly,skateboard,telescope,windmill,whale,backpack,campfire,crown,donut,' +
  'elephant,fireworks,giraffe,hammer,igloo,jellyfish,kangaroo,ladder,mermaid,ninja,octopus,parachute,scarecrow,' +
  'tornado,unicorn,vampire,waterfall,zombie,treasure map,ice cream,hot air balloon,roller coaster,' +
  'house,tree,car,bus,airplane,sailboat,train,bear,horse,cow,dog,cat,mouse,shark,dolphin,frog,snail,bee,owl,snake,' +
  'crab,turtle,lion,zebra,monkey,chair,table,bed,lamp,clock,key,scissors,toothbrush,pencil,book,kite,drum,trumpet,' +
  'sword,wizard,tent,tractor,submarine,ferris wheel,skyscraper,pyramid,hamburger,banana,snowflake,door').split(',');

const ROUNDS = 3, DRAW_TIME = 60, CHOOSE_TIME = 15, SCALE_TIME = 10, MAX_PLAYERS = 8;
const SCALES = [1, 5, 10]; // meters; board height = chosen scale
const rooms = {};
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const num = v => (Number.isFinite(+v) ? +v : 0);

const snapshot = r => ({
  code: r.code, state: r.state, round: r.round, rounds: ROUNDS, host: r.host, drawer: r.drawer, scale: r.scale,
  players: Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, score: p.score, guessed: p.guessed })),
});
const push = r => io.to(r.code).emit('state', snapshot(r));
const sys = (r, text) => io.to(r.code).emit('chat', { sys: true, text });
const stopTimers = r => { clearTimeout(r.t); clearInterval(r.t2); };

function sendHint(r) {
  io.to(r.code).emit('hint', r.hint.join(' '));
  if (r.drawer) io.to(r.drawer).emit('hint', r.word); // drawer sees the real word
}

function nextTurn(r) {
  stopTimers(r);
  r.queue = r.queue.filter(id => r.players[id]);
  if (!r.queue.length) { r.round++; r.queue = Object.keys(r.players); }
  if (r.round > ROUNDS || Object.keys(r.players).length < 2) return gameOver(r);
  r.drawer = r.queue.shift();
  Object.values(r.players).forEach(p => (p.guessed = false));
  r.state = 'choosing'; r.word = ''; r.strokes = []; r.scale = 0;
  io.to(r.code).emit('clear');
  push(r);
  const choices = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 3);
  io.to(r.drawer).emit('choices', choices);
  r.t = setTimeout(() => choose(r, choices[0]), CHOOSE_TIME * 1000);
}

function choose(r, word) {
  if (r.state !== 'choosing') return;
  clearTimeout(r.t);
  r.word = word; r.state = 'scaling';
  r.hint = word.split('').map(c => (c === ' ' ? ' ' : '_'));
  push(r); sendHint(r);
  r.t = setTimeout(() => setScale(r, SCALES[1]), SCALE_TIME * 1000); // auto-pick if drawer stalls
}

function setScale(r, meters) {
  if (r.state !== 'scaling') return;
  clearTimeout(r.t);
  r.scale = meters; r.state = 'drawing'; r.left = DRAW_TIME;
  push(r); sendHint(r);
  io.to(r.code).emit('tick', r.left);
  r.t2 = setInterval(() => {
    r.left--;
    io.to(r.code).emit('tick', r.left);
    if (r.left === 40 || r.left === 20) { // reveal one more letter
      const hidden = r.hint.map((c, i) => (c === '_' ? i : -1)).filter(i => i >= 0);
      if (hidden.length > 1) { const i = hidden[Math.floor(Math.random() * hidden.length)]; r.hint[i] = r.word[i]; sendHint(r); }
    }
    if (r.left <= 0) endTurn(r);
  }, 1000);
}

function endTurn(r) {
  if (r.state !== 'drawing') return;
  stopTimers(r);
  r.state = 'reveal';
  push(r);
  io.to(r.code).emit('reveal', { word: r.word });
  r.t = setTimeout(() => nextTurn(r), 4000);
}

function gameOver(r) {
  stopTimers(r);
  const board = Object.values(r.players).map(p => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  r.state = 'lobby'; r.round = 0; r.queue = []; r.drawer = null;
  io.to(r.code).emit('over', board);
  push(r);
}

io.on('connection', socket => {
  socket.on('join', ({ name, room } = {}) => {
    if (socket.room) return;
    const code = clean(room, 5).toUpperCase() || Math.random().toString(36).slice(2, 6).toUpperCase();
    const r = (rooms[code] ||= { code, host: socket.id, state: 'lobby', round: 0, queue: [], players: {}, strokes: [], word: '', hint: [], left: 0, drawer: null, scale: 0 });
    if (Object.keys(r.players).length >= MAX_PLAYERS) return socket.emit('err', 'Room is full');
    socket.room = code; socket.join(code);
    r.players[socket.id] = { name: clean(name, 16) || 'Player', score: 0, guessed: false };
    socket.emit('strokes', r.strokes);
    if (r.state === 'drawing') socket.emit('hint', r.hint.join(' '));
    sys(r, `${r.players[socket.id].name} joined`);
    push(r);
  });

  socket.on('start', () => {
    const r = rooms[socket.room];
    if (!r || r.host !== socket.id || r.state !== 'lobby' || Object.keys(r.players).length < 2) return;
    Object.values(r.players).forEach(p => (p.score = 0));
    nextTurn(r);
  });

  socket.on('choose', w => {
    const r = rooms[socket.room];
    if (r && r.drawer === socket.id) choose(r, clean(w, 30) || 'apple');
  });

  socket.on('scale', m => {
    const r = rooms[socket.room];
    if (r && r.drawer === socket.id && SCALES.includes(+m)) setScale(r, +m);
  });

  socket.on('draw', g => {
    const r = rooms[socket.room];
    if (!r || r.state !== 'drawing' || r.drawer !== socket.id) return;
    const seg = { x0: num(g.x0), y0: num(g.y0), x1: num(g.x1), y1: num(g.y1), c: clean(g.c, 9), w: Math.min(40, num(g.w)) };
    if (r.strokes.length < 20000) r.strokes.push(seg);
    socket.to(r.code).emit('draw', seg);
  });

  socket.on('clear', () => {
    const r = rooms[socket.room];
    if (!r || r.state !== 'drawing' || r.drawer !== socket.id) return;
    r.strokes = [];
    socket.to(r.code).emit('clear');
  });

  socket.on('chat', raw => {
    const r = rooms[socket.room];
    const text = clean(raw, 60);
    if (!r || !text) return;
    const p = r.players[socket.id];
    const playing = r.state === 'drawing';
    if (playing && socket.id !== r.drawer && !p.guessed && text.toLowerCase() === r.word.toLowerCase()) {
      p.guessed = true;
      p.score += 50 + Math.round((150 * r.left) / DRAW_TIME);
      if (r.players[r.drawer]) r.players[r.drawer].score += 30;
      sys(r, `${p.name} guessed the word!`);
      push(r);
      if (Object.keys(r.players).every(id => id === r.drawer || r.players[id].guessed)) endTurn(r);
      return;
    }
    const msg = { name: p.name, text };
    if (playing && (socket.id === r.drawer || p.guessed)) { // keep chat from leaking the answer
      Object.keys(r.players).filter(id => id === r.drawer || r.players[id].guessed)
        .forEach(id => io.to(id).emit('chat', { ...msg, secret: true }));
    } else io.to(r.code).emit('chat', msg);
  });

  socket.on('disconnect', () => {
    const r = rooms[socket.room];
    if (!r) return;
    const name = r.players[socket.id]?.name;
    delete r.players[socket.id];
    const ids = Object.keys(r.players);
    if (!ids.length) { stopTimers(r); delete rooms[r.code]; return; }
    if (r.host === socket.id) r.host = ids[0];
    sys(r, `${name} left`);
    if (r.state !== 'lobby' && ids.length < 2) return gameOver(r);
    if (r.drawer === socket.id) {
      if (r.state === 'drawing') endTurn(r);
      else if (r.state === 'choosing' || r.state === 'scaling') return nextTurn(r);
    }
    push(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Doodle Dash running at http://localhost:${PORT}`));
