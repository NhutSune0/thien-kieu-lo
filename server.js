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

// ---------- 11 map: tông môn + các vùng farm/boss ----------
const MAPS = {
  'tong-mon': { name: 'Thanh Huyền Tông' },
  'yeu-thu':  { name: 'Yêu Thú Sơn Mạch' },
  'hac-phong': { name: 'Hắc Phong Lĩnh' },
  'thi-luyen': { name: 'Thí Luyện Trường' },
  'loi-kiep': { name: 'Lôi Kiếp Đài' },
  'linh-mach': { name: 'Linh Mạch Cổ Địa' }, // Trúc Cơ (cấp 10+)
  'tang-kinh': { name: 'Tàng Kinh Các' }, // Thư viện tông môn
  'luyen-dan': { name: 'Luyện Đan Phòng' }, // Phòng luyện đan
  'u-minh': { name: 'U Minh Cốc' }, // Farm cấp 15+
  'thien-kiem': { name: 'Thiên Kiếm Nhai' }, // Farm cấp 18+
  'huyet-ma': { name: 'Huyết Ma Động' }, // Động boss cuối
};
const PORTALS = [
  { id: 'to-yeuthu',  from: 'tong-mon', x: 1920, y: 2620, to: 'yeu-thu',  tx: 1920, ty: 2380, label: 'Yêu Thú Sơn Mạch' },
  { id: 'to-tongmon', from: 'yeu-thu',  x: 1920, y: 2620, to: 'tong-mon', tx: 1920, ty: 2500, label: 'Thanh Huyền Tông' },
  { id: 'to-hacphong', from: 'yeu-thu', x: 3400, y: 400, to: 'hac-phong', tx: 400, ty: 2400, label: 'Hắc Phong Lĩnh', needLv: 5 },
  { id: 'to-yeuthu2', from: 'hac-phong', x: 400, y: 2400, to: 'yeu-thu', tx: 3400, ty: 400, label: 'Yêu Thú Sơn Mạch' },
  { id: 'to-thiluyen', from: 'tong-mon', x: 3400, y: 1400, to: 'thi-luyen', tx: 1920, ty: 2500, label: 'Thí Luyện Trường', needLv: 7 },
  { id: 'to-tongmon2', from: 'thi-luyen', x: 1920, y: 2620, to: 'tong-mon', tx: 3400, ty: 1400, label: 'Thanh Huyền Tông' },
  { id: 'to-loikiep', from: 'tong-mon', x: 400, y: 1400, to: 'loi-kiep', tx: 1920, ty: 2500, label: 'Lôi Kiếp Đài' },
  { id: 'to-tongmon3', from: 'loi-kiep', x: 1920, y: 2620, to: 'tong-mon', tx: 400, ty: 1400, label: 'Thanh Huyền Tông' },
];
const MAP_ANCHOR = { 'tong-mon': SPAWN, 'yeu-thu': { x: 1920, y: 2380 }, 'hac-phong': { x: 400, y: 2400 }, 'thi-luyen': { x: 1920, y: 2500 }, 'loi-kiep': { x: 1920, y: 2500 }, 'linh-mach': { x: 1920, y: 2500 }, 'tang-kinh': { x: 1920, y: 2500 }, 'luyen-dan': { x: 1920, y: 2500 }, 'u-minh': { x: 1920, y: 2500 }, 'thien-kiem': { x: 1920, y: 2500 }, 'huyet-ma': { x: 1920, y: 2500 } };
// Vật cản lớn mỗi map (x, y, r) — quái né khi di chuyển (hồ nước, đá lớn, cây đổ)
const OBSTACLES = {
  'yeu-thu': [
    { x: 1937, y: 1475, rx: 380, ry: 250 }, // hồ nước giữa map
    { x: 2625, y: 500, r: 90 }, { x: 2725, y: 750, r: 70 },   // cụm đá trên
    { x: 800, y: 562, r: 80 },                                 // cây đổ trái trên
    { x: 2825, y: 775, r: 90 }, { x: 2625, y: 812, r: 70 },   // cây đổ phải trên
    { x: 600, y: 1450, r: 60 }, { x: 875, y: 1650, r: 60 },   // đá trái giữa
    { x: 1250, y: 1875, r: 65 }, { x: 1275, y: 2400, r: 65 }, // đá giữa-dưới
    { x: 725, y: 2675, r: 85 },                                // cây đổ trái dưới
    { x: 1925, y: 2500, r: 65 },                               // đá giữa dưới
    { x: 2525, y: 625, r: 60 },                                // cây khô
    { x: 3250, y: 1650, r: 60 },                               // đá phải giữa
  ],
};
// Tránh vật cản: trả về hướng đã chỉnh (đẩy ra + đi vòng)
function avoidObs(map, x, y, dx, dy) {
  const obs = OBSTACLES[map];
  if (!obs) return [dx, dy];
  let ax = 0, ay = 0;
  for (const o of obs) {
    const rx = o.rx || o.r, ry = o.ry || o.r;
    const ox = x - o.x, oy = y - o.y;
    const d = Math.hypot(ox / rx, oy / ry); // khoảng cách chuẩn hóa ellipse
    if (d < 1.6 && d > 0.01) {
      const push = (1.6 - d) * 1.6;
      // pháp tuyến ellipse: gradient của (ox/rx)^2 + (oy/ry)^2
      let nx = ox / (rx * rx), ny = oy / (ry * ry);
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      ax += nx * push; ay += ny * push;
      ax += -ny * push * 0.9; ay += nx * push * 0.9; // tiếp tuyến -> đi vòng
    }
  }
  if (!ax && !ay) return [dx, dy];
  let nx = dx + ax, ny = dy + ay;
  const nl = Math.hypot(nx, ny) || 1;
  return [nx / nl, ny / nl];
}

