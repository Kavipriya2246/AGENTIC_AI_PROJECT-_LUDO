const COL = ['#d9483b', '#2f9e5a', '#d49a00', '#2f6fd6'];
const OWN = ['Red', 'Green', 'Yellow', 'Blue'];
const $ = id => document.getElementById(id);
let arch = 'central', st, timer = null;
const results = {};

// ---- Ludo geometry (15x15 grid, 24px cells) ----
const CELL = 24, px = c => c * CELL + CELL / 2;
const TRACK = [];
const seg = (c, r, dc, dr, n, out = TRACK) => { for (let i = 0; i < n; i++) out.push([c + dc * i, r + dr * i]); };
seg(1, 6, 1, 0, 5); seg(6, 5, 0, -1, 6); seg(7, 0, 1, 0, 2); seg(8, 1, 0, 1, 5);
seg(9, 6, 1, 0, 6); seg(14, 7, 0, 1, 2); seg(13, 8, -1, 0, 5); seg(8, 9, 0, 1, 6);
seg(7, 14, -1, 0, 2); seg(6, 13, 0, -1, 5); seg(5, 8, -1, 0, 6); seg(0, 7, 0, -1, 2);
const HOMEC = [[], [], [], []];
seg(1, 7, 1, 0, 5, HOMEC[0]); seg(7, 1, 0, 1, 5, HOMEC[1]); seg(13, 7, -1, 0, 5, HOMEC[2]); seg(7, 13, 0, -1, 5, HOMEC[3]);
const START = [0, 13, 26, 39];
const YARD = [[0, 0], [9, 0], [9, 9], [0, 9]];
const SLOT = [[1, 1], [4, 1], [1, 4], [4, 4]];
const HOME = 57; // 0 = yard, 1..51 = track, 52..56 = home column, 57 = home

function where(p, pos, t) {
  if (pos === 0) { const [ox, oy] = YARD[p], [dx, dy] = SLOT[t]; return [px(ox + dx), px(oy + dy)]; }
  if (pos <= 51) { const [c, r] = TRACK[(START[p] + pos - 1) % 52]; return [px(c), px(r)]; }
  if (pos <= 56) { const [c, r] = HOMEC[p][pos - 52]; return [px(c), px(r)]; }
  const o = [[-16, 0], [0, -16], [16, 0], [0, 16]][p];
  return [180 + o[0] + (t - 1.5) * 3, 180 + o[1] + (t - 1.5) * 3];
}

// ---- Architecture definitions (topology drawn in the SVG) ----
const ARCH = {
  central: {
    name: '1 · Centralized',
    desc: 'One coordinator collects dice from only 2 agents per tick, then moves the best token of any color. No roll is wasted, but throughput is capped.',
    nodes: { C: [180, 45, 'Coord'], W1: [50, 210, 'W1'], W2: [140, 210, 'W2'], W3: [230, 210, 'W3'], W4: [320, 210, 'W4'] },
    edges: [['C', 'W1'], ['C', 'W2'], ['C', 'W3'], ['C', 'W4']]
  },
  hier: {
    name: '2 · Hierarchical',
    desc: 'L1 pools Red + Green, L2 pools Yellow + Blue. All 4 agents roll every tick, and a lead may move any token of its pair. The manager is told when a token gets home.',
    nodes: { M: [180, 30, 'Mgr'], L1: [100, 120, 'L1'], L2: [260, 120, 'L2'], W1: [50, 225, 'W1'], W2: [150, 225, 'W2'], W3: [210, 225, 'W3'], W4: [310, 225, 'W4'] },
    edges: [['M', 'L1'], ['M', 'L2'], ['L1', 'W1'], ['L1', 'W2'], ['L2', 'W3'], ['L2', 'W4']]
  },
  p2p: {
    name: '7 · Peer-to-Peer',
    desc: 'No leader. Each peer rolls and may only move its own color, then broadcasts the move to the 3 other peers. Rolls with no legal move are wasted.',
    nodes: { P1: [80, 60, 'P1'], P2: [280, 60, 'P2'], P3: [280, 215, 'P3'], P4: [80, 215, 'P4'] },
    edges: [['P1', 'P2'], ['P1', 'P3'], ['P1', 'P4'], ['P2', 'P3'], ['P2', 'P4'], ['P3', 'P4']]
  }
};

