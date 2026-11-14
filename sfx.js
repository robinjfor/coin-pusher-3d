// 簡易 WebAudio 合成音效
let ctx = null, master = null, muted = false;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.12;
    master.connect(comp); comp.connect(ctx.destination);
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
export const sfx = {
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
