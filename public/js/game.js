// Thiên Kiêu Lộ P1 — Client core: net + render + input + effects
(() => {
'use strict';
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const ZOOM = 0.55;                       // zoom xa: nhân vật nhỏ gọn đúng tỉ lệ game thường
const WORLD_W = 80 * 48, WORLD_H = 60 * 48;

let ws, myName = '', players = new Map(), monsters = new Map();
let camX = WORLD_W/2, camY = WORLD_H/2;
let SKILLS = {}, ORDER = [];
let particles = [], dmgNums = [], fxAnims = [];
let zonesFx = []; // P3: vòng trận pháp đang tồn tại trên map
let shake = 0, hitStop = 0; // rung màn hình, khựng khi trúng đòn
// P2: NPC, nhiệm vụ, vật tương tác, auto
let npcs = [], myQuest = { active: null, done: [] };
// 2 map: tông môn (an toàn) + yêu thú (farm)
let myMap = 'tong-mon', portals = [];
let pendingPortal = null, lastPortalSend = 0;
let INTERACTS = new Map(), collected = new Set();
let channelUntil = 0, channelDur = 1;
let pendingTalk = null, pendingInteract = null, pendingAutoTalk = null, lastAutoTalk = 0; // npc/vật đang muốn tới
let autoOn = false, burstFx = null;
const atkAnim = new Map(), castAnim = new Map();   // name -> timestamp kết thúc anim đánh/vận công
const hitFlash = new Map(), hitPop = new Map();    // mid -> timestamp flash/nảy khi trúng đòn
const dyingMobs = new Map();                        // mid -> mob đang ngã xuống (fade out)
const mobAtk = new Map();                           // mid -> timestamp quái đang ra đòn

// ---------- Âm thanh (WebAudio, không cần file) ----------
let AC = null, muted = false;
function beep(freq, dur, type, vol, slideTo) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), AC.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
const SFX = {
  swing() { beep(620, 0.1, 'sawtooth', 0.05, 220); },
  hit()   { beep(170, 0.14, 'square', 0.09, 65); },
  skill() { beep(320, 0.32, 'sawtooth', 0.07, 950); },
  die()   { beep(280, 0.4, 'triangle', 0.09, 75); },
  loot()  { beep(880, 0.12, 'sine', 0.07, 1320); },
  click() { beep(500, 0.05, 'sine', 0.04); },
};

// ---------- Load assets ----------
const IMG = {};
const KEYED = new Set(['walk', 'attack', 'cast', 'm_hac', 'm_xa', 'm_lang',
  'npc_ly', 'npc_tran', 'npc_duoc', 'npc_ho', 'm_boss']); // sprite cần tách nền trắng
function loadImg(key, src) { return new Promise(res => { const i = new Image(); i.onload = () => res(IMG[key] = KEYED.has(key) ? keyOutWhite(i) : i); i.onerror = () => res(null); i.src = src; }); }
// Tách nền trắng: flood-fill từ viền ảnh, chỉ xóa trắng liền với viền (không ăn vào áo trắng nhân vật)
function keyOutWhite(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data, w = c.width, h = c.height;
  const seen = new Uint8Array(w * h), stack = [];
  for (let x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue; seen[p] = 1;
    const i = p * 4;
    if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) continue; // không phải trắng -> dừng
    d[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  g.putImageData(id, 0, 0);
  return c;
}
const ASSETS = [
  ['map', 'assets/map-quang-truong.webp'],
  ['map_yeuthu', 'assets/map-rung-yeu-thu.webp'],
  ['walk', 'assets/nvc-walk.webp'], ['attack', 'assets/nvc-attack.webp'], ['cast', 'assets/nvc-cast.webp'],
  ['m_hac', 'assets/mob-hac-mao-thu.webp'], ['m_xa', 'assets/mob-thanh-truc-xa.webp'], ['m_lang', 'assets/mob-da-hoa-lang.webp'],
  ['npc_ly', 'assets/npc-chap-su-ly.webp'], ['npc_tran', 'assets/npc-lao-tran.webp'],
  ['npc_duoc', 'assets/npc-duoc-tran-tu.webp'], ['npc_ho', 'assets/npc-tieu-ho.webp'],
  ['m_boss', 'assets/mob-thiet-bi-da-tru.webp'],
];
const NPC_IMG = { 'chap-su-ly': 'npc_ly', 'lao-tran': 'npc_tran', 'duoc-tran-tu': 'npc_duoc', 'tieu-ho': 'npc_ho' };
const NPC_PORTRAIT = { 'chap-su-ly': 'assets/npc-chap-su-ly.webp', 'lao-tran': 'assets/npc-lao-tran.webp',
  'duoc-tran-tu': 'assets/npc-duoc-tran-tu.webp', 'tieu-ho': 'assets/npc-tieu-ho.webp' };
const IT_EMOJI = { 'la': '🍂', 'linh-thao': '🌿', 'linh-thao-heo': '🥀', 'gieng': '⛲' };
const ICONS = { 'linh-kiem-tram':'icon-linh-kiem-tram.webp','cuu-loi-kiem':'icon-cuu-loi-kiem.webp','phan-thien-kiem':'icon-phan-thien-kiem.webp','van-kiem-quy-tong':'icon-van-kiem-quy-tong.webp','hon-don-kim-chung':'icon-hon-don-kim-chung.webp','khai-thien-nhat-kiem':'icon-khai-thien-nhat-kiem.webp' };
const MOB_IMG = { 'hac-mao-thu':'m_hac', 'thanh-truc-xa':'m_xa', 'da-hoa-lang':'m_lang', 'thiet-bi-da-tru':'m_boss' };
const SKILL_NAMES = { 'linh-kiem-tram':'Linh Kiếm Trảm','cuu-loi-kiem':'Cửu Lôi Kiếm Quyết','phan-thien-kiem':'Phần Thiên Kiếm','van-kiem-quy-tong':'Vạn Kiếm Quy Tông','hon-don-kim-chung':'Hỗn Độn Kim Chung','khai-thien-nhat-kiem':'Khai Thiên Nhất Kiếm' };
// P3: bậc + Đường (server gửi id, client dịch tên)
const RANKS = { 'tap-vu':'Tạp Vụ','ngoai-mon':'Ngoại Môn','noi-mon':'Nội Môn','hac-tam':'Hạch Tâm','chan-truyen':'Chân Truyền','thien-kieu':'Thiên Kiêu' };
const HALL_NAMES = { 'kiem-cac':'Kiếm Các','than-phu':'Thần Phù','tran-su':'Trận Sư','duoc-vuong':'Dược Vương' };
const HALL_ICONS_UI = { 'kiem-cac':'⚔️','than-phu':'🧧','tran-su':'☯️','duoc-vuong':'🌿' };

// ---------- WebSocket ----------
function connect(name) {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'login', name }));
  ws.onmessage = ev => handle(JSON.parse(ev.data));
  ws.onclose = () => sysMsg('Mất kết nối server. Tải lại trang để vào lại.');
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function handle(m) {
  if (m.t === 'welcome') {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    resize();
    SKILLS = m.skills; ORDER = m.order; players.set(m.you.name, m.you);
    Object.assign(ICONS, m.icons || {}); Object.assign(SKILL_NAMES, m.names || {}); // P3: icon/tên skill theo Đường
    npcs = m.npcs || []; myQuest = m.quest || { active: null, done: [] };
    myMap = m.map || 'tong-mon'; portals = m.portals || [];
    document.getElementById('mapname').textContent = '🗺️ ' + (m.mapName || 'Thanh Huyền Tông');
    document.getElementById('panel-map-name').textContent = m.mapName || 'Thanh Huyền Tông';
    INTERACTS.clear(); (m.interacts || []).forEach(it => INTERACTS.set(it.id, it));
    collected = new Set(m.collected || []);
    UI.buildSkills(); UI.updateMe(m.you); UI.updateQuest();
  } else if (m.t === 'mapchange') { // sang map mới: cập nhật dữ liệu, xóa entity cũ chờ snapshot
    myMap = m.map; npcs = m.npcs || []; portals = m.portals || [];
    document.getElementById('mapname').textContent = '🗺️ ' + (m.mapName || m.map);
    document.getElementById('panel-map-name').textContent = m.mapName || m.map;
    INTERACTS.clear(); (m.interacts || []).forEach(it => INTERACTS.set(it.id, it));
    monsters.clear(); players.clear(); pendingPortal = null;
    dyingMobs.clear(); dmgNums.length = 0; zonesFx.length = 0;
  } else if (m.t === 'snap') {
    const seen = new Set();
    for (const s of m.ps) { seen.add(s.name); players.set(s.name, Object.assign(players.get(s.name) || {}, s)); }
    for (const [k] of players) if (!seen.has(k)) players.delete(k);
    monsters.clear();
    for (const s of m.ms) monsters.set(s.id, s);
    const boss = [...monsters.values()].find(x => x.type === 'thiet-bi-da-tru');
    UI.updateBoss(boss || null);
  } else if (m.t === 'me') {
    players.set(m.you.name, Object.assign(players.get(m.you.name) || {}, m.you));
    UI.updateMe(m.you);
  } else if (m.t === 'fx') spawnFx(m);
  else if (m.t === 'dmg') {
    dmgNums.push({ x: 0, y: 0, mid: m.mid, txt: '-' + m.dmg, life: 1, color: '#ffdf6b' });
    const now = performance.now();
    hitFlash.set(m.mid, now + 150); hitPop.set(m.mid, now + 240); // chớp trắng + nảy lên khi trúng đòn
    hitStop = Math.max(hitStop, 0.07); // khựng 70ms cho có lực
    SFX.hit();
  }
  else if (m.t === 'mdie') {
    const mb = monsters.get(m.mid);
    if (mb) { mb.dying = performance.now() + 450; dyingMobs.set(m.mid, mb); } // ngã xuống fade dần
    monsters.delete(m.mid);
    SFX.die();
  }
  else if (m.t === 'sys') sysMsg(m.text);
  else if (m.t === 'loot') { sysMsg(m.text); SFX.loot(); }
  else if (m.t === 'chat') UI.addChat(m.name, m.text);
  else if (m.t === 'err') sysMsg('⚠️ ' + m.text);
  else if (m.t === 'leave') players.delete(m.name);
  // P2: nhiệm vụ / NPC / thu thập / burst
  else if (m.t === 'dlg') {
    if (pendingAutoTalk === m.npc) { // Auto tự nói chuyện: không mở panel, tự nhận/trả luôn
      pendingAutoTalk = null;
      if (m.canAccept) send({ t: 'accept', quest: m.qid });
      else if (m.canTurnin) send({ t: 'turnin', quest: m.qid });
    } else UI.showDlg(m);
  }
  else if (m.t === 'quest') { myQuest = { active: m.active, done: m.done }; UI.updateQuest(); }
  else if (m.t === 'qprog') { myQuest.active = m.active; UI.updateQuest(); }
  // P3: đổi skill theo Đường, chọn Đường, số hồi máu, trận pháp
  else if (m.t === 'hallskills') {
    SKILLS = m.skills; ORDER = m.order;
    Object.assign(ICONS, m.icons || {}); Object.assign(SKILL_NAMES, m.names || {});
    UI.buildSkills(); UI.updateMe(players.get(myName)); UI.renderChar();
    sysMsg('✨ Đã học bộ công pháp mới! Bấm 1-' + ORDER.length + ' để dùng.');
  }
  else if (m.t === 'canhall') UI.openHall(m.halls);
  else if (m.t === 'healnum') { dmgNums.push({ x: m.x, y: m.y - 60, txt: m.txt, life: 1.2, color: '#7dff9a' }); SFX.loot(); }
  else if (m.t === 'zonefx') zonesFx.push({ x: m.x, y: m.y, r: m.r, until: performance.now() + m.dur * 1000, vis: m.vis });
  else if (m.t === 'gathered') { collected.add(m.id); SFX.loot(); }
  else if (m.t === 'channel') { channelDur = m.dur / 1000 || 3; channelUntil = m.dur > 0 ? performance.now() + m.dur : 0; }
  else if (m.t === 'burst') {
    burstFx = { until: performance.now() + 1200, x: m.x, y: m.y };
    shake = Math.max(shake, 16); SFX.skill();
  }
}