// ---------- 4 Đường của Thanh Huyền Tông ----------
const HALLS = {
  'kiem-cac':   { name: 'Kiếm Các',   icon: '⚔️', desc: 'Kiếm tu: phi kiếm tung hoành, sát thương đơn cực mạnh' },
  'than-phu':  { name: 'Thần Phù',   icon: '🧧', desc: 'Phù tu: phù lục bay đầy trời, tầm xa và khống chế' },
  'tran-su':   { name: 'Trận Sư',    icon: '☯️', desc: 'Trận pháp: trận đồ bát quái, công thủ toàn diện' },
  'duoc-vuong':{ name: 'Dược Vương', icon: '🌿', desc: 'Đan tu: đan hỏa xanh, hồi phục và độc đan' },
};
const RANKS = {
  'tap-vu': 'Tạp Vụ', 'ngoai-mon': 'Ngoại Môn', 'noi-mon': 'Nội Môn',
  'hac-tam': 'Hạch Tâm', 'chan-truyen': 'Chân Truyền', 'thien-kieu': 'Thiên Kiêu',
};
// ---------- Trang bị ----------
const GEAR_SLOTS = {
  'vu-khi': 'Vũ Khí', 'ao': 'Áo', 'quan': 'Quần', 'giay': 'Giày', 'nhan': 'Nhẫn', 'day-chuyen': 'Dây Chuyền',
};
const GEAR_RARITY = {
  'thuong': { name: 'Thường', color: '#c0c0c0', mul: 1.0, icon: '⚪' },
  'tot':    { name: 'Tốt', color: '#5f5', mul: 1.5, icon: '🟢' },
  'hiem':   { name: 'Hiếm', color: '#5af', mul: 2.2, icon: '🔵' },
  'cuc-pham': { name: 'Cực Phẩm', color: '#c5f', mul: 3.2, icon: '🟣' },
};
const GEAR_BASE = {
  'vu-khi': { atk: 8 }, 'ao': { def: 6, hp: 40 }, 'quan': { def: 4, hp: 30 },
  'giay': { def: 3, spd: 10 }, 'nhan': { atk: 5, crit: 2 }, 'day-chuyen': { hp: 50, mp: 20 },
};
let gearSeq = 1;
function rollGear(monsterLv) {
  const slots = Object.keys(GEAR_SLOTS);
  const slot = slots[Math.floor(Math.random() * slots.length)];
  const r = Math.random();
  const rarity = r < 0.55 ? 'thuong' : r < 0.8 ? 'tot' : r < 0.95 ? 'hiem' : 'cuc-pham';
  const base = GEAR_BASE[slot], mul = GEAR_RARITY[rarity].mul * (1 + monsterLv * 0.08);
  const stats = {};
  for (const [k, v] of Object.entries(base)) stats[k] = Math.round(v * mul);
  return { id: gearSeq++, slot, rarity, stats, lv: monsterLv };
}
function gearStats(p) { // cộng chỉ số từ đồ đang mặc (kèm cường hóa)
  const s = { atk: 0, def: 0, hp: 0, mp: 0, crit: 0, spd: 0 };
  for (const g of Object.values(p.gear || {})) {
    if (!g) continue;
    const mul = 1 + (g.plus || 0) * 0.15; // mỗi cấp cường hóa +15%
    for (const [k, v] of Object.entries(g.stats)) s[k] = (s[k] || 0) + Math.round(v * mul);
  }
  return s;
}
// Cường hóa: chi phí linh thạch và tỉ lệ thành công theo cấp
function enhanceCost(g) {
  const plus = g.plus || 0;
  const rarMul = { thuong: 1, tot: 1.5, hiem: 2.5, 'cuc-pham': 4 }[g.rarity] || 1;
  return Math.round(50 * Math.pow(2.2, plus) * rarMul);
}
function enhanceRate(g) {
  const plus = g.plus || 0;
  if (plus < 3) return 100;
  if (plus < 5) return 80;
  if (plus < 7) return 60;
  if (plus < 9) return 40;
  return 25; // +9 -> +10
}
const MAX_PLUS = 10;
function doEnhance(p, gid) {
  p.bag = p.bag || []; p.gear = p.gear || {};
  // Tìm đồ: ưu tiên trong túi, sau đó đồ đang mặc
  let g = p.bag.find(x => x.id === gid), loc = 'bag';
  if (!g) {
    for (const [slot, it] of Object.entries(p.gear)) {
      if (it && it.id === gid) { g = it; loc = 'gear'; break; }
    }
  }
  if (!g) { sendTo(p, { t: 'err', text: 'Không tìm thấy trang bị!' }); return; }
  g.plus = g.plus || 0;
  if (g.plus >= MAX_PLUS) { sendTo(p, { t: 'err', text: 'Đã cường hóa tối đa!' }); return; }
  const cost = enhanceCost(g);
  if (p.lt < cost) { sendTo(p, { t: 'err', text: `Cần ${cost} linh thạch để cường hóa!` }); return; }
  p.lt -= cost;
  const rate = enhanceRate(g);
  if (Math.random() * 100 < rate) {
    g.plus++;
    sendTo(p, { t: 'sys', text: `✨ Cường hóa thành công! ${GEAR_SLOTS[g.slot]} +${g.plus}` });
  } else {
    sendTo(p, { t: 'sys', text: `💥 Cường hóa thất bại! ${GEAR_SLOTS[g.slot]} vẫn +${g.plus}` });
  }
  sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  savePlayer(p);
}
// vis: theme hình ảnh hiệu ứng — 'sword' phi kiếm, 'talisman' phù bay, 'formation' bát quái, 'danfire' đan hỏa
const HALL_SKILLS = {
  // Tạp Vụ: skill cơ bản, mở dần theo cấp
  'tap-vu': {
    'thiet-quyen': { cd: 3, mp: 8,  range: 120, dmgMul: 1.4, kind: 'bolt', targets: 1, vis: 'fist', unlockLv: 1 },
    'hoi-khi':     { cd: 12, mp: 15, kind: 'heal', healMul: 0.25, vis: 'heal', unlockLv: 2 },
    'than-hanh':   { cd: 20, mp: 15, kind: 'buff', spdMul: 1.4, spdDur: 8, vis: 'wind', unlockLv: 3 },
  },
  'kiem-cac': {
    'linh-kiem-tram':      { cd: 3,  mp: 10, range: 430, dmgMul: 1.6, kind: 'bolt',   targets: 1, vis: 'sword', unlockLv: 5 },
    'cuu-loi-kiem':        { cd: 8,  mp: 25, range: 390, dmgMul: 2.2, kind: 'aoe',    targets: 3, vis: 'sword', unlockLv: 6 },
    'phan-thien-kiem':     { cd: 10, mp: 30, range: 350, dmgMul: 2.8, kind: 'aoe',    radius: 140, vis: 'sword', unlockLv: 7 },
    'van-kiem-quy-tong':   { cd: 15, mp: 45, range: 300, dmgMul: 3.2, kind: 'nova',    radius: 230, vis: 'sword', unlockLv: 8 },
    'hon-don-kim-chung':   { cd: 20, mp: 40, range: 0,   dmgMul: 0,   kind: 'shield',  dur: 6, vis: 'sword', unlockLv: 9 },
    'khai-thien-nhat-kiem':{ cd: 60, mp: 80, range: 540, dmgMul: 8.0, kind: 'line',    width: 130, vis: 'sword', unlockLv: 10 },
    'kiem-y-thong-thien':  { cd: 45, mp: 100, range: 500, dmgMul: 12.0, kind: 'nova', radius: 300, vis: 'sword', unlockLv: 11 }, // Trúc Cơ
  },
  'than-phu': {
    'hoa-phu-lien-chau': { cd: 3,  mp: 10, range: 430, dmgMul: 1.5, kind: 'bolt', targets: 3, vis: 'talisman', unlockLv: 5 },
    'dinh-than-phu':     { cd: 8,  mp: 20, range: 380, dmgMul: 0.8, kind: 'stun', targets: 1, stunDur: 3, vis: 'talisman', unlockLv: 6 },
    'ngu-loi-phu':       { cd: 12, mp: 30, range: 360, dmgMul: 2.6, kind: 'aoe',  targets: 5, vis: 'talisman', unlockLv: 7 },
    'van-phu-trieu-tong':{ cd: 60, mp: 70, range: 420, dmgMul: 7.0, kind: 'rain', targets: 8, radius: 200, vis: 'talisman', unlockLv: 8 },
    'cuu-thien-loi-phu': { cd: 45, mp: 100, range: 450, dmgMul: 10.0, kind: 'rain', targets: 10, radius: 250, vis: 'talisman', unlockLv: 10 }, // Trúc Cơ
  },
  'tran-su': {
    'tu-linh-tieu-tran':     { cd: 3,  mp: 10, range: 400, kind: 'zone', radius: 110, dur: 5, tickMul: 0.8, vis: 'formation', unlockLv: 5 },
    'khon-long-tran':        { cd: 10, mp: 25, range: 380, kind: 'zone', radius: 130, dur: 4, tickMul: 0.5, slowMul: 0.4, slowDur: 4, stunDur: 2, vis: 'formation', unlockLv: 6 },
    'sat-phat-kiem-tran':    { cd: 15, mp: 35, range: 350, dmgMul: 3.0, kind: 'aoe', targets: 5, vis: 'formation', unlockLv: 7 },
    'cuu-cung-bat-quai-tran':{ cd: 60, mp: 70, range: 320, dmgMul: 6.0, kind: 'nova', radius: 280, slowMul: 0.5, slowDur: 4, vis: 'formation', unlockLv: 8 },
    'thien-dia-vo-cuc-tran': { cd: 45, mp: 100, range: 400, dmgMul: 9.0, kind: 'nova', radius: 350, slowMul: 0.3, slowDur: 5, vis: 'formation', unlockLv: 10 }, // Trúc Cơ
  },
  'duoc-vuong': {
    'hoi-xuan-dan-khi':  { cd: 3,  mp: 10, kind: 'heal', healMul: 0.3, vis: 'danfire', unlockLv: 5 },
    'thanh-tam-dan':     { cd: 10, mp: 20, kind: 'shield', dur: 6, healMul: 0.15, vis: 'danfire', unlockLv: 6 },
    'doc-dan-boc-phat':  { cd: 12, mp: 30, range: 360, dmgMul: 2.4, kind: 'aoe', targets: 4, poisonDur: 5, poisonMul: 0.3, vis: 'danfire', unlockLv: 7 },
    'cuu-chuyen-kim-dan':{ cd: 60, mp: 70, kind: 'heal', healMul: 0.8, atkBuffMul: 1.3, atkBuffDur: 10, vis: 'danfire', unlockLv: 8 },
    'vo-cuc-dan-dien':   { cd: 45, mp: 100, kind: 'heal', healMul: 1.0, atkBuffMul: 1.5, atkBuffDur: 15, vis: 'danfire', unlockLv: 10 }, // Trúc Cơ
  },
};
const HALL_ORDERS = {
  'tap-vu': ['thiet-quyen','hoi-khi','than-hanh'],
  'kiem-cac': ['linh-kiem-tram','cuu-loi-kiem','phan-thien-kiem','van-kiem-quy-tong','hon-don-kim-chung','khai-thien-nhat-kiem','kiem-y-thong-thien'],
  'than-phu': ['hoa-phu-lien-chau','dinh-than-phu','ngu-loi-phu','van-phu-trieu-tong','cuu-thien-loi-phu'],
  'tran-su': ['tu-linh-tieu-tran','khon-long-tran','sat-phat-kiem-tran','cuu-cung-bat-quai-tran','thien-dia-vo-cuc-tran'],
  'duoc-vuong': ['hoi-xuan-dan-khi','thanh-tam-dan','doc-dan-boc-phat','cuu-chuyen-kim-dan','vo-cuc-dan-dien'],
};
const HALL_ICONS = {
  'thiet-quyen':'icon-thiet-quyen.webp','hoi-khi':'icon-hoi-khi.webp','than-hanh':'icon-than-hanh.webp',
  'linh-kiem-tram':'icon-linh-kiem-tram.webp','cuu-loi-kiem':'icon-cuu-loi-kiem.webp','phan-thien-kiem':'icon-phan-thien-kiem.webp',
  'van-kiem-quy-tong':'icon-van-kiem-quy-tong.webp','hon-don-kim-chung':'icon-hon-don-kim-chung.webp','khai-thien-nhat-kiem':'icon-khai-thien-nhat-kiem.webp',
  'hoa-phu-lien-chau':'icon-hoa-phu-lien-chau.webp','dinh-than-phu':'icon-dinh-than-phu.webp',
  'ngu-loi-phu':'icon-ngu-loi-phu.webp','van-phu-trieu-tong':'icon-van-phu-trieu-tong.webp',
  'tu-linh-tieu-tran':'icon-tu-linh-tieu-tran.webp','khon-long-tran':'icon-khon-long-tran.webp',
  'sat-phat-kiem-tran':'icon-sat-phat-kiem-tran.webp','cuu-cung-bat-quai-tran':'icon-cuu-cung-bat-quai-tran.webp',
  'hoi-xuan-dan-khi':'icon-hoi-xuan-dan-khi.webp','thanh-tam-dan':'icon-thanh-tam-dan.webp',
  'doc-dan-boc-phat':'icon-doc-dan-boc-phat.webp','cuu-chuyen-kim-dan':'icon-cuu-chuyen-kim-dan.webp',
  'kiem-y-thong-thien':'icon-khai-thien-nhat-kiem.webp','cuu-thien-loi-phu':'icon-ngu-loi-phu.webp',
  'thien-dia-vo-cuc-tran':'icon-cuu-cung-bat-quai.webp','vo-cuc-dan-dien':'icon-cuu-chuyen-kim-dan.webp',
};
const SKILL_NAMES = {
  'thiet-quyen':'Thiết Quyền','hoi-khi':'Hồi Khí','than-hanh':'Thần Hành',
  'linh-kiem-tram':'Linh Kiếm Trảm','cuu-loi-kiem':'Cửu Lôi Kiếm Quyết','phan-thien-kiem':'Phần Thiên Kiếm',
  'van-kiem-quy-tong':'Vạn Kiếm Quy Tông','hon-don-kim-chung':'Hỗn Độn Kim Chung','khai-thien-nhat-kiem':'Khai Thiên Nhất Kiếm',
  'hoa-phu-lien-chau':'Hỏa Phù Liên Châu','dinh-than-phu':'Định Thân Phù','ngu-loi-phu':'Ngũ Lôi Phù Trận','van-phu-trieu-tong':'Vạn Phù Triều Tông',
  'tu-linh-tieu-tran':'Tụ Linh Tiểu Trận','khon-long-tran':'Khốn Long Trận','sat-phat-kiem-tran':'Sát Phạt Kiếm Trận','cuu-cung-bat-quai-tran':'Cửu Cung Bát Quái Trận',
  'hoi-xuan-dan-khi':'Hồi Xuân Đan Khí','thanh-tam-dan':'Thanh Tâm Đan','doc-dan-boc-phat':'Độc Đan Bộc Phát','cuu-chuyen-kim-dan':'Cửu Chuyển Kim Đan',
  'kiem-y-thong-thien':'Kiếm Ý Thông Thiên','cuu-thien-loi-phu':'Cửu Thiên Lôi Phù','thien-dia-vo-cuc-tran':'Thiên Địa Vô Cực Trận','vo-cuc-dan-dien':'Vô Cực Đan Điển',
};
const getSkills = p => {
  const hall = p.hall || 'tap-vu';
  const all = HALL_SKILLS[hall] || HALL_SKILLS['tap-vu'];
  // Chỉ trả skill đã mở khóa theo cấp
  const unlocked = {};
  for (const [id, s] of Object.entries(all)) {
    if ((s.unlockLv || 1) <= p.level) unlocked[id] = s;
  }
  return unlocked;
};
const getOrder = p => {
  const hall = p.hall || 'tap-vu';
  const order = HALL_ORDERS[hall] || HALL_ORDERS['tap-vu'];
  const skills = getSkills(p);
  return order.filter(id => skills[id]); // chỉ hiện skill đã mở
};
function hallData(hall) { // icons + names gửi client cho 1 Đường
  const h = HALL_ORDERS[hall] || HALL_ORDERS['tap-vu'];
  const icons = {}, names = {};
  for (const id of h) { icons[id] = HALL_ICONS[id]; names[id] = SKILL_NAMES[id]; }
  return { icons, names };
}
// Công kích hiệu dụng (tính buff Cửu Chuyển Kim Đan)
const effAtk = p => (p.atk + gearStats(p).atk) * (Date.now() < (p.atkBuffUntil || 0) ? (p.atkBuffMul || 1) : 1);
const effDef = p => p.def + gearStats(p).def;
const effCrit = p => 15 + (gearStats(p).crit || 0); // % bạo kích (cơ bản 15%)

