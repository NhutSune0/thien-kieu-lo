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
const atkAnim = new Map(), castAnim = new Map();   // name -> timestamp kết thúc anim đánh/vận công
const hitFlash = new Map(), hitPop = new Map();    // mid -> timestamp flash/nảy khi trúng đòn
const dyingMobs = new Map();                        // mid -> mob đang ngã xuống (fade out)

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
    document.getElementById('login').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    resize();
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
  else if (m.t === 'dmg') {
    dmgNums.push({ x: 0, y: 0, mid: m.mid, txt: '-' + m.dmg, life: 1, color: '#ffdf6b' });
    const now = performance.now();
    hitFlash.set(m.mid, now + 150); hitPop.set(m.mid, now + 240); // chớp trắng + nảy lên khi trúng đòn
  }
  else if (m.t === 'mdie') {
    const mb = monsters.get(m.mid);
    if (mb) { mb.dying = performance.now() + 450; dyingMobs.set(m.mid, mb); } // ngã xuống fade dần
    monsters.delete(m.mid);
  }
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
  const now = performance.now();
  // Kích hoạt animation đánh / vận công của người tung chiêu
  if (m.by) {
    if (m.kind === 'slash') atkAnim.set(m.by, now + 340);
    else if (m.id) castAnim.set(m.by, now + 520);
  }
  // Chớp sáng ở vị trí người tung chiêu — báo hiệu rõ ràng mỗi lần dùng skill
  if (m.id && m.kind !== 'aoe') fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 50, r: 55, life: 0.3, color: '#ffffff' });
  if (m.kind === 'slash') {
    for (let i = 0; i < 5; i++) swordParticle(m.x + (Math.random()-0.5)*50, m.y - 50 + (Math.random()-0.5)*50, m.dir + (Math.random()-0.5)*0.8, 460, 0.35, '#bfe9ff', 36);
  } else if (m.kind === 'bolt') {           // Linh Kiếm Trảm: phi kiếm bay thẳng
    swordParticle(m.x, m.y - 50, m.dir, 1000, 0.7, '#9fdcff', 62);
    fxAnims.push({ kind: 'flash', x: m.x, y: m.y - 50, r: 55, life: 0.25, color: '#9fdcff' });
  } else if (m.kind === 'aoe') {            // Cửu Lôi / Phần Thiên: mưa phi kiếm
    const col = m.id === 'cuu-loi-kiem' ? '#c07dff' : '#ff7a3d';
    for (let i = 0; i < 18; i++) {
      const a = Math.random()*Math.PI*2, rr = Math.random()*(m.r||120);
      const sx = m.x + Math.cos(a)*rr, sy = m.y + Math.sin(a)*rr - 300;
      particles.push({ x: sx, y: sy, vx: (Math.random()-0.5)*60, vy: 900 + Math.random()*300, ang: Math.PI/2.3, life: 0.6, maxLife: 0.6, color: col, size: 36, spin: 0, trail: true });
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
  const fw = img.width / 3, fh = img.height / 3;
  const bob = Math.sin(walkT * 7 + m.id) * 3;
  const sq = Math.sin(walkT * 9 + m.id * 1.7);          // co giãn nhịp nhàng
  const now = performance.now();
  const pop = hitPop.get(m.id) > now ? 1.14 : 1;        // nảy lên khi trúng đòn
  const dw = fw * scale * (1 - sq * 0.03) * pop, dh = fh * scale * (1 + sq * 0.045) * pop;
  ctx.save();
  ctx.translate(m.x, m.y + bob);
  ctx.rotate(Math.sin(walkT * 5 + m.id) * 0.035);        // lắc nhẹ
  if (hitFlash.get(m.id) > now) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 26; } // chớp trắng khi trúng đòn
  ctx.drawImage(img, fw * 1, 0, fw, fh, -dw/2, -dh, dw, dh);
  ctx.restore();
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
  const shadow = (x, y, rx) => { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 3, rx, rx * 0.32, 0, 0, Math.PI*2); ctx.fill(); };
  const draws = [];
  for (const m of monsters.values()) {
    if (!inView(m.x, m.y)) continue;
    draws.push({ y: m.y, f: () => {
      shadow(m.x, m.y, 30);
      drawMob(IMG[MOB_IMG[m.type]], m, 0.28);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(m.x - 24, m.y - 118, 48, 6);
      ctx.fillStyle = '#e33'; ctx.fillRect(m.x - 24, m.y - 118, 48 * (m.hp / m.maxhp), 6);
    }});
  }
  // Quái đang ngã xuống: mờ dần rồi biến mất
  {
    const nowD = performance.now();
    for (const [id, m] of dyingMobs) {
      const left = m.dying - nowD;
      if (left <= 0) { dyingMobs.delete(id); continue; }
      if (!inView(m.x, m.y)) continue;
      draws.push({ y: m.y, f: () => {
        ctx.save(); ctx.globalAlpha = Math.max(0, left / 450);
        drawMob(IMG[MOB_IMG[m.type]], m, 0.28);
        ctx.restore();
      }});
    }
  }
  for (const p of players.values()) {
    if (!inView(p.x, p.y) || p.dead) continue;
    draws.push({ y: p.y, f: () => {
      const isMe = p.name === myName;
      const ph = p.name.charCodeAt(0) || 0;
      const now = performance.now();
      shadow(p.x, p.y, 26);
      const aEnd = atkAnim.get(p.name) || 0, cEnd = castAnim.get(p.name) || 0;
      if (cEnd > now) {            // vận công tung skill
        const fr = Math.min(3, Math.floor((520 - (cEnd - now)) / 130));
        drawSheet(IMG.cast, p.x, p.y, dirRow(p.dir), fr, 4, 4, 0.28);
      } else if (aEnd > now) {     // chém đánh thường
        const fr = Math.min(3, Math.floor((340 - (aEnd - now)) / 85));
        drawSheet(IMG.attack, p.x, p.y, atkRow(p.dir), fr, 4, 4, 0.28);
      } else {
        const fr = p.moving ? Math.floor(walkT * 10) % 4 : 0;
        const bobY = p.moving ? 0 : Math.sin(walkT * 2.5 + ph) * 2.5; // đứng yên cũng nhún nhẹ
        drawSprite(IMG.walk, p.x, p.y + bobY, p.dir, fr, 0.28);
      }
      if (p.moving && isMe && Math.random() < 0.22) { // bụi bay ở chân khi chạy
        particles.push({ x: p.x + (Math.random()-0.5)*22, y: p.y - 3, vx: (Math.random()-0.5)*36, vy: -24 - Math.random()*36, ang: 0, life: 0.45, maxLife: 0.45, color: 'rgba(190,180,160,0.7)', size: 9, dot: true });
      }
      if (p.shield) { // vòng kim chung quanh người
        ctx.strokeStyle = 'rgba(255,217,122,.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y - 52, 38 + Math.sin(walkT*6)*2, 0, Math.PI*2); ctx.stroke();
      }
      ctx.fillStyle = isMe ? '#7dff9a' : '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - 126);
      // Thanh máu trên đầu (mình: xanh lá, người khác: đỏ) — như game thường
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - 24, p.y - 118, 48, 5);
      ctx.fillStyle = isMe ? '#5f5' : '#e33'; ctx.fillRect(p.x - 24, p.y - 118, 48 * Math.max(0, p.hp / p.maxhp), 5);
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
      ctx.beginPath(); ctx.arc(f.x, f.y - 52, 38, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(f.x, f.y - 52, 38, 0, Math.PI*2); ctx.fillStyle = f.color; ctx.fill();
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
}

// ---------- Input ----------
let pendingAtk = null; // id quái đang muốn đánh -> tự chạy lại gần rồi đánh
let deadSince = 0;     // lúc bắt đầu chết (đếm ngược hồi sinh)
cv.addEventListener('contextmenu', e => e.preventDefault());
// Dùng pointerdown để cả chuột và chạm màn hình đều ăn
cv.addEventListener('pointerdown', e => {
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
window.__game = { get myName() { return myName; }, players, monsters, send, SKILL_NAMES, get SKILLS() { return SKILLS; }, get ORDER() { return ORDER; } };
})();
