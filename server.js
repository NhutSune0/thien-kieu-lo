// Thiên Kiêu Lộ — P1 Core Server (Node.js + WebSocket)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const TICK = 50; // 20 tick/s
const SAVE_DIR = path.join(__dirname, 'save', 'players');

// ---------- Cấu hình thế giới ----------
const TILE = 48;
const MAP = { w: 80, h: 60 };              // Quảng Trường Tông Môn (P1)
const WORLD_W = MAP.w * TILE;              // 3840
const WORLD_H = MAP.h * TILE;              // 2880
const PLAYER_SPEED = 230;                  // px/s (server kiểm tra)

// ---------- Skill Kiếm Các Đường (P1) ----------
const SKILLS = {
  'linh-kiem-tram':      { cd: 3,  mp: 10, range: 430, dmgMul: 1.6, kind: 'bolt',   targets: 1 },
  'cuu-loi-kiem':        { cd: 8,  mp: 25, range: 390, dmgMul: 2.2, kind: 'aoe',    targets: 3 },
  'phan-thien-kiem':     { cd: 10, mp: 30, range: 350, dmgMul: 2.8, kind: 'aoe',    radius: 140 },
  'van-kiem-quy-tong':   { cd: 15, mp: 45, range: 300, dmgMul: 3.2, kind: 'nova',    radius: 230 },
  'hon-don-kim-chung':   { cd: 20, mp: 40, range: 0,   dmgMul: 0,   kind: 'shield',  dur: 6 },
  'khai-thien-nhat-kiem':{ cd: 60, mp: 80, range: 540, dmgMul: 8.0, kind: 'line',    width: 130 },
};
const SKILL_ORDER = Object.keys(SKILLS);

// ---------- Quái (P1: 3 loại vòng ngoài) ----------
const MONSTERS = {
  'hac-mao-thu':  { hp: 45,  dmg: 7,  tv: 18, ltMin: 1, ltMax: 3,  speed: 120, aggro: 230, count: 12 },
  'thanh-truc-xa':{ hp: 95,  dmg: 13, tv: 38, ltMin: 3, ltMax: 6,  speed: 145, aggro: 270, count: 8 },
  'da-hoa-lang':  { hp: 190, dmg: 24, tv: 85, ltMin: 6, ltMax: 12, speed: 165, aggro: 310, count: 5 },
};

const tvNeed = lvl => Math.round(100 * Math.pow(1.4, lvl - 1)); // Luyện Khí 1-9 (P1)

// ---------- HTTP static ----------
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const fp = path.join(__dirname, 'public', p);
  if (!fp.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(d);
  });
});

// ---------- Trạng thái game ----------
const players = new Map();   // ws -> player
const monsters = new Map();  // id -> monster
let midSeq = 1;

function newPlayerState(name) {
  return {
    name, hall: 'kiem-cac', x: WORLD_W/2, y: WORLD_H/2, dir: 0,
    tx: null, ty: null, moving: false,
    level: 1, tv: 0, hp: 120, maxhp: 120, mp: 80, maxmp: 80,
    atk: 24, lt: 20, potions: 3,
    cds: {}, shieldUntil: 0, lastAtk: 0, dead: false, respawnAt: 0,
  };
}
function loadPlayer(name) {
  const fp = path.join(SAVE_DIR, name + '.json');
  if (fs.existsSync(fp)) {
    try { return Object.assign(newPlayerState(name), JSON.parse(fs.readFile(fp))); } catch(e) {}
  }
  return newPlayerState(name);
}
function savePlayer(p) {
  try { fs.writeFileSync(path.join(SAVE_DIR, p.name + '.json'), JSON.stringify(p)); } catch(e) {}
}

