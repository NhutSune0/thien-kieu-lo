// Thiên Kiêu Lộ P1 — UI: HUD, thanh skill, minimap
(() => {
'use strict';
const G = () => window.__game;
const cds = {}; // id -> timestamp hết cooldown (client ước tính)

function fmt(n) { return n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : n >= 1000 ? (n/1000).toFixed(1) + 'K' : '' + Math.floor(n); }

function updateMe(me) {
  if (!me) return;
  const hpP = Math.max(0, me.hp / me.maxhp * 100), mpP = Math.max(0, me.mp / me.maxmp * 100), tvP = Math.max(0, me.tv / me.tvNeed * 100);
  setBar('hp', hpP, `${Math.ceil(me.hp)}/${me.maxhp}`);
  setBar('mp', mpP, `${Math.ceil(me.mp)}/${me.maxmp}`);
  setBar('tv', tvP, `${fmt(me.tv)}/${fmt(me.tvNeed)}`);
  document.getElementById('lvl-text').textContent = `Luyện Khí ${me.level}`;
  document.getElementById('lt-text').textContent = `💎 ${fmt(me.lt)} LT`;
  document.getElementById('pot-text').textContent = `🧪 ${me.potions} (Q)`;
  // trạng thái skill: hết mana -> xám
  document.querySelectorAll('.skill').forEach(el => {
    const sk = G().SKILLS[el.dataset.id];
    el.classList.toggle('nomp', sk && me.mp < sk.mp);
  });
}
function setBar(id, pct, text) {
  document.getElementById(id + '-fill').style.width = pct + '%';
  document.getElementById(id + '-text').textContent = text;
}

function buildSkills() {
  const bar = document.getElementById('skillbar'); bar.innerHTML = '';
  G().ORDER.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'skill'; d.dataset.id = id; d.title = G().SKILL_NAMES[id];
    d.innerHTML = `<img src="assets/${iconFile(id)}"><span class="key">${i + 1}</span><div class="cd" style="display:none"></div>`;
    d.onclick = () => trySkill(id);
    bar.appendChild(d);
  });
  setInterval(tickCds, 100);
  // Nhấp nháy 6s đầu để báo "icon này chạm được"
  bar.classList.add('attn');
  setTimeout(() => bar.classList.remove('attn'), 6000);
}
function iconFile(id) {
  return { 'linh-kiem-tram':'icon-linh-kiem-tram.webp','cuu-loi-kiem':'icon-cuu-loi-kiem.webp','phan-thien-kiem':'icon-phan-thien-kiem.webp','van-kiem-quy-tong':'icon-van-kiem-quy-tong.webp','hon-don-kim-chung':'icon-hon-don-kim-chung.webp','khai-thien-nhat-kiem':'icon-khai-thien-nhat-kiem.webp' }[id];
}
function trySkill(id) {
  const sk = G().SKILLS[id]; if (!sk) return;
  if (G().setAuto) G().setAuto(false); // bấm skill tay thì tắt Auto
  const now = Date.now();
  if (cds[id] && cds[id] > now) return;
  const me = G().players.get(G().myName);
  if (me && me.mp < sk.mp) {
    const el = document.querySelector(`.skill[data-id="${id}"]`);
    el.classList.remove('nomp'); void el.offsetWidth; el.classList.add('nomp');
    return;
  }
  cds[id] = now + sk.cd * 1000;
  G().send({ t: 'skill', id });
}
function tickCds() {
  const now = Date.now();
  document.querySelectorAll('.skill').forEach(el => {
    const left = Math.max(0, ((cds[el.dataset.id] || 0) - now) / 1000);
    const cd = el.querySelector('.cd');
    if (left > 0.05) { cd.style.display = 'flex'; cd.textContent = left > 10 ? Math.ceil(left) : left.toFixed(1); }
    else cd.style.display = 'none';
  });
}