// ---- Rendering ----
function drawBoard() {
  let s = '';
  YARD.forEach(([ox, oy], p) => {
    s += `<rect x="${ox * CELL}" y="${oy * CELL}" width="${6 * CELL}" height="${6 * CELL}" fill="${COL[p]}" fill-opacity=".3"/>`;
    s += `<rect x="${(ox + .8) * CELL}" y="${(oy + .8) * CELL}" width="${4.4 * CELL}" height="${4.4 * CELL}" rx="10" fill="#fff"/>`;
    SLOT.forEach(([dx, dy]) => s += `<circle cx="${px(ox + dx)}" cy="${px(oy + dy)}" r="10" fill="${COL[p]}" fill-opacity=".2"/>`);
  });
  TRACK.forEach(([c, r], i) => {
    const t = i % 13 === 0 ? ` style="fill:${COL[i / 13]};fill-opacity:.45"` : '';
    s += `<rect class="cell" x="${c * CELL}" y="${r * CELL}" width="${CELL}" height="${CELL}"${t}/>`;
  });
  HOMEC.forEach((cells, p) => cells.forEach(([c, r]) =>
    s += `<rect class="cell" x="${c * CELL}" y="${r * CELL}" width="${CELL}" height="${CELL}" style="fill:${COL[p]};fill-opacity:.45"/>`));
  const tri = [[144, 144, 144, 216], [144, 144, 216, 144], [216, 144, 216, 216], [144, 216, 216, 216]];
  tri.forEach(([x1, y1, x2, y2], p) => s += `<polygon points="${x1},${y1} ${x2},${y2} 180,180" fill="${COL[p]}"/>`);
  $('board').innerHTML = s + '<g class="tok" id="tok"></g>';
}
function drawTokens() {
  const seen = {}; let s = '';
  for (let p = 0; p < 4; p++) for (let t = 0; t < 4; t++) {
    let [x, y] = where(p, st.pos[p][t], t);
    const k = x + ',' + y, n = seen[k] = (seen[k] || 0) + 1;
    x += (n - 1) * 5; y -= (n - 1) * 2;
    s += `<circle cx="${x}" cy="${y}" r="8" fill="${COL[p]}"/><text x="${x}" y="${y + 3}">${t + 1}</text>`;
  }
  $('tok').innerHTML = s;
}
function drawTopology() {
  const a = ARCH[arch];
  let h = a.edges.map(([x, y]) => `<line x1="${a.nodes[x][0]}" y1="${a.nodes[x][1]}" x2="${a.nodes[y][0]}" y2="${a.nodes[y][1]}"/>`).join('');
  h += Object.entries(a.nodes).map(([id, [x, y, l]]) => {
    const k = /^[WP]\d$/.test(id) ? `style="stroke:${COL[+id[1] - 1]}"` : '';
    return `<g id="n-${id}"><circle cx="${x}" cy="${y}" r="24" ${k}/><text x="${x}" y="${y + 4}">${l}</text></g>`;
  }).join('');
  $('topo').innerHTML = h;
  $('archTitle').textContent = a.name;
  $('desc').textContent = a.desc;
}
const homeCount = () => st.pos.flat().filter(v => v === HOME).length;
function renderStats() {
  $('stats').textContent = `Tick ${st.tick} · Home ${homeCount()}/16 · Messages ${st.msgs} · Wasted rolls ${st.waste}`;
}
function renderResults() {
  $('results').innerHTML = Object.keys(ARCH).map(k => {
    const r = results[k];
    return `<tr><td>${ARCH[k].name}</td><td>${r ? r.tick : '–'}</td><td>${r ? r.msgs : '–'}</td><td>${r ? r.waste : '–'}</td></tr>`;
  }).join('');
}