// ---------- Quái (P1: 3 loại vòng ngoài) ----------
const MONSTERS = {
  'hac-mao-thu':  { hp: 35,  dmg: 6,  tv: 25, ltMin: 1, ltMax: 3,  speed: 120, aggro: 230, count: 40, map: 'yeu-thu', zone: { x0: 0, x1: 3840, y0: 1900, y1: 2880 }, lv: '1-3' },
  'thanh-truc-xa':{ hp: 80,  dmg: 11, tv: 55, ltMin: 3, ltMax: 6,  speed: 145, aggro: 270, count: 30, map: 'yeu-thu', zone: { x0: 0, x1: 3840, y0: 950, y1: 1900 }, lv: '3-5' },
  'da-hoa-lang':  { hp: 160, dmg: 20, tv: 120, ltMin: 6, ltMax: 12, speed: 165, aggro: 310, count: 20, map: 'yeu-thu', zone: { x0: 0, x1: 3840, y0: 0, y1: 950 }, lv: '5-7' },
  // Hắc Phong Lĩnh: quái mạnh hơn
  'am-anh-thu':   { hp: 200, dmg: 24, tv: 150, ltMin: 6, ltMax: 12, speed: 170, aggro: 300, count: 20, map: 'hac-phong', zone: { x0: 0, x1: 3840, y0: 1440, y1: 2880 }, lv: '7-9' },
  'hac-phong-bao':{ hp: 320, dmg: 32, tv: 220, ltMin: 10, ltMax: 18, speed: 180, aggro: 340, count: 25, map: 'hac-phong', zone: { x0: 0, x1: 3840, y0: 0, y1: 1440 }, lv: '9-12' },
  // Quái độ kiếp: chỉ spawn khi độ kiếp ở Lôi Kiếp Đài
  'loi-kiep-thu':  { hp: 500, dmg: 40, tv: 0, ltMin: 20, ltMax: 40, speed: 190, aggro: 9999, count: 0, map: 'loi-kiep', lv: '9' },
  // Linh Mạch Cổ Địa: quái Trúc Cơ (cấp 10-15)
  'co-dia-thu':    { hp: 800, dmg: 60, tv: 400, ltMin: 15, ltMax: 25, speed: 185, aggro: 350, count: 18, map: 'linh-mach', zone: { x0: 0, x1: 3840, y0: 1440, y1: 2880 }, lv: '10-12' },
  'linh-mach-yeu': { hp: 1200, dmg: 85, tv: 650, ltMin: 25, ltMax: 40, speed: 195, aggro: 380, count: 15, map: 'linh-mach', zone: { x0: 0, x1: 3840, y0: 0, y1: 1440 }, lv: '12-15' },
  // U Minh Cốc: quái cấp 15-18
  'u-minh-quy':    { hp: 1800, dmg: 110, tv: 900, ltMin: 30, ltMax: 50, speed: 200, aggro: 400, count: 16, map: 'u-minh', zone: { x0: 0, x1: 3840, y0: 1440, y1: 2880 }, lv: '15-16' },
  'minh-ha-cot':   { hp: 2500, dmg: 140, tv: 1200, ltMin: 40, ltMax: 65, speed: 210, aggro: 420, count: 14, map: 'u-minh', zone: { x0: 0, x1: 3840, y0: 0, y1: 1440 }, lv: '16-18' },
  // Thiên Kiếm Nhai: quái cấp 18-20
  'kiem-khi-linh': { hp: 3200, dmg: 170, tv: 1500, ltMin: 50, ltMax: 80, speed: 215, aggro: 440, count: 14, map: 'thien-kiem', zone: { x0: 0, x1: 3840, y0: 1440, y1: 2880 }, lv: '18-19' },
  'thien-kiem-thu':{ hp: 4200, dmg: 210, tv: 2000, ltMin: 65, ltMax: 100, speed: 225, aggro: 460, count: 12, map: 'thien-kiem', zone: { x0: 0, x1: 3840, y0: 0, y1: 1440 }, lv: '19-20' },
};

// ---------- NPC Chương 1 (đều ở map tông môn) ----------
const NPCS = {
  'dich-chuyen':  { name: 'Trưởng Lão Dịch Chuyển', x: 1920, y: 2000, map: 'tong-mon', teleport: true },
  // NPC tông môn mới
  'chuong-mon':   { name: 'Chưởng Môn Huyền Cơ', x: 1920, y: 1500, map: 'tong-mon', dialog: 'chưởng môn' },
  'truyen-cong':  { name: 'Trưởng Lão Truyền Công', x: 1700, y: 2000, map: 'tong-mon', dialog: 'truyền công' },
  'dan-su':       { name: 'Đan Sư Dược Trần', x: 2140, y: 2000, map: 'tong-mon', dialog: 'đan sư' },
  'thu-kho':      { name: 'Thủ Kho Linh Bảo', x: 1920, y: 2300, map: 'tong-mon', dialog: 'thủ kho' },
  // NPC các map khác
  'thu-vien':     { name: 'Thủ Thư Cổ Nguyệt', x: 1920, y: 2200, map: 'tang-kinh', dialog: 'thủ thư' },
  'luyen-dan-su': { name: 'Luyện Đan Sư Hỏa Vân', x: 1920, y: 2200, map: 'luyen-dan', dialog: 'luyện đan' },
};

// ---------- Nhiệm vụ Chương 1 (chuỗi tuyến tính) ----------
const QUESTS = {
  // Chương 1: Nhập môn
  'Q01': { name: 'Bái Kiến Chưởng Môn', giver: 'dich-chuyen', turnin: 'chuong-mon',
    objectives: [{ type: 'talk', npc: 'chuong-mon', text: 'Gặp Chưởng Môn Huyền Cơ' }],
    reward: { tv: 100, lt: 20 },
    offer: ['Ngươi là đệ tử mới? Đến bái kiến Chưởng Môn đi.'],
    done: ['Huyết Ma sắp xuất thế, tông môn cần người tài như ngươi!', 'Hãy đi săn yêu thú rèn luyện đi.'] },
  'Q02': { name: 'Săn Yêu Thú', giver: 'chuong-mon', turnin: 'chuong-mon',
    objectives: [{ type: 'kill', mob: 'hac-mao-thu', count: 10, text: 'Diệt 10 Hắc Mao Thử' }],
    reward: { tv: 200, lt: 30 },
    offer: ['Yêu Thú Sơn Mạch yêu khí ngút trời.', 'Đi diệt 10 Hắc Mao Thử rèn luyện!'],
    done: ['Tốt lắm! Ngươi đã có phong thái tu sĩ rồi.'] },
  'Q03': { name: 'Thử Thách Rắn Xanh', giver: 'chuong-mon', turnin: 'truyen-cong',
    objectives: [{ type: 'kill', mob: 'thanh-truc-xa', count: 8, text: 'Diệt 8 Thanh Trúc Xà' }],
    reward: { tv: 300, lt: 50 },
    offer: ['Thanh Trúc Xà độc tính mạnh, cẩn thận!', 'Diệt 8 con rồi về gặp Trưởng Lão Truyền Công.'],
    done: ['Không tệ! Ta sẽ chỉ điểm thêm cho ngươi.'] },
  // Chương 2: Hắc Phong Lĩnh
  'Q04': { name: 'Hắc Phong Nguy Cơ', giver: 'truyen-cong', turnin: 'chuong-mon',
    objectives: [{ type: 'kill', mob: 'am-anh-thu', count: 10, text: 'Diệt 10 Âm Ảnh Thử ở Hắc Phong Lĩnh' }],
    reward: { tv: 500, lt: 80 },
    offer: ['Hắc Phong Lĩnh có dị động, ma khí lan tràn.', 'Đi điều tra, diệt 10 Âm Ảnh Thử!'],
    done: ['Ma khí quả nhiên đang mạnh lên...'] },
  'Q05': { name: 'Báo Đen Hắc Phong', giver: 'chuong-mon', turnin: 'chuong-mon',
    objectives: [{ type: 'kill', mob: 'hac-phong-bao', count: 8, text: 'Diệt 8 Hắc Phong Báo' }],
    reward: { tv: 800, lt: 120 },
    offer: ['Hắc Phong Báo là tay sai của Huyết Ma.', 'Diệt 8 con để suy yếu chúng!'],
    done: ['Ngươi đã sẵn sàng độ kiếp chưa?'] },
  // Chương 3: Độ kiếp
  'Q06': { name: 'Cửu Cửu Lôi Kiếp', giver: 'chuong-mon', turnin: 'chuong-mon',
    objectives: [{ type: 'tribulate', text: 'Vượt qua Cửu Cửu Lôi Kiếp' }],
    reward: { tv: 1000, lt: 200 },
    offer: ['Đến Lôi Kiếp Đài, độ kiếp thành Trúc Cơ!', 'Đánh bại 9 đợt Lôi Kiếp Thú!'],
    done: ['Trúc Cơ thành công! Tông môn có thêm một trụ cột!'] },
  // Chương 4: Linh Mạch Cổ Địa
  'Q07': { name: 'Khám Phá Cổ Địa', giver: 'chuong-mon', turnin: 'dan-su',
    objectives: [{ type: 'kill', mob: 'co-dia-thu', count: 10, text: 'Diệt 10 Cổ Địa Thú' }],
    reward: { tv: 1500, lt: 300 },
    offer: ['Linh Mạch Cổ Địa linh khí dồi dào nhưng yêu thú hung mãnh.', 'Đi rèn luyện đi!'],
    done: ['Đan dược này tặng ngươi, dùng khi nguy cấp.'] },
  'Q08': { name: 'Yêu Vật Linh Mạch', giver: 'dan-su', turnin: 'thu-kho',
    objectives: [{ type: 'kill', mob: 'linh-mach-yeu', count: 8, text: 'Diệt 8 Linh Mạch Yêu' }],
    reward: { tv: 2000, lt: 400 },
    offer: ['Linh Mạch Yêu đang phá hoại linh mạch!', 'Diệt chúng rồi về gặp Thủ Kho nhận thưởng.'],
    done: ['Tông môn ghi nhận công lao của ngươi!'] },
  // Chương 5: U Minh Cốc
  'Q09': { name: 'U Minh Thám Hiểm', giver: 'thu-kho', turnin: 'chuong-mon',
    objectives: [{ type: 'kill', mob: 'u-minh-quy', count: 10, text: 'Diệt 10 U Minh Quỷ' }],
    reward: { tv: 3000, lt: 600 },
    offer: ['U Minh Cốc là nơi Huyết Ma từng tu luyện.', 'Vào đó điều tra!'],
    done: ['Huyết Ma sắp phá phong ấn rồi...'] },
  'Q10': { name: 'Quyết Chiến Huyết Ma', giver: 'chuong-mon', turnin: 'chuong-mon',
    objectives: [{ type: 'kill', mob: 'minh-ha-cot', count: 5, text: 'Diệt 5 Minh Hà Cốt Ma' }],
    reward: { tv: 5000, lt: 1000 },
    offer: ['Đây là trận chiến cuối cùng!', 'Diệt Minh Hà Cốt Ma, ngăn Huyết Ma xuất thế!'],
    done: ['Ngươi đã cứu tông môn! Tên ngươi sẽ lưu danh thiên cổ!'] },
};
const QUEST_ORDER = Object.keys(QUESTS);