function spawnMonster(type, initial) {
  const cfg = MONSTERS[type];
  const m = {
    id: midSeq++, type, cfg,
    x: 200 + Math.random() * (WORLD_W - 400),
    y: 200 + Math.random() * (WORLD_H - 400),
    hp: cfg.hp, maxhp: cfg.hp,
    state: 'idle', wx: 0, wy: 0, wt: 0, target: null, atkAt: 0, dead: false, respawnAt: 0,
  };
  if (!initial) { m.x = WORLD_W/2 + (Math.random()-0.5)*1600; m.y = WORLD_H/2 + (Math.random()-0.5)*1200; }
  monsters.set(m.id, m);
  return m;
}
// Spawn ban đầu
for (const [t, c] of Object.entries(MONSTERS)) for (let i = 0; i < c.count; i++) spawnMonster(t, true);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- WebSocket ----------
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    const p = players.get(ws);
    if (msg.t === 'login') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Vô Danh';
      const st = loadPlayer(name);
      st.dead = false;
      players.set(ws, st); ws._p = st;
      ws.send(JSON.stringify({ t: 'welcome', you: pubPlayer(st), skills: SKILLS, order: SKILL_ORDER }));
      broadcast({ t: 'sys', text: `${name} đã vào tông môn.` }, ws);
      return;
    }
    if (!p || p.dead) return;
    if (msg.t === 'move') {
      // Server kiểm tra: đích trong map, tốc độ hợp lệ (chống hack speed)
      const nx = clamp(+msg.x || p.x, 0, WORLD_W), ny = clamp(+msg.y || p.y, 0, WORLD_H);
      p.tx = nx; p.ty = ny; p.moving = true;
      p.dir = Math.atan2(ny - p.y, nx - p.x);
    } else if (msg.t === 'skill') {
      castSkill(p, String(msg.id));
    } else if (msg.t === 'attack') {
      basicAttack(p);
    } else if (msg.t === 'potion') {
      usePotion(p);
    }
  });
  ws.on('close', () => {
    const p = players.get(ws);
    if (p) { savePlayer(p); players.delete(ws); broadcast({ t: 'leave', name: p.name }); }
  });
});

