import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const FONT = '"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei",sans-serif';

let active = null;
export const minigameActive = () => !!active;

const overlay = $('mgOverlay'), cv = $('mgCanvas'), ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
const mouse = { x: W / 2, y: H / 2, inside: false };

function fitCanvas() {
  const st = document.getElementById('stage').getBoundingClientRect();
  const maxW = Math.min(600, st.width * 0.94, (st.height - 170) * (W / H));
  cv.style.width = maxW + 'px'; cv.style.height = (maxW * H / W) + 'px';
}
window.addEventListener('resize', fitCanvas);
function toCanvas(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
cv.addEventListener('pointermove', (e) => { const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; mouse.inside = true; });
cv.addEventListener('pointerleave', () => { mouse.inside = false; });
cv.addEventListener('pointerdown', (e) => { if (!active || e.button !== 0) return; const p = toCanvas(e); mouse.x = p.x; mouse.y = p.y; active.click && active.click(p.x, p.y); });

function setTitle(t, sub = '') { $('mgTitle').textContent = t; $('mgSub').textContent = sub; }
function setSub(sub) { $('mgSub').textContent = sub; }
function buttons(list) {
  const box = $('mgButtons'); box.innerHTML = '';
  for (const b of list) {
    const el = document.createElement('button'); el.className = 'btn ' + (b.cls || 'gold'); el.textContent = b.text;
    el.onclick = () => { sfx.click(); b.onClick(); }; box.appendChild(el);
  }
}

// ---------- 共用繪圖 ----------
function roundRect(x, y, w, h, r) { r = 0; // 直角（Lamborghini：0 圓角）
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function text(t, x, y, size = 20, color = '#fff', align = 'center', stroke = '#000', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = stroke; ctx.lineJoin = 'miter'; ctx.strokeText(t, x, y); }
  ctx.fillStyle = color; ctx.fillText(t, x, y);
}
function coin(x, y, r) {
  const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
  g.addColorStop(0, '#fff6c0'); g.addColorStop(.6, '#ffc400'); g.addColorStop(1, '#a86200');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#8a5000'; ctx.lineWidth = Math.max(1, r * .12); ctx.beginPath(); ctx.arc(x, y, r * .72, 0, TAU); ctx.stroke();
}
function bg() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1.5;
  for (let y = 0, r = 0; y < H + 30; y += 26, r++) for (let x = (r % 2) * 15; x < W + 30; x += 30) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 14, y + Math.sin(a) * 14); } ctx.closePath(); ctx.stroke(); }
}
const sparks = [];
function burst(x, y, n = 24, color = '#ffc000') { for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(80, 320); sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, life: rand(.5, 1.1), color }); } }
function drawSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i]; p.life -= dt; if (p.life <= 0) { sparks.splice(i, 1); continue; }
    p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const floats = [];
function floatText(t, x, y, color = '#ffc000', size = 30) { floats.push({ t, x, y, color, size, life: 1.4 }); }
function drawFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.life -= dt; if (f.life <= 0) { floats.splice(i, 1); continue; }
    f.y -= 40 * dt; ctx.globalAlpha = clamp(f.life, 0, 1); text(f.t, f.x, f.y, f.size, f.color); ctx.globalAlpha = 1;
  }
}

// ---------- 啟動 / 結束 ----------
let raf = 0, lastT = 0;
export function startMinigame(type, onFinish) {
  if (active) return;
  sparks.length = 0; floats.length = 0;
  overlay.classList.remove('hidden'); fitCanvas(); buttons([]);
  const finish = (total) => {
    cancelAnimationFrame(raf); active = null; overlay.classList.add('hidden'); buttons([]);
    onFinish(total);
  };
  active = ({ plinko: Plinko, darts: Darts, hats: Hats })[type](finish);
  window.__mg = active;
  lastT = performance.now();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const t = performance.now(); const dt = Math.min(0.033, (t - lastT) / 1000); lastT = t;
    if (!active) return;
    const k = window.__mgSpeed || 1; for (let i = 0; i < k && active; i++) active.update(dt);
    if (!active) return;
    active.draw(dt); drawSparks(dt); drawFloats(dt);
  };
  tick();
}

