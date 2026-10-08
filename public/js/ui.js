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
}
function iconFile(id) {
  return { 'linh-kiem-tram':'icon-linh-kiem-tram.webp','cuu-loi-kiem':'icon-cuu-loi-kiem.webp','phan-thien-kiem':'icon-phan-thien-kiem.webp','van-kiem-quy-tong':'icon-van-kiem-quy-tong.webp','hon-don-kim-chung':'icon-hon-don-kim-chung.webp','khai-thien-nhat-kiem':'icon-khai-thien-nhat-kiem.webp' }[id];
}
function trySkill(id) {
  const sk = G().SKILLS[id]; if (!sk) return;
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
  const W = 80 * 48, H = 60 * 48, sx = mm.width / W, sy = mm.height / H;
  c.clearRect(0, 0, mm.width, mm.height);
  c.fillStyle = '#141b33'; c.fillRect(0, 0, mm.width, mm.height);
  c.fillStyle = '#e33';
  for (const m of G().monsters.values()) { c.fillRect(m.x * sx - 1, m.y * sy - 1, 2, 2); }
  for (const p of G().players.values()) {
    c.fillStyle = p.name === G().myName ? '#7dff9a' : '#fff';
    c.beginPath(); c.arc(p.x * sx, p.y * sy, p.name === G().myName ? 3.5 : 2.5, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = '#4a5a8a'; c.strokeRect(0.5, 0.5, mm.width - 1, mm.height - 1);
}

window.UI = { updateMe, buildSkills, trySkill, drawMinimap };
})();
