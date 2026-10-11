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
  document.getElementById('lvl-text').textContent = realmName(me.level);
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
  return (G().ICONS || {})[id]; // P3: icon theo Đường (server gửi trong welcome/hallskills)
}
function trySkill(id, isAuto) {
  const sk = G().SKILLS[id]; if (!sk) return false;
  if (!isAuto && G().setAuto) G().setAuto(false); // bấm skill tay thì tắt Auto
  const now = Date.now();
  if (cds[id] && cds[id] > now) return false;
  const me = G().players.get(G().myName);
  if (me && me.mp < sk.mp) {
    if (!isAuto) {
      const el = document.querySelector(`.skill[data-id="${id}"]`);
      el.classList.remove('nomp'); void el.offsetWidth; el.classList.add('nomp');
    }
    return false;
  }
  cds[id] = now + sk.cd * 1000;
  G().send({ t: 'skill', id });
  return true;
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
function realmName(lvl) {
  if (lvl < 10) return `Luyện Khí tầng ${lvl}`;
  return `Trúc Cơ tầng ${lvl - 9}`;
}
function renderGearSlots(me) {
  const slots = ['vu-khi','ao','quan','giay','nhan','day-chuyen'];
  const slotNames = {'vu-khi':'Vũ Khí','ao':'Áo','quan':'Quần','giay':'Giày','nhan':'Nhẫn','day-chuyen':'Dây Chuyền'};
  const icons = {'vu-khi':'gear-vu-khi.webp','ao':'gear-ao.webp','quan':'gear-quan.webp','giay':'gear-giay.webp','nhan':'gear-nhan.webp','day-chuyen':'gear-day-chuyen.webp'};
  const colors = {thuong:'#8a8a8a',tot:'#2ecc71',hiem:'#3498db','cuc-pham':'#9b59b6'};
  const bgColors = {thuong:'rgba(138,138,138,.12)',tot:'rgba(46,204,113,.12)',hiem:'rgba(52,152,219,.12)','cuc-pham':'rgba(155,89,182,.15)'};
  const rarNames = {thuong:'Thường',tot:'Tốt',hiem:'Hiếm','cuc-pham':'Cực Phẩm'};
  return '<div class="gear-grid">' + slots.map(s => {
    const g = (me.gear || {})[s];
    if (!g) return `<div class="gear-slot empty">
      <div class="gear-icon"><img src="assets/${icons[s]}" alt=""></div><div class="gear-slotname">${slotNames[s]}</div></div>`;
    const plus = g.plus || 0;
    const mul = 1 + plus * 0.15;
    const statTxt = Object.entries(g.stats).map(([k,v]) => `${k==='atk'?'Công':k==='def'?'Thủ':k==='hp'?'HP':k==='mp'?'MP':k==='crit'?'Bạo':k==='spd'?'Tốc':k}+${Math.round(v*mul)}`).join(' ');
    const plusTxt = plus > 0 ? ` <b style="color:#ffd94a">+${plus}</b>` : '';
    return `<div class="gear-slot" data-unequip="${s}" style="border-color:${colors[g.rarity]};background:${bgColors[g.rarity]}" title="Bấm để tháo">
      <div class="gear-icon"><img src="assets/${icons[s]}" alt=""></div>
      <div class="gear-rar" style="color:${colors[g.rarity]}">${rarNames[g.rarity]}${plusTxt}</div>
      <div class="gear-stats">${statTxt}</div>
      ${plus < 10 ? `<button class="enh-btn" data-enhance="${g.id}" title="Cường hóa">⚒️</button>` : '<div class="gear-max">MAX</div>'}</div>`;
  }).join('') + '</div>';
}
function renderChar() {
  const me = G().players.get(G().myName); if (!me) return;
  const hallName = (G().HALL_NAMES || {})[me.hall] || '';
  const hallIcon = (G().HALL_ICONS_UI || {})[me.hall] || '';
  const classIcon = me.hall === 'kiem-cac' ? '🗡️' : me.hall === 'than-phu' ? '🧧' : me.hall === 'tran-su' ? '☯️' : '⚔️';
  const className = me.hall === 'kiem-cac' ? 'Kiếm Tu' : me.hall === 'than-phu' ? 'Phù Tu' : me.hall === 'tran-su' ? 'Trận Sư' : '';
  const avatarBg = me.gender === 'nu' ? 'linear-gradient(135deg,#ff9ff3,#f368e0)' : 'linear-gradient(135deg,#48dbfb,#0abde3)';
  document.getElementById('char-body').innerHTML = `
  <div class="char-top">
    <div class="char-avatar" style="background:${avatarBg}">${me.gender === 'nu' ? '👸' : '🤴'}</div>
    <div class="char-info">
      <div class="char-name">${me.name}</div>
      <div class="char-class">${classIcon} ${className} ${me.trucCo ? '· <span style="color:#c5f">Trúc Cơ</span>' : ''}</div>
      <div class="char-lv">Cấp ${me.level}</div>
    </div>
  </div>
  <div class="char-section">⚔️ Chỉ số chiến đấu</div>
  <div class="stat-grid">
    <div class="stat"><span>Công kích</span><b>${me.atk || 0}</b></div>
    <div class="stat"><span>Phòng ngự</span><b>${me.def || 0}</b></div>
    <div class="stat"><span>Khí huyết</span><b>${Math.ceil(me.hp)}/${me.maxhp}</b></div>
    <div class="stat"><span>Linh lực</span><b>${Math.ceil(me.mp)}/${me.maxmp}</b></div>
    <div class="stat"><span>Bạo kích</span><b>${me.crit || 15}%</b></div>
    <div class="stat"><span>Tu vi</span><b>${fmt(me.tv)}/${fmt(me.tvNeed)}</b></div>
  </div>
  <div class="char-section">🛡️ Trang bị đang mặc</div>
  ${renderGearSlots(me)}
  <div class="char-section">💰 Tài sản</div>
  <div class="stat-grid">
    <div class="stat"><span>Linh thạch</span><b>💎 ${fmt(me.lt)}</b></div>
    <div class="stat"><span>Hồi Khí Đan</span><b>🧪 ${me.potions}</b></div>
  </div>
  ${(me.titles && me.titles.length) ? `<div class="char-section">🏵️ Danh hiệu</div><div style="color:#ffd94a;font-size:13px">${me.titles.join(' · ')}</div>` : ''}
  ${me.level >= 9 && !me.trucCo ? `<button data-trib class="trib-btn">⚡ Độ Kiếp (đến Lôi Kiếp Đài)</button>` : ''}
  <button data-delchar class="delchar-btn">🗑️ Xóa nhân vật</button>`;
  document.querySelectorAll('#char-body [data-unequip]').forEach(el => el.onclick = () => {
    G().send({ t: 'unequip', slot: el.dataset.unequip }); setTimeout(renderChar, 300);
  });
  const delBtn = document.querySelector('#char-body [data-delchar]');
  if (delBtn) delBtn.onclick = () => {
    if (confirm('Xóa nhân vật này vĩnh viễn? Không thể khôi phục!')) {
      if (confirm('Chắc chắn xóa?')) G().send({ t: 'deletechar' });
    }
  };
  document.querySelectorAll('#char-body [data-enhance]').forEach(btn => btn.onclick = (e) => {
    e.stopPropagation(); // không trigger unequip
    if (confirm('Cường hóa trang bị? Tốn linh thạch, mỗi cấp +15% chỉ số.')) {
      G().send({ t: 'enhance', id: btn.dataset.enhance });
      setTimeout(renderChar, 500);
    }
  });
  const tribBtn = document.querySelector('#char-body [data-trib]');
  if (tribBtn) tribBtn.onclick = () => {
    if (confirm('Bắt đầu độ Cửu Cửu Lôi Kiếp? 9 đợt sét, nguy hiểm!')) G().send({ t: 'tribulate' });
  };
}
let bagFilter = 'all'; // all, vu-khi, ao, quan, giay, nhan, day-chuyen, thuong, tot, hiem, cuc-pham
function renderBag() {
  const me = G().players.get(G().myName); if (!me) return;
  let bag = me.bag || [];
  // Lọc theo bộ lọc đang chọn
  if (bagFilter !== 'all') {
    if (['vu-khi','ao','quan','giay','nhan','day-chuyen'].includes(bagFilter)) {
      bag = bag.filter(g => g.slot === bagFilter);
    } else {
      bag = bag.filter(g => g.rarity === bagFilter);
    }
  }
  const icons = {'vu-khi':'gear-vu-khi.webp','ao':'gear-ao.webp','quan':'gear-quan.webp','giay':'gear-giay.webp','nhan':'gear-nhan.webp','day-chuyen':'gear-day-chuyen.webp'};
  const slotNames = {'vu-khi':'Vũ Khí','ao':'Áo','quan':'Quần','giay':'Giày','nhan':'Nhẫn','day-chuyen':'Dây Chuyền'};
  const colors = {thuong:'#8a8a8a',tot:'#2ecc71',hiem:'#3498db','cuc-pham':'#9b59b6'};
  const bgColors = {thuong:'rgba(138,138,138,.12)',tot:'rgba(46,204,113,.12)',hiem:'rgba(52,152,219,.12)','cuc-pham':'rgba(155,89,182,.15)'};
  const rarNames = {thuong:'Thường',tot:'Tốt',hiem:'Hiếm','cuc-pham':'Cực Phẩm'};
  let gearHtml = '';
  for (const g of bag) {
    const statTxt = Object.entries(g.stats).map(([k,v]) => `${k==='atk'?'Công':k==='def'?'Thủ':k==='hp'?'HP':k==='mp'?'MP':k==='crit'?'Bạo':k==='spd'?'Tốc':k}+${v}`).join(' ');
    const sellP = Math.round(({thuong:30,tot:80,hiem:200,'cuc-pham':500})[g.rarity] * (1 + (g.plus||0)*0.5));
    gearHtml += `<div class="bag-gear" style="border-color:${colors[g.rarity]};background:${bgColors[g.rarity]}">
      <div class="gear-icon"><img src="assets/${icons[g.slot]}" alt=""></div>
      <div class="gear-rar" style="color:${colors[g.rarity]}">${rarNames[g.rarity]}${g.plus?` +${g.plus}`:''}</div>
      <div class="gear-slotname">${slotNames[g.slot] || g.slot}</div>
      <div class="gear-stats">${statTxt}</div>
      <div class="gear-btns">
        <button data-equip="${g.id}" class="wear-btn">Mặc</button>
        <button data-sell="${g.id}" class="sell-btn">Bán ${sellP}💎</button>
      </div></div>`;
  }
  document.getElementById('bag-body').innerHTML = `
    <div class="bag-top">
      <div class="bag-item"><div class="ic">🧪</div>
        <div class="nm">Hồi Khí Đan<small>Còn <b>${me.potions}</b> viên</small></div>
        <button data-drink>Dùng</button></div>
      <div class="bag-item"><div class="ic">💎</div>
        <div class="nm">Linh thạch<small>${fmt(me.lt)} viên</small></div></div>
    </div>
    <div class="char-section">🎒 Trang bị trong túi (${bag.length})</div>
    <div class="bag-filters">
      <button data-filter="all" class="${bagFilter==='all'?'active':''}">Tất cả</button>
      <button data-filter="vu-khi" class="${bagFilter==='vu-khi'?'active':''}">🗡️</button>
      <button data-filter="ao" class="${bagFilter==='ao'?'active':''}">🥋</button>
      <button data-filter="thuong" class="${bagFilter==='thuong'?'active':''}" style="color:#8a8a8a">Thường</button>
      <button data-filter="tot" class="${bagFilter==='tot'?'active':''}" style="color:#2ecc71">Tốt</button>
      <button data-filter="hiem" class="${bagFilter==='hiem'?'active':''}" style="color:#3498db">Hiếm</button>
      <button data-filter="cuc-pham" class="${bagFilter==='cuc-pham'?'active':''}" style="color:#9b59b6">Cực Phẩm</button>
    </div>
    ${gearHtml ? `<div class="bag-grid">${gearHtml}</div>` : '<div class="bag-empty">Chưa có trang bị — đi đánh quái để rớt đồ.</div>'}`;
  document.querySelector('#bag-body [data-drink]').onclick = () => { G().send({ t: 'potion' }); setTimeout(renderBag, 300); };
  document.querySelectorAll('#bag-body [data-equip]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    G().send({ t: 'equip', id: b.dataset.equip }); setTimeout(() => { renderBag(); renderChar(); }, 300);
  });
  document.querySelectorAll('#bag-body [data-sell]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (confirm('Bán trang bị này?')) {
      G().send({ t: 'sell', id: b.dataset.sell }); setTimeout(renderBag, 300);
    }
  });
  document.querySelectorAll('#bag-body [data-filter]').forEach(b => b.onclick = () => {
    bagFilter = b.dataset.filter; renderBag();
  });
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
  // Đã bỏ hệ nhiệm vụ — ẩn tracker
  document.getElementById('quest-tracker').style.display = 'none';
  return;
}
function renderQuestPanel() {
  return; // Đã bỏ hệ nhiệm vụ
}