// =====================================================================
// 連連看（彈珠台）
// =====================================================================
function Plinko(finish) {
  setTitle('連連看', '移動滑鼠選擇位置，點擊放球！相鄰獎洞都進球，兩邊金幣翻倍！');
  const L = 50, R = 550, HOLE_Y = 650, BOTTOM = 790, BR = 13, PR = 7;
  const HW = (R - L) / 6;
  const pegs = [];
  for (let r = 0; r < 10; r++) {
    const y = 215 + r * 44; const odd = r % 2 === 1;
    const n = odd ? 9 : 10;
    for (let k = 0; k < n; k++) pegs.push({ x: L + (odd ? 50 : 25) + k * 50, y, glow: 0 });
  }
  const dividers = []; for (let i = 1; i < 6; i++) dividers.push(L + i * HW);
  const holes = [0, 1, 2, 3, 4, 5].map((i) => ({ prize: i >= 1 && i <= 4, h: 0, flash: 0 }));
  const BASE = [0, 200, 100, 50];
  let ballsLeft = 4, ball = null, state = 'aim', msg = '', endTimer = 0, landed = 0;

  const value = (i) => {
    const ho = holes[i]; if (!ho.prize || ho.h === 0) return 0;
    const lit = (j) => holes[j] && holes[j].prize && holes[j].h > 0;
    const dbl = lit(i - 1) || lit(i + 1);
    return BASE[ho.h] * (dbl ? 2 : 1);
  };
  const doubled = (i) => { const lit = (j) => holes[j] && holes[j].prize && holes[j].h > 0; return holes[i].prize && holes[i].h > 0 && (lit(i - 1) || lit(i + 1)); };
  const total = () => [1, 2, 3, 4].reduce((s, i) => s + value(i), 0);

  function land(i) {
    const ho = holes[i]; ho.flash = 1; landed++;
    const x = L + HW * (i + .5);
    if (!ho.prize) { msg = '空洞！損失一顆球'; sfx.lose(); floatText('空洞', x, HOLE_Y - 30, '#aaa'); }
    else {
      ho.h = (ho.h + 1) % 4;
      if (ho.h === 0) { msg = '進球第四次，獎洞歸零重置！'; sfx.lose(); floatText('歸零', x, HOLE_Y - 30, '#f88'); }
      else { msg = ho.h === 1 ? `進洞！獲得 ${value(i)} 金幣` : `重複進洞，獎金減少為 ${value(i)}`; sfx.win(); burst(x, HOLE_Y + 40); floatText(`${value(i)}`, x, HOLE_Y - 30); }
      if (doubled(i)) { msg += '　相鄰翻倍！'; sfx.big(); }
    }
    setSub(`${msg}　目前合計：${total()} 金幣`);
    ball = null;
    if (ballsLeft === 0) { state = 'end'; endTimer = 0.8; } else state = 'aim';
  }

  return {
    click(x, y) {
      if (state !== 'aim' || ballsLeft <= 0) return;
      const dx = clamp(x, L + BR + 4, R - BR - 4);
      ball = { x: dx, y: 165, vx: rand(-20, 20), vy: 0, still: 0 };
      ballsLeft--; state = 'drop'; sfx.click();
    },
    update(dt) {
      for (const p of pegs) p.glow = Math.max(0, p.glow - dt * 3);
      for (const h of holes) h.flash = Math.max(0, h.flash - dt);
      if (state === 'end') {
        endTimer -= dt;
        if (endTimer <= 0) {
          state = 'done'; const t = total();
          setSub(t >= 1600 ? '完美！四個獎洞全中！' : '遊戲結束！');
          if (t > 0) { sfx.big(); burst(300, 400, 60); }
          buttons([{ text: `領取 ${t} 金幣`, onClick: () => finish(t) }]);
        }
      }
      if (!ball) return;
      const SUB = 6, sdt = dt / SUB;
      for (let s = 0; s < SUB && ball; s++) {
        ball.vy += 1100 * sdt; ball.x += ball.vx * sdt; ball.y += ball.vy * sdt;
        for (const p of pegs) {
          const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy);
          if (d < BR + PR && d > 0) {
            const nx = dx / d, ny = dy / d; ball.x = p.x + nx * (BR + PR); ball.y = p.y + ny * (BR + PR);
            const vn = ball.vx * nx + ball.vy * ny;
            if (vn < 0) { ball.vx -= 1.55 * vn * nx; ball.vy -= 1.55 * vn * ny; ball.vx += rand(-25, 25); if (p.glow < .5) sfx.tick(); p.glow = 1; }
          }
        }
        for (const x of dividers) {
          // 隔板：膠囊體（頂端圓弧）
          const top = HOLE_Y; const cy = clamp(ball.y, top, BOTTOM);
          const dx = ball.x - x, dy = ball.y - cy, d = Math.hypot(dx, dy);
          if (d < BR + 4 && d > 0) { const nx = dx / d, ny = dy / d; ball.x = x + nx * (BR + 4); ball.y = cy + ny * (BR + 4); const vn = ball.vx * nx + ball.vy * ny; if (vn < 0) { ball.vx -= 1.4 * vn * nx; ball.vy -= 1.4 * vn * ny; } if (Math.abs(dx) < 2) ball.vx += rand(-60, 60); }
        }
        if (ball.x < L + BR) { ball.x = L + BR; ball.vx = Math.abs(ball.vx) * .5; }
        if (ball.x > R - BR) { ball.x = R - BR; ball.vx = -Math.abs(ball.vx) * .5; }
        ball.vx *= 0.999;
        if (ball.y > BOTTOM - BR) { const i = clamp(Math.floor((ball.x - L) / HW), 0, 5); land(i); break; }
      }
      if (ball) { const sp = Math.hypot(ball.vx, ball.vy); ball.still = sp < 25 ? ball.still + dt : 0; if (ball.still > 0.4) { ball.vx += rand(-120, 120); ball.vy -= 60; ball.still = 0; } }
    },
    draw() {
      bg();
      // 外框
      ctx.fillStyle = '#181818'; roundRect(L - 14, 130, R - L + 28, BOTTOM - 115, 22); ctx.fill();
      ctx.strokeStyle = '#202020'; ctx.lineWidth = 2; roundRect(L - 14, 130, R - L + 28, BOTTOM - 115, 22); ctx.stroke(); ctx.fillStyle = '#ffc000'; ctx.fillRect(L - 14, 128, R - L + 28, 3);
      // 洞
      for (let i = 0; i < 6; i++) {
        const x = L + i * HW, ho = holes[i];
        const g = ctx.createLinearGradient(0, HOLE_Y, 0, BOTTOM);
        if (ho.prize) { const c = doubled(i) ? '#ffc000' : ho.h ? '#494949' : '#202020'; g.addColorStop(0, c); g.addColorStop(1, c); }
        else { g.addColorStop(0, '#0a0a0a'); g.addColorStop(1, '#0a0a0a'); }
        ctx.fillStyle = g; ctx.fillRect(x + 3, HOLE_Y, HW - 6, BOTTOM - HOLE_Y);
        if (ho.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${ho.flash * .6})`; ctx.fillRect(x + 3, HOLE_Y, HW - 6, BOTTOM - HOLE_Y); }
        const cx = x + HW / 2;
        if (!ho.prize) text('空洞', cx, HOLE_Y + 60, 22, '#999');
        else {
          const v = value(i);
          text(ho.h === 0 ? '200' : String(v), cx, HOLE_Y + 40, 30, doubled(i) ? '#000' : '#fff', 'center', doubled(i) ? null : '#000', 600);
          text(ho.h === 0 ? '獎洞' : `進球 ${ho.h}`, cx, HOLE_Y + 72, 14, doubled(i) ? '#000' : '#969696', 'center', null, 500);
          if (doubled(i)) text('×2', cx, HOLE_Y + 102, 22, '#000', 'center', null, 700);
        }
      }
      ctx.fillStyle = '#ffffff';
      for (const x of dividers) { ctx.fillRect(x - 4, HOLE_Y, 8, BOTTOM - HOLE_Y); ctx.beginPath(); ctx.arc(x, HOLE_Y, 4, 0, TAU); ctx.fill(); }
      // 釘子
      for (const p of pegs) {
        ctx.fillStyle = p.glow > 0 ? `rgb(255,${200 + 55 * p.glow},${120 + 135 * p.glow})` : '#7d7d7d';
        ctx.shadowColor = '#ffc000'; ctx.shadowBlur = 8 + p.glow * 14;
        ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;
      // 瞄準
      if (state === 'aim') {
        const x = clamp(mouse.x, L + BR + 4, R - BR - 4);
        ctx.globalAlpha = .6; ctx.setLineDash([6, 8]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 165); ctx.lineTo(x, 200); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        drawBall(x, 165);
        text('▼ 點擊放球', clamp(x, 90, 510), 145, 16, '#fff');
      }
      if (ball) drawBall(ball.x, ball.y);
      // 資訊
      text('剩餘球數', 90, 40, 16, '#969696', 'center', null);
      for (let i = 0; i < 4; i++) { ctx.globalAlpha = i < ballsLeft ? 1 : .2; drawBall(45 + i * 30, 80); ctx.globalAlpha = 1; }
      text('合計', 470, 40, 16, '#969696', 'center', null); text(`${total()} 金幣`, 470, 80, 32, '#ffc000', 'center', null, 600);
      text('最高 1600', 300, 60, 14, '#7d7d7d', 'center', null, 500);
      if (!mouse.inside && state === 'aim') {}
    },
  };
  function drawBall(x, y) {
    const g = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, BR); g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#d8dade'); g.addColorStop(1, '#5a5a5a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, BR, 0, TAU); ctx.fill();
  }
}

// =====================================================================
// 飛鏢
// =====================================================================
function Darts(finish) {
  setTitle('飛鏢', '瞄準旋轉的輪盤，點擊射出飛鏢！每射一鏢，會有兩格變成空格');
  const CX = 300, CY = 440, R = 260, N = 12, SEG = TAU / N;
  const pool = [50, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 100];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const segs = pool.map((v) => ({ v, empty: false, flash: 0 }));
  const colors = ['#000000', '#202020'];
  let rot = 0, speed = 3, spdMul = 0.9 + Math.random() * 0.25, t = 0, dartsLeft = 3, total = 0, fly = null, stuck = [], state = 'aim', timer = 0, hits = [];

  function emptyTwo() {
    const cand = segs.map((s, i) => i).filter((i) => !segs[i].empty);
    for (let k = 0; k < 2 && cand.length; k++) { const idx = cand.splice(Math.floor(Math.random() * cand.length), 1)[0]; segs[idx].empty = true; segs[idx].flash = 1; }
    sfx.whoosh();
  }
  function impact(x, y) {
    const dx = x - CX, dy = y - CY, d = Math.hypot(dx, dy);
    let v = 0, label;
    if (d > R) { label = '脫靶！'; sfx.lose(); }
    else {
      const a = (((Math.atan2(dy, dx) - rot) % TAU) + TAU) % TAU;
      const si = Math.floor(a / SEG) % N;
      stuck.push({ a: Math.atan2(dy, dx) - rot, d });
      if (segs[si].empty) { label = '空格！'; sfx.lose(); }
      else { v = segs[si].v; label = `+${v}`; segs[si].flash = 1; sfx.win(); burst(x, y, 30); }
    }
    total += v; hits.push(v);
    floatText(label, x, y - 30, v ? '#ffe066' : '#bbb', 34);
    setSub(`第 ${3 - dartsLeft} 鏢：${v ? v + ' 金幣' : label}　累計 ${total} 金幣`);
    if (dartsLeft > 0) { state = 'wait'; timer = 0.6; spdMul = 0.9 + Math.random() * 0.25; }
    else { state = 'end'; timer = 1.2; }
  }
  return {
    click(x, y) {
      if (state !== 'aim' || dartsLeft <= 0) return;
      dartsLeft--; fly = { x0: x + 40, y0: H + 40, x, y, t: 0 }; state = 'fly'; sfx.whoosh();
    },
    update(dt) {
      t += dt; speed = (2.9 + Math.sin(t * 0.9) * 1.4) * spdMul; rot += speed * dt; // 約為原本 1.8 倍
      for (const s of segs) s.flash = Math.max(0, s.flash - dt * 1.2);
      if (state === 'fly') { fly.t += dt / 0.28; if (fly.t >= 1) { const f = fly; fly = null; impact(f.x, f.y); } }
      else if (state === 'wait') { timer -= dt; if (timer <= 0) { emptyTwo(); state = 'aim'; } }
      else if (state === 'end') {
        timer -= dt;
        if (timer <= 0) {
          state = 'done'; emptyTwo();
          setSub(`三鏢結果：${hits.map((h) => h || '空').join('、')}`);
          if (total > 0) { sfx.big(); burst(300, 400, 60); }
          buttons([{ text: `領取 ${total} 金幣`, onClick: () => finish(total) }]);
        }
      }
    },
    draw() {
      bg();
      // 背光
      const g0 = ctx.createRadialGradient(CX, CY, R * .6, CX, CY, R + 60); g0.addColorStop(0, 'rgba(255,255,255,.06)'); g0.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(CX, CY, R + 16, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; ctx.fillStyle = (Math.floor(t * 6) + i) % 2 ? '#ffc000' : '#494949'; ctx.beginPath(); ctx.arc(CX + Math.cos(a) * (R + 8), CY + Math.sin(a) * (R + 8), 4, 0, TAU); ctx.fill(); }
      ctx.save(); ctx.translate(CX, CY); ctx.rotate(rot);
      segs.forEach((s, i) => {
        const a0 = i * SEG, a1 = a0 + SEG;
        ctx.fillStyle = s.empty ? '#0a0a0a' : s.v >= 500 ? '#ffc000' : colors[i % colors.length];
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
        if (s.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${s.flash * .7})`; ctx.fill(); }
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.save(); ctx.rotate(a0 + SEG / 2);
        if (s.empty) text('空', R * .68, 0, 22, '#494949', 'center', null);
        else { text(String(s.v), R * .7, 0, s.v >= 1000 ? 30 : 32, s.v >= 500 ? '#000' : '#fff', 'center', null, 600); }
        ctx.restore();
      });
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill(); ctx.strokeStyle = '#ffc000'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#ffc000'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      for (const sd of stuck) drawDart(Math.cos(sd.a + 0) * sd.d, Math.sin(sd.a) * sd.d, 1, -rot);
      ctx.restore();
      if (fly) { const u = fly.t, x = fly.x0 + (fly.x - fly.x0) * u, y = fly.y0 + (fly.y - fly.y0) * u - Math.sin(u * Math.PI) * 80; drawDart(x, y, 2.2 - 1.2 * u, 0); }
      // 準星
      if (state === 'aim' && mouse.inside) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 16, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mouse.x - 24, mouse.y); ctx.lineTo(mouse.x + 24, mouse.y); ctx.moveTo(mouse.x, mouse.y - 24); ctx.lineTo(mouse.x, mouse.y + 24); ctx.stroke();
      }
      text('剩餘飛鏢', 90, 40, 16, '#969696', 'center', null);
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = i < dartsLeft ? 1 : .2; drawDart(45 + i * 36, 70, 1, 0); ctx.globalAlpha = 1; }
      text('累計', 490, 40, 16, '#969696', 'center', null); text(`${total} 金幣`, 490, 80, 32, '#ffc000', 'center', null, 600);
      text('點擊輪盤射出飛鏢', 300, 770, 16, '#969696', 'center', null);
    },
  };
  function drawDart(x, y, s, extraRot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(extraRot); ctx.scale(s, s);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 24); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.fillRect(12, 22, 6, 16);
    ctx.fillStyle = '#ffc000'; ctx.beginPath(); ctx.moveTo(15, 36); ctx.lineTo(4, 50); ctx.lineTo(15, 44); ctx.lineTo(26, 50); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// =====================================================================