function sysMsg(text) {
  const box = document.getElementById('sysmsg');
  const d = document.createElement('div'); d.textContent = text; box.appendChild(d);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => d.remove(), 5000);
}

// ---------- Hiệu ứng: PHI KIẾM là chủ đạo ----------
function swordParticle(x, y, ang, speed, life, color, size) {
  particles.push({ x, y, vx: Math.cos(ang)*speed, vy: Math.sin(ang)*speed, ang, life, maxLife: life, color, size: size || 26, spin: 0 });
}
// P3: phù lục vàng bay xoay (Thần Phù Đường)
function taliParticle(x, y, ang, speed, life, size) {
  particles.push({ x, y, vx: Math.cos(ang)*speed, vy: Math.sin(ang)*speed, ang, life, maxLife: life, color: '#ffd94a', size: size || 34, tali: true });
}
// P3: đan hỏa xanh bay lên (Dược Vương Đường)
function danParticle(x, y, life, size) {
  particles.push({ x: x + (Math.random()-0.5)*60, y: y + (Math.random()-0.5)*30, vx: (Math.random()-0.5)*50, vy: -140 - Math.random()*80,
    ang: 0, life, maxLife: life, color: Math.random() < 0.5 ? '#7dff9a' : '#3ddc74', size: size || 10, dot: true });
}
function spawnFx(m) {
  const now = performance.now();
  // Kích hoạt animation đánh / vận công của người tung chiêu
  if (m.by) {
    if (m.kind === 'slash') atkAnim.set(m.by, now + 340);
    else if (m.id) castAnim.set(m.by, now + 520);
  }
  // Chớp sáng ở vị trí người tung chiêu — báo hiệu rõ ràng mỗi lần dùng skill
  if (m.id && m.kind !== 'aoe') fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 50, r: 55, life: 0.3, color: '#ffffff' });
  if (m.kind === 'slash') {
    SFX.swing();
    for (let i = 0; i < 5; i++) swordParticle(m.x + (Math.random()-0.5)*50, m.y - 50 + (Math.random()-0.5)*50, m.dir + (Math.random()-0.5)*0.8, 460, 0.35, '#bfe9ff', 36);
  } else if (m.kind === 'bolt' || m.kind === 'stun') { // phi kiếm / phù định thân bay thẳng
    SFX.skill();
    const vis = m.vis || 'sword';
    if (vis === 'talisman') {
      for (let i = -1; i <= 1; i++) taliParticle(m.x, m.y - 50, m.dir + i * 0.13, 950, 0.65, 42);
      fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 50, r: 55, life: 0.25, color: '#ffd94a' });
    } else {
      swordParticle(m.x, m.y - 50, m.dir, 1000, 0.7, '#9fdcff', 62);
      fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 50, r: 55, life: 0.25, color: '#9fdcff' });
    }
  } else if (m.kind === 'aoe' || m.kind === 'rain') { // nổ vùng: kiếm / phù / trận / đan hỏa
    const vis = m.vis || 'sword';
    const n = m.kind === 'rain' ? 34 : 18;
    const col = vis === 'talisman' ? '#ff9d3d' : vis === 'formation' ? '#6adce8' : vis === 'danfire' ? '#3ddc74'
      : (m.id === 'cuu-loi-kiem' ? '#c07dff' : '#ff7a3d');
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, rr = Math.random()*(m.r||120);
      const sx = m.x + Math.cos(a)*rr, sy = m.y + Math.sin(a)*rr - 300;
      if (vis === 'talisman') particles.push({ x: sx, y: sy, vx: (Math.random()-0.5)*60, vy: 900 + Math.random()*300, ang: Math.PI/2.3, life: 0.6, maxLife: 0.6, color: '#ffd94a', size: 36, tali: true });
      else if (vis === 'danfire') particles.push({ x: m.x + (Math.random()-0.5)*(m.r||120)*1.4, y: m.y - Math.random()*60, vx: (Math.random()-0.5)*120, vy: -60 - Math.random()*120, ang: 0, life: 0.7, maxLife: 0.7, color: Math.random()<0.5?'#7dff9a':'#3ddc74', size: 12, dot: true });
      else particles.push({ x: sx, y: sy, vx: (Math.random()-0.5)*60, vy: 900 + Math.random()*300, ang: Math.PI/2.3, life: 0.6, maxLife: 0.6, color: col, size: 36, spin: 0, trail: true });
    }
    fxAnims.push({ kind: vis === 'formation' ? 'bagua' : 'ring', x: m.x, y: m.y, r: m.r || 120, life: 0.5, color: col });
    SFX.skill(); if (UI.settings.shake) shake = Math.max(shake, 7);
  } else if (m.kind === 'nova') {           // Vạn Kiếm / Cửu Cung Bát Quái: bung ra
    const vis = m.vis || 'sword';
    const col = vis === 'formation' ? '#6adce8' : '#8fd8ff';
    for (let i = 0; i < 24; i++) {
      const a = (i/24)*Math.PI*2;
      swordParticle(m.x, m.y, a, 520, 0.55, col, 34);
    }
    fxAnims.push({ kind: vis === 'formation' ? 'bagua' : 'ring', x: m.x, y: m.y, r: m.r, life: 0.6, color: col });
    SFX.skill(); if (UI.settings.shake) shake = Math.max(shake, 9);
  } else if (m.kind === 'line') {           // Khai Thiên: cự kiếm chém dọc đường thẳng
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const d = (m.len/n)*i;
      swordParticle(m.x + Math.cos(m.dir)*d, m.y + Math.sin(m.dir)*d - 30, m.dir, 60, 0.6, '#ffe9a8', 52);
    }
    fxAnims.push({ kind: 'beam', x: m.x, y: m.y, dir: m.dir, len: m.len, w: m.w, life: 0.5, color: '#ffe9a8' });
    SFX.skill(); if (UI.settings.shake) shake = Math.max(shake, 12);
  } else if (m.kind === 'shield') {         // Kim Chung / Thanh Tâm Đan
    const col = (m.vis || 'sword') === 'danfire' ? '#7dff9a' : '#ffd97a';
    fxAnims.push({ kind: 'shield', x: m.x, y: m.y, life: m.dur, color: col });
  } else if (m.kind === 'heal') {
    for (let i = 0; i < 12; i++) danParticle(m.x, m.y, 0.9, 10);
  } else if (m.kind === 'hit') {
    fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 20, r: 26, life: 0.15, color: '#ff5a5a' });
    // Tìm con quái gần nhất đang đánh -> cho nó ra đòn thế đánh
    let bm = null, bd = 130;
    for (const mon of monsters.values()) { const d = Math.hypot(mon.x - m.x, mon.y - m.y); if (d < bd) { bd = d; bm = mon; } }
    if (bm) mobAtk.set(bm.id, performance.now() + 350);
  }
}