// ---- Simulation ----
function init() {
  clearInterval(timer); timer = null;
  $('run').textContent = 'Run';
  st = { tick: 0, msgs: 0, waste: 0, pos: Array.from({ length: 4 }, () => [0, 0, 0, 0]) };
  drawBoard(); drawTokens(); drawTopology(); $('log').innerHTML = ''; renderStats();
}
function log(t, msg) {
  const li = document.createElement('li');
  li.innerHTML = `<b>t${t}</b>${msg}`;
  $('log').prepend(li);
  while ($('log').children.length > 150) $('log').lastChild.remove();
}
// Same dice for every architecture: roll depends only on tick and agent
function die(tick, agent) {
  let a = (tick * 13 + agent * 7919 + 5) | 0;
  a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return 1 + Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * 6);
}
const legal = (pos, d) => pos === 0 ? d === 6 : pos < HOME && pos + d <= HOME;
function choose(owners, d) { // finish > leave yard > advance the leader
  let best = null, bs = -1;
  for (const p of owners) for (let t = 0; t < 4; t++) {
    const pos = st.pos[p][t];
    if (!legal(pos, d)) continue;
    const s = pos + d === HOME ? 3 : pos === 0 ? 2 : 1 + pos / 100;
    if (s > bs) { bs = s; best = [p, t]; }
  }
  return best;
}
function go(p, t, d) {
  const pos = st.pos[p][t] = st.pos[p][t] === 0 ? 1 : st.pos[p][t] + d;
  return pos === HOME;
}
const tag = (p, t, fin) => `${OWN[p]} token ${t + 1}${fin ? ' reaches home' : ''}`;

function stepCentral(a, say) {
  const agents = st.tick % 2 ? [0, 1] : [2, 3];
  for (const i of agents) {
    const d = die(st.tick, i); st.msgs++; a.push('W' + (i + 1), 'C');
    const m = choose([0, 1, 2, 3], d);
    if (!m) { st.waste++; say(`W${i + 1} rolls ${d}: no legal move for anyone, wasted`); continue; }
    st.msgs++; const fin = go(m[0], m[1], d);
    say(`W${i + 1} rolls ${d}; Coordinator moves ${tag(m[0], m[1], fin)}`);
  }
}
function stepHier(a, say) {
  for (let i = 0; i < 4; i++) {
    const l = i < 2 ? 0 : 1, d = die(st.tick, i); st.msgs++; a.push('W' + (i + 1), 'L' + (l + 1));
    const m = choose(l ? [2, 3] : [0, 1], d);
    if (!m) { st.waste++; say(`W${i + 1} rolls ${d}: L${l + 1} has no legal move, wasted`); continue; }
    st.msgs++; const fin = go(m[0], m[1], d);
    say(`W${i + 1} rolls ${d}; L${l + 1} moves ${tag(m[0], m[1], fin)}`);
    if (fin) { st.msgs++; a.push('M'); say(`L${l + 1} reports the finished token to Manager`); }
  }
}
function stepP2P(a, say) {
  for (let i = 0; i < 4; i++) {
    const d = die(st.tick, i); a.push('P' + (i + 1));
    const m = choose([i], d);
    if (!m) { st.waste++; say(`P${i + 1} rolls ${d}: no legal move, wasted`); continue; }
    st.msgs += 3; const fin = go(m[0], m[1], d);
    say(`P${i + 1} rolls ${d}, moves ${tag(m[0], m[1], fin)}, broadcasts to peers`);
  }
}

function tick() {
  st.tick++;
  const active = [], say = m => log(st.tick, m);
  ({ central: stepCentral, hier: stepHier, p2p: stepP2P })[arch](active, say);
  document.querySelectorAll('#topo g').forEach(g => g.classList.remove('on'));
  active.forEach(id => $('n-' + id)?.classList.add('on'));
  drawTokens(); renderStats();
  if (homeCount() === 16) {
    clearInterval(timer); timer = null; $('run').textContent = 'Run again';
    results[arch] = { tick: st.tick, msgs: st.msgs, waste: st.waste };
    log(st.tick, 'All 16 tokens are home'); renderResults();
  }
}

// ---- Controls ----
function start() {
  if (homeCount() === 16) init();
  clearInterval(timer);
  timer = setInterval(tick, +$('speed').value);
  $('run').textContent = 'Pause';
}
$('run').onclick = () => timer ? (clearInterval(timer), timer = null, $('run').textContent = 'Resume') : start();
$('reset').onclick = init;
$('speed').oninput = () => { if (timer) start(); };
$('tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  arch = b.dataset.arch;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  init();
};

init(); renderResults();