// ---------- Khung thoại NPC ----------
function showDlg(m) {
  closePanels();
  document.getElementById('dlg-name').textContent = m.name;
  document.getElementById('dlg-img').src = (G().NPC_PORTRAIT || {})[m.npc] || '';
  const lines = document.getElementById('dlg-lines'); lines.innerHTML = '';
  m.lines.forEach(t => { const p = document.createElement('p'); p.textContent = t; lines.appendChild(p); });
  const btns = document.getElementById('dlg-btns'); btns.innerHTML = '';
  if (m.canTeleport && m.teleports) { // Dịch chuyển
    for (const tp of m.teleports) {
      const b = document.createElement('button'); b.className = 'dlg-btn accept'; b.textContent = '🌀 ' + tp.name;
      b.onclick = () => { G().send({ t: 'teleport', map: tp.map }); closePanels(); };
      btns.appendChild(b);
    }
  }
  const bye = document.createElement('button'); bye.className = 'dlg-btn'; bye.textContent = 'Tạm biệt';
  bye.onclick = closePanels;
  btns.appendChild(bye);
  document.getElementById('panel-dlg').classList.add('open');
}

// ---------- P3: Chọn Đường ----------
function openHall(halls) {
  closePanels();
  const body = document.getElementById('hall-body'); body.innerHTML = '';
  const me = G().players.get(G().myName);
  const curHall = me && me.hall;
  const skillCount = { 'kiem-cac': 6, 'than-phu': 4, 'tran-su': 4, 'duoc-vuong': 4 };
  const note = document.createElement('div');
  note.style.cssText = 'color:#ffb84d;font-size:12px;margin-bottom:10px';
  note.textContent = 'Chọn 1 Đường để theo cả đời — mỗi Đường có bộ kỹ năng riêng!';
  body.appendChild(note);
  for (const id of ['kiem-cac', 'than-phu', 'tran-su', 'duoc-vuong']) {
    const h = halls[id]; if (!h) continue;
    const isCur = curHall === id;
    const card = document.createElement('div'); card.className = 'hall-card';
    card.innerHTML = `<div class="hc-icon">${h.icon}</div>
      <div class="hc-info"><b>${h.name}${isCur ? ' <span class="hc-cur">Đang theo</span>' : ''}</b>
      <small>${h.desc}</small><small style="color:#8fa0c8">${skillCount[id] || 4} kỹ năng riêng</small></div>`;
    const btn = document.createElement('button');
    btn.textContent = isCur ? 'Xác nhận ở lại' : 'Gia nhập';
    btn.onclick = () => {
      if (btn.dataset.confirm) { G().send({ t: 'joinhall', hall: id }); closePanels(); }
      else { btn.dataset.confirm = '1'; btn.textContent = 'Chắc chắn?'; btn.classList.add('warn'); }
    };
    card.appendChild(btn);
    body.appendChild(card);
  }
  document.getElementById('panel-hall').classList.add('open');
}

// ---------- Thanh máu boss ----------
function updateBoss(m) {
  const el = document.getElementById('bossbar');
  if (!m) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  document.getElementById('boss-fill').style.width = Math.max(0, m.hp / m.maxhp * 100) + '%';
  document.getElementById('boss-hptext').textContent = `${Math.max(0, Math.ceil(m.hp))}/${m.maxhp}`;
}

window.UI = { updateMe, buildSkills, trySkill, drawMinimap, togglePanel, closePanels, addChat, openChat, closeChat, chatOpen, settings, showDlg, updateQuest, updateBoss, openHall, renderChar, realmName };
})();
