// 音效：真實錄音取樣（CC0，見 CREDITS.md）＋ WebAudio 合成備援
let ctx = null, master = null, muted = false;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.12;
    master.connect(comp); comp.connect(ctx.destination);
    loadBank();
  } catch (e) { ctx = null; }
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.35; }
export function isMuted() { return muted; }
function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol = 0.2, hp = 1000, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}
let lastClink = 0;
// 金屬碰撞聲：非諧波泛音 + 短促敲擊雜訊，音高隨機、音量依撞擊速度，並限制每秒次數
let clinkTimes = [];
function metalClink(v, base) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const nowMs = performance.now();
  clinkTimes = clinkTimes.filter((x) => nowMs - x < 250);
  if (clinkTimes.length >= 5) return; // 每 0.25 秒最多 5 聲
  clinkTimes.push(nowMs);
  const vol = Math.min(0.22, 0.03 + v * 0.035) * (clinkTimes.length > 3 ? 0.6 : 1);
  const f = base * (0.85 + Math.random() * 0.35);
  const out = ctx.createGain(); out.gain.value = vol;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; out.connect(pan); pan.connect(master); } else out.connect(master);
  [[1, 1, 0.35], [2.76, 0.55, 0.22], [5.4, 0.35, 0.12], [8.93, 0.2, 0.07]].forEach(([mul, amp, dec]) => {
    if (f * mul > 16000) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f * mul;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
  });
  const len = Math.floor(ctx.sampleRate * 0.012), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = ctx.createBufferSource(); n.buffer = buf; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
  const ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(hp); hp.connect(ng); ng.connect(out); n.start(t);
}
const synth = {
  suspend() { if (ctx && ctx.state === "running") ctx.suspend(); },
  resume() { if (ctx && ctx.state === "suspended") ctx.resume(); },
  shoot() { tone(520, 0.12, 'square', 0.12, 400); noise(0.08, 0.08, 3000); },
  hit() { tone(220, 0.1, 'triangle', 0.25, -80); },
  snap() { noise(0.25, 0.3, 600); tone(880, 0.3, 'sawtooth', 0.12, -600); },
  crit() { tone(660, 0.1, 'square', 0.2); tone(990, 0.15, 'square', 0.2, 0, 0.08); tone(1320, 0.25, 'square', 0.2, 0, 0.16); },
  clink(v = 2) { metalClink(v, 2300 + Math.random() * 1400); },
  drop(v = 3) { metalClink(v, 1500 + Math.random() * 700); },
  coin() { const n = performance.now(); if (n - lastClink < 40) return; lastClink = n; tone(1800 + Math.random() * 600, 0.08, 'sine', 0.08); tone(2600 + Math.random() * 400, 0.06, 'sine', 0.05, 0, 0.02); },
  insert() { tone(1200, 0.06, 'square', 0.12); tone(1600, 0.1, 'square', 0.12, 0, 0.06); },
  tick() { tone(1500, 0.03, 'square', 0.06); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, 0, i * 0.1)); },
  big() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.3, 'square', 0.12, 0, i * 0.08)); },
  lose() { tone(400, 0.25, 'sawtooth', 0.15, -200); tone(250, 0.4, 'sawtooth', 0.15, -120, 0.2); },
  power() { tone(300, 0.5, 'sawtooth', 0.15, 900); },
  egg() { noise(0.15, 0.25, 2000); tone(700, 0.15, 'triangle', 0.2, 300); },
  ticket() { tone(300 + Math.random() * 40, 0.03, 'square', 0.03); },
  whoosh() { noise(0.2, 0.1, 800); },
  click() { tone(900, 0.04, 'square', 0.08); },
};

// ====================== 取樣播放引擎 ======================
const MOBILE_A = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
const MAX_VOICES = MOBILE_A ? 10 : 20;
const BANK = {
  clink: 8, drop: 5, roll: 2, pour: 4, hole: 3, print: 1, shoot: 1, snap: 1, crack: 2, tick: 3,
  win: 1, big: 1, insert: 1, whoosh: 1, hit: 2, thud: 2, crit: 1, power: 1, lose: 1, click: 1, egg: 1,
};
const bufs = {}; // name -> [AudioBuffer]
let voices = 0;
const lastPlay = {};
function decode(ab) {
  return new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
}
function loadBank() {
  for (const [name, n] of Object.entries(BANK)) {
    for (let i = 1; i <= n; i++) {
      const file = n === 1 ? name : name + i;
      const url = new URL(`./sfx/${file}.mp3`, import.meta.url);
      fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(decode).then((b) => { (bufs[name] = bufs[name] || []).push(b); })
        .catch(() => {}); // 載入失敗時自動使用合成音效
    }
  }
}
export function sampleStats() { return { loaded: Object.fromEntries(Object.entries(bufs).map(([k, v]) => [k, v.length])), voices }; }
const rnd = (a, b) => a + Math.random() * (b - a);
// 播放一個取樣；回傳 false 代表沒有取樣（呼叫端改用合成）
function play(name, { vol = 0.5, rate = 1, rv = 0.08, pan = null, offset = 0, dur = 0, gap = 0, prio = false } = {}) {
  if (!ctx || muted) return true;
  const list = bufs[name];
  if (!list || !list.length) return false;
  const nowMs = performance.now();
  if (gap && nowMs - (lastPlay[name] || 0) < gap) return true;
  if (voices >= MAX_VOICES && !prio) return true;
  lastPlay[name] = nowMs;
  const b = list[(Math.random() * list.length) | 0];
  const src = ctx.createBufferSource(); src.buffer = b;
  src.playbackRate.value = rate * (1 + rnd(-rv, rv));
  const g = ctx.createGain(); g.gain.value = vol * rnd(0.85, 1.05);
  src.connect(g);
  let node = g;
  if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = pan === null ? rnd(-0.4, 0.4) : pan; g.connect(pn); node = pn; }
  node.connect(master);
  const t = ctx.currentTime;
  const off = Math.min(offset, Math.max(0, b.duration - 0.05));
  if (dur) {
    const end = Math.min(dur, b.duration - off);
    g.gain.setValueAtTime(g.gain.value, t + end * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + end);
    src.start(t, off, end + 0.02);
  } else src.start(t, off);
  voices++; src.onended = () => { voices--; try { node.disconnect(); } catch (e) {} };
  return true;
}
const velVol = (v, lo, hi) => Math.max(0.06, Math.min(1, (v - 0.8) / 6)) * (hi - lo) + lo;
let clinkWin = [];
function clinkGate(max) { const n = performance.now(); clinkWin = clinkWin.filter((x) => n - x < 250); if (clinkWin.length >= max) return false; clinkWin.push(n); return true; }

