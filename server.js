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
const SPAWN = { x: WORLD_W / 2, y: WORLD_H / 2 };
const SAFE_R = 520; // vùng an toàn quanh điểm spawn: quái không chủ động đánh người trong này
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

// ---------- NPC Chương 1 ----------
const NPCS = {
  'chap-su-ly':   { name: 'Chấp sự Lý',    x: 1920, y: 1150 },
  'lao-tran':     { name: 'Lão Trần',       x: 1700, y: 1500 },
  'duoc-tran-tu': { name: 'Dược Trần Tử',   x: 2140, y: 1500 },
  'tieu-ho':      { name: 'Trương Tiểu Hổ', x: 1920, y: 1730 },
};

// ---------- Nhiệm vụ Chương 1 (chuỗi tuyến tính) ----------
const QUESTS = {
  'C1-01': { name: 'Nhập Môn', giver: 'chap-su-ly', turnin: 'duoc-tran-tu',
    objectives: [{ type: 'talk', npc: 'duoc-tran-tu', text: 'Gặp Dược Trần Tử báo danh' }],
    reward: { tv: 50, lt: 5, dch: 10 },
    offer: ['Tạp linh căn thì về Tạp Dịch Viện. Đừng có mơ mộng.', 'Đến gặp Dược Trần Tử báo danh đi.'],
    done: ['Lại một đứa nhỏ bị chê... Không sao.', 'Ở đây không ai chê con cả. Tạp vụ cũng là đệ tử tông môn.'] },
  'C1-02': { name: 'Chổi Đầu Đời', giver: 'lao-tran', turnin: 'lao-tran',
    objectives: [{ type: 'collect', item: 'la', count: 5, text: 'Quét lá trong sân' }],
    reward: { tv: 30, dch: 10 },
    offer: ['Quét sân thì phải quét tâm trước.', 'Quét 5 đống lá trong sân đi.'],
    done: ['Sân sạch rồi. Tâm con cũng sạch hơn chút đấy.'] },
  'C1-03': { name: 'Gánh Nước Linh Tuyền', giver: 'tieu-ho', turnin: 'duoc-tran-tu',
    objectives: [{ type: 'interact', obj: 'gieng', text: 'Lấy nước ở giếng phía đông' },
                 { type: 'talk', npc: 'duoc-tran-tu', text: 'Gánh nước về cho Dược Trần Tử' }],
    reward: { tv: 60, lt: 5, dch: 15 },
    offer: ['Đi! Gánh nước Linh Tuyền với ta!', 'Lấy nước ở giếng phía đông rồi gánh về cho Dược lão.'],
    done: ['Nước Linh Tuyền đây rồi. Vất vả cho con.'] },
  'C1-04': { name: 'Hái Linh Thảo', giver: 'duoc-tran-tu', turnin: 'duoc-tran-tu',
    objectives: [{ type: 'collect', item: 'linh-thao', count: 10, text: 'Hái Linh Thảo tươi' }],
    reward: { tv: 80, potions: 2, dch: 20 },
    offer: ['Đan Đường thiếu Linh Thảo luyện Hồi Khí Đan.', 'Hái 10 gốc tươi về đây. Cẩn thận, có 2 gốc héo đấy!'],
    done: ['Đủ 10 gốc tươi. Tốt lắm!'] },
  'C1-05': { name: 'Bữa Cơm Huynh Đệ', giver: 'tieu-ho', turnin: 'tieu-ho',
    objectives: [{ type: 'talk', npc: 'tieu-ho', text: 'Ăn bánh bao cùng Tiểu Hổ' }],
    reward: { tv: 30, ketbai: true },
    offer: ['Này, phần bánh bao của ngươi đây.', 'Ngươi là huynh đệ đầu tiên của ta ở đây.', 'Sau này ai bắt nạt ngươi... ta sẽ chạy đi gọi người cứu ngươi!'],
    done: ['Từ nay chúng ta là huynh đệ! (Đã mở Kết bái)'] },
  'C1-06': { name: 'Đêm Yêu Thú', giver: 'lao-tran', turnin: 'lao-tran',
    objectives: [{ type: 'kill', mob: 'thiet-bi-da-tru', count: 1, text: 'Đánh bại Thiết Bì Dã Trư' }],
    reward: { tv: 300, lt: 20, dch: 100, title: 'Kẻ Sống Sót Đêm Yêu Thú' },
    offer: ['Đêm nay có yêu thú lẻn vào Tạp Dịch Viện!', 'Cẩn thận đấy tiểu tử...'],
    done: ['Tiểu tử... thú vị đấy. (Hỗn Độn Linh Căn của con vừa rung động!)'] },
};
const QUEST_ORDER = Object.keys(QUESTS);