// ---------- Vật tương tác (lá, thảo, giếng) — đều ở map tông môn ----------
const INTERACTS = [
  { id: 'la1', type: 'la', x: 1580, y: 1420, map: 'tong-mon' }, { id: 'la2', type: 'la', x: 1820, y: 1420, map: 'tong-mon' },
  { id: 'la3', type: 'la', x: 1580, y: 1600, map: 'tong-mon' }, { id: 'la4', type: 'la', x: 1820, y: 1600, map: 'tong-mon' },
  { id: 'la5', type: 'la', x: 1700, y: 1690, map: 'tong-mon' },
  { id: 'gieng', type: 'gieng', x: 2280, y: 1230, map: 'tong-mon' },
];
{ // 12 gốc thảo quanh Dược Trần Tử: 10 tươi + 2 héo (vị trí 3 và 8)
  const cx = 2140, cy = 1500;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI * 2 / 12, r = i % 2 ? 190 : 145;
    INTERACTS.push({ id: 'lt' + i, type: (i === 3 || i === 8) ? 'linh-thao-heo' : 'linh-thao',
      x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r), map: 'tong-mon' });
  }
}

const tvNeed = lvl => {
  // Kiểu MU: cấp đầu lên nhanh, cấp cao chậm dần
  const fast = { 1: 40, 2: 70, 3: 120, 4: 180 };
  if (fast[lvl]) return fast[lvl];
  if (lvl < 10) return Math.round(220 * Math.pow(1.45, lvl - 5)); // Luyện Khí 5-9
  // Trúc Cơ 10-19: tốn hơn
  return Math.round(1500 * Math.pow(1.35, lvl - 10));
};
// Hiển thị cảnh giới: 1-9 Luyện Khí, 10-19 Trúc Cơ
function realmName(lvl) {
  if (lvl < 10) return `Luyện Khí tầng ${lvl}`;
  return `Trúc Cơ tầng ${lvl - 9}`;
}

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
const zones = []; // trận pháp đặt dưới đất: {id,x,y,r,until,nextTick,tickMul,slowMul,slowDur,stunDur,owner,vis,map}
let zidSeq = 1;

function newPlayerState(name) {
  return {
    name, hall: null, gender: 'nam', map: 'tong-mon', x: WORLD_W/2, y: WORLD_H/2, dir: 0,
    tx: null, ty: null, moving: false,
    level: 1, tv: 0, hp: 120, maxhp: 120, mp: 80, maxmp: 80,
    atk: 24, def: 8, lt: 20, potions: 3,
    gear: {}, bag: [], // trang bị đang mặc + túi đồ
    cds: {}, shieldUntil: 0, protectUntil: 0, lastAtk: 0, dead: false, respawnAt: 0,
    quests: { active: null, done: [] }, dch: 0, titles: [], ketbai: false,
    rank: 'tap-vu', hallChosen: false, // P3: bậc tông môn + đã chọn Đường chưa
    carrying: false, collected: [], channel: null,
  };
}
function loadPlayer(name) {
  const fp = path.join(SAVE_DIR, name + '.json');
  if (fs.existsSync(fp)) {
    try { return Object.assign(newPlayerState(name), JSON.parse(fs.readFileSync(fp))); } catch(e) {}
  }
  return newPlayerState(name);
}
function savePlayer(p) {
  try { fs.writeFileSync(path.join(SAVE_DIR, p.name + '.json'), JSON.stringify(p)); } catch(e) {}
}
function deletePlayer(name) {
  try { fs.unlinkSync(path.join(SAVE_DIR, name + '.json')); } catch(e) {}
}
// Giá bán trang bị theo phẩm chất và cường hóa
function sellPrice(g) {
  const base = { thuong: 30, tot: 80, hiem: 200, 'cuc-pham': 500 }[g.rarity] || 30;
  return Math.round(base * (1 + (g.plus || 0) * 0.5));
}
function doSell(p, gid) {
  p.bag = p.bag || [];
  const idx = p.bag.findIndex(g => g.id === gid);
  if (idx < 0) { sendTo(p, { t: 'err', text: 'Không tìm thấy trang bị!' }); return; }
  const g = p.bag[idx];
  const price = sellPrice(g);
  p.bag.splice(idx, 1);
  p.lt += price;
  sendTo(p, { t: 'sys', text: `💰 Đã bán ${GEAR_SLOTS[g.slot]} [${GEAR_RARITY[g.rarity].name}] +${price} linh thạch` });
  sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  savePlayer(p);
}