function drawMinimap() {
  const mm = document.getElementById('minimap'), c = mm.getContext('2d');
  drawMapOn(c, mm.width, mm.height);
}
function drawMapOn(c, W, H) {
  const w = 80 * 48, h = 60 * 48, sx = W / w, sy = H / h;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#141b33'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#e33';
  for (const m of G().monsters.values()) { c.fillRect(m.x * sx - 1, m.y * sy - 1, 2, 2); }
  for (const p of G().players.values()) {
    c.fillStyle = p.name === G().myName ? '#7dff9a' : '#fff';
    c.beginPath(); c.arc(p.x * sx, p.y * sy, p.name === G().myName ? 3.5 : 2.5, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = '#4a5a8a'; c.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// ---------- Panel UI ----------
function togglePanel(id) {
  const el = document.getElementById(id);
  const willOpen = !el.classList.contains('open');
  document.querySelectorAll('.panel.open').forEach(x => x.classList.remove('open'));
  if (willOpen) {
    el.classList.add('open');
    if (id === 'panel-char') renderChar();
    if (id === 'panel-bag') renderBag();
    if (id === 'panel-map') { const bm = document.getElementById('bigmap'); drawMapOn(bm.getContext('2d'), bm.width, bm.height); }
    if (id === 'panel-settings') renderSettings();
    if (id === 'panel-quest') renderQuestPanel();
  }
}
function closePanels() { document.querySelectorAll('.panel.open').forEach(x => x.classList.remove('open')); }
const REALMS = ['Luyện Khí', 'Trúc Cơ', 'Kim Đan', 'Nguyên Anh', 'Hóa Thần', 'Luyện Hư', 'Hợp Thể', 'Đại Thừa', 'Độ Kiếp'];
function renderChar() {
  const me = G().players.get(G().myName); if (!me) return;
  const realm = REALMS[Math.min(8, Math.floor((me.level - 1) / 10))] || 'Luyện Khí';
  document.getElementById('char-body').innerHTML = `
    <div class="row"><span>Đạo hiệu</span><b style="color:#7dff9a">${me.name}</b></div>
    <div class="row"><span>Tông môn</span><b>Thanh Huyền Tông · Kiếm Các</b></div>
    <div class="row"><span>Cảnh giới</span><b>${realm} ${me.level}</b></div>
    <div class="row"><span>Khí huyết</span><b>${Math.ceil(me.hp)} / ${me.maxhp}</b></div>
    <div class="row"><span>Linh lực</span><b>${Math.ceil(me.mp)} / ${me.maxmp}</b></div>
    <div class="row"><span>Công kích</span><b>⚔️ ${me.atk || 24}</b></div>
    <div class="row"><span>Phòng ngự</span><b>🛡️ ${me.def || 8}</b></div>
    <div class="row"><span>Tu vi</span><b>${fmt(me.tv)} / ${fmt(me.tvNeed)}</b></div>
    <div class="row"><span>Linh thạch</span><b>💎 ${fmt(me.lt)}</b></div>
    <div class="row"><span>Điểm cống hiến</span><b>🏵️ ${fmt(me.dch || 0)}</b></div>
    <div class="row"><span>Danh hiệu</span><b>${(me.titles && me.titles.length) ? me.titles.join(' · ') : '—'}</b></div>
    <div class="row"><span>Kết bái</span><b>${me.ketbai ? '🤝 Trương Tiểu Hổ' : 'Chưa có'}</b></div>`;
}
function renderBag() {
  const me = G().players.get(G().myName); if (!me) return;
  document.getElementById('bag-body').innerHTML = `
    <div class="bag-item"><div class="ic">🧪</div>
      <div class="nm">Hồi Khí Đan<small>Hồi 40% khí huyết · còn <b>${me.potions}</b> viên</small></div>
      <button data-drink>Dùng</button></div>
    <div class="bag-item"><div class="ic">💎</div>
      <div class="nm">Linh thạch<small>${fmt(me.lt)} viên — dùng để mua đồ, cường hóa</small></div></div>
    <div style="color:#66708c;font-size:12px;margin-top:6px">Trang bị sẽ mở ở giai đoạn sau.</div>`;
  document.querySelector('#bag-body [data-drink]').onclick = () => { G().send({ t: 'potion' }); setTimeout(renderBag, 300); };
}
const settings = { sound: true, shake: true };
function renderSettings() {
  document.getElementById('settings-body').innerHTML = `
    <div class="set-row"><span>🔊 Âm thanh</span><button data-k="sound" class="${settings.sound ? 'on' : ''}">${settings.sound ? 'Bật' : 'Tắt'}</button></div>
    <div class="set-row"><span>📳 Rung màn hình</span><button data-k="shake" class="${settings.shake ? 'on' : ''}">${settings.shake ? 'Bật' : 'Tắt'}</button></div>
    <div style="color:#66708c;font-size:12px;margin-top:8px">Thiên Kiêu Lộ · P2</div>`;
  document.querySelectorAll('#settings-body [data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k; settings[k] = !settings[k]; G().applySetting(k, settings[k]); renderSettings();
  });
}

// ---------- Chat ----------
function addChat(name, text) {
  const log = document.getElementById('chatlog');
  const d = document.createElement('div');
  const b = document.createElement('b'); b.textContent = name + ': ';
  d.appendChild(b); d.appendChild(document.createTextNode(text));
  log.appendChild(d);
  while (log.children.length > 6) log.removeChild(log.firstChild);
}
function openChat() {
  closePanels();
  const w = document.getElementById('chatinput-wrap');
  w.style.display = 'block';
  const inp = document.getElementById('chatinput');
  setTimeout(() => inp.focus(), 50);
}
function closeChat(sendIt) {
  const w = document.getElementById('chatinput-wrap'), inp = document.getElementById('chatinput');
  if (sendIt && inp.value.trim()) G().send({ t: 'chat', text: inp.value.trim() });
  inp.value = ''; w.style.display = 'none';
}
function chatOpen() { return document.getElementById('chatinput-wrap').style.display === 'block'; }

// ---------- Nhiệm vụ ----------
function updateQuest() {
  const q = G().quest || { active: null, done: [] };
  const tr = document.getElementById('quest-tracker');
  if (q.active) {
    tr.style.display = 'block';
    document.getElementById('qt-name').textContent = '📜 ' + q.active.id + ' · ' + q.active.name;
    document.getElementById('qt-obj').textContent = q.active.text;
  } else tr.style.display = 'none';
  if (document.getElementById('panel-quest').classList.contains('open')) renderQuestPanel();
}
function renderQuestPanel() {
  const q = G().quest || { active: null, done: [] };
  const doneCount = (q.done || []).length;
  let html = '';
  if (q.active) html += `<div class="q-active"><b>📜 ${q.active.id} · ${q.active.name}</b><div>${q.active.text}</div></div>`;
  else html += `<div style="color:#66708c">Chưa nhận nhiệm vụ nào.<br>Tìm NPC có dấu <b style="color:#ffd94a">!</b> vàng để nhận.</div>`;
  html += `<div style="margin-top:10px;color:#8fa0c8;font-size:12px">Chương 1 · Tạp Dịch Viện: ${doneCount}/6 nhiệm vụ</div>`;
  document.getElementById('quest-body').innerHTML = html;
}

// ---------- Khung thoại NPC ----------
function showDlg(m) {
  closePanels();
  document.getElementById('dlg-name').textContent = m.name;
  document.getElementById('dlg-img').src = (G().NPC_PORTRAIT || {})[m.npc] || '';
  const lines = document.getElementById('dlg-lines'); lines.innerHTML = '';
  m.lines.forEach(t => { const p = document.createElement('p'); p.textContent = t; lines.appendChild(p); });
  const btns = document.getElementById('dlg-btns'); btns.innerHTML = '';
  if (m.canAccept) {
    const b = document.createElement('button'); b.className = 'dlg-btn accept'; b.textContent = 'Nhận nhiệm vụ';
    b.onclick = () => { G().send({ t: 'accept', quest: m.qid }); closePanels(); };
    btns.appendChild(b);
  }
  if (m.canTurnin) {
    const b = document.createElement('button'); b.className = 'dlg-btn turnin'; b.textContent = 'Trả nhiệm vụ';
    b.onclick = () => { G().send({ t: 'turnin', quest: m.qid }); closePanels(); };
    btns.appendChild(b);
  }
  const bye = document.createElement('button'); bye.className = 'dlg-btn'; bye.textContent = 'Tạm biệt';
  bye.onclick = closePanels;
  btns.appendChild(bye);
  document.getElementById('panel-dlg').classList.add('open');
}

// ---------- Thanh máu boss ----------
function updateBoss(m) {
  const el = document.getElementById('bossbar');
  if (!m) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  document.getElementById('boss-fill').style.width = Math.max(0, m.hp / m.maxhp * 100) + '%';
  document.getElementById('boss-hptext').textContent = `${Math.max(0, Math.ceil(m.hp))}/${m.maxhp}`;
}

window.UI = { updateMe, buildSkills, trySkill, drawMinimap, togglePanel, closePanels, addChat, openChat, closeChat, chatOpen, settings, showDlg, updateQuest, updateBoss };
})();