// ---------- Render ----------
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize); resize();

// Hàng sprite NVC: 0=xuống, 1=trái, 2=phải, 3=lên (đủ 4 hướng, không cần lật)
function dirRow(dir) {
  const a = ((dir % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  if (a < Math.PI/4 || a >= Math.PI*7/4) return 2;  // phải
  if (a < Math.PI*3/4) return 0;                    // xuống
  if (a < Math.PI*5/4) return 1;                    // trái
  return 3;                                         // lên
}
function drawSheet(img, x, y, row, frame, cols, rows, scale) {
  if (!img) return;
  const fw = img.width / cols, fh = img.height / rows;
  const dw = fw * scale, dh = fh * scale;
  ctx.drawImage(img, (frame % cols) * fw, row * fh, fw, fh, x - dw/2, y - dh, dw, dh);
}
function drawSprite(img, x, y, dir, frame, scale) { drawSheet(img, x, y, dirRow(dir), frame, 4, 4, scale); }
// Sheet đánh: hàng 0=xuống, 1=lên, 2=trái, 3=phải
function atkRow(dir) {
  const a = ((dir % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  if (a >= Math.PI/4 && a < Math.PI*3/4) return 0;   // xuống
  if (a >= Math.PI*5/4 && a < Math.PI*7/4) return 1; // lên
  if (a >= Math.PI*3/4 && a < Math.PI*5/4) return 2; // trái
  return 3;                                          // phải
}
// Sheet quái 3x3: cột 0=đứng 1=chạy 2=đánh · hàng 0=trước 1=sau 2=ngang — thêm squash & stretch cho đỡ "ảnh tĩnh"
function drawMob(img, m, scale) {
  if (!img) return;
  const now = performance.now();
  const bob = Math.sin(walkT * 7 + m.id) * 3;
  const sq = Math.sin(walkT * 9 + m.id * 1.7);          // co giãn nhịp nhàng
  const pop = hitPop.get(m.id) > now ? 1.14 : 1;        // nảy lên khi trúng đòn
  ctx.save();
  ctx.translate(m.rx, m.ry + bob);
  ctx.rotate(Math.sin(walkT * 5 + m.id) * 0.035);        // lắc nhẹ
  if (hitFlash.get(m.id) > now) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 26; } // chớp trắng khi trúng đòn
  if (m.type === 'thiet-bi-da-tru') { // boss: 1 frame, vẽ cao ~170px
    const k = 170 / img.height, dw = img.width * k, dh = 170;
    ctx.drawImage(img, -dw/2, -dh, dw, dh);
    ctx.restore();
    return;
  }
  const fw = img.width / 3, fh = img.height / 3;
  const col = (mobAtk.get(m.id) > now) ? 2 : (m.moving ? 1 : 0); // tự đổi thế: đánh / chạy / đứng
  const dw = fw * scale * (1 - sq * 0.03) * pop, dh = fh * scale * (1 + sq * 0.045) * pop;
  ctx.drawImage(img, fw * col, 0, fw, fh, -dw/2, -dh, dw, dh);
  ctx.restore();
}

let lastT = 0, walkT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
  if (hitStop > 0) { hitStop -= dt; dt *= 0.08; } // khựng khi trúng đòn
  walkT += dt;
  if (shake > 0.3) shake *= Math.pow(0.002, dt); else shake = 0; // rung màn hình tắt dần
  const me = players.get(myName);
  if (!me) return;
  // NỘI SUY CHUYỂN ĐỘNG: server gửi 20Hz, render 60fps — lerp để đi/đánh mượt, không giật từng bước
  const kk = Math.min(1, dt * 10);
  for (const p of players.values()) {
    if (p.rx === undefined) { p.rx = p.x; p.ry = p.y; }
    p.rx += (p.x - p.rx) * kk; p.ry += (p.y - p.ry) * kk;
  }
  for (const m of monsters.values()) {
    if (m.rx === undefined) { m.rx = m.x; m.ry = m.y; }
    const mdx = m.x - m.rx, mdy = m.y - m.ry;
    m.moving = Math.hypot(mdx, mdy) > 4;
    m.rx += mdx * kk; m.ry += mdy * kk;
  }
  // Camera theo nhân vật (+ rung)
  camX += (me.rx - camX) * Math.min(1, dt * 6);
  camY += (me.ry - camY) * Math.min(1, dt * 6);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false; // pixel art: giữ nét gai, không làm mịn
  ctx.translate(cv.width/2 + (Math.random()-0.5)*shake, cv.height/2 + (Math.random()-0.5)*shake);
  ctx.scale(ZOOM, ZOOM); ctx.translate(-camX, -camY);

  const vx0 = camX - cv.width/2/ZOOM - 100, vx1 = camX + cv.width/2/ZOOM + 100;
  const vy0 = camY - cv.height/2/ZOOM - 100, vy1 = camY + cv.height/2/ZOOM + 100;
  const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

  // Map theo map hiện tại
  const mapImg = myMap === 'yeu-thu' ? IMG.map_yeuthu : IMG.map;
  if (mapImg) ctx.drawImage(mapImg, 0, 0, WORLD_W, WORLD_H);

  // Gom entity trong tầm nhìn, XẾP THEO Y (đứng dưới vẽ sau = đè lên đúng như game thường)
  const shadow = (x, y, rx) => { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 3, rx, rx * 0.32, 0, 0, Math.PI*2); ctx.fill(); };
  const draws = [];
  for (const m of monsters.values()) {
    if (!inView(m.rx, m.ry)) continue;
    draws.push({ y: m.ry, f: () => {
      const isBoss = m.type === 'thiet-bi-da-tru';
      shadow(m.rx, m.ry, isBoss ? 52 : 30);
      if (m.slow) { // P3: làm chậm — vòng xanh dưới chân
        ctx.strokeStyle = 'rgba(106,220,232,.8)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(m.rx, m.ry + 3, 34, 12, 0, 0, Math.PI*2); ctx.stroke();
      }
      drawMob(IMG[MOB_IMG[m.type]], m, 0.28);
      if (m.stun) { // P3: choáng — sao xoay trên đầu
        ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('✨', m.rx + Math.sin(walkT * 6) * 14, (isBoss ? m.ry - 215 : m.ry - 128));
      }
      const bw = isBoss ? 110 : 48, by = isBoss ? m.ry - 205 : m.ry - 118;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(m.rx - bw/2, by, bw, 6);
      ctx.fillStyle = isBoss ? '#f80' : '#e33'; ctx.fillRect(m.rx - bw/2, by, bw * (m.hp / m.maxhp), 6);
      if (isBoss) { ctx.fillStyle = '#ffb060'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🐗 Thiết Bì Dã Trư', m.rx, by - 8); }
    }});
  }
  // NPC Chương 1: vẽ 1 frame + tên + marker !/? (chỉ NPC cùng map)
  {
    const meQ = players.get(myName);
    for (const n of npcs) {
      if (n.map !== myMap || !inView(n.x, n.y)) continue;
      draws.push({ y: n.y, f: () => {
        const img = IMG[NPC_IMG[n.id]];
        shadow(n.x, n.y, 26);
        let dh = 150;
        if (img) { const sc = 150 / img.height, dw = img.width * sc; dh = 150; ctx.drawImage(img, n.x - dw/2, n.y - dh, dw, dh); }
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe9b0'; ctx.font = '13px sans-serif';
        ctx.fillText(n.name, n.x, n.y - dh - 34);
        const mk = meQ && meQ.qm && meQ.qm[n.id];
        if (mk) { // marker vàng nảy nhẹ
          ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ffd94a';
          ctx.shadowColor = '#ffd94a'; ctx.shadowBlur = 8;
          ctx.fillText(mk, n.x, n.y - dh - 58 + Math.sin(walkT * 5) * 4);
          ctx.shadowBlur = 0;
        }
      }});
    }
  }
  // Cổng truyền tống: vòng cyan puls + emoji 🌀 + tên map đích
  for (const pt of portals) {
    if (!inView(pt.x, pt.y)) continue;
    draws.push({ y: pt.y, f: () => {
      const pulse = 1 + Math.sin(walkT * 4) * 0.12;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,230,255,.9)'; ctx.lineWidth = 4;
      ctx.shadowColor = '#66aaff'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(pt.x, pt.y - 30, 34 * pulse, 0, Math.PI*2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = '36px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🌀', pt.x, pt.y - 16);
      ctx.fillStyle = '#bfe9ff'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(pt.label || '', pt.x, pt.y + 28);
      ctx.restore();
    }});
  }
  // Vật tương tác: lá / thảo / giếng (vẽ emoji)
  for (const it of INTERACTS.values()) {
    if (collected.has(it.id) || !inView(it.x, it.y)) continue;
    draws.push({ y: it.y, f: () => {
      ctx.font = '30px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(IT_EMOJI[it.type] || '❔', it.x, it.y - 6);
    }});
  }
  // Quái đang ngã xuống: mờ dần rồi biến mất
  {
    const nowD = performance.now();
    for (const [id, m] of dyingMobs) {
      const left = m.dying - nowD;
      if (left <= 0) { dyingMobs.delete(id); continue; }
      if (m.rx === undefined) { m.rx = m.x; m.ry = m.y; }
      if (!inView(m.rx, m.ry)) continue;
      draws.push({ y: m.ry, f: () => {
        ctx.save(); ctx.globalAlpha = Math.max(0, left / 450);
        drawMob(IMG[MOB_IMG[m.type]], m, 0.28);
        ctx.restore();
      }});
    }
  }
  for (const p of players.values()) {
    if (!inView(p.rx, p.ry) || p.dead) continue;
    draws.push({ y: p.ry, f: () => {
      const isMe = p.name === myName;
      const ph = p.name.charCodeAt(0) || 0;
      const now = performance.now();
      shadow(p.rx, p.ry, 26);
      const aEnd = atkAnim.get(p.name) || 0, cEnd = castAnim.get(p.name) || 0;
      if (cEnd > now) {            // vận công tung skill
        const fr = Math.min(3, Math.floor((520 - (cEnd - now)) / 100));
        drawSheet(IMG.cast, p.rx, p.ry, dirRow(p.dir), fr, 4, 4, 0.3);
      } else if (aEnd > now) {     // chém đánh thường
        const fr = Math.min(3, Math.floor((340 - (aEnd - now)) / 85));
        drawSheet(IMG.attack, p.rx, p.ry, atkRow(p.dir), fr, 4, 4, 0.3);
      } else {
        const fr = p.moving ? Math.floor(walkT * 12) % 4 : 0;
        const bobY = p.moving ? 0 : Math.sin(walkT * 2.5 + ph) * 2.5; // đứng yên cũng nhún nhẹ
        drawSprite(IMG.walk, p.rx, p.ry + bobY, p.dir, fr, 0.3);
      }
      if (p.moving && isMe && Math.random() < 0.22) { // bụi bay ở chân khi chạy
        particles.push({ x: p.rx + (Math.random()-0.5)*22, y: p.ry - 3, vx: (Math.random()-0.5)*36, vy: -24 - Math.random()*36, ang: 0, life: 0.45, maxLife: 0.45, color: 'rgba(190,180,160,0.7)', size: 9, dot: true });
      }
      if (p.shield) { // vòng kim chung quanh người
        ctx.strokeStyle = 'rgba(255,217,122,.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.rx, p.ry - 52, 38 + Math.sin(walkT*6)*2, 0, Math.PI*2); ctx.stroke();
      }
      if (isMe && channelUntil > performance.now()) { // vòng tiến độ thu thập
        const pr = 1 - (channelUntil - performance.now()) / (channelDur * 1000);
        ctx.strokeStyle = 'rgba(125,255,154,.95)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.rx, p.ry - 60, 26, -Math.PI/2, -Math.PI/2 + Math.max(0, Math.min(1, pr)) * Math.PI*2); ctx.stroke();
      }
      ctx.fillStyle = isMe ? '#7dff9a' : '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.name, p.rx, p.ry - 126);
      if (p.rank && p.rank !== 'tap-vu') { // P3: bậc + Đường trên tên
        ctx.fillStyle = '#9fd8ff'; ctx.font = '10px sans-serif';
        const hn = HALL_NAMES[p.hall] || '';
        ctx.fillText(`${RANKS[p.rank] || ''}${p.hallChosen && hn ? ' · ' + hn : ''}`, p.rx, p.ry - 141);
      }
      // Thanh máu trên đầu (mình: xanh lá, người khác: đỏ) — như game thường
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.rx - 24, p.ry - 118, 48, 5);
      ctx.fillStyle = isMe ? '#5f5' : '#e33'; ctx.fillRect(p.rx - 24, p.ry - 118, 48 * Math.max(0, p.hp / p.maxhp), 5);
    }});
  }
  draws.sort((a, b) => a.y - b.y).forEach(d => d.f());

  // Hiệu ứng phi kiếm
  for (const pt of particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
    const a = Math.max(0, pt.life / pt.maxLife);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(pt.x, pt.y); ctx.rotate(pt.ang);
    if (pt.dot) { ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(0, 0, pt.size/2, 0, Math.PI*2); ctx.fill(); }
    else if (pt.tali) { // phù vàng xoay bay
      ctx.rotate(Math.sin(pt.life * 22) * 0.6);
      ctx.fillStyle = pt.color; ctx.shadowColor = '#ff9d3d'; ctx.shadowBlur = 10;
      const s = pt.size;
      ctx.fillRect(-s/2, -s/3, s, s*2/3);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-s/7, -s/4, s*2/7, s/2); // ấn đỏ giữa phù
      ctx.strokeStyle = '#8a6d1c'; ctx.lineWidth = 2; ctx.strokeRect(-s/2, -s/3, s, s*2/3);
    }
    else {
      // Vẽ phi kiếm: thân kiếm + chuôi
      ctx.fillStyle = pt.color; ctx.shadowColor = pt.color; ctx.shadowBlur = 12;
      const s = pt.size;
      ctx.beginPath(); ctx.moveTo(s/2, 0); ctx.lineTo(-s/6, -s/7); ctx.lineTo(-s/2, 0); ctx.lineTo(-s/6, s/7); ctx.closePath(); ctx.fill();
      ctx.fillRect(-s/2 - 3, -2, 6, 4);
    }
    ctx.restore();
  }
  particles = particles.filter(p => p.life > 0);

  for (const f of fxAnims) {
    f.life -= dt; const a = Math.max(0, f.life);
    ctx.save(); ctx.globalAlpha = Math.min(1, a * 2);
    if (f.kind === 'ring') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 4; ctx.shadowColor = f.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * (1.2 - a), f.r * 0.55 * (1.2 - a), 0, 0, Math.PI*2); ctx.stroke();
    } else if (f.kind === 'bagua') { // P3: trận đồ bát quái dưới đất
      const r = f.r * (1.15 - a * 0.15);
      ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.shadowColor = f.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.55, 0, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(f.x, f.y, r * 0.55, r * 0.3, 0, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = f.color; // 8 vạch quẻ quanh vòng
      for (let i = 0; i < 8; i++) {
        const qa = (i / 8) * Math.PI * 2 + walkT * 0.8;
        ctx.fillRect(f.x + Math.cos(qa) * r * 0.78 - 4, f.y + Math.sin(qa) * r * 0.43 - 2, 8, 4);
      }
    } else if (f.kind === 'flash') {
      ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * a * 3, 0, Math.PI*2); ctx.fill();
    } else if (f.kind === 'beam') {
      ctx.translate(f.x, f.y); ctx.rotate(f.dir);
      const g = ctx.createLinearGradient(0, 0, f.len, 0);
      g.addColorStop(0, f.color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.shadowColor = f.color; ctx.shadowBlur = 30;
      ctx.fillRect(0, -f.w/2 * a, f.len, f.w * a);
    } else if (f.kind === 'shield') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.shadowColor = f.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(f.x, f.y - 52, 38, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(f.x, f.y - 52, 38, 0, Math.PI*2); ctx.fillStyle = f.color; ctx.fill();
    } else if (f.kind === 'click') { // vòng ripple chỗ bấm — thấy ngay bấm có ăn không
      const pr = 1 - f.life / 0.35;
      ctx.strokeStyle = 'rgba(255,233,168,.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + pr * 36, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha *= 0.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, Math.PI*2); ctx.fillStyle = '#ffe9a8'; ctx.fill();
    }
    ctx.restore();
  }
  fxAnims = fxAnims.filter(f => f.life > 0);

  // P3: vòng trận pháp tồn tại theo thời gian (mờ dần)
  {
    const zn = performance.now();
    zonesFx = zonesFx.filter(z => z.until > zn);
    for (const z of zonesFx) {
      if (!inView(z.x, z.y)) continue;
      const a = Math.min(1, (z.until - zn) / 2000);
      ctx.save(); ctx.globalAlpha = 0.3 + 0.5 * a;
      ctx.strokeStyle = '#6adce8'; ctx.lineWidth = 3; ctx.shadowColor = '#6adce8'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * 0.55, z.r * 0.3, 0, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#6adce8';
      for (let i = 0; i < 8; i++) {
        const qa = (i / 8) * Math.PI * 2 + walkT * 0.6;
        ctx.fillRect(z.x + Math.cos(qa) * z.r * 0.78 - 4, z.y + Math.sin(qa) * z.r * 0.43 - 2, 8, 4);
      }
      ctx.restore();
    }
  }

  // Số sát thương
  ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif';
  for (const d of dmgNums) {
    d.life -= dt * 1.2;
    const m = monsters.get(d.mid);
    const x = m && m.rx !== undefined ? m.rx : d.x, y = (m && m.ry !== undefined ? m.ry : d.y) - 70 - (1 - d.life) * 40;
    ctx.globalAlpha = Math.max(0, d.life);
    ctx.fillStyle = d.color; ctx.fillText(d.txt, x, y);
    ctx.globalAlpha = 1;
  }
  dmgNums = dmgNums.filter(d => d.life > 0);

  ctx.restore();
  // Cinematic bộc phát Hỗn Độn Linh Căn: tối màn hình + 5 luồng sáng ngũ hành xoay + flash trắng
  if (burstFx) {
    const left = burstFx.until - performance.now();
    if (left <= 0) burstFx = null;
    else {
      const pr = 1 - left / 1200;
      ctx.fillStyle = `rgba(2,2,12,${0.55 * (1 - pr)})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      const px = (burstFx.x - camX) * ZOOM + cv.width / 2, py = (burstFx.y - camY) * ZOOM + cv.height / 2;
      const cols = ['#ff5a5a', '#ffd94a', '#7dff9a', '#6ab8ff', '#c07dff'];
      for (let i = 0; i < 5; i++) {
        const a = pr * 7 + i * Math.PI * 2 / 5, r = 50 + pr * 170;
        ctx.strokeStyle = cols[i]; ctx.lineWidth = 5; ctx.shadowColor = cols[i]; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(px, py, r, a, a + 1.3); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.75 - pr)})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  }
  UI.drawMinimap();
  // Overlay hồi sinh khi ngã xuống
  const deadEl = document.getElementById('dead-overlay');
  if (me.dead) {
    if (!deadSince) deadSince = performance.now();
    deadEl.style.display = 'flex';
    document.getElementById('dead-count').textContent = Math.ceil(Math.max(0, 5 - (performance.now() - deadSince) / 1000));
  } else { deadSince = 0; deadEl.style.display = 'none'; }
  // Tự động đánh khi đã chạy đủ gần quái được chọn
  if (pendingAtk && me && !me.dead) {
    const m = monsters.get(pendingAtk);
    if (!m) pendingAtk = null;
    else if (Math.hypot(m.x - me.x, m.y - me.y) < 110) { send({ t: 'attack' }); pendingAtk = null; }
    else if (!me.moving) send({ t: 'move', x: Math.round(m.x), y: Math.round(m.y) });
  }
  // Tự nói chuyện khi đã lại gần NPC
  if (pendingTalk && me && !me.dead) {
    const n = npcs.find(x => x.id === pendingTalk);
    if (!n) pendingTalk = null;
    else if (Math.hypot(n.x - me.x, n.y - me.y) < 130) { send({ t: 'talk', npc: n.id }); pendingTalk = null; }
    else if (!me.moving) send({ t: 'move', x: Math.round(n.x), y: Math.round(n.y + 60) });
  }
  // Tự thu thập khi đã lại gần vật
  if (pendingInteract && me && !me.dead) {
    const it = INTERACTS.get(pendingInteract);
    if (!it || collected.has(it.id)) pendingInteract = null;
    else if (Math.hypot(it.x - me.x, it.y - me.y) < 130) { send({ t: 'interact', id: it.id }); pendingInteract = null; }
    else if (!me.moving) send({ t: 'move', x: Math.round(it.x), y: Math.round(it.y) });
  }
  // Tự qua cổng khi đã lại gần
  if (pendingPortal && me && !me.dead) {
    const pt = portals.find(x => x.id === pendingPortal);
    if (!pt) pendingPortal = null;
    else if (Math.hypot(pt.x - me.x, pt.y - me.y) < 130) {
      const now = Date.now();
      if (now - lastPortalSend > 2000) { lastPortalSend = now; send({ t: 'portal', id: pt.id }); }
      pendingPortal = null;
    }
    else if (!me.moving) send({ t: 'move', x: Math.round(pt.x), y: Math.round(pt.y) });
  }
}

// ---------- Input ----------
let pendingAtk = null; // id quái đang muốn đánh -> tự chạy lại gần rồi đánh
let deadSince = 0;     // lúc bắt đầu chết (đếm ngược hồi sinh)
cv.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('mutebtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  muted = !muted;
  UI.settings.sound = !muted;
  document.getElementById('mutebtn').textContent = muted ? '🔇' : '🔊';
});
// Dùng pointerdown để cả chuột và chạm màn hình đều ăn
cv.addEventListener('pointerdown', e => {
  if (e.button === 2) return;
  SFX.click();
  setAuto(false); // bấm tay thì tắt Auto
  const wx = camX + (e.clientX - cv.width/2) / ZOOM;
  const wy = camY + (e.clientY - cv.height/2) / ZOOM;
  fxAnims.push({ kind: 'click', x: wx, y: wy, life: 0.35 }); // ripple báo đã nhận lệnh
  pendingAtk = null; pendingTalk = null; pendingInteract = null; pendingAutoTalk = null; pendingPortal = null;
  // 1. Click NPC -> lại gần rồi nói chuyện
  let bn = null, bd = 70 / ZOOM;
  for (const n of npcs) { const d = Math.hypot(n.x - wx, n.y - wy); if (d < bd) { bd = d; bn = n; } }
  if (bn) {
    pendingTalk = bn.id;
    send({ t: 'move', x: Math.round(bn.x), y: Math.round(bn.y + 60) });
    return;
  }
  // 2. Click vật tương tác -> lại gần rồi thu thập
  let bi = null, id2 = 70 / ZOOM;
  for (const it of INTERACTS.values()) {
    if (collected.has(it.id)) continue;
    const d = Math.hypot(it.x - wx, it.y - wy); if (d < id2) { id2 = d; bi = it; }
  }
  if (bi) {
    pendingInteract = bi.id;
    send({ t: 'move', x: Math.round(bi.x), y: Math.round(bi.y) });
    return;
  }
  // 2b. Click cổng -> lại gần rồi chuyển map
  let bp = null, pd = 80 / ZOOM;
  for (const pt of portals) { const d = Math.hypot(pt.x - wx, pt.y - wy); if (d < pd) { pd = d; bp = pt; } }
  if (bp) {
    pendingPortal = bp.id;
    send({ t: 'move', x: Math.round(bp.x), y: Math.round(bp.y) });
    return;
  }
  // 3. Click trúng quái -> tự chạy lại gần rồi đánh (như game thường)
  let best = null, md = 80 / ZOOM;
  for (const m of monsters.values()) { const d = Math.hypot(m.x - wx, m.y - wy); if (d < md) { md = d; best = m; } }
  if (best) {
    pendingAtk = best.id;
    send({ t: 'move', x: Math.round(best.x), y: Math.round(best.y) });
    return;
  }
  send({ t: 'move', x: Math.round(wx), y: Math.round(wy) });
});
addEventListener('keydown', e => {
  if (document.getElementById('game').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (UI.chatOpen()) { // đang gõ chat: Enter gửi, Esc đóng
    if (e.key === 'Enter') UI.closeChat(true);
    else if (e.key === 'Escape') UI.closeChat(false);
    return;
  }
  if (k >= '1' && k <= '6') { const id = ORDER[+k - 1]; if (id) { setAuto(false); UI.trySkill(id); } }
  else if (k === 'q') { setAuto(false); send({ t: 'potion' }); }
  else if (k === 'c') UI.togglePanel('panel-char');
  else if (k === 'b') UI.togglePanel('panel-bag');
  else if (k === 'm') UI.togglePanel('panel-map');
  else if (k === 'n') UI.togglePanel('panel-quest');
  else if (k === 't') setAuto(!autoOn);
  else if (k === 'enter') UI.openChat();
  else if (k === 'escape') UI.closePanels();
});
// Nút menu UI (mobile)
document.getElementById('menubtns').addEventListener('pointerdown', e => {
  const b = e.target.closest('button'); if (!b) return;
  e.stopPropagation();
  if (b.id === 'chatbtn') UI.openChat();
  else UI.togglePanel(b.dataset.p);
});
document.querySelectorAll('.p-x').forEach(x => x.addEventListener('pointerdown', e => { e.stopPropagation(); UI.closePanels(); }));
document.getElementById('chatinput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') UI.closeChat(true);
  else if (e.key === 'Escape') UI.closeChat(false);
});
function applySetting(k, v) {
  if (k === 'sound') { muted = !v; document.getElementById('mutebtn').textContent = v ? '🔊' : '🔇'; }
}

// ---------- Auto: tự động tu luyện + tự nhận/trả nhiệm vụ ----------
function setAuto(v) {
  autoOn = v;
  if (!v) pendingAutoTalk = null;
  const b = document.getElementById('autobtn');
  if (b) b.classList.toggle('on', v);
}
document.getElementById('autobtn').addEventListener('pointerdown', e => { e.stopPropagation(); SFX.click(); setAuto(!autoOn); });
setInterval(() => { // vòng auto 400ms
  if (!autoOn) return;
  const me = players.get(myName);
  if (!me || me.dead) return;
  if (UI.chatOpen() || document.querySelector('.panel.open')) return; // đang chat / mở panel thì nghỉ
  if (me.hp < me.maxhp * 0.3 && me.potions > 0) { send({ t: 'potion' }); return; } // tự uống đan
  const qm = me.qm || {}, act = myQuest && myQuest.active;
  const nearNpc = n => Math.hypot(n.x - me.x, n.y - me.y) < 130;
  const goNpc = n => send({ t: 'move', x: Math.round(n.x), y: Math.round(n.y) });
  const autoTalk = n => {
    const now = Date.now();
    if (pendingAutoTalk !== n.id && now - lastAutoTalk > 3000) { pendingAutoTalk = n.id; lastAutoTalk = now; send({ t: 'talk', npc: n.id }); }
  };
  // Đi qua cổng sang map đích (dùng cho Auto) — trả về true nếu đã xử lý
  const goToMap = targetMap => {
    if (targetMap === myMap) return false;
    const pt = portals.find(x => x.to === targetMap);
    if (!pt) return false;
    if (Math.hypot(pt.x - me.x, pt.y - me.y) < 130) {
      const now = Date.now();
      if (now - lastPortalSend > 2000) { lastPortalSend = now; send({ t: 'portal', id: pt.id }); }
    } else send({ t: 'move', x: Math.round(pt.x), y: Math.round(pt.y) });
    return true;
  };
  // 1. NV: tìm NPC mục tiêu (trả '?' -> nhận '!' -> nói chuyện theo mục tiêu)
  let qNpc = null, qKind = null;
  if (act && act.done) { const n = npcs.find(x => qm[x.id] === '?'); if (n) { qNpc = n; qKind = 'turnin'; } }
  if (!qNpc && !act) { const n = npcs.find(x => qm[x.id] === '!'); if (n) { qNpc = n; qKind = 'accept'; } }
  if (!qNpc && act && !act.done && act.talkNpc) { const n = npcs.find(x => x.id === act.talkNpc); if (n) { qNpc = n; qKind = 'talk'; } }
  if (qNpc) {
    // Chỉ tự qua map khác khi đi TRẢ nhiệm vụ ('?'); nhận/nói chuyện thì để người chơi tự đi (đỡ bị lôi đi farm giữa chừng)
    if (qNpc.map !== myMap && qKind !== 'turnin') qNpc = null;
  }
  if (qNpc) {
    if (qNpc.map !== myMap) { goToMap(qNpc.map); return; } // qua cổng trả NV
    if (qKind === 'turnin') { if (nearNpc(qNpc)) send({ t: 'turnin', quest: act.id }); else goNpc(qNpc); return; }
    if (nearNpc(qNpc)) autoTalk(qNpc); else goNpc(qNpc);
    return;
  }
  // 2. Farm: không có NV cần làm và map hiện tại hết quái -> sang Yêu Thú Sơn Mạch
  let best = null, bd = 1000;
  for (const m of monsters.values()) { const d = Math.hypot(m.x - me.x, m.y - me.y); if (d < bd) { bd = d; best = m; } }
  if (!best && myMap !== 'yeu-thu') { goToMap('yeu-thu'); return; }
  if (!best) return;
  if (bd > 110) send({ t: 'move', x: Math.round(best.x), y: Math.round(best.y) });
  else send({ t: 'attack' });
}, 400);

// ---------- Khởi động ----------
document.getElementById('join-btn').onclick = async () => {
  const btn = document.getElementById('join-btn');
  const name = document.getElementById('name-input').value.trim();
  if (!name) { alert('Nhập đạo hiệu đã bạn ơi'); return; }
  myName = name; btn.disabled = true; btn.textContent = 'Đang tải...';
  resize();
  for (const [k, s] of ASSETS) await loadImg(k, s);
  for (const [id, f] of Object.entries(ICONS)) await loadImg('ic_' + id, 'assets/' + f);
  connect(name);
  requestAnimationFrame(loop);
};
window.__game = { get myName() { return myName; }, players, monsters, send, applySetting, setAuto,
  get quest() { return myQuest; }, get npcs() { return npcs; }, NPC_PORTRAIT,
  get myMap() { return myMap; }, get portals() { return portals; },
  SKILL_NAMES, get ICONS() { return ICONS; }, get RANKS() { return RANKS; },
  get HALL_NAMES() { return HALL_NAMES; }, get HALL_ICONS_UI() { return HALL_ICONS_UI; },
  get SKILLS() { return SKILLS; }, get ORDER() { return ORDER; } };
})();