function pubPlayer(p) {
  return { name: p.name, hall: p.hall, x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2),
    hp: Math.ceil(p.hp), maxhp: p.maxhp, mp: Math.ceil(p.mp), maxmp: p.maxmp,
    level: p.level, tv: p.tv, tvNeed: tvNeed(p.level), lt: p.lt, potions: p.potions,
    moving: p.moving, dead: p.dead, shield: Date.now() < p.shieldUntil };
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const [ws] of players) if (ws !== except && ws.readyState === 1) ws.send(s);
}
function sendTo(p, msg) {
  for (const [ws, pl] of players) if (pl === p && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- Chiến đấu ----------
function nearestMonsters(x, y, range, n) {
  return [...monsters.values()]
    .filter(m => !m.dead && dist({x,y}, m) <= range)
    .sort((a, b) => dist({x,y}, a) - dist({x,y}, b))
    .slice(0, n);
}

function damageMonster(m, dmg, p) {
  if (m.dead) return;
  m.hp -= dmg;
  m.target = p; m.state = 'chase';
  broadcast({ t: 'dmg', mid: m.id, dmg: Math.round(dmg), hp: Math.max(0, Math.ceil(m.hp)), maxhp: m.maxhp });
  if (m.hp <= 0) killMonster(m, p);
}

function killMonster(m, p) {
  m.dead = true; m.respawnAt = Date.now() + 20000;
  const ltGain = m.cfg.ltMin + Math.floor(Math.random() * (m.cfg.ltMax - m.cfg.ltMin + 1));
  if (p && !p.dead) {
    p.lt += ltGain;
    gainTv(p, m.cfg.tv);
    // 15% rơi Hồi Khí Đan
    if (Math.random() < 0.15) { p.potions++; sendTo(p, { t: 'loot', text: '+1 Hồi Khí Đan' }); }
    sendTo(p, { t: 'loot', text: `+${ltGain} linh thạch · +${m.cfg.tv} tu vi` });
  }
  broadcast({ t: 'mdie', mid: m.id });
}

function gainTv(p, amount) {
  p.tv += amount;
  while (p.tv >= tvNeed(p.level) && p.level < 9) {
    p.tv -= tvNeed(p.level); p.level++;
    p.maxhp += 30; p.hp = p.maxhp; p.maxmp += 15; p.mp = p.maxmp; p.atk += 4;
    broadcast({ t: 'sys', text: `🎉 ${p.name} đột phá Luyện Khí tầng ${p.level}!` });
  }
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

function basicAttack(p) {
  const now = Date.now();
  if (now - p.lastAtk < 600) return; // 0.6s/đòn
  p.lastAtk = now;
  const targets = nearestMonsters(p.x, p.y, 90, 1);
  p.dir = targets.length ? Math.atan2(targets[0].y - p.y, targets[0].x - p.x) : p.dir;
  broadcast({ t: 'fx', kind: 'slash', x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2), by: p.name });
  if (targets.length) damageMonster(targets[0], p.atk, p);
}

function castSkill(p, id) {
  const s = SKILLS[id];
  if (!s) return;
  const now = Date.now();
  if ((p.cds[id] || 0) > now) return;
  if (p.mp < s.mp) { sendTo(p, { t: 'err', text: 'Hết linh lực!' }); return; }
  p.mp -= s.mp; p.cds[id] = now + s.cd * 1000;

  if (s.kind === 'shield') {
    p.shieldUntil = now + s.dur * 1000;
    broadcast({ t: 'fx', kind: 'shield', x: Math.round(p.x), y: Math.round(p.y), by: p.name, dur: s.dur });
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  const dmg = p.atk * s.dmgMul;
  if (s.kind === 'bolt') {
    const tg = nearestMonsters(p.x, p.y, s.range, s.targets);
    const ang = tg.length ? Math.atan2(tg[0].y - p.y, tg[0].x - p.x) : p.dir;
    p.dir = ang;
    broadcast({ t: 'fx', kind: 'bolt', id, x: Math.round(p.x), y: Math.round(p.y), dir: +ang.toFixed(2), by: p.name });
    tg.forEach(m => damageMonster(m, dmg, p));
  } else if (s.kind === 'aoe') {
    const tg = nearestMonsters(p.x, p.y, s.range, s.targets);
    tg.forEach(m => {
      damageMonster(m, dmg, p);
      broadcast({ t: 'fx', kind: 'aoe', id, x: Math.round(m.x), y: Math.round(m.y), r: s.radius || 120, by: p.name });
    });
    if (!tg.length) broadcast({ t: 'fx', kind: 'aoe', id, x: Math.round(p.x + Math.cos(p.dir)*200), y: Math.round(p.y + Math.sin(p.dir)*200), r: s.radius || 120, by: p.name });
  } else if (s.kind === 'nova') {
    const tg = nearestMonsters(p.x, p.y, s.radius, 99);
    broadcast({ t: 'fx', kind: 'nova', id, x: Math.round(p.x), y: Math.round(p.y), r: s.radius, by: p.name });
    tg.forEach(m => damageMonster(m, dmg, p));
  } else if (s.kind === 'line') {
    const tg = nearestMonsters(p.x, p.y, s.range, 99).filter(m => {
      const dx = m.x - p.x, dy = m.y - p.y;
      const along = dx * Math.cos(p.dir) + dy * Math.sin(p.dir);
      const perp = Math.abs(-dx * Math.sin(p.dir) + dy * Math.cos(p.dir));
      return along > 0 && along <= s.range && perp <= s.width / 2;
    });
    // nếu không có quái, đánh theo hướng đang đứng
    const targets = tg.length ? tg : nearestMonsters(p.x + Math.cos(p.dir)*s.range/2, p.y + Math.sin(p.dir)*s.range/2, s.width, 99);
    broadcast({ t: 'fx', kind: 'line', id, x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2), len: s.range, w: s.width, by: p.name });
    targets.forEach(m => damageMonster(m, dmg, p));
  }
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

function usePotion(p) {
  if (p.potions <= 0) { sendTo(p, { t: 'err', text: 'Hết Hồi Khí Đan!' }); return; }
  if (p.hp >= p.maxhp) return;
  p.potions--; p.hp = Math.min(p.maxhp, p.hp + p.maxhp * 0.4);
  broadcast({ t: 'fx', kind: 'heal', x: Math.round(p.x), y: Math.round(p.y), by: p.name });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

function hurtPlayer(p, dmg) {
  if (p.dead) return;
  if (Date.now() < p.shieldUntil) dmg *= 0.25; // Kim Chung giảm 75%
  p.hp -= dmg;
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 5000; p.moving = false;
    broadcast({ t: 'sys', text: `💀 ${p.name} đã ngã xuống...` });
  }
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

// ---------- Game loop ----------
setInterval(() => {
  const now = Date.now();
  const dt = TICK / 1000;

  // Người chơi
  for (const p of players.values()) {
    if (p.dead) {
      if (now >= p.respawnAt) { p.dead = false; p.hp = p.maxhp; p.mp = p.maxmp; p.x = WORLD_W/2; p.y = WORLD_H/2; sendTo(p, { t: 'me', you: pubPlayer(p) }); }
      continue;
    }
    if (p.moving && p.tx !== null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = PLAYER_SPEED * dt;
      if (d <= step + 2) { p.x = p.tx; p.y = p.ty; p.moving = false; p.tx = p.ty = null; }
      else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    // Hồi linh lực
    p.mp = Math.min(p.maxmp, p.mp + p.maxmp * 0.04 * dt);
  }

  // Quái AI
  for (const m of monsters.values()) {
    if (m.dead) {
      if (now >= m.respawnAt) { const nm = spawnMonster(m.type); monsters.delete(m.id); }
      continue;
    }
    if (m.state === 'idle') {
      m.wt -= dt;
      if (m.wt <= 0) { m.wx = m.x + (Math.random()-0.5)*300; m.wy = m.y + (Math.random()-0.5)*300; m.wt = 2 + Math.random()*3; }
      const dx = m.wx - m.x, dy = m.wy - m.y, d = Math.hypot(dx, dy);
      if (d > 5) { m.x += dx/d * m.cfg.speed*0.4*dt; m.y += dy/d * m.cfg.speed*0.4*dt; }
      // Tìm mục tiêu
      let best = null, bd = m.cfg.aggro;
      for (const p of players.values()) { if (p.dead) continue; const dd = dist(m, p); if (dd < bd) { bd = dd; best = p; } }
      if (best) { m.state = 'chase'; m.target = best; }
    } else if (m.state === 'chase') {
      const t = m.target;
      if (!t || t.dead || dist(m, t) > m.cfg.aggro * 1.6) { m.state = 'idle'; m.target = null; continue; }
      const d = dist(m, t);
      if (d < 44) {
        if (now - m.atkAt > 1000) { m.atkAt = now; hurtPlayer(t, m.cfg.dmg * (0.9 + Math.random()*0.2)); broadcast({ t: 'fx', kind: 'hit', x: Math.round(t.x), y: Math.round(t.y), by: t.name }); }
      } else {
        m.x += (t.x - m.x)/d * m.cfg.speed*dt; m.y += (t.y - m.y)/d * m.cfg.speed*dt;
      }
    }
  }

  // Snapshot 20Hz
  const snap = { t: 'snap',
    ps: [...players.values()].map(pubPlayer),
    ms: [...monsters.values()].filter(m => !m.dead).map(m => ({ id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp), maxhp: m.maxhp })),
  };
  const s = JSON.stringify(snap);
  for (const [ws] of players) if (ws.readyState === 1) ws.send(s);
}, TICK);

// Lưu định kỳ 30s
setInterval(() => { for (const p of players.values()) savePlayer(p); }, 30000);

server.listen(PORT, () => console.log(`Thiên Kiêu Lộ P1 chạy ở cổng ${PORT}`));