export const sfx = {
  suspend: synth.suspend, resume: synth.resume,
  // 金幣互撞：多種真實錄音，音高/音量隨機，音量依撞擊速度，並限制同時聲部
  clink(v = 2) { if (!ctx || muted || !clinkGate(MOBILE_A ? 4 : 6)) return; if (!play('clink', { vol: velVol(v, 0.05, 0.55), rate: rnd(0.95, 1.25), rv: 0.04 })) synth.clink(v); },
  // 金幣落在檯面/托盤
  drop(v = 3) { if (!ctx || muted || !clinkGate(MOBILE_A ? 4 : 6)) return; if (!play('drop', { vol: velVol(v, 0.06, 0.5), rate: rnd(0.9, 1.15), dur: 0.45 })) synth.drop(v); },
  // 側邊大量倒幣
  pour(side = 0, n = 12) { if (!play('pour', { vol: Math.min(0.75, 0.3 + n * 0.035), pan: side * 0.55, rate: rnd(0.95, 1.1), offset: rnd(0, 0.5), dur: rnd(0.9, 1.3), prio: true })) synth.drop(1.2); },
  // 出幣口金幣立著滾下坡道
  roll() { if (!play('roll', { vol: 0.32, rate: rnd(0.95, 1.2), offset: rnd(0, 0.8), dur: 0.55, gap: 140, pan: rnd(-0.15, 0.15) })) synth.coin(); },
  // 金幣掉進洞口
  hole() { if (!play('hole', { vol: 0.45, rate: rnd(0.95, 1.15), dur: 0.5, gap: 70 })) synth.coin(); },
  coin() { this.hole(); },
  ticket() { if (!play('print', { vol: 0.28, rate: rnd(0.95, 1.08), dur: 0.12, gap: 60, pan: 0.3 })) synth.ticket(); },
  shoot() { if (!play('shoot', { vol: 0.55, rate: rnd(1.0, 1.15), prio: true, pan: 0 })) synth.shoot(); },
  snap() { if (!play('snap', { vol: 0.8, rate: rnd(0.95, 1.1), prio: true })) synth.snap(); },
  hit() { if (!play('hit', { vol: 0.5, rate: rnd(1.0, 1.3), prio: true })) synth.hit(); },
  thud() { play('thud', { vol: 0.55, rate: rnd(0.9, 1.1), prio: true }); },
  crit() { if (!play('crit', { vol: 0.55, rv: 0.02, prio: true, pan: 0 })) synth.crit(); },
  egg() { if (!play('egg', { vol: 0.45, rv: 0.02, prio: true, pan: 0.4 })) synth.egg(); },
  crack() { if (!play('crack', { vol: 0.75, rate: rnd(0.95, 1.1), prio: true, pan: 0.4 })) synth.egg(); },
  tick() { if (!play('tick', { vol: 0.5, rate: rnd(0.95, 1.1), prio: true, pan: 0 })) synth.tick(); },
  win() { if (!play('win', { vol: 0.5, rv: 0, prio: true, pan: 0 })) synth.win(); },
  big() { if (!play('big', { vol: 0.6, rv: 0, prio: true, pan: 0 })) synth.big(); else play('win', { vol: 0.4, rv: 0, prio: true, pan: 0 }); },
  lose() { if (!play('lose', { vol: 0.45, rv: 0, prio: true, pan: 0 })) synth.lose(); },
  power() { if (!play('power', { vol: 0.45, rv: 0, prio: true, pan: 0 })) synth.power(); },
  insert() { if (!play('insert', { vol: 0.6, rate: rnd(0.95, 1.05), prio: true, pan: 0.3 })) synth.insert(); },
  whoosh() { if (!play('whoosh', { vol: 0.45, rate: rnd(0.9, 1.15), prio: true })) synth.whoosh(); },
  click() { if (!play('click', { vol: 0.5, rate: rnd(0.95, 1.05), prio: true, pan: 0 })) synth.click(); },
};