// 魔術帽（猜猜金幣在哪頂帽子下）
// =====================================================================
function Hats(finish) {
  const ROUNDS = [
    { c: 2, r: 1, p: 200 }, { c: 2, r: 1, p: 500 }, { c: 1, r: 2, p: 1000 },
    { c: 1, r: 2, p: 1500 }, { c: 2, r: 2, p: 2000 }, { c: 1, r: 3, p: 2500 },
  ];
  setTitle('魔術帽', '記住金幣的位置！選中金幣即可晉級，選到兔子只能拿上一局的獎金');
  let round = 0, lastWon = 0, hats = [], phase = 'show', timer = 0, swap = null, swapsLeft = 0, chosen = -1, hover = -1, revealAll = 0;
  const TABLE_Y = 560;
  function slotX(i, n) { const sp = n === 3 ? 180 : 138; return W / 2 + (i - (n - 1) / 2) * sp; }
  function setupRound() {
    const cfg = ROUNDS[round]; const n = cfg.c + cfg.r;
    const contents = [...Array(cfg.c).fill('coin'), ...Array(cfg.r).fill('rabbit')];
    for (let i = contents.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [contents[i], contents[j]] = [contents[j], contents[i]]; }
    hats = contents.map((c, i) => ({ content: c, slot: i, x: slotX(i, n), y: TABLE_Y, lift: 1, dy: 0 }));
    phase = 'show'; timer = 1.8; chosen = -1; revealAll = 0;
    swapsLeft = 5 + round * 2;
    setSub(`第 ${round + 1} 局：${cfg.c} 疊金幣、${cfg.r} 隻兔子 — 猜中可得 ${cfg.p} 金幣`);
    buttons([]);
  }
  const swapDur = () => Math.max(0.2, 0.5 - round * 0.05);
  function startSwap() {
    const n = hats.length; const a = Math.floor(Math.random() * n); let b = Math.floor(Math.random() * (n - 1)); if (b >= a) b++;
    const ha = hats.find((h) => h.slot === a), hb = hats.find((h) => h.slot === b);
    swap = { ha, hb, xa: slotX(a, n), xb: slotX(b, n), t: 0 }; sfx.whoosh();
  }
  function choose(i) {
    chosen = i; phase = 'reveal'; timer = 0; sfx.click();
  }
  function afterReveal() {
    const cfg = ROUNDS[round]; const h = hats[chosen];
    if (h.content === 'coin') {
      lastWon = cfg.p; sfx.big(); burst(h.x, TABLE_Y - 40, 50);
      floatText(`猜中！${cfg.p} 金幣`, W / 2, 250, '#ffe066', 36);
      if (round < ROUNDS.length - 1) {
        setSub(`猜中了！目前可得 ${lastWon} 金幣。要繼續挑戰下一局（${ROUNDS[round + 1].p} 金幣）嗎？`);
        buttons([
          { text: `繼續挑戰（${ROUNDS[round + 1].p}）`, cls: '', onClick: () => { round++; setupRound(); } },
          { text: `收下 ${lastWon} 金幣`, onClick: () => finish(lastWon) },
        ]);
      } else {
        setSub('全部六局過關！魔術大師！');
        buttons([{ text: `領取 ${lastWon} 金幣`, onClick: () => finish(lastWon) }]);
      }
    } else {
      sfx.lose(); floatText('是兔子！', W / 2, 250, '#fff', 36);
      setSub(lastWon ? `可惜！只能獲得上一局的獎金 ${lastWon} 金幣` : '可惜！第一局就猜錯了，沒有獎金');
      buttons([{ text: lastWon ? `領取 ${lastWon} 金幣` : '結束', onClick: () => finish(lastWon) }]);
    }
  }
  setupRound();
  function hatAt(x, y) {
    for (let i = 0; i < hats.length; i++) { const h = hats[i]; if (Math.abs(x - h.x) < (hats.length > 3 ? 62 : 75) && y > h.y - 170 && y < h.y + 30) return i; }
    return -1;
  }
  return {
    click(x, y) { if (phase !== 'pick') return; const i = hatAt(x, y); if (i >= 0) choose(i); },
    update(dt) {
      hover = phase === 'pick' && mouse.inside ? hatAt(mouse.x, mouse.y) : -1;
      if (phase === 'show') { timer -= dt; if (timer <= 0) { phase = 'lower'; } }
      else if (phase === 'lower') { let done = true; for (const h of hats) { h.lift = Math.max(0, h.lift - dt * 2.5); if (h.lift > 0) done = false; } if (done) { phase = 'shuffle'; startSwap(); } }
      else if (phase === 'shuffle') {
        swap.t += dt / swapDur(); const u = Math.min(1, swap.t); const e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        swap.ha.x = swap.xa + (swap.xb - swap.xa) * e; swap.ha.dy = -Math.sin(u * Math.PI) * 40;
        swap.hb.x = swap.xb + (swap.xa - swap.xb) * e; swap.hb.dy = Math.sin(u * Math.PI) * 30;
        if (u >= 1) {
          const sa = swap.ha.slot; swap.ha.slot = swap.hb.slot; swap.hb.slot = sa; swap.ha.dy = swap.hb.dy = 0;
          swapsLeft--;
          if (swapsLeft > 0) startSwap(); else { swap = null; phase = 'pick'; setSub(`選一頂帽子！（第 ${round + 1} 局，猜中得 ${ROUNDS[round].p} 金幣）`); }
        }
      }
      else if (phase === 'reveal') {
        const h = hats[chosen]; h.lift = Math.min(1, h.lift + dt * 2.5); timer += dt;
        if (timer > 0.9) { phase = 'revealAll'; afterReveal(); }
      }
      else if (phase === 'revealAll') { for (const h of hats) h.lift = Math.min(1, h.lift + dt * 2); }
    },
    draw() {
      bg();
      // 布幕
      for (let i = 0; i < 12; i++) { const x = i * 52; const g = ctx.createLinearGradient(x, 0, x + 52, 0); g.addColorStop(0, '#050505'); g.addColorStop(.5, '#1c1c1c'); g.addColorStop(1, '#050505'); ctx.fillStyle = g; ctx.fillRect(x, 0, 52, 440); }
      const sg = ctx.createRadialGradient(W / 2, 470, 40, W / 2, 470, 460); sg.addColorStop(0, 'rgba(255,240,200,.35)'); sg.addColorStop(1, 'rgba(0,0,0,.5)'); ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
      // 桌子
      ctx.fillStyle = '#181818'; ctx.fillRect(W / 2 - 290, TABLE_Y + 20, 580, 90);
      ctx.fillStyle = '#202020'; ctx.beginPath(); ctx.ellipse(W / 2, TABLE_Y + 20, 290, 70, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffc000'; ctx.lineWidth = 2; ctx.stroke();
      // 進度條
      ROUNDS.forEach((r, i) => {
        const x = 110 + (i % 3) * 190, y = 40 + Math.floor(i / 3) * 52;
        ctx.fillStyle = i === round ? '#ffc000' : i < round || (i === round && lastWon === r.p) ? '#494949' : '#000';
        roundRect(x - 80, y - 20, 160, 40, 12); ctx.fill(); ctx.strokeStyle = i === round ? '#ffc000' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
        text(`第${i + 1}局 ${r.p}`, x, y, 17, i === round ? '#000' : '#fff', 'center', null);
      });
      text(`目前可得 ${lastWon} 金幣`, W / 2, 150, 22, '#ffc000', 'center', null, 600);
      // 內容物
      const k = hats.length > 3 ? 0.95 : 1.15;
      for (const h of hats) if (h.lift > 0.05 || phase === 'show') { ctx.save(); ctx.translate(h.x, h.y); ctx.scale(k, k); drawContent(h.content, 0, 0); ctx.restore(); }
      // 帽子
      const order = [...hats].sort((a, b) => a.dy - b.dy);
      for (const h of order) {
        const i = hats.indexOf(h);
        ctx.save(); ctx.translate(h.x, h.y + h.dy - h.lift * 170); ctx.scale(k, k); drawHat(0, 0, i === hover, i === chosen); ctx.restore();
      }
      if (phase === 'pick') text('點擊選擇帽子', W / 2, 760, 18, '#969696', 'center', null);
    },
  };
  function drawContent(c, x, y) {
    if (c === 'coin') {
      for (let k = 0; k < 6; k++) { const yy = y - k * 9; ctx.fillStyle = '#a86200'; ctx.beginPath(); ctx.ellipse(x, yy + 4, 34, 12, 0, 0, TAU); ctx.fill(); const g = ctx.createLinearGradient(x - 34, 0, x + 34, 0); g.addColorStop(0, '#d08a00'); g.addColorStop(.5, '#fff0a0'); g.addColorStop(1, '#d08a00'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, yy, 34, 12, 0, 0, TAU); ctx.fill(); }
      coin(x + 40, y + 6, 14);
    } else {
      ctx.fillStyle = '#fff';
      for (const s of [-1, 1]) { ctx.save(); ctx.translate(x + s * 14, y - 72); ctx.rotate(s * 0.15); ctx.beginPath(); ctx.ellipse(0, 0, 10, 32, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffb0c8'; ctx.beginPath(); ctx.ellipse(0, 2, 5, 22, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.restore(); }
      ctx.beginPath(); ctx.ellipse(x, y - 8, 36, 28, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 36, 24, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x - 9, y - 40, 3.5, 0, TAU); ctx.arc(x + 9, y - 40, 3.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff6a9a'; ctx.beginPath(); ctx.arc(x, y - 31, 4, 0, TAU); ctx.fill();
    }
  }
  function drawHat(x, y, hl, ch) {
    ctx.save();
    if (hl || ch) { ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = 24; }
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.ellipse(x, y, 66, 16, 0, 0, TAU); ctx.fill();
    const g = ctx.createLinearGradient(x - 46, 0, x + 46, 0); g.addColorStop(0, '#0a0a0a'); g.addColorStop(.35, '#3a3a40'); g.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 44, y - 2); ctx.lineTo(x - 48, y - 120); ctx.lineTo(x + 48, y - 120); ctx.lineTo(x + 44, y - 2); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffc000'; ctx.fillRect(x - 45, y - 34, 90, 10);
    ctx.fillStyle = '#000'; ctx.fillRect(x - 10, y - 36, 20, 22);
    ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.ellipse(x, y - 120, 48, 11, 0, 0, TAU); ctx.fill();
    if (hl) { ctx.strokeStyle = '#ffc000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, 66, 16, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
}
