// Thiên Kiêu Lộ P1 — Client core: net + render + input + effects
(() => {
'use strict';
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const ZOOM = 0.7;                       // chuẩn VLTK: nhìn rộng, nhân vật gọn
const WORLD_W = 80 * 48, WORLD_H = 60 * 48;

let ws, myName = '', players = new Map(), monsters = new Map();
let camX = WORLD_W/2, camY = WORLD_H/2;
let SKILLS = {}, ORDER = [];
let particles = [], dmgNums = [], fxAnims = [];

// ---------- Load assets ----------
const IMG = {};
const KEYED = new Set(['walk', 'attack', 'cast', 'm_hac', 'm_xa', 'm_lang']); // sprite cần tách nền trắng
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
  ['walk', 'assets/nvc-walk.webp'], ['attack', 'assets/nvc-attack.webp'], ['cast', 'assets/nvc-cast.webp'],
  ['m_hac', 'assets/mob-hac-mao-thu.webp'], ['m_xa', 'assets/mob-thanh-truc-xa.webp'], ['m_lang', 'assets/mob-da-hoa-lang.webp'],
];
const ICONS = { 'linh-kiem-tram':'icon-linh-kiem-tram.webp','cuu-loi-kiem':'icon-cuu-loi-kiem.webp','phan-thien-kiem':'icon-phan-thien-kiem.webp','van-kiem-quy-tong':'icon-van-kiem-quy-tong.webp','hon-don-kim-chung':'icon-hon-don-kim-chung.webp','khai-thien-nhat-kiem':'icon-khai-thien-nhat-kiem.webp' };
const MOB_IMG = { 'hac-mao-thu':'m_hac', 'thanh-truc-xa':'m_xa', 'da-hoa-lang':'m_lang' };
const SKILL_NAMES = { 'linh-kiem-tram':'Linh Kiếm Trảm','cuu-loi-kiem':'Cửu Lôi Kiếm Quyết','phan-thien-kiem':'Phần Thiên Kiếm','van-kiem-quy-tong':'Vạn Kiếm Quy Tông','hon-don-kim-chung':'Hỗn Độn Kim Chung','khai-thien-nhat-kiem':'Khai Thiên Nhất Kiếm' };

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
    SKILLS = m.skills; ORDER = m.order; players.set(m.you.name, m.you);
    UI.buildSkills(); UI.updateMe(m.you);
  } else if (m.t === 'snap') {
    const seen = new Set();
    for (const s of m.ps) { seen.add(s.name); players.set(s.name, Object.assign(players.get(s.name) || {}, s)); }
    for (const [k] of players) if (!seen.has(k)) players.delete(k);
    monsters.clear();
    for (const s of m.ms) monsters.set(s.id, s);
  } else if (m.t === 'me') {
    players.set(m.you.name, Object.assign(players.get(m.you.name) || {}, m.you));
    UI.updateMe(m.you);
  } else if (m.t === 'fx') spawnFx(m);
  else if (m.t === 'dmg') { dmgNums.push({ x: 0, y: 0, mid: m.mid, txt: '-' + m.dmg, life: 1, color: '#ffdf6b' }); }
  else if (m.t === 'mdie') monsters.delete(m.mid);
  else if (m.t === 'sys') sysMsg(m.text);
  else if (m.t === 'loot') sysMsg(m.text);
  else if (m.t === 'err') sysMsg('⚠️ ' + m.text);
  else if (m.t === 'leave') players.delete(m.name);
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
function spawnFx(m) {
  const P = id => { const p = players.get(id); return p; };
  if (m.kind === 'slash') {
    for (let i = 0; i < 3; i++) swordParticle(m.x + (Math.random()-0.5)*40, m.y + (Math.random()-0.5)*40, m.dir + (Math.random()-0.5)*0.8, 420, 0.28, '#bfe9ff', 30);
  } else if (m.kind === 'bolt') {           // Linh Kiếm Trảm: phi kiếm bay thẳng
    swordParticle(m.x, m.y - 20, m.dir, 900, 0.5, '#9fdcff', 44);
    fxAnims.push({ kind: 'flash', x: m.x, y: m.y, r: 40, life: 0.2, color: '#9fdcff' });
  } else if (m.kind === 'aoe') {            // Cửu Lôi / Phần Thiên: mưa phi kiếm
    const col = m.id === 'cuu-loi-kiem' ? '#c07dff' : '#ff7a3d';
    for (let i = 0; i < 14; i++) {
      const a = Math.random()*Math.PI*2, rr = Math.random()*(m.r||120);
      const sx = m.x + Math.cos(a)*rr, sy = m.y + Math.sin(a)*rr - 260;
      particles.push({ x: sx, y: sy, vx: (Math.random()-0.5)*60, vy: 900 + Math.random()*300, ang: Math.PI/2.3, life: 0.45, maxLife: 0.45, color: col, size: 30, spin: 0, trail: true });
    }
    fxAnims.push({ kind: 'ring', x: m.x, y: m.y, r: m.r || 120, life: 0.5, color: col });
  } else if (m.kind === 'nova') {           // Vạn Kiếm Quy Tông: vòng phi kiếm bung ra
    for (let i = 0; i < 24; i++) {
      const a = (i/24)*Math.PI*2;
      swordParticle(m.x, m.y, a, 520, 0.55, '#8fd8ff', 34);
    }
    fxAnims.push({ kind: 'ring', x: m.x, y: m.y, r: m.r, life: 0.6, color: '#8fd8ff' });
  } else if (m.kind === 'line') {           // Khai Thiên: cự kiếm chém dọc đường thẳng
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const d = (m.len/n)*i;
      swordParticle(m.x + Math.cos(m.dir)*d, m.y + Math.sin(m.dir)*d - 30, m.dir, 60, 0.6, '#ffe9a8', 52);
    }
    fxAnims.push({ kind: 'beam', x: m.x, y: m.y, dir: m.dir, len: m.len, w: m.w, life: 0.5, color: '#ffe9a8' });
  } else if (m.kind === 'shield') {         // Kim Chung: chuông vàng
    fxAnims.push({ kind: 'shield', x: m.x, y: m.y, life: m.dur, color: '#ffd97a' });
  } else if (m.kind === 'heal') {
    for (let i = 0; i < 10; i++) particles.push({ x: m.x + (Math.random()-0.5)*50, y: m.y + (Math.random()-0.5)*30, vx: (Math.random()-0.5)*40, vy: -120 - Math.random()*60, ang: 0, life: 0.8, maxLife: 0.8, color: '#7dff9a', size: 8, dot: true });
  } else if (m.kind === 'hit') {
    fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 20, r: 26, life: 0.15, color: '#ff5a5a' });
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
function drawSprite(img, x, y, dir, frame, scale) {
  if (!img) return;
  const cols = 4, rows = 4;
  const fw = img.width / cols, fh = img.height / rows;
  const row = dirRow(dir);
  const sx = (frame % cols) * fw, sy = row * fh;
  const dw = fw * scale, dh = fh * scale;
  ctx.drawImage(img, sx, sy, fw, fh, x - dw/2, y - dh, dw, dh);
}
// Sheet quái 3x3: cột 0=đứng 1=chạy 2=đánh · hàng 0=trước 1=sau 2=ngang
function drawMob(img, m, scale) {
  if (!img) return;
  const fw = img.width / 3, fh = img.height / 3;
  const bob = Math.sin(walkT * 7 + m.id) * 3; // nhún nhẹ giả chuyển động
  const dw = fw * scale, dh = fh * scale;
  ctx.drawImage(img, fw * 1, 0, fw, fh, m.x - dw/2, m.y + bob - dh, dw, dh);
}

