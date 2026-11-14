// 簡易 WebAudio 合成音效
let ctx = null, master = null, muted = false;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
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
export const sfx = {
  shoot() { tone(520, 0.12, 'square', 0.12, 400); noise(0.08, 0.08, 3000); },
  hit() { tone(220, 0.1, 'triangle', 0.25, -80); },
  snap() { noise(0.25, 0.3, 600); tone(880, 0.3, 'sawtooth', 0.12, -600); },
  crit() { tone(660, 0.1, 'square', 0.2); tone(990, 0.15, 'square', 0.2, 0, 0.08); tone(1320, 0.25, 'square', 0.2, 0, 0.16); },
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