let grpSeq = 1; // id bầy quái
function spawnMonster(type, map, initial, gx, gy, grp) {
  const cfg = MONSTERS[type];
  map = map || 'yeu-thu';
  const anchor = MAP_ANCHOR[map] || SPAWN;
  const z = cfg.zone;
  // Spawn trong vùng cấp độ của loại quái
  const zx = z ? z.x0 + 100 + Math.random() * (z.x1 - z.x0 - 200) : 200 + Math.random() * (WORLD_W - 400);
  const zy = z ? z.y0 + 100 + Math.random() * (z.y1 - z.y0 - 200) : 200 + Math.random() * (WORLD_H - 400);
  const m = {
    id: midSeq++, type, cfg, map,
    x: gx !== undefined ? gx + (Math.random()-0.5)*220 : zx,
    y: gy !== undefined ? gy + (Math.random()-0.5)*220 : zy,
    hp: cfg.hp, maxhp: cfg.hp,
    state: 'idle', wx: 0, wy: 0, wt: 0, target: null, atkAt: 0, dead: false, respawnAt: 0,
    stunUntil: 0, slowUntil: 0, slowMul: 1, poisonUntil: 0, poisonMul: 0, poisonBy: null, poisonTick: 0, // P3: choáng/chậm/độc
    grp: grp || 0, // bầy quái — cùng bầy thì cùng aggro
  };
  if (!initial) { m.x = anchor.x + (Math.random()-0.5)*1600; m.y = anchor.y + (Math.random()-0.5)*1200; }
  // Đẩy quái ra khỏi vùng an toàn quanh điểm đáp của map
  {
    const dx = m.x - anchor.x, dy = m.y - anchor.y, d = Math.hypot(dx, dy);
    if (d < 650) { const a = d > 1 ? Math.atan2(dy, dx) : Math.random()*Math.PI*2; m.x = anchor.x + Math.cos(a)*650; m.y = anchor.y + Math.sin(a)*650; }
  }
  monsters.set(m.id, m);
  return m;
}
// Spawn ban đầu: quái theo bầy 3-5 con, theo map của từng loại
for (const [t, c] of Object.entries(MONSTERS)) {
  let left = c.count;
  const mmap = c.map || 'yeu-thu';
  while (left > 0) {
    const grpSize = Math.min(left, 3 + Math.floor(Math.random() * 3)); // 3-5 con/bầy
    const grp = grpSeq++;
    const gx = 200 + Math.random() * (WORLD_W - 400), gy = 200 + Math.random() * (WORLD_H - 400);
    for (let i = 0; i < grpSize; i++) spawnMonster(t, mmap, true, gx, gy, grp);
    left -= grpSize;
  }
}
spawnArenaBoss(); // boss Thí Luyện Trường
// Quái hồi sinh: về gần bầy cũ nếu còn
function alertGroup(m, target) {
  if (!m.grp) return;
  for (const o of monsters.values()) {
    if (o.dead || o.id === m.id || o.grp !== m.grp || o.map !== m.map) continue;
    if (Math.hypot(o.x - m.x, o.y - m.y) > 500) continue;
    if (o.state !== 'chase') { o.state = 'chase'; o.target = target; }
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Dữ liệu theo map gửi client ----------
const npcsFor = () => Object.entries(NPCS).map(([id, n]) => ({ id, name: n.name, x: n.x, y: n.y, map: n.map }));
const interactsFor = map => INTERACTS.filter(i => i.map === map);
const portalsFor = map => PORTALS.filter(q => q.from === map).map(q => ({ id: q.id, x: q.x, y: q.y, to: q.to, label: q.label }));
function sendMapData(p) { // gửi khi vào map mới
  sendTo(p, { t: 'mapchange', map: p.map, mapName: MAPS[p.map].name,
    npcs: npcsFor(), interacts: interactsFor(p.map), portals: portalsFor(p.map) });
}
function usePortal(p, id) {
  const pt = PORTALS.find(q => q.id === id);
  if (!pt || pt.from !== p.map) return;
  if (Math.hypot(p.x - pt.x, p.y - pt.y) > 160) { sendTo(p, { t: 'err', text: 'Lại gần cổng hơn đã!' }); return; }
  if (pt.needLv && p.level < pt.needLv) { sendTo(p, { t: 'err', text: `Cần Luyện Khí tầng ${pt.needLv} mới vào được!` }); return; }
  p.map = pt.to; p.x = pt.tx; p.y = pt.ty;
  p.moving = false; p.tx = p.ty = null; p.channel = null;
  sendMapData(p);
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  sendTo(p, { t: 'sys', text: `🌀 Đã đến [${MAPS[p.map].name}]` });
}

// ---------- WebSocket ----------
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    const p = players.get(ws);
    if (msg.t === 'login') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Vô Danh';
      const gender = msg.gender === 'nu' ? 'nu' : 'nam';
      const cls = ['kiem-cac','than-phu','tran-su'].includes(msg.class) ? msg.class : 'kiem-cac';
      const st = loadPlayer(name);
      st.gender = gender; // luôn cập nhật theo lựa chọn đăng nhập
      if (!st.hall) { st.hall = cls; st.hallChosen = true; st.rank = 'ngoai-mon'; } // chọn class từ đầu, bỏ Tạp Vụ
      st.dead = false;
      st.map = 'tong-mon'; // về tông môn an toàn khi đăng nhập
      st.x = SPAWN.x; st.y = SPAWN.y; // về điểm spawn an toàn
      st.protectUntil = Date.now() + 5000; // bảo hộ 5s lúc mới vào
      st.channel = null; st.carrying = false; // reset trạng thái vận công/gánh nước
      players.set(ws, st); ws._p = st;
      const hd0 = hallData(st.hall);
      ws.send(JSON.stringify({ t: 'welcome', you: pubPlayer(st), skills: getSkills(st), order: getOrder(st),
        icons: hd0.icons, names: hd0.names,
        map: st.map, mapName: MAPS[st.map].name,
        npcs: npcsFor(), quest: questInfo(st), interacts: interactsFor(st.map),
        portals: portalsFor(st.map), collected: st.collected }));
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
    } else if (msg.t === 'tribulate') {
      startTribulation(p);
    } else if (msg.t === 'teleport') {
      doTeleport(p, String(msg.map));
    } else if (msg.t === 'equip') {
      const gid = +msg.id; p.bag = p.bag || []; p.gear = p.gear || {};
      const idx = p.bag.findIndex(g => g.id === gid);
      if (idx >= 0) {
        const g = p.bag[idx];
        const old = p.gear[g.slot];
        if (old) p.bag.push(old); // tháo đồ cũ ra túi
        p.gear[g.slot] = g;
        p.bag.splice(idx, 1);
        // Cập nhật maxhp/maxmp từ đồ
        const gs = gearStats(p);
        sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
        sendTo(p, { t: 'sys', text: `✅ Đã mặc ${GEAR_RARITY[g.rarity].icon} ${GEAR_SLOTS[g.slot]} [${GEAR_RARITY[g.rarity].name}]` });
        sendTo(p, { t: 'me', you: pubPlayer(p) });
      }
    } else if (msg.t === 'unequip') {
      const slot = String(msg.slot); p.gear = p.gear || {}; p.bag = p.bag || [];
      if (p.gear[slot]) { p.bag.push(p.gear[slot]); delete p.gear[slot];
        sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
        sendTo(p, { t: 'me', you: pubPlayer(p) });
      }
    } else if (msg.t === 'enhance') {
      doEnhance(p, +msg.id);
    } else if (msg.t === 'potion') {
      usePotion(p);
    } else if (msg.t === 'deletechar') {
      // Xóa nhân vật: xóa save, kick khỏi game
      deletePlayer(p.name);
      players.delete(ws);
      broadcast({ t: 'leave', name: p.name });
      try { ws.close(); } catch(e) {}
      return;
    } else if (msg.t === 'sell') {
      doSell(p, +msg.id);
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
    } else if (msg.t === 'portal') {
      usePortal(p, String(msg.id));
    } else if (msg.t === 'promote') {
      promote(p);
    } else if (msg.t === 'joinhall') {
      joinHall(p, msg.hall);
    } else if (msg.t === 'wantshall') {
      if (p.rank === 'ngoai-mon' && !p.hallChosen) sendTo(p, { t: 'canhall', halls: HALLS });
    }
  });
  ws.on('close', () => {
    const p = players.get(ws);
    if (p) { savePlayer(p); players.delete(ws); broadcast({ t: 'leave', name: p.name }); }
  });
});

function pubPlayer(p) {
  const gs = gearStats(p);
  // Phẩm chất cao nhất đang mặc -> aura hiệu ứng
  const rarOrder = { thuong: 0, tot: 1, hiem: 2, 'cuc-pham': 3 };
  let bestRar = null, bestOrd = -1;
  for (const g of Object.values(p.gear || {})) {
    if (g && (rarOrder[g.rarity] || 0) > bestOrd) { bestOrd = rarOrder[g.rarity]; bestRar = g.rarity; }
  }
  return { name: p.name, hall: p.hall, x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2),
    hp: Math.ceil(p.hp), maxhp: p.maxhp + gs.hp, mp: Math.ceil(p.mp), maxmp: p.maxmp + gs.mp,
    level: p.level, tv: p.tv, tvNeed: tvNeed(p.level), lt: p.lt, potions: p.potions,
    atk: p.atk + gs.atk, def: (p.def || 8) + gs.def, crit: effCrit(p),
    dch: p.dch || 0, titles: p.titles || [], ketbai: !!p.ketbai, qm: npcMarkers(p),
    rank: p.rank || 'tap-vu', hall: p.hall || null, hallChosen: !!p.hallChosen, gender: p.gender || 'nam',
    trucCo: !!p.trucCo, gear: p.gear || {}, bag: p.bag || [], aura: bestRar,
    moving: p.moving, dead: p.dead, shield: Date.now() < p.shieldUntil };
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const [ws] of players) if (ws !== except && ws.readyState === 1) ws.send(s);
}
// Broadcast chỉ cho người chơi ở cùng map (fx/dmg của map nào chỉ hiện ở map đó)
function broadcastMap(map, msg, except) {
  const s = JSON.stringify(msg);
  for (const [ws, pl] of players) if (pl.map === map && ws !== except && ws.readyState === 1) ws.send(s);
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
  return { active: { id: a.id, name: q.name, step: a.step, count: a.count, text: o.text + prog, done: false, talkNpc: o.type === 'talk' ? o.npc : null,
    gather: o.type === 'collect' ? o.item : (o.type === 'interact' ? o.obj : null), killMob: o.type === 'kill' ? o.mob : null,
    tribulate: o.type === 'tribulate' }, done };
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
  let lines = ['Muốn đi đâu? Ta đưa ngươi đi ngay.'];
  // Dialog riêng cho từng NPC
  const dialogs = {
    'chuong-mon': [
      'Ta là Huyền Cơ Tử, chưởng môn Thanh Huyền Tông.',
      'Ma đạo đang trỗi dậy, Huyết Ma Động phong ấn sắp vỡ.',
      'Ngươi hãy tu luyện thật tốt, tông môn trông cậy vào ngươi!',
    ],
    'truyen-cong': [
      'Muốn học công pháp mới? Hãy đột phá cảnh giới đi.',
      'Mỗi tầng mới sẽ mở khóa kỹ năng mạnh hơn.',
    ],
    'dan-su': [
      'Đan dược là bảo bối của tu sĩ.',
      'Hồi Khí Đan hết thì đi đánh quái kiếm linh thạch mua thêm nhé.',
    ],
    'thu-kho': [
      'Kho linh bảo của tông môn đây.',
      'Trang bị không dùng thì bán đi, đừng để chật túi!',
    ],
    'thu-vien': [
      'Tàng Kinh Các chứa vô số bí tịch.',
      'Đọc sách vạn quyển, tu hành mới tinh thông.',
    ],
    'luyen-dan-su': [
      'Lửa lò đang cháy, đan sắp thành!',
      'Ngươi có linh thảo không? Ta luyện giúp cho.',
    ],
  };
  if (dialogs[npcId]) lines = dialogs[npcId];
  sendTo(p, { t: 'dlg', npc: npcId, name: npc.name, lines, canAccept: false, canTurnin: false, qid: null,
    canTeleport: !!npc.teleport, teleports: npc.teleport ? getTeleports(p) : undefined });
}
function getTeleports(p) {
  // Danh sách map dịch chuyển được (kèm yêu cầu cấp)
  return [
    { map: 'yeu-thu', name: 'Yêu Thú Sơn Mạch', needLv: 1 },
    { map: 'hac-phong', name: 'Hắc Phong Lĩnh', needLv: 5 },
    { map: 'thi-luyen', name: 'Thí Luyện Trường', needLv: 7 },
    { map: 'loi-kiep', name: 'Lôi Kiếp Đài', needLv: 1 },
    { map: 'linh-mach', name: 'Linh Mạch Cổ Địa (Trúc Cơ)', needLv: 10 },
    { map: 'u-minh', name: 'U Minh Cốc (15+)', needLv: 15 },
    { map: 'thien-kiem', name: 'Thiên Kiếm Nhai (18+)', needLv: 18 },
  ].filter(t => p.level >= t.needLv && p.map !== t.map);
}
function doTeleport(p, map) {
  const dest = getTeleports(p).find(t => t.map === map);
  if (!dest) { sendTo(p, { t: 'err', text: 'Không thể dịch chuyển đến đó!' }); return; }
  const anchor = MAP_ANCHOR[map] || SPAWN;
  p.map = map; p.x = anchor.x; p.y = anchor.y;
  p.moving = false; p.tx = p.ty = null; p.channel = null;
  sendMapData(p);
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  sendTo(p, { t: 'sys', text: `🌀 Dịch chuyển đến [${MAPS[map].name}]` });
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
  if (r.gear) { // thưởng trang bị
    p.bag = p.bag || [];
    for (let i = 0; i < r.gear; i++) {
      const g = rollGear(p.level);
      // Quest thưởng đồ Tốt trở lên
      if (g.rarity === 'thuong') g.rarity = 'tot';
      const mul = GEAR_RARITY[g.rarity].mul * (1 + p.level * 0.08);
      for (const k of Object.keys(g.stats)) g.stats[k] = Math.round(GEAR_BASE[g.slot][k] * mul);
      p.bag.push(g);
    }
    sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
  }
  if (qid === 'C1-03') p.carrying = false;
  p.quests.done.push(qid);
  p.quests.active = null;
  broadcast({ t: 'sys', text: `🎉 ${p.name} hoàn thành nhiệm vụ [${q.name}]!` });
  refreshQuest(p);
}
// ---------- P3: Bậc tông môn + gia nhập Đường ----------
function canPromote(p) {
  return p.rank === 'tap-vu' && p.level >= 5 && (p.dch || 0) >= 150 && (p.quests.done || []).length >= 6;
}
function promote(p) {
  if (p.rank !== 'tap-vu') { sendTo(p, { t: 'err', text: 'Ngươi đã là Ngoại Môn trở lên rồi.' }); return; }
  if (p.level < 5) { sendTo(p, { t: 'err', text: 'Cần đạt Luyện Khí tầng 5!' }); return; }
  if ((p.dch || 0) < 150) { sendTo(p, { t: 'err', text: `Cần 150 điểm cống hiến! (đang có ${p.dch || 0})` }); return; }
  if ((p.quests.done || []).length < 6) { sendTo(p, { t: 'err', text: 'Hãy hoàn thành Chương 1: Tạp Dịch Viện!' }); return; }
  p.rank = 'ngoai-mon';
  savePlayer(p); // lưu ngay — tránh mất khi server restart trước autosave
  broadcast({ t: 'sys', text: `🎉 ${p.name} đã thăng lên đệ tử Ngoại Môn!` });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  sendTo(p, { t: 'canhall', halls: HALLS }); // mở UI chọn Đường
}
function joinHall(p, hall) {
  hall = String(hall);
  if (p.rank !== 'ngoai-mon') { sendTo(p, { t: 'err', text: 'Cần lên Ngoại Môn trước!' }); return; }
  if (p.hallChosen) { sendTo(p, { t: 'err', text: 'Ngươi đã chọn Đường rồi.' }); return; }
  if (!HALLS[hall]) return;
  p.hall = hall; p.hallChosen = true; p.cds = {};
  savePlayer(p); // lưu ngay — tránh mất khi server restart trước autosave
  const hd = hallData(hall);
  sendTo(p, { t: 'hallskills', skills: getSkills(p), order: getOrder(p), icons: hd.icons, names: hd.names });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  broadcast({ t: 'sys', text: `🏛️ ${p.name} đã gia nhập ${HALLS[hall].icon} ${HALLS[hall].name}!` });
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
  if (it.map !== p.map) return; // vật ở map khác
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
  const withered = it.type === 'linh-thao-heo'; // gốc héo chỉ phạt -1, không mất vĩnh viễn (tránh kẹt NV)
  if (!withered) p.collected.push(it.id);
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
  if (!withered) broadcast({ t: 'gathered', id: it.id }); // gốc héo vẫn hiện để hái lại
}