let lastT = 0, walkT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t; walkT += dt;
  const me = players.get(myName);
  if (!me) return;
  // Camera theo nhân vật
  camX += (me.x - camX) * Math.min(1, dt * 6);
  camY += (me.y - camY) * Math.min(1, dt * 6);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.translate(cv.width/2, cv.height/2); ctx.scale(ZOOM, ZOOM); ctx.translate(-camX, -camY);

  const vx0 = camX - cv.width/2/ZOOM - 100, vx1 = camX + cv.width/2/ZOOM + 100;
  const vy0 = camY - cv.height/2/ZOOM - 100, vy1 = camY + cv.height/2/ZOOM + 100;
  const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

  // Map
  if (IMG.map) ctx.drawImage(IMG.map, 0, 0, WORLD_W, WORLD_H);

  // Gom entity trong tầm nhìn, XẾP THEO Y (đứng dưới vẽ sau = đè lên đúng như game thường)
  const draws = [];
  for (const m of monsters.values()) {
    if (!inView(m.x, m.y)) continue;
    draws.push({ y: m.y, f: () => {
      drawMob(IMG[MOB_IMG[m.type]], m, 0.45);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(m.x - 24, m.y - 200, 48, 6);
      ctx.fillStyle = '#e33'; ctx.fillRect(m.x - 24, m.y - 200, 48 * (m.hp / m.maxhp), 6);
    }});
  }
  for (const p of players.values()) {
    if (!inView(p.x, p.y) || p.dead) continue;
    draws.push({ y: p.y, f: () => {
      const fr = p.moving ? Math.floor(walkT * 8) % 4 : 0;
      const isMe = p.name === myName;
      drawSprite(IMG.walk, p.x, p.y, p.dir, fr, 0.62);
      if (p.shield) { // vòng kim chung quanh người
        ctx.strokeStyle = 'rgba(255,217,122,.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y - 120, 72 + Math.sin(walkT*6)*3, 0, Math.PI*2); ctx.stroke();
      }
      ctx.fillStyle = isMe ? '#7dff9a' : '#fff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - 258);
      if (!isMe) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - 24, p.y - 250, 48, 5);
        ctx.fillStyle = '#e33'; ctx.fillRect(p.x - 24, p.y - 250, 48 * (p.hp / p.maxhp), 5);
      }
    }});
  }
  draws.sort((a, b) => a.y - b.y).forEach(d => d.f());

  // Hiệu ứng phi kiếm
  for (const pt of particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt;
    const a = Math.max(0, pt.life / pt.maxLife);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(pt.x, pt.y); ctx.rotate(pt.ang);
    if (pt.dot) { ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(0, 0, pt.size/2, 0, Math.PI*2); ctx.fill(); }
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
      ctx.beginPath(); ctx.arc(f.x, f.y - 120, 72, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(f.x, f.y - 120, 72, 0, Math.PI*2); ctx.fillStyle = f.color; ctx.fill();
    }
    ctx.restore();
  }
  fxAnims = fxAnims.filter(f => f.life > 0);

  // Số sát thương
  ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif';
  for (const d of dmgNums) {
    d.life -= dt * 1.2;
    const m = monsters.get(d.mid);
    const x = m ? m.x : d.x, y = (m ? m.y : d.y) - 70 - (1 - d.life) * 40;
    ctx.globalAlpha = Math.max(0, d.life);
    ctx.fillStyle = d.color; ctx.fillText(d.txt, x, y);
    ctx.globalAlpha = 1;
  }
  dmgNums = dmgNums.filter(d => d.life > 0);

  ctx.restore();
  UI.drawMinimap();
  // Tự động đánh khi đã chạy đủ gần quái được chọn
  if (pendingAtk && me && !me.dead) {
    const m = monsters.get(pendingAtk);
    if (!m) pendingAtk = null;
    else if (Math.hypot(m.x - me.x, m.y - me.y) < 110) { send({ t: 'attack' }); pendingAtk = null; }
    else if (!me.moving) send({ t: 'move', x: Math.round(m.x), y: Math.round(m.y) });
  }
}