// ---------- Vật tương tác (lá, thảo, giếng) ----------
const INTERACTS = [
  { id: 'la1', type: 'la', x: 1580, y: 1420 }, { id: 'la2', type: 'la', x: 1820, y: 1420 },
  { id: 'la3', type: 'la', x: 1580, y: 1600 }, { id: 'la4', type: 'la', x: 1820, y: 1600 },
  { id: 'la5', type: 'la', x: 1700, y: 1690 },
  { id: 'gieng', type: 'gieng', x: 2280, y: 1230 },
];
{ // 12 gốc thảo quanh Dược Trần Tử: 10 tươi + 2 héo (vị trí 3 và 8)
  const cx = 2140, cy = 1500;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12, r = i % 2 ? 190 : 145;
    INTERACTS.push({ id: 'lt' + i, type: (i === 3 || i === 8) ? 'linh-thao-heo' : 'linh-thao',
      x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r) });
  }
}

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
    atk: 24, def: 8, lt: 20, potions: 3,
    cds: {}, shieldUntil: 0, protectUntil: 0, lastAtk: 0, dead: false, respawnAt: 0,
    quests: { active: null, done: [] }, dch: 0, titles: [], ketbai: false,
    carrying: false, collected: [], channel: null,
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
  // Đẩy quái ra khỏi vùng an toàn quanh điểm spawn
  {
    const dx = m.x - SPAWN.x, dy = m.y - SPAWN.y, d = Math.hypot(dx, dy);
    if (d < 650) { const a = d > 1 ? Math.atan2(dy, dx) : Math.random()*Math.PI*2; m.x = SPAWN.x + Math.cos(a)*650; m.y = SPAWN.y + Math.sin(a)*650; }
  }
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
      st.x = SPAWN.x; st.y = SPAWN.y; // về điểm spawn an toàn
      st.protectUntil = Date.now() + 5000; // bảo hộ 5s lúc mới vào
      st.channel = null; st.carrying = false; // reset trạng thái vận công/gánh nước
      players.set(ws, st); ws._p = st;
      ws.send(JSON.stringify({ t: 'welcome', you: pubPlayer(st), skills: SKILLS, order: SKILL_ORDER,
        npcs: Object.entries(NPCS).map(([id, n]) => ({ id, name: n.name, x: n.x, y: n.y })),
        quest: questInfo(st), interacts: INTERACTS, collected: st.collected }));
      broadcast({ t: 'sys', text: `${name} đã vào tông môn.` }, ws);
      return;
    }
    if (!p || p.dead) return;
    if (msg.t === 'move') {
      // Server kiểm tra: đích trong map, tốc độ hợp lệ (chống hack speed)
      const nx = clamp(+msg.x || p.x, 0, WORLD_W), ny = clamp(+msg.y || p.y, 0, WORLD_H);
      p.tx = nx; p.ty = ny; p.moving = true;
      p.dir = Math.atan2(ny - p.y, nx - p.x);
      if (p.channel) { p.channel = null; sendTo(p, { t: 'channel', dur: 0 }); } // di chuyển hủy vận công thu thập
    } else if (msg.t === 'skill') {
      castSkill(p, String(msg.id));
    } else if (msg.t === 'attack') {
      basicAttack(p);
    } else if (msg.t === 'potion') {
      usePotion(p);
    } else if (msg.t === 'chat') {
      const now = Date.now();
      if (now - (p.lastChat || 0) < 2000) return; // chống spam
      const text = String(msg.text || '').trim().slice(0, 80);
      if (!text) return;
      p.lastChat = now;
      broadcast({ t: 'chat', name: p.name, text });
    } else if (msg.t === 'talk') {
      handleTalk(p, String(msg.npc));
    } else if (msg.t === 'accept') {
      acceptQuest(p, String(msg.quest));
    } else if (msg.t === 'turnin') {
      turninQuest(p, String(msg.quest));
    } else if (msg.t === 'interact') {
      startInteract(p, String(msg.id));
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
    atk: p.atk, def: p.def || 8,
    dch: p.dch || 0, titles: p.titles || [], ketbai: !!p.ketbai, qm: npcMarkers(p),
    moving: p.moving, dead: p.dead, shield: Date.now() < p.shieldUntil };
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const [ws] of players) if (ws !== except && ws.readyState === 1) ws.send(s);
}
function sendTo(p, msg) {
  for (const [ws, pl] of players) if (pl === p && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- Quest engine (Chương 1) ----------
// NV khả dụng tiếp theo: NV đầu tiên chưa done và chưa active (chuỗi tuyến tính)
function acceptAvailQuest(p) {
  const a = p.quests.active;
  for (const id of QUEST_ORDER) {
    if (p.quests.done.includes(id)) continue;
    if (a) return null; // đang dở NV khác
    return id;
  }
  return null;
}
// Thông tin NV gửi client: { active: {id,name,text,done} | null, done: [...] }
function questInfo(p) {
  const a = p.quests.active, done = p.quests.done;
  if (!a) return { active: null, done };
  const q = QUESTS[a.id];
  if (!q) return { active: null, done };
  if (a.step >= q.objectives.length)
    return { active: { id: a.id, name: q.name, text: 'Về trả nhiệm vụ!', done: true }, done };
  const o = q.objectives[a.step];
  const prog = o.count ? ` (${Math.min(a.count, o.count)}/${o.count})` : '';
  return { active: { id: a.id, name: q.name, step: a.step, count: a.count, text: o.text + prog, done: false }, done };
}
// Marker trên đầu NPC: '!' có NV mới, '?' trả được
function npcMarkers(p) {
  const mk = {};
  const nid = acceptAvailQuest(p);
  const a = p.quests.active;
  for (const id of Object.keys(NPCS)) {
    if (nid && QUESTS[nid].giver === id) mk[id] = '!';
    if (a) {
      const q = QUESTS[a.id];
      if (q && a.step >= q.objectives.length && q.turnin === id) mk[id] = '?';
    }
  }
  return mk;
}
function refreshQuest(p) {
  sendTo(p, { t: 'quest', ...questInfo(p) });
  sendTo(p, { t: 'me', you: pubPlayer(p) }); // cập nhật marker
}
// Xong 1 bước mục tiêu -> sang bước tiếp
function advanceStep(p) {
  const a = p.quests.active; if (!a) return;
  a.step++; a.count = 0;
  refreshQuest(p);
}
// Kiểm tra mục tiêu đếm (collect/kill) đã đủ chưa
function checkObjComplete(p) {
  const a = p.quests.active; if (!a) return;
  const q = QUESTS[a.id]; const o = q.objectives[a.step];
  if (o && o.count && a.count >= o.count) {
    advanceStep(p);
    if (a.step >= q.objectives.length)
      sendTo(p, { t: 'sys', text: '✅ Hoàn thành mục tiêu, về trả nhiệm vụ!' });
  } else {
    sendTo(p, { t: 'qprog', active: questInfo(p).active });
  }
}
function defaultLines(npcId) {
  return {
    'chap-su-ly': ['Có việc gì? Đừng có lảng vảng ở đây.'],
    'lao-tran': ['Quét sân thì phải quét tâm trước...'],
    'duoc-tran-tu': ['Tạp vụ cũng là đệ tử của tông môn. Cố gắng nhé.'],
    'tieu-ho': ['Huynh đệ! Hôm nay có gì vui không?'],
  }[npcId] || ['...'];
}
function handleTalk(p, npcId) {
  const npc = NPCS[npcId]; if (!npc) return;
  const a = p.quests.active;
  let lines = [], canAccept = false, canTurnin = false, qid = null;
  // 1. Mục tiêu talk của NV đang làm -> hoàn thành bước
  if (a) {
    const q = QUESTS[a.id];
    if (q && a.step < q.objectives.length) {
      const o = q.objectives[a.step];
      if (o.type === 'talk' && o.npc === npcId) advanceStep(p);
    }
    const q2 = QUESTS[a.id];
    if (q2 && a.step >= q2.objectives.length && q2.turnin === npcId) {
      canTurnin = true; qid = a.id; lines = q2.done;
    }
  }
  // 2. NPC là giver của NV khả dụng -> chào nhận NV
  if (!canTurnin) {
    const nid = acceptAvailQuest(p);
    if (nid && QUESTS[nid].giver === npcId) { canAccept = true; qid = nid; lines = QUESTS[nid].offer; }
  }
  if (!lines.length) lines = defaultLines(npcId);
  sendTo(p, { t: 'dlg', npc: npcId, name: npc.name, lines, canAccept, canTurnin, qid });
}
function acceptQuest(p, qid) {
  const nid = acceptAvailQuest(p);
  if (!nid || nid !== qid) { sendTo(p, { t: 'err', text: 'Chưa thể nhận nhiệm vụ này.' }); return; }
  const q = QUESTS[qid];
  p.quests.active = { id: qid, step: 0, count: 0 };
  broadcast({ t: 'sys', text: `📜 ${p.name} nhận nhiệm vụ [${q.name}]` });
  if (qid === 'C1-06') spawnBoss(p.x + 150, p.y + 100, p); // boss xuất hiện khi nhận NV
  refreshQuest(p);
}
function turninQuest(p, qid) {
  const a = p.quests.active;
  if (!a || a.id !== qid) return;
  const q = QUESTS[qid];
  if (a.step < q.objectives.length) { sendTo(p, { t: 'err', text: 'Chưa hoàn thành mục tiêu!' }); return; }
  const r = q.reward;
  if (r.tv) gainTv(p, r.tv);
  if (r.lt) p.lt += r.lt;
  if (r.dch) p.dch += r.dch;
  if (r.potions) p.potions += r.potions;
  if (r.ketbai) p.ketbai = true;
  if (r.title && !p.titles.includes(r.title)) p.titles.push(r.title);
  if (qid === 'C1-03') p.carrying = false;
  p.quests.done.push(qid);
  p.quests.active = null;
  broadcast({ t: 'sys', text: `🎉 ${p.name} hoàn thành nhiệm vụ [${q.name}]!` });
  refreshQuest(p);
}
// Vật thu thập có hợp với NV đang làm không
function gatherable(p, it) {
  const a = p.quests.active; if (!a) return false;
  if (it.type === 'la') return a.id === 'C1-02' && a.step === 0;
  if (it.type === 'linh-thao' || it.type === 'linh-thao-heo') return a.id === 'C1-04' && a.step === 0;
  if (it.type === 'gieng') return a.id === 'C1-03' && a.step === 0;
  return false;
}
function startInteract(p, id) {
  const it = INTERACTS.find(i => i.id === id);
  if (!it || p.channel) return;
  if (p.collected.includes(id)) return;
  if (Math.hypot(p.x - it.x, p.y - it.y) > 130) { sendTo(p, { t: 'err', text: 'Lại gần hơn đã!' }); return; }
  if (!gatherable(p, it)) { sendTo(p, { t: 'err', text: 'Chưa cần thứ này.' }); return; }
  p.channel = { id, until: Date.now() + 3000 };
  sendTo(p, { t: 'channel', dur: 3000 });
}
function finishInteract(p) {
  const it = INTERACTS.find(i => i.id === p.channel.id);
  p.channel = null;
  if (!it || p.collected.includes(it.id)) return;
  p.collected.push(it.id);
  const a = p.quests.active;
  if (it.type === 'gieng') {
    if (a && a.id === 'C1-03' && a.step === 0) { p.carrying = true; advanceStep(p); }
    sendTo(p, { t: 'sys', text: '💧 Đã lấy nước Linh Tuyền! Gánh về cho Dược Trần Tử (đi chậm).' });
  } else if (it.type === 'la') {
    if (a && a.id === 'C1-02' && a.step === 0) { a.count++; checkObjComplete(p); }
  } else if (it.type === 'linh-thao') {
    if (a && a.id === 'C1-04' && a.step === 0) { a.count++; checkObjComplete(p); }
  } else if (it.type === 'linh-thao-heo') {
    if (a && a.id === 'C1-04' && a.step === 0) {
      a.count = Math.max(0, a.count - 1); // hái nhầm gốc héo: -1
      sendTo(p, { t: 'sys', text: '🥀 Hái nhầm Linh Thảo Héo! (-1)' });
      sendTo(p, { t: 'qprog', active: questInfo(p).active });
    }
  }
  broadcast({ t: 'gathered', id: it.id });
}

// ---------- Boss Thiết Bì Dã Trư (C1-06) ----------
function spawnBoss(x, y, nearP) {
  for (const m of monsters.values()) if (!m.dead && m.boss) return m; // chỉ 1 boss mỗi lúc
  const cfg = { hp: 1500, dmg: 35, tv: 300, ltMin: 20, ltMax: 20, speed: 150, aggro: 9999 };
  const m = { id: midSeq++, type: 'thiet-bi-da-tru', cfg, boss: true, bursted: false,
    x: clamp(x, 200, WORLD_W - 200), y: clamp(y, 200, WORLD_H - 200),
    hp: cfg.hp, maxhp: cfg.hp, state: 'chase', wx: 0, wy: 0, wt: 0,
    target: nearP || null, atkAt: 0, dead: false, respawnAt: 0 };
  monsters.set(m.id, m);
  broadcast({ t: 'sys', text: '🐗 Thiết Bì Dã Trư xuất hiện! Cẩn thận!' });
  return m;
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
  // Bộc phát Hỗn Độn Linh Căn: lần đầu máu boss <30% -> đánh 400 + hất văng
  if (m.boss && !m.bursted && p && m.hp < m.maxhp * 0.3) {
    m.bursted = true;
    m.hp -= 400;
    const a = Math.atan2(m.y - p.y, m.x - p.x);
    m.x = clamp(m.x + Math.cos(a) * 200, 0, WORLD_W);
    m.y = clamp(m.y + Math.sin(a) * 200, 0, WORLD_H);
    broadcast({ t: 'burst', x: Math.round(p.x), y: Math.round(p.y), by: p.name });
    broadcast({ t: 'sys', text: `⚡ Hỗn Độn Linh Căn của ${p.name} bộc phát!` });
  }
  broadcast({ t: 'dmg', mid: m.id, dmg: Math.round(dmg), hp: Math.max(0, Math.ceil(m.hp)), maxhp: m.maxhp });
  if (m.hp <= 0) killMonster(m, p);
}

function killMonster(m, p) {
  m.dead = true; m.respawnAt = Date.now() + (m.boss ? 60000 : 20000);
  const ltGain = m.cfg.ltMin + Math.floor(Math.random() * (m.cfg.ltMax - m.cfg.ltMin + 1));
  if (p && !p.dead) {
    p.lt += ltGain;
    gainTv(p, m.cfg.tv);
    // 15% rơi Hồi Khí Đan
    if (Math.random() < 0.15) { p.potions++; sendTo(p, { t: 'loot', text: '+1 Hồi Khí Đan' }); }
    sendTo(p, { t: 'loot', text: `+${ltGain} linh thạch · +${m.cfg.tv} tu vi` });
  }
  // NV giết quái: mọi player đang làm NV đúng loại quái đều được +1
  for (const pl of players.values()) {
    if (pl.dead || !pl.quests || !pl.quests.active) continue;
    const a = pl.quests.active, q = QUESTS[a.id];
    const o = q && q.objectives[a.step];
    if (o && o.type === 'kill' && o.mob === m.type && a.count < o.count) {
      a.count++;
      checkObjComplete(pl);
    }
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
  if (p.dead || Date.now() < p.protectUntil) return; // bảo hộ tân thủ: không mất máu
  if (Date.now() < p.shieldUntil) dmg *= 0.25; // Kim Chung giảm 75%
  p.hp -= dmg;
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.respawnAt = Date.now() + 5000; p.moving = false;
    p.channel = null; // chết thì hủy thu thập
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
      if (now >= p.respawnAt) { p.dead = false; p.hp = p.maxhp; p.mp = p.maxmp; p.x = WORLD_W/2; p.y = WORLD_H/2; p.protectUntil = Date.now() + 5000; sendTo(p, { t: 'me', you: pubPlayer(p) }); }
      continue;
    }
    if (p.moving && p.tx !== null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = PLAYER_SPEED * (p.carrying ? 0.55 : 1) * dt; // gánh nước đi chậm
      if (d <= step + 2) { p.x = p.tx; p.y = p.ty; p.moving = false; p.tx = p.ty = null; }
      else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    // Thu thập: đủ 3s vận công -> thu
    if (p.channel && now >= p.channel.until) finishInteract(p);
    // Hồi linh lực
    p.mp = Math.min(p.maxmp, p.mp + p.maxmp * 0.04 * dt);
  }

  // Quái AI
  for (const m of monsters.values()) {
    if (m.dead) {
      if (now >= m.respawnAt) {
        if (m.boss) {
          // Boss chỉ respawn nếu còn người chơi đang làm C1-06
          const need = [...players.values()].some(pl => pl.quests && pl.quests.active && pl.quests.active.id === 'C1-06');
          if (need) spawnBoss(SPAWN.x + 300, SPAWN.y + 200, null);
          monsters.delete(m.id);
        } else { const nm = spawnMonster(m.type); monsters.delete(m.id); }
      }
      continue;
    }
    if (m.state === 'idle') {
      m.wt -= dt;
      if (m.wt <= 0) { m.wx = m.x + (Math.random()-0.5)*300; m.wy = m.y + (Math.random()-0.5)*300; m.wt = 2 + Math.random()*3; }
      const dx = m.wx - m.x, dy = m.wy - m.y, d = Math.hypot(dx, dy);
      if (d > 5) { m.x += dx/d * m.cfg.speed*0.4*dt; m.y += dy/d * m.cfg.speed*0.4*dt; }
      // Tìm mục tiêu
      let best = null, bd = m.cfg.aggro;
      for (const p of players.values()) {
        if (p.dead || Date.now() < p.protectUntil) continue;
        if (Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y) < SAFE_R) continue; // vùng an toàn: không chủ động đánh
        const dd = dist(m, p); if (dd < bd) { bd = dd; best = p; }
      }
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

server.listen(PORT, () => console.log(`Thiên Kiêu Lộ P2 chạy ở cổng ${PORT}`));