// ---------- Boss Thí Luyện Trường: Hắc Phong Lão Yêu ----------
function spawnArenaBoss() {
  for (const m of monsters.values()) if (!m.dead && m.type === 'hac-phong-lao-yeu') return;
  const cfg = { hp: 3000, dmg: 45, tv: 800, ltMin: 50, ltMax: 80, speed: 140, aggro: 9999 };
  const m = { id: midSeq++, type: 'hac-phong-lao-yeu', cfg, boss: true, arenaBoss: true,
    map: 'thi-luyen', x: 1920, y: 1200, hp: cfg.hp, maxhp: cfg.hp,
    state: 'idle', wx: 0, wy: 0, wt: 0, target: null, atkAt: 0, dead: false, respawnAt: 0,
    stunUntil: 0, slowUntil: 0, slowMul: 1, poisonUntil: 0, poisonMul: 0, poisonBy: null, poisonTick: 0, grp: 0 };
  monsters.set(m.id, m);
  broadcast({ t: 'sys', text: '👹 Hắc Phong Lão Yêu xuất hiện ở Thí Luyện Trường!' });
}

// ---------- Boss Thiết Bì Dã Trư (C1-06) ----------
function spawnBoss(x, y, nearP) {
  for (const m of monsters.values()) if (!m.dead && m.boss) return m; // chỉ 1 boss mỗi lúc
  const cfg = { hp: 1500, dmg: 35, tv: 300, ltMin: 20, ltMax: 20, speed: 150, aggro: 9999 };
  const m = { id: midSeq++, type: 'thiet-bi-da-tru', cfg, boss: true, bursted: false,
    map: nearP ? nearP.map : 'tong-mon',
    x: clamp(x, 200, WORLD_W - 200), y: clamp(y, 200, WORLD_H - 200),
    hp: cfg.hp, maxhp: cfg.hp, state: 'chase', wx: 0, wy: 0, wt: 0,
    target: nearP || null, atkAt: 0, dead: false, respawnAt: 0 };
  monsters.set(m.id, m);
  broadcast({ t: 'sys', text: '🐗 Thiết Bì Dã Trư xuất hiện! Cẩn thận!' });
  return m;
}

// ---------- Chiến đấu (chỉ quái cùng map với người chơi) ----------
function nearestMonsters(x, y, range, n, map) {
  return [...monsters.values()]
    .filter(m => !m.dead && m.map === map && dist({x,y}, m) <= range)
    .sort((a, b) => dist({x,y}, a) - dist({x,y}, b))
    .slice(0, n);
}

function damageMonster(m, dmg, p, crit) {
  if (m.dead) return;
  m.hp -= dmg;
  m.target = p; m.state = 'chase'; alertGroup(m, p); // bị đánh -> cả bầy bu lại
  // Bộc phát Hỗn Độn Linh Căn: lần đầu máu boss <30% -> đánh 400 + hất văng
  if (m.boss && !m.bursted && p && m.hp < m.maxhp * 0.3) {
    m.bursted = true;
    m.hp -= 400;
    const a = Math.atan2(m.y - p.y, m.x - p.x);
    m.x = clamp(m.x + Math.cos(a) * 200, 0, WORLD_W);
    m.y = clamp(m.y + Math.sin(a) * 200, 0, WORLD_H);
    broadcastMap(m.map, { t: 'burst', x: Math.round(p.x), y: Math.round(p.y), by: p.name });
    broadcast({ t: 'sys', text: `⚡ Hỗn Độn Linh Căn của ${p.name} bộc phát!` });
  }
  broadcastMap(m.map, { t: 'dmg', mid: m.id, dmg: Math.round(dmg), hp: Math.max(0, Math.ceil(m.hp)), maxhp: m.maxhp, crit: crit || undefined });
  if (m.hp <= 0) killMonster(m, p);
}