// ---------- Input ----------
let pendingAtk = null; // id quái đang muốn đánh -> tự chạy lại gần rồi đánh
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  if (e.button === 2) return;
  const wx = camX + (e.clientX - cv.width/2) / ZOOM;
  const wy = camY + (e.clientY - cv.height/2) / ZOOM;
  // Click trúng quái -> tự chạy lại gần rồi đánh (như game thường)
  let best = null, bd = 60 / ZOOM;
  for (const m of monsters.values()) { const d = Math.hypot(m.x - wx, m.y - wy); if (d < bd) { bd = d; best = m; } }
  if (best) {
    pendingAtk = best.id;
    send({ t: 'move', x: Math.round(best.x), y: Math.round(best.y) });
    return;
  }
  pendingAtk = null;
  send({ t: 'move', x: Math.round(wx), y: Math.round(wy) });
});
addEventListener('keydown', e => {
  if (document.getElementById('game').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '6') { const id = ORDER[+k - 1]; if (id) UI.trySkill(id); }
  else if (k === 'q') send({ t: 'potion' });
});

// ---------- Khởi động ----------
document.getElementById('join-btn').onclick = async () => {
  const name = document.getElementById('name-input').value.trim();
  if (!name) { alert('Nhập đạo hiệu đã bạn ơi'); return; }
  myName = name;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  resize();
  for (const [k, s] of ASSETS) await loadImg(k, s);
  for (const [id, f] of Object.entries(ICONS)) await loadImg('ic_' + id, 'assets/' + f);
  connect(name);
  requestAnimationFrame(loop);
};
window.__game = { get myName() { return myName; }, players, monsters, send, SKILL_NAMES, get SKILLS() { return SKILLS; }, get ORDER() { return ORDER; } };
})();