function killMonster(m, p) {
  m.dead = true;
  m.respawnAt = Date.now() + (m.arenaBoss ? 300000 : m.boss ? 45000 : 12000); // boss arena 5 phút
  const ltGain = m.cfg.ltMin + Math.floor(Math.random() * (m.cfg.ltMax - m.cfg.ltMin + 1));
  if (p && !p.dead) {
    p.lt += ltGain;
    gainTv(p, m.cfg.tv);
    // Điểm cống hiến từ săn quái — cày chay cũng lên được Ngoại Môn, không bị ép làm NV
    let dchGain = 0;
    if (m.boss) dchGain = 10;
    else if (m.type === 'da-hoa-lang') dchGain = 1;
    else if (Math.random() < 0.2) dchGain = 1;
    if (dchGain > 0) { p.dch = (p.dch || 0) + dchGain; }
    // 15% rơi Hồi Khí Đan
    if (Math.random() < 0.15) { p.potions++; sendTo(p, { t: 'loot', text: '+1 Hồi Khí Đan' }); }
    // Rớt trang bị: boss 100%, lang 12%, khác 6%
    const gearChance = m.boss ? 1 : m.type === 'da-hoa-lang' ? 0.12 : 0.06;
    if (Math.random() < gearChance) {
      const g = rollGear(p.level);
      p.bag = p.bag || []; p.bag.push(g);
      const rn = GEAR_RARITY[g.rarity];
      sendTo(p, { t: 'loot', text: `${rn.icon} ${GEAR_SLOTS[g.slot]} [${rn.name}]! Mở túi (B) để mặc.` });
      sendTo(p, { t: 'gearupdate', bag: p.bag, gear: p.gear });
    }
    sendTo(p, { t: 'loot', text: `+${ltGain} linh thạch · +${m.cfg.tv} tu vi` + (dchGain > 0 ? ` · +${dchGain} ĐCH` : '') });
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
  broadcastMap(m.map, { t: 'mdie', mid: m.id });
}

// ---------- Độ Kiếp ----------
function canTribulate(p) {
  return p.level >= 9 && !p.trucCo && p.tv >= tvNeed(9);
}
function startTribulation(p) {
  if (!canTribulate(p)) { sendTo(p, { t: 'err', text: 'Chưa đủ điều kiện độ kiếp!' }); return; }
  if (p.map !== 'loi-kiep') { sendTo(p, { t: 'err', text: 'Phải đến Lôi Kiếp Đài (cổng tây tông môn) mới độ kiếp được!' }); return; }
  if (p.tribulation) { sendTo(p, { t: 'err', text: 'Đang độ kiếp!' }); return; }
  p.tribulation = { wave: 0, mobIds: [] };
  p.tv = 0; // tiêu hao tu vi để dẫn kiếp
  broadcast({ t: 'sys', text: `⚡ ${p.name} bắt đầu độ Cửu Cửu Lôi Kiếp! Đánh bại 9 đợt Lôi Kiếp Thú!` });
  broadcastMap(p.map, { t: 'tribstart', name: p.name });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  // Spawn đợt 1 ngay
  spawnTribWave(p);
}
function spawnTribWave(p) {
  const tr = p.tribulation; if (!tr) return;
  tr.wave++;
  // Đợt càng cao càng nhiều quái và mạnh hơn
  const count = Math.min(1 + Math.floor(tr.wave / 3), 3); // đợt 1-2: 1 con, 3-5: 2 con, 6-9: 3 con
  tr.mobIds = [];
  for (let i = 0; i < count; i++) {
    const m = spawnMonster('loi-kiep-thu', 'loi-kiep', false,
      p.x + (Math.random()-0.5)*400, p.y + (Math.random()-0.5)*400);
    // Tăng máu/dame theo đợt
    const mul = 1 + (tr.wave - 1) * 0.25;
    m.hp = m.maxhp = Math.round(m.cfg.hp * mul);
    m.dmg = Math.round(m.cfg.dmg * mul);
    m.tribOwner = p.name; // đánh dấu quái của ai
    tr.mobIds.push(m.id);
  }
  broadcastMap(p.map, { t: 'tribwave', name: p.name, wave: tr.wave, count });
  sendTo(p, { t: 'sys', text: `⚡ Đợt ${tr.wave}/9: ${count} Lôi Kiếp Thú xuất hiện!` });
}
function updateTribulation(p, now) {
  const tr = p.tribulation; if (!tr) return;
  // Kiểm tra quái đợt hiện tại còn sống không
  const alive = tr.mobIds.filter(id => { const m = monsters.get(id); return m && !m.dead; });
  if (alive.length === 0) {
    if (tr.wave >= 9) {
      // Hoàn thành 9 đợt -> đột phá
      tribulationSuccess(p);
    } else {
      // Spawn đợt tiếp theo sau 2s
      if (!tr.nextWaveAt) tr.nextWaveAt = now + 2000;
      if (now >= tr.nextWaveAt) {
        tr.nextWaveAt = null;
        spawnTribWave(p);
      }
    }
  }
  // Nếu người chơi chết -> thất bại
  if (p.dead) {
    // Xóa quái độ kiếp của người này
    for (const id of tr.mobIds) monsters.delete(id);
    p.tribulation = null;
    broadcast({ t: 'sys', text: `💀 ${p.name} độ kiếp thất bại!` });
    broadcastMap(p.map, { t: 'tribend', name: p.name, success: false });
  }
}
function tribulationSuccess(p) {
  p.tribulation = null;
  p.trucCo = true; p.level = 10; // Trúc Cơ kỳ
  // Thưởng đột phá mạnh: gấp 3 lần trước
  p.maxhp += 600; p.hp = p.maxhp; p.maxmp += 250; p.mp = p.maxmp;
  p.atk += 100; p.def += 50;
  p.titles = p.titles || []; p.titles.push('Trúc Cơ Chân Nhân');
  broadcast({ t: 'sys', text: `🌟 ${p.name} độ kiếp thành công! Đột phá Trúc Cơ kỳ! (+600 HP, +100 Công, mở kỹ năng Trúc Cơ)` });
  broadcastMap(p.map, { t: 'tribend', name: p.name, success: true });
  // Hoàn thành nhiệm vụ độ kiếp (nếu đang làm)
  const a = p.quests && p.quests.active;
  if (a) {
    const q = QUESTS[a.id];
    const o = q && q.objectives[a.step];
    if (o && o.type === 'tribulate') advanceStep(p);
  }
  // Mở skill Trúc Cơ cho class
  sendTo(p, { t: 'hallskills', skills: getSkills(p), order: getOrder(p), icons: hallData(p.hall).icons, names: hallData(p.hall).names });
  sendTo(p, { t: 'sys', text: `✨ Đã mở khóa kỹ năng Trúc Cơ!` });
  sendTo(p, { t: 'me', you: pubPlayer(p) });
  savePlayer(p);
}

function gainTv(p, amount) {
  p.tv += amount;
  // Cấp 9 max (chưa độ kiếp): tích tu vi để độ kiếp (không tự lên cấp)
  if (p.level >= 9 && p.level < 10 && !p.trucCo) {
    if (p.tv > tvNeed(9)) p.tv = tvNeed(9); // giữ max để báo đủ điều kiện
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  // Cấp 19 max (Trúc Cơ đỉnh): tích tu vi chờ độ kiếp Kim Đan sau này
  const maxLvl = 19;
  if (p.level >= maxLvl) {
    if (p.tv > tvNeed(maxLvl)) p.tv = tvNeed(maxLvl);
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  while (p.tv >= tvNeed(p.level) && p.level < maxLvl) {
    p.tv -= tvNeed(p.level); p.level++;
    p.maxhp += 30; p.hp = p.maxhp; p.maxmp += 15; p.mp = p.maxmp; p.atk += 4;
    broadcast({ t: 'sys', text: `🎉 ${p.name} đột phá ${realmName(p.level)}!` });
    // Kiểm tra skill mới mở khóa
    const hall = p.hall || 'tap-vu';
    const order = HALL_ORDERS[hall] || HALL_ORDERS['tap-vu'];
    for (const sid of order) {
      const sk = HALL_SKILLS[hall][sid];
      if (sk && sk.unlockLv === p.level) {
        sendTo(p, { t: 'sys', text: `✨ Mở khóa kỹ năng mới: ${SKILL_NAMES[sid]}!` });
        sendTo(p, { t: 'hallskills', skills: getSkills(p), order: getOrder(p), icons: hallData(hall).icons, names: hallData(hall).names });
        break;
      }
    }
  }
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

function basicAttack(p) {
  const now = Date.now();
  if (now - p.lastAtk < 350) return; // KPAH: đánh nhanh 0.35s/đòn
  p.lastAtk = now;
  const targets = nearestMonsters(p.x, p.y, 90, 1, p.map);
  p.dir = targets.length ? Math.atan2(targets[0].y - p.y, targets[0].x - p.x) : p.dir;
  // Crit: tỉ lệ từ đồ + cơ bản, 1.8x sát thương
  const isCrit = Math.random() * 100 < effCrit(p);
  const dmg = effAtk(p) * (isCrit ? 1.8 : 1);
  const wRar = (p.gear && p.gear['vu-khi'] && p.gear['vu-khi'].rarity) || null;
  broadcastMap(p.map, { t: 'fx', kind: 'slash', vis: 'sword', x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2), by: p.name, crit: isCrit || undefined, wrar: wRar });
  if (targets.length) damageMonster(targets[0], dmg, p, isCrit);
}

function castSkill(p, id) {
  const s = getSkills(p)[id];
  if (!s) return;
  const now = Date.now();
  if ((p.cds[id] || 0) > now) return;
  if (p.mp < s.mp) { sendTo(p, { t: 'err', text: 'Hết linh lực!' }); return; }
  p.mp -= s.mp; p.cds[id] = now + s.cd * 1000;
  const vis = s.vis || 'sword';
  const isUltSkill = (s.cd || 0) >= 60; // ultimate: server đánh dấu để client chắc chắn hiện cinematic
  const fxm = o => broadcastMap(p.map, Object.assign({ vis, by: p.name }, isUltSkill ? { ult: true } : null, o));

  if (s.kind === 'shield') {
    p.shieldUntil = now + s.dur * 1000;
    if (s.healMul) { // Thanh Tâm Đan: khiên + hồi ít máu
      const amt = Math.round(p.maxhp * s.healMul);
      p.hp = Math.min(p.maxhp, p.hp + amt);
      broadcastMap(p.map, { t: 'healnum', x: Math.round(p.x), y: Math.round(p.y), txt: '+' + amt });
    }
    fxm({ t: 'fx', kind: 'shield', id, x: Math.round(p.x), y: Math.round(p.y), dur: s.dur });
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  if (s.kind === 'buff') {
    if (s.spdMul) { p.spdBuffMul = s.spdMul; p.spdBuffUntil = now + s.spdDur * 1000; }
    fxm({ t: 'fx', kind: 'buff', id, x: Math.round(p.x), y: Math.round(p.y) });
    if (s.spdMul) sendTo(p, { t: 'sys', text: `💨 Thần Hành: tốc độ di chuyển +${Math.round((s.spdMul-1)*100)}% trong ${s.spdDur}s!` });
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  if (s.kind === 'heal') {
    const amt = Math.round(p.maxhp * s.healMul);
    p.hp = Math.min(p.maxhp, p.hp + amt);
    if (s.atkBuffMul) { p.atkBuffMul = s.atkBuffMul; p.atkBuffUntil = now + s.atkBuffDur * 1000; }
    fxm({ t: 'fx', kind: 'heal', id, x: Math.round(p.x), y: Math.round(p.y) });
    broadcastMap(p.map, { t: 'healnum', x: Math.round(p.x), y: Math.round(p.y), txt: '+' + amt });
    if (s.atkBuffMul) sendTo(p, { t: 'sys', text: `\u2694\uFE0F Cửu Chuyển Kim Đan: công kích +${Math.round((s.atkBuffMul-1)*100)}% trong ${s.atkBuffDur}s!` });
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  if (s.kind === 'zone') {
    // Đặt trận: tại quái gần nhất trong tầm, không có thì trước mặt 200px
    const tg = nearestMonsters(p.x, p.y, s.range, 1, p.map);
    const zx = tg.length ? tg[0].x : p.x + Math.cos(p.dir) * 200;
    const zy = tg.length ? tg[0].y : p.y + Math.sin(p.dir) * 200;
    zones.push({ id: zidSeq++, x: Math.round(zx), y: Math.round(zy), r: s.radius,
      until: now + s.dur * 1000, nextTick: now, tickMul: s.tickMul || 0,
      slowMul: s.slowMul || 0, slowDur: s.slowDur || 0, stunDur: s.stunDur || 0,
      owner: p, vis, map: p.map });
    fxm({ t: 'zonefx', id, x: Math.round(zx), y: Math.round(zy), r: s.radius, dur: s.dur });
    sendTo(p, { t: 'me', you: pubPlayer(p) });
    return;
  }
  const dmg = effAtk(p) * s.dmgMul;
  if (s.kind === 'bolt' || s.kind === 'stun') {
    const tg = nearestMonsters(p.x, p.y, s.range, s.targets, p.map);
    const ang = tg.length ? Math.atan2(tg[0].y - p.y, tg[0].x - p.x) : p.dir;
    p.dir = ang;
    fxm({ t: 'fx', kind: s.kind, id, x: Math.round(p.x), y: Math.round(p.y), dir: +ang.toFixed(2) });
    tg.forEach(m => {
      if (s.kind === 'stun' && s.stunDur) m.stunUntil = now + s.stunDur * 1000; // Định Thân Phù: khóa cứng
      damageMonster(m, dmg, p);
    });
  } else if (s.kind === 'aoe' || s.kind === 'rain') {
    const tg = nearestMonsters(p.x, p.y, s.range, s.targets, p.map);
    tg.forEach(m => {
      if (s.poisonDur) { m.poisonUntil = now + s.poisonDur * 1000; m.poisonMul = s.poisonMul || 0.3; m.poisonBy = p; m.poisonTick = 0; }
      damageMonster(m, dmg, p);
      fxm({ t: 'fx', kind: s.kind, id, x: Math.round(m.x), y: Math.round(m.y), r: s.radius || 120 });
    });
    if (!tg.length) fxm({ t: 'fx', kind: s.kind, id, x: Math.round(p.x + Math.cos(p.dir)*200), y: Math.round(p.y + Math.sin(p.dir)*200), r: s.radius || 120 });
  } else if (s.kind === 'nova') {
    const tg = nearestMonsters(p.x, p.y, s.radius, 99, p.map);
    fxm({ t: 'fx', kind: 'nova', id, x: Math.round(p.x), y: Math.round(p.y), r: s.radius });
    tg.forEach(m => {
      if (s.slowMul) { m.slowUntil = now + (s.slowDur || 3) * 1000; m.slowMul = s.slowMul; }
      damageMonster(m, dmg, p);
    });
  } else if (s.kind === 'line') {
    const tg = nearestMonsters(p.x, p.y, s.range, 99, p.map).filter(m => {
      const dx = m.x - p.x, dy = m.y - p.y;
      const along = dx * Math.cos(p.dir) + dy * Math.sin(p.dir);
      const perp = Math.abs(-dx * Math.sin(p.dir) + dy * Math.cos(p.dir));
      return along > 0 && along <= s.range && perp <= s.width / 2;
    });
    // nếu không có quái, đánh theo hướng đang đứng
    const targets = tg.length ? tg : nearestMonsters(p.x + Math.cos(p.dir)*s.range/2, p.y + Math.sin(p.dir)*s.range/2, s.width, 99, p.map);
    fxm({ t: 'fx', kind: 'line', id, x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2), len: s.range, w: s.width });
    targets.forEach(m => damageMonster(m, dmg, p));
  }
  sendTo(p, { t: 'me', you: pubPlayer(p) });
}

function usePotion(p) {
  if (p.potions <= 0) { sendTo(p, { t: 'err', text: 'Hết Hồi Khí Đan!' }); return; }
  if (p.hp >= p.maxhp) return;
  p.potions--; p.hp = Math.min(p.maxhp, p.hp + p.maxhp * 0.4);
  broadcastMap(p.map, { t: 'fx', kind: 'heal', vis: 'danfire', x: Math.round(p.x), y: Math.round(p.y), by: p.name });
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
    updateTribulation(p, now); // độ kiếp
    if (p.dead) {
      if (now >= p.respawnAt) {
        p.dead = false; p.hp = p.maxhp; p.mp = p.maxmp;
        const changedMap = p.map !== 'tong-mon';
        p.map = 'tong-mon'; p.x = WORLD_W/2; p.y = WORLD_H/2; // hồi sinh luôn về tông môn
        p.protectUntil = Date.now() + 5000;
        if (changedMap) sendMapData(p);
        sendTo(p, { t: 'me', you: pubPlayer(p) });
      }
      continue;
    }
    if (p.moving && p.tx !== null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const spdBuff = Date.now() < (p.spdBuffUntil || 0) ? (p.spdBuffMul || 1) : 1;
      const step = PLAYER_SPEED * (p.carrying ? 0.55 : 1) * spdBuff * dt; // gánh nước đi chậm, Thần Hành tăng tốc
      if (d <= step + 2) { p.x = p.tx; p.y = p.ty; p.moving = false; p.tx = p.ty = null; }
      else { p.x += dx / d * step; p.y += dy / d * step; }
    }
    // Thu thập: đủ 3s vận công -> thu
    if (p.channel && now >= p.channel.until) finishInteract(p);
    // Hồi linh lực
    p.mp = Math.min(p.maxmp, p.mp + p.maxmp * 0.04 * dt);
  }

  // Trận pháp (zone): mỗi giây gây sát thương + hiệu ứng cho quái trong vòng
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (now >= z.until) { zones.splice(i, 1); continue; }
    if (now >= z.nextTick) {
      z.nextTick = now + 1000;
      const ow = z.owner, zAtk = ow ? effAtk(ow) : 10;
      for (const m of monsters.values()) {
        if (m.dead || m.map !== z.map) continue;
        if (dist(m, z) > z.r) continue;
        if (z.tickMul > 0) {
          const zd = zAtk * z.tickMul;
          m.hp -= zd;
          m.target = ow; m.state = 'chase';
          broadcastMap(z.map, { t: 'dmg', mid: m.id, dmg: Math.round(zd), hp: Math.max(0, Math.ceil(m.hp)), maxhp: m.maxhp });
          if (m.hp <= 0) { killMonster(m, ow); continue; }
        }
        if (z.slowMul > 0) { m.slowUntil = now + (z.slowDur || 3) * 1000; m.slowMul = z.slowMul; }
        if (z.stunDur > 0) m.stunUntil = now + z.stunDur * 1000;
      }
    }
  }

  // Quái AI
  for (const m of monsters.values()) {
    if (m.dead) {
      if (now >= m.respawnAt) {
        if (m.boss) {
          if (m.arenaBoss) { spawnArenaBoss(); } // boss arena: spawn lại ngay khi hết giờ
          else {
            // Boss chỉ respawn nếu còn người chơi đang làm C1-06
            const need = [...players.values()].some(pl => pl.quests && pl.quests.active && pl.quests.active.id === 'C1-06');
            if (need) spawnBoss(SPAWN.x + 300, SPAWN.y + 200, null);
          }
          monsters.delete(m.id);
        } else {
          // Hồi sinh gần bầy cũ (cùng loại, còn sống) để giữ bầy
          let gx, gy, grp = 0;
          for (const o of monsters.values()) {
            if (o.dead || o.type !== m.type || o.map !== m.map || !o.grp) continue;
            gx = o.x; gy = o.y; grp = o.grp; break;
          }
          const nm = spawnMonster(m.type, m.map, false, gx, gy, grp);
          monsters.delete(m.id);
        }
      }
      continue;
    }
    // P3: choáng -> đứng yên hoàn toàn; độc -> trừ máu mỗi giây
    if (now < m.stunUntil) continue;
    if (m.poisonUntil && now < m.poisonUntil && now >= m.poisonTick) {
      m.poisonTick = now + 1000;
      const pd = (m.poisonBy ? effAtk(m.poisonBy) : 10) * m.poisonMul;
      m.hp -= pd;
      m.target = m.poisonBy; m.state = 'chase';
      broadcastMap(m.map, { t: 'dmg', mid: m.id, dmg: Math.round(pd), hp: Math.max(0, Math.ceil(m.hp)), maxhp: m.maxhp });
      if (m.hp <= 0) { killMonster(m, m.poisonBy); continue; }
    }
    const spdMul = now < m.slowUntil ? (m.slowMul || 0.5) : 1; // P3: làm chậm
    if (m.state === 'idle') {
      m.wt -= dt;
      if (m.wt <= 0) {
        const wz = m.cfg.zone;
        if (wz) { // lang thang trong vùng cấp độ
          m.wx = wz.x0 + 100 + Math.random() * (wz.x1 - wz.x0 - 200);
          m.wy = wz.y0 + 100 + Math.random() * (wz.y1 - wz.y0 - 200);
        } else { m.wx = m.x + (Math.random()-0.5)*300; m.wy = m.y + (Math.random()-0.5)*300; }
        m.wt = 2 + Math.random()*3;
      }
      const dx = m.wx - m.x, dy = m.wy - m.y, d = Math.hypot(dx, dy);
      if (d > 5) {
        let sx = dx / d, sy = dy / d;
        [sx, sy] = avoidObs(m.map, m.x, m.y, sx, sy); // né địa hình
        m.x += sx * m.cfg.speed*0.4*spdMul*dt; m.y += sy * m.cfg.speed*0.4*spdMul*dt;
      }
      // Tìm mục tiêu: chỉ người chơi cùng map
      let best = null, bd = m.cfg.aggro;
      const anchor = MAP_ANCHOR[m.map] || SPAWN;
      for (const p of players.values()) {
        if (p.map !== m.map) continue;
        if (p.dead || Date.now() < p.protectUntil) continue;
        if (Math.hypot(p.x - anchor.x, p.y - anchor.y) < SAFE_R) continue; // vùng an toàn: không chủ động đánh
        const dd = dist(m, p); if (dd < bd) { bd = dd; best = p; }
      }
      if (best) { m.state = 'chase'; m.target = best; alertGroup(m, best); }
    } else if (m.state === 'chase') {
      const t = m.target;
      if (!t || t.dead || dist(m, t) > m.cfg.aggro * 1.6) { m.state = 'idle'; m.target = null; continue; }
      // Leash: đuổi quá xa vùng cấp độ thì bỏ về
      const zz = m.cfg.zone;
      if (zz && (m.x < zz.x0 - 200 || m.x > zz.x1 + 200 || m.y < zz.y0 - 200 || m.y > zz.y1 + 200)) {
        m.state = 'idle'; m.target = null; m.hp = m.maxhp; continue; // về vùng + hồi đầy máu
      }
      const d = dist(m, t);
      if (d < 48) {
        if (!m.windupAt && now - m.atkAt > 1000) m.windupAt = now; // giơ vuốt 0.5s — client vẽ vòng đỏ cảnh báo
        if (m.windupAt && now - m.windupAt >= 500) {
          m.windupAt = null; m.atkAt = now;
          if (dist(m, t) < 70) { // vẫn trong tầm mới trúng — né được
            hurtPlayer(t, m.cfg.dmg * (0.9 + Math.random()*0.2));
            broadcast({ t: 'fx', kind: 'hit', x: Math.round(t.x), y: Math.round(t.y), by: t.name });
          }
        }
      } else {
        m.windupAt = null;
        let sx = (t.x - m.x)/d, sy = (t.y - m.y)/d;
        [sx, sy] = avoidObs(m.map, m.x, m.y, sx, sy); // đuổi theo nhưng né địa hình
        m.x += sx * m.cfg.speed*spdMul*dt; m.y += sy * m.cfg.speed*spdMul*dt;
      }
    }
  }

  // Snapshot 20Hz: mỗi người chơi chỉ thấy map của mình
  for (const [ws, pl] of players) {
    if (ws.readyState !== 1) continue;
    const snap = { t: 'snap',
      ps: [...players.values()].filter(q => q.map === pl.map).map(pubPlayer),
      ms: [...monsters.values()].filter(m => !m.dead && m.map === pl.map)
        .map(m => ({ id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp), maxhp: m.maxhp,
          lv: m.cfg.lv || '', stun: now < m.stunUntil, slow: now < m.slowUntil, windup: !!m.windupAt })),
    };
    ws.send(JSON.stringify(snap));
  }
}, TICK);

// Lưu định kỳ 30s
setInterval(() => { for (const p of players.values()) savePlayer(p); }, 30000);

server.listen(PORT, () => console.log(`Thiên Kiêu Lộ P2 chạy ở cổng ${PORT}`));
