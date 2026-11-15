import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { sfx, initAudio, setMuted, isMuted } from './sfx.js';
import { startMinigame, minigameActive } from './minigames.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const MOBILE = params.has('mobile') || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
const LOWFX = params.has('lowfx');
const LITE = LOWFX || MOBILE; // 手機自動使用省電設定
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ====================== 遊戲狀態 ======================
const S = {
  bullets: 20, inserted: 0, tickets: 0,
  eggs: 0, spins: 0,
  collect: { diamond: 0, dart: 0, hat: 0 },
  freeUntil: 0, powerUntil: 0,
  pendingCoins: 0, dumpCoins: 0,
  totalWon: 0, broken: 0, hits: 0, shots: 0,
};
// 金幣池不設數量上限（改用睡眠、簡化碰撞、只更新移動中的金幣等方式優化）
const COIN_CAP0 = 2048;
const FREE_DUR = 10, POWER_DUR = 50;
const now = () => performance.now() / 1000;

// ====================== 渲染器 / 場景 ======================
const stage = $('stage'), hud = $('hud');
let SW = 430, SH = 764, SPLIT = 382, HS = 1;
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: MOBILE ? 'low-power' : 'high-performance' });
renderer.setPixelRatio(LOWFX ? 1 : Math.min(window.devicePixelRatio, MOBILE ? 1.35 : 1.75));

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = !LOWFX;
renderer.shadowMap.autoUpdate = false; // 陰影每幀最多算一次（兩個視角共用），手機每 3 幀更新一次
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#000000'); gr.addColorStop(0.5, '#141414'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// 上方：吊掛道具攝影機；下方：金幣池攝影機（直式雙畫面）
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
camera.position.set(0, 8, 6); camera.lookAt(0, 7.4, -8);
const poolCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
poolCam.position.set(0, 7.4, 6.9); poolCam.lookAt(0, -0.3, 1.0);
poolCam.layers.enable(2);
camera.layers.enable(1); // 圖層 1：吊掛道具、子彈、道具 Icon（只在上方畫面顯示）

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let w, h;
  if (vw / vh > 0.75) { h = vh; w = Math.round(vh * 9 / 16); stage.classList.remove('full'); }
  else { w = vw; h = vh; stage.classList.add('full'); }
  SW = w; SH = h; SPLIT = Math.round(h * 0.5);
  Object.assign(stage.style, { width: w + 'px', height: h + 'px', left: Math.round((vw - w) / 2) + 'px', top: Math.round((vh - h) / 2) + 'px' });
  HS = w / 430;
  hud.style.transform = `scale(${HS})`; hud.style.height = (h / HS) + 'px';
  hud.style.setProperty('--split', (SPLIT / HS) + 'px');
  renderer.setSize(w, h);
  camera.aspect = w / SPLIT;
  camera.fov = Math.max(52, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) * 1.0 / camera.aspect)));
  camera.updateProjectionMatrix();
  poolCam.aspect = w / (h - SPLIT);
  poolCam.fov = Math.max(42, 2 * THREE.MathUtils.radToDeg(Math.atan(0.42 / poolCam.aspect)));
  poolCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// 燈光
scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a0a, LITE ? 0.75 : 0.45));
const key = new THREE.DirectionalLight(0xfff6e8, 2.4);
key.position.set(3, 12, 6); key.target.position.set(0, 0, 0);
key.castShadow = true; key.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -6.5, right: 6.5, top: 7, bottom: -7, near: 1, far: 30 });
key.shadow.bias = -0.0008;
scene.add(key, key.target);
const upper = new THREE.DirectionalLight(0xffffff, 1.5); upper.position.set(-4, 14, 4); upper.target.position.set(0, 6, -10); scene.add(upper, upper.target);
// 側面輪廓光：白光 + 一盞金色重點光（單一強調色）
if (!LITE) { // 手機省略兩盞側光（逐像素成本高）
  const pl1 = new THREE.PointLight(0xffffff, 22, 18); pl1.position.set(-6, 3.5, 1); scene.add(pl1);
  const pl2 = new THREE.PointLight(0xffffff, 22, 18); pl2.position.set(6, 3.5, 1); scene.add(pl2);
}
const pl3 = new THREE.PointLight(0xffc000, 30, 14); pl3.position.set(0, 4, 4); scene.add(pl3);
if (!LITE) { const spotItems = new THREE.SpotLight(0xffffff, 120, 40, 0.75, 0.6); spotItems.position.set(0, 18, 2); spotItems.target.position.set(0, 7, -10); scene.add(spotItems, spotItems.target); }

// ====================== 材質 ======================
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// 金幣：金色 PBR + 浮雕（bumpMap）：凸起外圈、六角形徽記、齒邊
function hexPath(g, cx, cy, r, rot = Math.PI / 6) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); }
const coinFaceTex = canvasTex(128, 128, (g, w, h) => {
  g.scale(w / 256, h / 256); w = h = 256; // 低解析度貼圖（座標仍以 256 設計）
  const gr = g.createRadialGradient(100, 90, 10, 128, 128, 140);
  gr.addColorStop(0, '#fff6cf'); gr.addColorStop(0.55, '#ffd25a'); gr.addColorStop(1, '#e0a92a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,70,0,.55)'; g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke();
  hexPath(g, 128, 128, 62); g.strokeStyle = 'rgba(110,62,0,.6)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = 'rgba(110,62,0,.55)'; g.font = '700 74px "Barlow Condensed","Noto Sans TC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 128, 132);
});
const M = {
  gold: new THREE.MeshStandardMaterial({ color: 0xffc23a, metalness: 1, roughness: 0.26 }),
  // 金幣：粗糙一點、不做凹凸貼圖（比較不精細也比較省）
  coinEdge: new THREE.MeshStandardMaterial({ color: 0xe8b23a, metalness: 1, roughness: 0.42, envMapIntensity: 1.5 }),
  coinFace: new THREE.MeshStandardMaterial({ color: 0xffffff, map: coinFaceTex, metalness: 1, roughness: 0.38, envMapIntensity: 1.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.14 }),
  red: new THREE.MeshPhysicalMaterial({ color: 0xd0081e, metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }),
  lacquer: new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }),
  charcoal: new THREE.MeshPhysicalMaterial({ color: 0x202020, metalness: 0.3, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  pearl: new THREE.MeshPhysicalMaterial({ color: 0xf5f5f5, metalness: 0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4 }),
  leather: new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.62, metalness: 0, sheen: 0.6, sheenColor: new THREE.Color(0x555555) }),
  crystal: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0.3, ior: 2.2, clearcoat: 1, envMapIntensity: 2.5 }), // 不用 transmission（會多一次整個場景的渲染）
  steel: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.32 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  rope: new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.85, roughness: 0.38 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 }),
  goldGlow: new THREE.MeshBasicMaterial({ color: 0xffc000 }),
};
M.wood = M.leather; M.sack = M.leather; M.pink = M.pearl; M.purple = M.lacquer; M.teal = M.charcoal;

// ====================== 機台外觀 ======================
const blinkers = [];
const RAMP_DEF = { z: -1.65, x0: -3.95, y0: 2.2, x1: -2.2, y1: 1.15, w: 0.24 };
const POOL = { xHalf: 4.2, front: 4.0, back: -7, wallZ: -2.0, pusherHalfD: 2.2, pusherH: 0.6 };
{
  // 金幣池底板
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2; // 六角形網格（品牌幾何）
    const R = 22, hx = R * Math.sqrt(3);
    for (let row = -1; row < h / (R * 1.5) + 1; row++) for (let col = -1; col < w / hx + 1; col++) { hexPath(g, col * hx + (row % 2 ? hx / 2 : 0), row * R * 1.5, R - 2, Math.PI / 6); g.stroke(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(3, 4);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(POOL.xHalf * 2 + 0.4, 0.3, POOL.front - POOL.back),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.55 }));
  floor.position.set(0, -0.15, (POOL.front + POOL.back) / 2); floor.receiveShadow = true; scene.add(floor);
  // 前方出口洞
  const pit = new THREE.Mesh(new THREE.BoxGeometry(POOL.xHalf * 2 + 0.4, 0.05, 1.6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pit.position.set(0, -1.2, POOL.front + 0.8); scene.add(pit);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(POOL.xHalf * 2 + 0.4, 0.06, 0.06), M.goldGlow);
  lip.position.set(0, 0.0, POOL.front); scene.add(lip);
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(POOL.xHalf * 2 + 1.4, 0.25, 0.25), M.lacquer);
  frontBar.position.set(0, -0.9, POOL.front + 1.7); scene.add(frontBar);
  // 側面玻璃
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, depthWrite: false });
  for (const s of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, POOL.front - POOL.back), glass);
    g.position.set(s * (POOL.xHalf + 0.12), 1.3, (POOL.front + POOL.back) / 2); scene.add(g);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, POOL.front - POOL.back, 12), M.chrome);
    rail.rotation.x = Math.PI / 2; rail.position.set(s * (POOL.xHalf + 0.12), 2.6, (POOL.front + POOL.back) / 2); scene.add(rail);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, POOL.front - POOL.back), M.goldGlow);
    neon.position.set(s * (POOL.xHalf + 0.12), 0.05, (POOL.front + POOL.back) / 2); scene.add(neon);
    // 燈柱
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffc000 : 0xffffff }));
      b.position.set(s * (POOL.xHalf + 0.6), 0.4 + k * 0.55, POOL.front - 0.8); b.userData.blink = k; scene.add(b); blinkers.push(b);
    }
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 0.4), M.lacquer);
    pillar.position.set(s * (POOL.xHalf + 0.6), 1.6, POOL.front - 0.8); pillar.position.z -= 0.25; scene.add(pillar);
  }
  // 後牆（推板上方）
  const wallTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
    for (let x = 0; x < w + 40; x += 38) for (let y = 0; y < h + 40; y += 33) { hexPath(g, x + ((y / 33) % 2 ? 19 : 0), y, 18); g.stroke(); }
    g.fillStyle = '#ffc000'; g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, w, 3);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.font = '400 92px "Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif'; g.fillText('幸運推金幣', w / 2, h / 2 - 14);
    g.font = '500 30px "Barlow Condensed",sans-serif'; g.fillStyle = '#ffc000'; g.fillText('L U C K Y   C O I N   P U S H E R', w / 2, h / 2 + 62);
  });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(POOL.xHalf * 2 + 0.4, 2.6, 0.3),
    [M.lacquer, M.lacquer, M.chrome, M.lacquer, new THREE.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.2 }), M.lacquer]);
  wall.position.set(0, 0.62 + 1.3, POOL.wallZ - 0.15); wall.castShadow = true; scene.add(wall);
  // 左上出幣口 + 斜坡（視覺）
  const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
  chute.rotation.z = Math.PI / 2; chute.position.set(-POOL.xHalf - 0.25, 2.62, RAMP_DEF.z); scene.add(chute);
  const chuteRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 8, 24), M.goldGlow);
  chuteRing.position.set(-POOL.xHalf + 0.2, 2.62, RAMP_DEF.z); chuteRing.rotation.y = Math.PI / 2; scene.add(chuteRing);
  // 上方大螢幕背板
  const backTex = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const sp = g.createRadialGradient(w / 2, h * 0.35, 10, w / 2, h * 0.4, w * 0.55); sp.addColorStop(0, 'rgba(255,255,255,.10)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1.5;
    for (let x = 0; x < w + 30; x += 28) for (let y = 0; y < h + 30; y += 24) { hexPath(g, x + ((y / 24) % 2 ? 14 : 0), y, 13); g.stroke(); }
    g.fillStyle = 'rgba(255,192,0,.55)'; g.fillRect(0, h * 0.92, w, 2);
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(90, 34), new THREE.MeshBasicMaterial({ map: backTex }));
  back.position.set(0, 8, -22); scene.add(back);
}
// ====================== 物理世界 ======================
// 輕微向前傾斜的重力（模擬機台微傾），讓金幣堆更容易被推動
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -14, 0.45) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
// cannon 預設的碰撞矩陣是 n² 陣列（1500 枚金幣 ≈ 110 萬格），每步清零、每次加/移除剛體都重新配置；
// 改用只記錄實際接觸配對的稀疏集合。另外關掉沒用到的 begin/endContact 追蹤（它用線性插入排序，接觸一多就很慢）。
class SparseCollisionMatrix {
  constructor() { this.s = new Set(); }
  key(bi, bj) { const a = bi.id, b = bj.id; return a < b ? a * 1048576 + b : b * 1048576 + a; }
  get(bi, bj) { return this.s.has(this.key(bi, bj)); }
  set(bi, bj, v) { const k = this.key(bi, bj); if (v) this.s.add(k); else this.s.delete(k); }
  reset() { this.s.clear(); }
  setNumObjects() {}
}
world.collisionMatrix = new SparseCollisionMatrix(); world.collisionMatrixPrevious = new SparseCollisionMatrix();
for (const ok of [world.bodyOverlapKeeper, world.shapeOverlapKeeper]) { ok.set = () => {}; ok.tick = () => {}; ok.getDiff = () => {}; }
world.solver.iterations = 5;
const matCoin = new CANNON.Material('coin'), matStatic = new CANNON.Material('static'), matPusher = new CANNON.Material('pusher');
world.addContactMaterial(new CANNON.ContactMaterial(matCoin, matCoin, { friction: 0.07, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCoin, matStatic, { friction: 0.2, restitution: 0.08 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCoin, matPusher, { friction: 0.35, restitution: 0.02 }));
const matWall = new CANNON.Material('wall'); // 滾道擋板：無摩擦，立著滾的金幣貼著擋板也不會被摩擦力卡住
world.addContactMaterial(new CANNON.ContactMaterial(matCoin, matWall, { friction: 0, restitution: 0.05 }));
function staticBox(hx, hy, hz, x, y, z) {
  const b = new CANNON.Body({ mass: 0, material: matStatic });
  b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(x, y, z); world.addBody(b); return b;
}
staticBox(POOL.xHalf + 0.2, 0.5, (POOL.front - POOL.back) / 2, 0, -0.5, (POOL.front + POOL.back) / 2); // 底板
staticBox(0.1, 3, (POOL.front - POOL.back) / 2 + 1, -POOL.xHalf - 0.1, 2, (POOL.front + POOL.back) / 2);
staticBox(0.1, 3, (POOL.front - POOL.back) / 2 + 1, POOL.xHalf + 0.1, 2, (POOL.front + POOL.back) / 2);
staticBox(POOL.xHalf + 0.2, 1.6, 0.15, 0, POOL.pusherH + 0.03 + 1.6, POOL.wallZ - 0.15); // 後牆
staticBox(POOL.xHalf + 0.2, 3, 0.2, 0, 3, POOL.back - 0.2);

const pusherBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matPusher });
pusherBody.addShape(new CANNON.Box(new CANNON.Vec3(POOL.xHalf - 0.03, POOL.pusherH / 2, POOL.pusherHalfD)));
pusherBody.allowSleep = false; world.addBody(pusherBody);
const RAMP = (() => {
  const d = RAMP_DEF;
  const dx = d.x1 - d.x0, dy = d.y1 - d.y0, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  const dir = new THREE.Vector3(dx / len, dy / len, 0), normal = new THREE.Vector3(-dir.y, dir.x, 0);
  const mid = new THREE.Vector3((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, d.z).addScaledVector(normal, -0.05);
  const body = new CANNON.Body({ mass: 0, material: matStatic });
  body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, 0.05, d.w)));
  // 擋板與分隔在坡底收短（垂直於坡面的擋板上緣會凸出坡底，金幣離開時會被勾住）
  const WL = len / 2 - 0.2, WO = -0.2, LIPZ = 0.19, wallShape = (hz) => { const sh = new CANNON.Box(new CANNON.Vec3(WL, 0.3, hz)); sh.material = matWall; return sh; }; // 每條滾道內寬 0.12，只容得下一枚立著的金幣（不會兩枚並排卡住）
  body.addShape(wallShape(0.03), new CANNON.Vec3(WO, 0.3, LIPZ));
  body.addShape(wallShape(0.03), new CANNON.Vec3(WO, 0.3, -LIPZ));
  body.addShape(wallShape(0.04), new CANNON.Vec3(WO, 0.3, 0)); // 中間分隔：兩條滾道
  body.position.set(mid.x, mid.y, mid.z); body.quaternion.setFromEuler(0, 0, ang); world.addBody(body);
  const g = new THREE.Group(); g.position.copy(mid); g.rotation.z = ang;
  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, d.w * 2), M.gold); base.receiveShadow = true; g.add(base);
  for (const sz of [-1, 1]) { const lip = new THREE.Mesh(new THREE.BoxGeometry(WL * 2, 0.6, 0.06), new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.18 })); lip.position.set(WO, 0.3, sz * LIPZ); g.add(lip); }
  { const mid = new THREE.Mesh(new THREE.BoxGeometry(WL * 2, 0.6, 0.08), M.chrome); mid.position.set(WO, 0.3, 0); g.add(mid); }
  scene.add(g);
  return { dir, normal, z: d.z, top: new THREE.Vector3(d.x0 + dir.x * 0.25, d.y0 + dir.y * 0.25, d.z) };
})();
const PUSH = { mid: -0.55, amp: 1.5, w: (Math.PI * 2) / 4.6 };
const pusherFront = (t) => PUSH.mid + PUSH.amp * Math.sin(PUSH.w * t);
const pusherVel = (t) => PUSH.amp * PUSH.w * Math.cos(PUSH.w * t);
const pusherMesh = new THREE.Group();
{
  const top = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#9da1a8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .12})`; g.fillRect(0, Math.random() * h, w, 1); } // 髮絲紋
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry((POOL.xHalf - 0.03) * 2, POOL.pusherH, POOL.pusherHalfD * 2),
    new THREE.MeshStandardMaterial({ map: top, metalness: 1, roughness: 0.3 }));
  body.castShadow = true; body.receiveShadow = true; pusherMesh.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry((POOL.xHalf - 0.03) * 2, 0.06, 0.04), M.goldGlow);
  stripe.position.set(0, 0.05, POOL.pusherHalfD + 0.01); pusherMesh.add(stripe);
  scene.add(pusherMesh);
}

// 金幣（InstancedMesh）
const COIN_R = 0.256, COIN_H = 0.072; // 縮小約 20%
const coinGeo = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, LITE ? 10 : 12); // 低面數（粗糙一點）
{ const gs = coinGeo.groups; if (gs.length === 3 && gs[1].start + gs[1].count === gs[2].start) { gs[1].count += gs[2].count; gs.length = 2; } } // 上下兩面合成一個 draw call
let coinMesh = makeCoinMesh(COIN_CAP0);
function makeCoinMesh(cap) {
  const m = new THREE.InstancedMesh(coinGeo, [M.coinEdge, M.coinFace, M.coinFace], cap);
  m.castShadow = !LITE; m.receiveShadow = true; m.count = 0; // 手機上金幣不投射陰影（陰影 pass 不用再畫上千枚金幣）
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false;
  m.layers.set(2); scene.add(m); return m;
}
// 容量不夠時自動加倍（不限制金幣數量）
function ensureCoinCap(n) {
  if (n <= coinMesh.instanceMatrix.count) return;
  let cap = coinMesh.instanceMatrix.count; while (cap < n) cap *= 2;
  const old = coinMesh; coinMesh = makeCoinMesh(cap); scene.remove(old); old.dispose();
  for (const c of coins) c.dirty = true;
}
// 金幣閃光：少量星芒點精靈（單一 Points、加法混合），隨機附著在金幣上閃爍
const SPARK_N = LITE ? 40 : 80;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3));
sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(SPARK_N), 1));
sparkGeo.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(SPARK_N), 1));
const sparkMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute float aSize; attribute float aRot; varying float vA; varying float vR; uniform float uScale;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; vA = clamp(aSize * 3.0, 0.0, 1.0); vR = aRot; }`,
  fragmentShader: `varying float vA; varying float vR;
    void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float c = cos(vR), s = sin(vR); p = mat2(c, -s, s, c) * p;
      float d = length(p); float ray = max(0.0, 1.0 - abs(p.x) * 9.0) * pow(max(0.0, 1.0 - abs(p.y)), 2.0) + max(0.0, 1.0 - abs(p.y) * 9.0) * pow(max(0.0, 1.0 - abs(p.x)), 2.0);
      float core = exp(-d * d * 18.0); float a = (ray * 1.4 + core * 1.3) * vA; if (a < 0.01) discard;
      gl_FragColor = vec4(vec3(1.0, 0.93, 0.7) * a, a); }`,
});
const sparkPts = new THREE.Points(sparkGeo, sparkMat); sparkPts.frustumCulled = false; sparkPts.layers.set(2); scene.add(sparkPts);
const sparks = Array.from({ length: SPARK_N }, () => ({ c: null, t: 0, dur: 0, ox: 0, oz: 0, big: 1, rot: 0, delay: Math.random() * 1.5 }));
const _sq = new THREE.Quaternion(), _sv = new THREE.Vector3();
function updateSparkles(dt) {
  sparkMat.uniforms.uScale.value = (SH - SPLIT) * renderer.getPixelRatio() * 1.1;
  const pos = sparkGeo.attributes.position.array, size = sparkGeo.attributes.aSize.array, rot = sparkGeo.attributes.aRot.array;
  for (let i = 0; i < SPARK_N; i++) {
    const k = sparks[i];
    if (k.delay > 0) { k.delay -= dt; size[i] = 0; continue; }
    k.t += dt;
    if (!k.c || k.t >= k.dur || !k.c.body.world) {
      k.c = null; size[i] = 0;
      for (let tries = 0; tries < 4 && coins.length; tries++) { const c = coins[(Math.random() * coins.length) | 0]; if (c.free || c.body.position.y > 0.1) { k.c = c; break; } }
      if (!k.c && coins.length) k.c = coins[(Math.random() * coins.length) | 0];
      k.t = 0; k.dur = rand(0.35, 0.8); const a = rand(0, Math.PI * 2), r = rand(0, COIN_R * 0.7); k.ox = Math.cos(a) * r; k.oz = Math.sin(a) * r; k.big = rand(0.7, 1.3); k.rot = rand(0, 1.6); k.delay = rand(0, 0.25);
      continue;
    }
    const b = k.c.body; _sq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _sv.set(k.ox, COIN_H * 0.55, k.oz).applyQuaternion(_sq);
    pos[i * 3] = b.position.x + _sv.x; pos[i * 3 + 1] = b.position.y + _sv.y + 0.02; pos[i * 3 + 2] = b.position.z + _sv.z;
    const u = k.t / k.dur; size[i] = Math.sin(Math.PI * u) ** 2 * 0.85 * k.big; rot[i] = k.rot + u * 0.8;
  }
  sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.aSize.needsUpdate = true; sparkGeo.attributes.aRot.needsUpdate = true;
}
const coinShape = new CANNON.Box(new CANNON.Vec3(0.225, COIN_H / 2, 0.225));
const coins = []; // {body}

// ====================== 快速碰撞：平躺金幣用解析圓盤碰撞 ======================
// 落定的平躺金幣（鎖定旋轉、只有 yaw）視為直立圓盤；圓盤對圓盤、圓盤對軸向靜態方塊（底板、牆、推板）
// 用解析解算出「單一接觸點」，取代 cannon 預設的凸多面體 SAT + 多點裁切，大幅降低窄相與約束數量。
const DISC_R = 0.235, DISC_H = COIN_H / 2;
const isFlatCoin = (b, s) => s === coinShape && b.fixedRotation;
const isAxisBox = (b, q) => (b.type !== CANNON.Body.DYNAMIC) && Math.abs(q.w) > 0.99999;
const _np = world.narrowphase, _boxBoxSAT = _np.boxBox;
function pushContact(np, bi, bj, si, sj, rsi, rsj, nx, ny, nz, pix, piy, piz, pjx, pjy, pjz) {
  const r = np.createContactEquation(bi, bj, si, sj, rsi, rsj);
  r.ni.set(nx, ny, nz);
  r.ri.set(pix - bi.position.x, piy - bi.position.y, piz - bi.position.z);
  r.rj.set(pjx - bj.position.x, pjy - bj.position.y, pjz - bj.position.z);
  np.result.push(r); np.createFrictionEquationsFromContact(r, np.frictionResult);
}
function discDisc(np, si, sj, xi, xj, bi, bj, rsi, rsj, justTest) {
  const dx = xj.x - xi.x, dy = xj.y - xi.y, dz = xj.z - xi.z, d2 = dx * dx + dz * dz, D = DISC_R * 2;
  if (d2 >= D * D || Math.abs(dy) >= DISC_H * 2) return false;
  if (justTest) return true;
  const d = Math.sqrt(d2), ph = D - d, pv = DISC_H * 2 - Math.abs(dy);
  if (pv <= ph * 1.5 || d < 1e-4) { // 疊在上面／下面：垂直法線，接觸點在兩圓心的水平中點
    const sy = dy >= 0 ? 1 : -1, cx = xi.x + dx / 2, cz = xi.z + dz / 2;
    pushContact(np, bi, bj, si, sj, rsi, rsj, 0, sy, 0, cx, xi.y + sy * DISC_H, cz, cx, xj.y - sy * DISC_H, cz);
  } else { // 同一層側面相碰：水平法線
    const nx = dx / d, nz = dz / d, my = (xi.y + xj.y) / 2;
    pushContact(np, bi, bj, si, sj, rsi, rsj, nx, 0, nz, xi.x + nx * DISC_R, my, xi.z + nz * DISC_R, xj.x - nx * DISC_R, my, xj.z - nz * DISC_R);
  }
  return true;
}
// c = 金幣圓盤中心, x/h = 方塊中心與半長；coinIsI 決定法線方向（cannon 的法線由 i 指向 j）
function discBox(np, si, sj, xi, xj, bi, bj, rsi, rsj, justTest, coinIsI) {
  const c = coinIsI ? xi : xj, x = coinIsI ? xj : xi, h = (coinIsI ? sj : si).halfExtents;
  const qx = Math.max(x.x - h.x, Math.min(x.x + h.x, c.x)), qz = Math.max(x.z - h.z, Math.min(x.z + h.z, c.z));
  const ddx = c.x - qx, ddz = c.z - qz, dist2 = ddx * ddx + ddz * ddz;
  if (dist2 >= DISC_R * DISC_R) return false;
  const top = x.y + h.y, bot = x.y - h.y;
  if (c.y - DISC_H >= top || c.y + DISC_H <= bot) return false;
  if (justTest) return true;
  // 候選：上面、下面、側面（取穿透最小者）
  let best = top - (c.y - DISC_H), nx = 0, ny = 1, nz = 0; // 法線：由方塊指向金幣
  const pDown = (c.y + DISC_H) - bot; if (pDown < best) { best = pDown; ny = -1; }
  let sx = 0, sz = 0, ps;
  if (dist2 > 1e-10) { const dist = Math.sqrt(dist2); ps = DISC_R - dist; sx = ddx / dist; sz = ddz / dist; }
  else { // 圓心在方塊投影內：找最近的側面
    const l = c.x - (x.x - h.x), r = (x.x + h.x) - c.x, b = c.z - (x.z - h.z), f = (x.z + h.z) - c.z;
    ps = Math.min(l, r, b, f); if (ps === l) sx = -1; else if (ps === r) sx = 1; else if (ps === b) sz = -1; else sz = 1; ps += DISC_R;
  }
  let pcx, pcy, pcz, pbx, pby, pbz;
  if (ps < best) { nx = sx; ny = 0; nz = sz; pcx = c.x - sx * DISC_R; pcy = c.y; pcz = c.z - sz * DISC_R; pbx = dist2 > 1e-10 ? qx : (sx ? x.x + sx * h.x : c.x); pby = c.y; pbz = dist2 > 1e-10 ? qz : (sz ? x.z + sz * h.z : c.z); }
  else { pcx = qx; pcz = qz; pcy = c.y - ny * DISC_H; pbx = qx; pbz = qz; pby = ny > 0 ? top : bot; }
  if (coinIsI) pushContact(np, bi, bj, si, sj, rsi, rsj, -nx, -ny, -nz, pcx, pcy, pcz, pbx, pby, pbz);
  else pushContact(np, bi, bj, si, sj, rsi, rsj, nx, ny, nz, pbx, pby, pbz, pcx, pcy, pcz);
  return true;
}
_np.boxBox = function (si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest) {
  const fi = isFlatCoin(bi, si), fj = isFlatCoin(bj, sj);
  if (fi && fj) return discDisc(this, si, sj, xi, xj, bi, bj, rsi, rsj, justTest);
  if (fi && isAxisBox(bj, qj)) return discBox(this, si, sj, xi, xj, bi, bj, rsi, rsj, justTest, true);
  if (fj && isAxisBox(bi, qi)) return discBox(this, si, sj, xi, xj, bi, bj, rsi, rsj, justTest, false);
  return _boxBoxSAT.call(this, si, sj, xi, xj, qi, qj, bi, bj, rsi, rsj, justTest);
};
// （enableFrictionReduction 會讓立著滾的金幣在坡道上卡住，所以不開）
const balls = []; // {body, mesh}
const ballShape = new CANNON.Sphere(0.36);
const ballGeo = new THREE.SphereGeometry(0.36, 28, 20);

// 金幣有兩種狀態：
//  free：真實圓柱剛體（可滾動、翻轉），用於出幣口滾出與天降金幣
//  flat：平躺方塊剛體（鎖定旋轉），落定後切換，讓大量金幣堆疊時效能穩定；到前緣時再解鎖翻落
const coinCyl = new CANNON.Cylinder(COIN_R, COIN_R, COIN_H, 12); coinCyl.material = matCoin;
let freeCount = 0;
const SLEEP_V = 0.2, SLEEP_T = 0.3; // 落定的金幣更快進入睡眠
function onCoinCollide(e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 0.8) return;
  if (e.body && e.body.material === matCoin) sfx.clink(v); else sfx.drop(v);
}
function makeCoinBody(x, y, z, vx = 0, vy = 0, vz = 0) {
  const b = new CANNON.Body({ mass: 1, material: matCoin, shape: coinShape, linearDamping: 0.08, angularDamping: 0.35 });
  b.position.set(x, y, z); b.velocity.set(vx, vy, vz);
  b.fixedRotation = true; b.quaternion.setFromEuler(0, rand(0, Math.PI), 0); b.updateMassProperties();
  b.allowSleep = true; b.sleepSpeedLimit = TUNE.sv || SLEEP_V; b.sleepTimeLimit = TUNE.st || SLEEP_T;
  world.addBody(b); return b;
}
// 倒入的金幣用可自由翻轉的薄方塊（碰撞計算比 12 邊圓柱便宜很多，外觀仍是圓柱）；出幣口立著滾的金幣才用圓柱
const coinTumble = new CANNON.Box(new CANNON.Vec3(0.215, COIN_H / 2, 0.215));
function makeFreeCoinBody(x, y, z, q, v, w, roll = false) {
  const b = new CANNON.Body({ mass: 1, material: matCoin, shape: roll ? coinCyl : coinTumble, linearDamping: 0.04, angularDamping: 0.08 });
  b.position.set(x, y, z); b.quaternion.copy(q); b.velocity.copy(v); b.angularVelocity.copy(w);
  b.allowSleep = false;
  b.addEventListener('collide', onCoinCollide);
  world.addBody(b); freeCount++; return b;
}
function addCoin(x, y, z, vx, vy, vz) {
  coins.push({ body: makeCoinBody(x, y, z, vx, vy, vz), born: simTime, free: false, dirty: true });
  return true;
}
function addFreeCoin(x, y, z, q, v, w, roll = false) {
  coins.push({ body: makeFreeCoinBody(x, y, z, q, v, w, roll), born: simTime, free: true, dirty: true });
  // 倒入中的金幣彼此先不碰撞（只碰檯面和已落定的金幣），省下一大團金幣在空中互相計算的成本
  if (!roll && !TUNE.noAir) { const b = coins[coins.length - 1].body; b.collisionFilterGroup = 2; b.collisionFilterMask = 1; }
  return true;
}
const _up = new CANNON.Vec3(), _ax = new CANNON.Vec3(), _X1 = new CANNON.Vec3(1, 0, 0), _Y1 = new CANNON.Vec3(0, 1, 0);
// 自由金幣落定（平躺且速度很低）後轉為平躺方塊
function settleCoin(c) {
  const b = c.body;
  b.removeEventListener('collide', onCoinCollide);
  b.collisionFilterGroup = 1; b.collisionFilterMask = -1;
  b.quaternion.vmult(_X1, _ax);
  const yaw = Math.atan2(-_ax.z, _ax.x);
  while (b.shapes.length) b.removeShape(b.shapes[0]);
  b.addShape(coinShape);
  b.quaternion.setFromEuler(0, yaw, 0);
  b.angularVelocity.set(0, 0, 0);
  b.fixedRotation = true; b.updateMassProperties();
  b.allowSleep = true; b.sleepSpeedLimit = TUNE.sv || SLEEP_V; b.sleepTimeLimit = TUNE.st || SLEEP_T;
  c.free = false; freeCount--;
}
let fastFree = 0; // 速度快的自由金幣數（有的話物理維持 1/60 秒小步，避免穿透）
function updateFreeCoins(t) {
  let ff = 0;
  for (const c of coins) {
    if (!c.free) continue;
    const b = c.body, age = t - c.born;
    if (c.edge || b.velocity.lengthSquared() > 3.2 || age < 0.25) ff++;
    if (b.collisionFilterGroup === 2 && age > 0.45) { b.collisionFilterGroup = 1; b.collisionFilterMask = -1; }
    // 斜坡上絕不停留：速度太低就沿坡道推一下
    if (b.position.x < RAMP_DEF.x1 + (c.edge ? 0.32 : 0.05) && b.position.y > 0.95) {
      if (b.velocity.x * RAMP.dir.x + b.velocity.y * RAMP.dir.y < 3.3) { b.velocity.x += RAMP.dir.x * 0.3; b.velocity.y += RAMP.dir.y * 0.3; }
      if (!c.edge) continue;
    }
    if (c.edge) {
      const roll = Math.abs(b.angularVelocity.z) * COIN_R;
      // 完全離開坡道末端（含兩側擋板與中間分隔）後才放開旋轉，避免在坡道上倒下卡在擋板上
      const off = b.position.x > RAMP_DEF.x1 + 0.32 || b.position.y < 0.95;
      if (b.position.x > RAMP_DEF.x1 + 1.8 || (off && (age > 2.0 || roll < 0.9 || b.velocity.length() < 0.9))) {
        c.edge = false; b.angularFactor.set(1, 1, 1); b.angularVelocity.x += rand(-2.5, 2.5);
      } else continue;
    }
    b.quaternion.vmult(_Y1, _up);
    const flat = Math.abs(_up.y) > 0.94;
    const sp = b.velocity.length() + b.angularVelocity.length() * 0.25;
    // 倒入的金幣一碰到金幣堆、接近平躺就轉成平躺圓盤（便宜的解析碰撞）；立著滾的出幣口金幣維持較嚴格條件
    const quick = !c.roll && age > 0.5 && Math.abs(_up.y) > 0.9 && sp < 0.9 && b.velocity.y > -1.0 && b.position.y < 1.8;
    if (quick || (age > 0.45 && flat && sp < 0.7 && b.position.y < 1.6) || (age > 1.5 && sp < 1.8 && b.position.y < 2 && Math.abs(_up.y) > 0.5) || age > 3) settleCoin(c);
  }
  fastFree = ff;
}
function addBall(x, y, z, vx = 0, vy = 0, vz = 0) {
  const b = new CANNON.Body({ mass: 2.5, material: matCoin, shape: ballShape, linearDamping: 0.15, angularDamping: 0.4 });
  b.position.set(x, y, z); b.velocity.set(vx, vy, vz); b.sleepSpeedLimit = 0.3; b.sleepTimeLimit = 0.3;
  world.addBody(b);
  const m = new THREE.Mesh(ballGeo, M.red); m.castShadow = true; m.layers.set(2); scene.add(m);
  balls.push({ body: b, mesh: m });
}
// 出幣口：金幣立著從斜坡滾下，滾出坡底後自然倒入金幣池
let chuteLane = 0;
function spawnChuteCoin() {
  const sp = rand(3.3, 3.7);
  const p = RAMP.top.clone().addScaledVector(RAMP.normal, COIN_R + 0.03);
  // 出幣口前方還有金幣就先等一下，避免新金幣和前一枚重疊而被彈出斜坡
  const lane = chuteLane ^ 1, lz = RAMP.z + (lane ? 0.1 : -0.1); // 兩條滾道輪流出幣
  for (const c of coins) { const q = c.body.position; if (Math.abs(q.z - lz) < 0.09 && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 0.53 * 0.53) return false; }
  chuteLane = lane;
  const q = new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, rand(-0.05, 0.05)); // 軸向朝 z → 立起來
  const v = new CANNON.Vec3(RAMP.dir.x * sp, RAMP.dir.y * sp, 0);
  const w = new CANNON.Vec3(rand(-0.3, 0.3), 0, -sp / COIN_R);
  const ok = addFreeCoin(p.x, p.y, lz + rand(-0.01, 0.01), q, v, w, true);
  if (ok) {
    // 立著滾：只允許繞 z 軸（硬幣自身的軸）旋轉，滾出坡底一段距離後才放開讓它自然倒下
    const c = coins[coins.length - 1]; c.edge = true; c.roll = true; c.body.angularFactor.set(0, 0, 1);
    sfx.roll();
  }
  return ok;
}
// 側邊倒入：左右兩側固定的倒幣口輪流把金幣倒進池中，帶隨機角度翻滾
const SPOUTS = [-1, 1].map(sx => ({ sx, x: sx * (POOL.xHalf - 1.75), y: 2.15, z: 1.55, timer: sx > 0 ? 0.18 : 0 }));
const SPOUT_W = 2.1; // 出幣口寬度（z 方向）
// 倒幣口外觀：寬口黑色烤漆倒幣槽從兩側伸進池子上方＋金色出口框＋上方漏斗
for (const sp of SPOUTS) {
  const g = new THREE.Group(); g.position.set(sp.sx * (POOL.xHalf - 0.95), sp.y + 0.2, sp.z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, SPOUT_W + 0.3), M.lacquer); body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.03, SPOUT_W + 0.32), M.charcoal); top.position.y = 0.26; g.add(top);
  const hop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, SPOUT_W + 0.1), M.lacquer); hop.position.set(sp.sx * 0.15, 0.52, 0); hop.scale.x = 1; g.add(hop);
  const hopRim = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, SPOUT_W + 0.16), M.goldGlow); hopRim.position.set(sp.sx * 0.15, 0.78, 0); g.add(hopRim);
  const pile = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, SPOUT_W - 0.05), M.gold); pile.position.set(sp.sx * 0.15, 0.79, 0); g.add(pile); // 漏斗裡的金幣
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, SPOUT_W), new THREE.MeshBasicMaterial({ color: 0x000000 })); mouth.position.set(-sp.sx * 0.66, -0.03, 0); g.add(mouth);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, SPOUT_W + 0.1), M.goldGlow); frame.position.set(-sp.sx * 0.655, -0.03, 0); g.add(frame);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, SPOUT_W - 0.04), new THREE.MeshBasicMaterial({ color: 0x000000 })); inner.position.set(-sp.sx * 0.68, -0.03, 0); g.add(inner);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, SPOUT_W), M.charcoal); lip.position.set(-sp.sx * 0.84, -0.24, 0); lip.rotation.z = sp.sx * 0.35; g.add(lip);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.02), M.goldGlow); stripe.position.set(0, -0.14, SPOUT_W / 2 + 0.16); g.add(stripe);
  scene.add(g); sp.frame = frame;
}
// 一口氣倒出：每一波在整個出口寬度上同時噴出一團金幣（4 列 × 3 排）
function spawnPourBurst(sp, maxN) {
  let n = 0;
  for (let k = 0; n < maxN; k++) for (let j = 0; j < 3 && n < maxN; j++) for (let i = 0; i < 4 && n < maxN; i++) {
    const q = new CANNON.Quaternion().setFromEuler(rand(-0.8, 0.8), rand(0, Math.PI * 2), Math.PI / 2 * sp.sx + rand(-0.7, 0.7));
    const v = new CANNON.Vec3(-sp.sx * rand(1.8, 3.6) - sp.sx * j * 0.4, rand(-0.6, 0.8), rand(-0.6, 0.6) + (i - 1.5) * 0.25);
    const w = new CANNON.Vec3(rand(-9, 9), rand(-4, 4), rand(-11, 11));
    const x = sp.x - sp.sx * j * 0.55 + rand(-0.03, 0.03), y = sp.y + (j % 2) * 0.12 + k * 0.16 + rand(-0.03, 0.03), z = sp.z + (i - 1.5) * 0.55 + rand(-0.04, 0.04);
    if (!addFreeCoin(x, y, z, q, v, w)) return n;
    n++;
  }
  return n;
}

// 初始金幣堆與紅球
function initPool() {
  const p0 = pusherFront(0);
  for (let layer = 0; layer < 3; layer++) {
    for (let x = -POOL.xHalf + 0.3; x <= POOL.xHalf - 0.28; x += 0.52) {
      for (let z = p0 + 0.35; z <= POOL.front - 0.12; z += 0.52) {
        if (layer === 2 && Math.random() < 0.6) continue;
        if (coins.length >= 330) continue; // 初始金幣不要塞滿，留空間給倒入的金幣
        const o = layer % 2 ? 0.23 : 0;
        if (Math.abs(x + o) > POOL.xHalf - 0.25) continue;
        addCoin(x + o + rand(-.03, .03), 0.04 + layer * 0.08, z + o + rand(-.03, .03));
      }
    }
  }
  for (let x = -POOL.xHalf + 0.4; x <= POOL.xHalf - 0.4; x += 0.54) for (let z = POOL.wallZ + 0.3; z < p0 - 0.25; z += 0.54) addCoin(x, POOL.pusherH + 0.05, z);
  for (let i = 0; i < 10; i++) addBall(rand(-POOL.xHalf + 0.8, POOL.xHalf - 0.8), 0.9 + i * 0.05, rand(-0.2, POOL.front - 2));
}

// ====================== 上方吊掛道具 ======================
const ROWS = [
  { z: -5, y: 6.4, range: 8.5, spacing: 3.4, speed: 0.75, values: [5, 8, 10, 12, 15, 20], scale: 1.0, color: '#ffffff' },
  { z: -9.5, y: 8.4, range: 11, spacing: 4.4, speed: 0.6, values: [30, 40, 50, 60, 80], scale: 1.25, color: '#969696' },
  { z: -14, y: 10.6, range: 14, spacing: 5.6, speed: 0.45, values: [100, 120, 150, 200, 300], scale: 1.55, color: '#ffc000' },
];
const items = [];
const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 1, roughness: 0.25 });
const itemsRoot = new THREE.Group(); scene.add(itemsRoot);
for (const r of ROWS) {
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * r.scale, 0.06 * r.scale, r.range * 2 + 6, 10), railMat);
  rail.rotation.z = Math.PI / 2; rail.position.set(0, r.y + 0.05, r.z); scene.add(rail); rail.layers.set(1);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(r.range * 2 + 6, 0.025 * r.scale, 0.025), new THREE.MeshBasicMaterial({ color: new THREE.Color(r.color).multiplyScalar(0.55) }));
  glow.position.set(0, r.y + 0.16 * r.scale, r.z); scene.add(glow); glow.layers.set(1);
}

function labelTexture(value, color) {
  return canvasTex(256, 100, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,.9)'; g.fillRect(2, 8, w - 4, h - 16);
    g.fillStyle = color; g.fillRect(2, 8, 8, h - 16); // 左側色條（直角，無圓角）
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.strokeRect(2, 8, w - 4, h - 16);
    hexPath(g, 50, 50, 25); g.fillStyle = '#ffc000'; g.fill();
    g.fillStyle = '#000'; g.font = '700 32px "Barlow Condensed",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 50, 52);
    g.fillStyle = '#fff'; g.font = '600 58px "Barlow Condensed","Noto Sans TC",sans-serif'; g.textAlign = 'left';
    g.fillText('×' + value, 86, 54);
  });
}

function makeModel(kind, s) {
  const g = new THREE.Group(); let r = 0.6 * s;
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const coin = (rr, hh) => new THREE.CylinderGeometry(rr, rr, hh, 28);
  const coinMats = [M.coinEdge, M.coinFace, M.coinFace];
  switch (kind) {
    case 'stack': { // 浮雕金幣塔＋黑色底座
      add(new THREE.CylinderGeometry(0.5 * s, 0.54 * s, 0.1 * s, 6), M.lacquer, 0, -0.45 * s);
      for (let i = 0; i < 7; i++) add(coin(0.4 * s, 0.11 * s), coinMats, Math.sin(i * 1.7) * 0.025 * s, -0.34 * s + i * 0.12 * s, 0, 0, i * 0.7);
      add(coin(0.4 * s, 0.11 * s), coinMats, 0.12 * s, 0.55 * s, 0.05 * s, 1.1, 0, 0.3);
      r = 0.55 * s; break;
    }
    case 'sack': { // 黑色皮革錢袋、金色束口與徽章
      const b = add(new THREE.SphereGeometry(0.55 * s, 28, 20), M.leather, 0, -0.1 * s); b.scale.set(1, 0.92, 0.95);
      add(new THREE.CylinderGeometry(0.15 * s, 0.24 * s, 0.26 * s, 16), M.leather, 0, 0.45 * s);
      add(new THREE.TorusGeometry(0.17 * s, 0.035 * s, 10, 24), M.gold, 0, 0.42 * s, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 0.04 * s, 6), M.gold, 0, -0.05 * s, 0.52 * s, Math.PI / 2, 0, Math.PI / 6);
      for (let i = 0; i < 3; i++) add(coin(0.12 * s, 0.03 * s), coinMats, (i - 1) * 0.12 * s, 0.6 * s + (i % 2) * 0.03 * s, 0, rand(-0.6, 0.6), 0, rand(-0.6, 0.6));
      r = 0.6 * s; break;
    }
    case 'gift': { // 鋼琴烤漆禮盒＋金色緞帶
      const mat = pick([M.lacquer, M.pearl, M.charcoal]);
      add(new THREE.BoxGeometry(0.9 * s, 0.78 * s, 0.9 * s), mat);
      add(new THREE.BoxGeometry(0.96 * s, 0.14 * s, 0.96 * s), mat, 0, 0.42 * s);
      add(new THREE.BoxGeometry(0.98 * s, 0.94 * s, 0.12 * s), M.gold, 0, 0.05 * s); add(new THREE.BoxGeometry(0.12 * s, 0.94 * s, 0.98 * s), M.gold, 0, 0.05 * s);
      add(new THREE.TorusGeometry(0.15 * s, 0.04 * s, 10, 20), M.gold, -0.13 * s, 0.6 * s, 0, 0, 0, 0.7);
      add(new THREE.TorusGeometry(0.15 * s, 0.04 * s, 10, 20), M.gold, 0.13 * s, 0.6 * s, 0, 0, 0, -0.7);
      r = 0.64 * s; break;
    }
    case 'piggy': { // 白色陶瓷金豬（金色細節）
      const b = add(new THREE.SphereGeometry(0.55 * s, 28, 20), M.pearl); b.scale.set(1.15, 0.95, 0.95);
      add(new THREE.CylinderGeometry(0.17 * s, 0.17 * s, 0.14 * s, 20), M.pearl, 0, 0, 0.58 * s, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.13 * s, 0.13 * s, 0.02 * s, 20), M.gold, 0, 0, 0.655 * s, Math.PI / 2);
      for (const sx of [-1, 1]) {
        add(new THREE.ConeGeometry(0.13 * s, 0.22 * s, 12), M.pearl, sx * 0.25 * s, 0.5 * s, 0.1 * s);
        add(new THREE.SphereGeometry(0.05 * s, 10, 10), M.black, sx * 0.2 * s, 0.18 * s, 0.48 * s);
        for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.09 * s, 0.1 * s, 0.22 * s, 12), M.pearl, sx * 0.32 * s, -0.48 * s, sz * 0.25 * s);
      }
      add(new THREE.BoxGeometry(0.3 * s, 0.04 * s, 0.08 * s), M.black, 0, 0.53 * s, 0);
      add(coin(0.18 * s, 0.05 * s), coinMats, 0, 0.66 * s, 0, Math.PI / 2, 0, 0);
      r = 0.68 * s; break;
    }
    case 'chest': { // 碳黑寶箱＋金色包角、滿溢金幣
      add(new THREE.BoxGeometry(1.1 * s, 0.6 * s, 0.75 * s), M.charcoal, 0, -0.15 * s);
      add(new THREE.CylinderGeometry(0.375 * s, 0.375 * s, 1.1 * s, 20, 1, false, 0, Math.PI), M.charcoal, 0, 0.15 * s, -0.05 * s, -0.5, 0, Math.PI / 2);
      for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.06 * s, 0.64 * s, 0.79 * s), M.gold, x * s, -0.15 * s);
      add(new THREE.BoxGeometry(1.14 * s, 0.06 * s, 0.79 * s), M.gold, 0, 0.15 * s);
      add(new THREE.BoxGeometry(0.16 * s, 0.2 * s, 0.05 * s), M.gold, 0, 0.02 * s, 0.4 * s);
      for (let i = 0; i < 9; i++) add(coin(0.13 * s, 0.035 * s), coinMats, rand(-0.4, 0.4) * s, 0.2 * s + rand(0, 0.12) * s, rand(-0.2, 0.25) * s, rand(-.6, .6), 0, rand(-.6, .6));
      r = 0.7 * s; break;
    }
    case 'trophy': { // 金盃＋黑色底座＋水晶
      const pts = [[0.05, -0.1], [0.12, 0], [0.3, 0.15], [0.4, 0.38], [0.42, 0.55], [0.38, 0.56]].map(([x, y]) => new THREE.Vector2(x * s, y * s));
      add(new THREE.LatheGeometry(pts, 32), M.gold, 0, 0);
      add(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.32 * s, 14), M.gold, 0, -0.26 * s);
      add(new THREE.CylinderGeometry(0.22 * s, 0.26 * s, 0.06 * s, 6), M.gold, 0, -0.43 * s);
      add(new THREE.BoxGeometry(0.56 * s, 0.2 * s, 0.4 * s), M.lacquer, 0, -0.56 * s);
      for (const sx of [-1, 1]) add(new THREE.TorusGeometry(0.15 * s, 0.035 * s, 10, 20, Math.PI), M.gold, sx * 0.42 * s, 0.3 * s, 0, 0, 0, -sx * Math.PI / 2);
      add(new THREE.OctahedronGeometry(0.14 * s, 0), M.crystal, 0, 0.75 * s);
      r = 0.65 * s; break;
    }
    case 'bars': { // 梯形金條堆
      const bar = new THREE.CylinderGeometry(0.2 * s, 0.27 * s, 0.17 * s, 4, 1); bar.rotateY(Math.PI / 4); bar.scale(1.25, 1, 0.62);
      [[-0.27, -0.2, 0], [0.27, -0.2, 0], [0, -0.2, 0.26], [-0.14, -0.03, 0.1], [0.14, -0.03, 0.1], [0, 0.14, 0.1]].forEach(([x, y, z]) => add(bar, M.gold, x * s, y * s, z * s));
      add(new THREE.BoxGeometry(0.9 * s, 0.06 * s, 0.7 * s), M.lacquer, 0, -0.32 * s, 0.1 * s);
      r = 0.55 * s; break;
    }
  }
  return { group: g, r };
}

function newItemData(row, rowIdx) {
  const value = pick(row.values);
  const kinds = rowIdx === 0 ? ['stack', 'sack', 'gift'] : rowIdx === 1 ? ['piggy', 'gift', 'sack', 'chest'] : ['chest', 'trophy', 'bars'];
  const vmul = 0.85 + 0.3 * (row.values.indexOf(value) / (row.values.length - 1));
  return { value, kind: pick(kinds), s: row.scale * vmul * 0.85 };
}
const ROPE_HOT = new THREE.Color(0xff5030);
function buildItem(it) {
  if (it.pivot) itemsRoot.remove(it.pivot);
  const d = newItemData(it.row, it.rowIdx);
  it.value = d.value; it.state = 'hang'; it.hits = 0;
  it.L = rand(1.0, 1.8) * (0.85 + it.rowIdx * 0.15);
  const pivot = new THREE.Group();
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * it.row.scale, 0.03 * it.row.scale, 1, 8), M.rope.clone());
  rope.scale.y = it.L; rope.position.y = -it.L / 2; pivot.add(rope);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1 * it.row.scale, 0.03 * it.row.scale, 6, 12), M.chrome); pivot.add(hook);
  const mdl = makeModel(d.kind, d.s);
  mdl.group.position.y = -it.L - mdl.r * 0.85; pivot.add(mdl.group);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(it.value, it.row.color), depthWrite: false }));
  const ls = 0.62 * it.row.scale * (1 + it.rowIdx * 0.12); label.scale.set(ls * 2.56, ls, 1);
  label.position.y = mdl.group.position.y - mdl.r - ls * 0.55; pivot.add(label);
  pivot.position.set(it.x, it.row.y, it.row.z);
  itemsRoot.add(pivot); pivot.traverse((o) => o.layers.set(1));
  Object.assign(it, { pivot, rope, model: mdl.group, r: mdl.r, label, swing: rand(0.04, 0.1), phase: rand(0, 6.28), sw: rand(1.3, 2.0), kick: 0 });
}
ROWS.forEach((row, rowIdx) => {
  const n = Math.floor((row.range * 2) / row.spacing);
  for (let i = 0; i < n; i++) {
    const it = { row, rowIdx, x: -row.range + i * row.spacing + rand(-0.4, 0.4) };
    buildItem(it); items.push(it);
  }
});
const falling = [];
let flow = -1, flowTarget = -1, flowTimer = rand(8, 14);

function updateItems(dt, t) {
  flowTimer -= dt;
  if (flowTimer <= 0) {
    if (flowTarget < 0 && Math.random() < 0.45) { flowTarget = 1; flowTimer = rand(3, 6); }
    else { flowTarget = -1; flowTimer = rand(8, 15); }
  }
  flow += (flowTarget - flow) * Math.min(1, dt * 0.8);
  for (const it of items) {
    it.x += it.row.speed * flow * dt;
    const R = it.row.range;
    let wrapped = false;
    if (it.x < -R) { it.x += 2 * R; wrapped = true; }
    if (it.x > R) { it.x -= 2 * R; wrapped = true; }
    if (wrapped && it.state !== 'hang') buildItem(it);
    it.pivot.position.x = it.x;
    it.kick *= Math.exp(-dt * 1.2);
    const ang = Math.sin(t * it.sw + it.phase) * (it.swing + it.kick) - flow * 0.04;
    it.pivot.rotation.z = ang;
    it.pivot.rotation.x = Math.sin(t * it.sw * 0.7 + it.phase) * 0.04;
  }
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i];
    f.v.y -= 16 * dt; f.obj.position.addScaledVector(f.v, dt);
    f.obj.rotation.x += f.spin.x * dt; f.obj.rotation.z += f.spin.z * dt;
    f.life -= dt;
    if (f.obj.position.y < 2.5 || f.life <= 0) { if (f.obj.position.y < 2.5) sfx.thud(); scene.remove(f.obj); falling.splice(i, 1); }
  }
}

function breakChance(v) { return clamp(1.56 / Math.pow(v, 0.7), 0.025, 0.5); }

function breakItem(it) {
  it.state = 'broken'; S.broken++;
  const wp = new THREE.Vector3(); it.model.getWorldPosition(wp);
  const grp = new THREE.Group(); grp.layers.set(1); scene.add(grp); grp.position.copy(wp);
  const wq = new THREE.Quaternion(); it.model.getWorldQuaternion(wq);
  it.pivot.remove(it.model); it.model.position.set(0, 0, 0); it.model.quaternion.copy(wq); grp.add(it.model);
  const lp = new THREE.Vector3(); it.label.getWorldPosition(lp); it.pivot.remove(it.label); it.label.position.copy(lp.sub(wp)); grp.add(it.label);
  falling.push({ obj: grp, v: new THREE.Vector3(it.row.speed * flow, 1.5, 0), spin: { x: rand(-3, 3), z: rand(-4, 4) }, life: 3 });
  // 繩子斷開：只留一小截
  const stub = it.L * rand(0.3, 0.5); it.rope.scale.y = stub; it.rope.position.y = -stub / 2;
  it.rope.material.color.set(0xff6a3a);
  sfx.snap();
  const sp = toScreen(wp);
  popup('繩子斷了！', sp.x, sp.y - 30, 'info');
  setTimeout(() => popup(`+${it.value} 金幣`, sp.x, sp.y + 10, 'big'), 250);
  addPrizeCoins(it.value, 'drop');
  flyEgg(sp.x, sp.y);
}

// ====================== 道具 Icon（免費 / 威力） ======================
function iconTexture(kind) {
  return canvasTex(256, 256, (g, w, h) => {
    const accent = kind === 'free' ? '#ffffff' : '#ffc000';
    hexPath(g, 128, 128, 118, 0); g.fillStyle = 'rgba(0,0,0,.92)'; g.fill();
    g.lineWidth = 8; g.strokeStyle = accent; g.stroke();
    hexPath(g, 128, 128, 100, 0); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
    g.save(); g.translate(128, 92); g.rotate(-0.6);
    g.fillStyle = '#ffc000'; g.beginPath(); g.moveTo(-13, 28); g.lineTo(-13, -10); g.quadraticCurveTo(0, -42, 13, -10); g.lineTo(13, 28); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.fillRect(-15, 24, 30, 9);
    if (kind === 'power') { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(30, -40); g.lineTo(18, -10); g.lineTo(30, -10); g.lineTo(20, 18); g.lineTo(44, -18); g.lineTo(32, -18); g.closePath(); g.fill(); }
    g.restore();
    g.textAlign = 'center'; g.fillStyle = '#fff';
    g.font = '500 36px "Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif';
    g.fillText(kind === 'free' ? '免費子彈' : '威力子彈', 128, 170);
    g.font = '600 30px "Barlow Condensed",sans-serif'; g.fillStyle = accent; g.fillText(kind === 'free' ? '10 SEC' : '50 SEC', 128, 204);
  });
}
const iconTex = { free: iconTexture('free'), power: iconTexture('power') };
const icons = [];
let iconTimer = rand(6, 12);
function spawnIcon(kind) {
  kind = kind || (Math.random() < 0.5 ? 'free' : 'power');
  const dir = Math.random() < 0.5 ? 1 : -1;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex[kind], depthWrite: false }));
  sp.scale.set(1.5, 1.5, 1);
  const y = rand(5.6, 6.6);
  sp.position.set(-dir * 8, y, -3.5);
  sp.layers.set(1); scene.add(sp);
  icons.push({ kind, sprite: sp, dir, y, speed: rand(1.0, 1.5), t: 0 });
}
function updateIcons(dt) {
  iconTimer -= dt;
  if (iconTimer <= 0) { spawnIcon(); iconTimer = rand(14, 26); }
  for (let i = icons.length - 1; i >= 0; i--) {
    const ic = icons[i]; ic.t += dt;
    ic.sprite.position.x += ic.dir * ic.speed * dt;
    ic.sprite.position.y = ic.y + Math.sin(ic.t * 2) * 0.3;
    const s = 1.5 + Math.sin(ic.t * 5) * 0.1; ic.sprite.scale.set(s, s, 1);
    if (Math.abs(ic.sprite.position.x) > 8.5) { scene.remove(ic.sprite); icons.splice(i, 1); }
  }
}
function activateBuff(kind) {
  const t = now();
  if (kind === 'free') { S.freeUntil = Math.max(S.freeUntil, t) + FREE_DUR; toast('免費子彈 10 秒！'); }
  else { S.powerUntil = Math.max(S.powerUntil, t) + POWER_DUR; toast('威力子彈 50 秒！斷繩機率提升'); }
  sfx.power();
}

// ====================== 射擊 ======================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0.3);
const mousePx = { x: 215, y: 250 };
let charging = false, chargeStart = 0, charge = 0;
const CHARGE_TIME = 1.1;
const projectiles = [];
const projGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 18);
const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.4, 'rgba(255,180,40,.6)'); gr.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const powerGlowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,220,1)'); gr.addColorStop(0.4, 'rgba(255,40,40,.7)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const rangeFor = (c) => 12.5 + 10 * c;

function canShoot() { return !modalOpen() && !minigameActive() && $('helpPanel').classList.contains('hidden'); }
function fire(c) {
  const t = now(); const free = t < S.freeUntil; const power = t < S.powerUntil;
  if (!free) {
    if (S.bullets <= 0) { popup('子彈不足，請投幣！', mousePx.x, mousePx.y - 50, 'crit'); $('insertBtn').classList.remove('flash'); void $('insertBtn').offsetWidth; $('insertBtn').classList.add('flash'); sfx.lose(); return; }
    S.bullets--;
  }
  sfx.shoot(); S.shots++;
  // 每射擊一次，金幣池後方左上滾出一枚金幣
  if (!spawnChuteCoin()) S.pendingCoins++;
  raycaster.setFromCamera(mouse, camera);
  const dir = raycaster.ray.direction.clone();
  const start = camera.position.clone().addScaledVector(dir, 1.5); start.y -= 0.5;
  const range = rangeFor(c);
  const end = camera.position.clone().addScaledVector(dir, range);
  const mesh = new THREE.Mesh(projGeo, M.gold); mesh.position.copy(start);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: power ? powerGlowTex : glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.set(1.3, 1.3, 1); mesh.add(glow);
  mesh.traverse((o) => o.layers.set(1)); scene.add(mesh);
  const len = start.distanceTo(end);
  projectiles.push({ mesh, start, end, len, d: 0, speed: 70, power, done: false, fade: 0, vel: end.clone().sub(start).normalize().multiplyScalar(70) });
  updateHUD();
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
function segSegDist(p1, q1, p2, q2) {
  // 回傳 [距離平方, s(在線段1上的參數)]
  const d1 = _a.subVectors(q1, p1), d2 = _b.subVectors(q2, p2), r = _c.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-8 && e <= 1e-8) return [r.dot(r), 0];
  if (a <= 1e-8) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-8) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = _d.copy(p1).addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return [c1.distanceToSquared(c2), s];
}
function pointSegDist(p, a, b) {
  const ab = _a.subVectors(b, a), ap = _b.subVectors(p, a);
  const t = clamp(ap.dot(ab) / Math.max(1e-8, ab.dot(ab)), 0, 1);
  return [_c.copy(a).addScaledVector(ab, t).distanceToSquared(p), t];
}

const ropeTop = new THREE.Vector3(), ropeBot = new THREE.Vector3(), mdlPos = new THREE.Vector3();
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.done) {
      p.fade += dt; p.vel.y -= 20 * dt; p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(Math.max(0.01, 1 - p.fade * 2));
      if (p.fade > 0.5) { scene.remove(p.mesh); projectiles.splice(i, 1); }
      continue;
    }
    const p0 = p.mesh.position.clone();
    p.d = Math.min(p.len, p.d + p.speed * dt);
    const p1 = p.start.clone().lerp(p.end, p.d / p.len);
    p.mesh.rotation.x += dt * 20; p.mesh.rotation.z += dt * 11;
    // 碰撞檢查
    let best = null, bestS = 2;
    for (const ic of icons) {
      const [d2, s] = pointSegDist(ic.sprite.position, p0, p1);
      if (d2 < 0.6 && s < bestS) { bestS = s; best = { type: 'icon', ic }; }
    }
    for (const it of items) {
      if (it.state !== 'hang') continue;
      if (Math.abs(it.row.z - p1.z) > 3.5 && Math.abs(it.row.z - p0.z) > 3.5) continue;
      it.pivot.updateMatrixWorld(true);
      ropeTop.set(0, 0, 0).applyMatrix4(it.pivot.matrixWorld);
      ropeBot.set(0, -it.L, 0).applyMatrix4(it.pivot.matrixWorld);
      it.model.getWorldPosition(mdlPos);
      const rr = 0.22 * it.row.scale;
      let [d2, s] = segSegDist(p0, p1, ropeTop, ropeBot);
      if (d2 < rr * rr && s < bestS) { bestS = s; best = { type: 'item', it, where: 'rope' }; }
      [d2, s] = pointSegDist(mdlPos, p0, p1);
      const mr = it.r + 0.15;
      if (d2 < mr * mr && s < bestS) { bestS = s; best = { type: 'item', it, where: 'body' }; }
    }
    if (best) {
      p.mesh.position.copy(p0).lerp(p1, bestS);
      p.done = true; p.vel.multiplyScalar(-0.15); p.vel.y = 3;
      if (best.type === 'icon') {
        const ic = best.ic; scene.remove(ic.sprite); icons.splice(icons.indexOf(ic), 1);
        const sp = toScreen(ic.sprite.position); popup(ic.kind === 'free' ? '獲得免費子彈！' : '獲得威力子彈！', sp.x, sp.y, 'info');
        activateBuff(ic.kind);
      } else onItemHit(best.it, p.power, p.mesh.position);
      continue;
    }
    p.mesh.position.copy(p1);
    if (p.d >= p.len || p1.y < 0.2) { p.done = true; p.vel.multiplyScalar(0.3); }
  }
}

function onItemHit(it, power, pos) {
  sfx.hit(); it.hits++; S.hits++;
  let p = breakChance(it.value);
  if (power) p = Math.min(0.95, p * 1.8 + 0.04);
  const sp = toScreen(pos);
  const crit = Math.random() < 0.12;
  if (crit) { p = Math.min(0.95, p * 3 + 0.12); popup('爆擊！', sp.x, sp.y - 40, 'crit'); sfx.crit(); }
  if (Math.random() < p) breakItem(it);
  else {
    it.kick = Math.min(0.5, it.kick + 0.25);
    popup(pick(['差一點！', '繩子撐住了', '沒斷！']), sp.x, sp.y, 'miss');
    it.rope.material.color.lerp(ROPE_HOT, 0.12);
  }
}

// ====================== 金幣出幣佇列 ======================
function addPrizeCoins(n, src) {
  if (n <= 0) return;
  S.totalWon += n;
  S.pendingCoins += n;
  if (S.pendingCoins > 20) { // 超過 20 的部分立刻從兩側倒幣口一口氣倒入（不排隊）
    const excess = S.pendingCoins - 20; S.pendingCoins = 20; S.dumpCoins += excess;
    toast(`大量金幣 ${excess} 枚從兩側倒入！`);
  }
  updateHUD();
}
let dispenseTimer = 0;
function updateDispense(dt) {
  dispenseTimer -= dt;
  if (S.pendingCoins > 0 && dispenseTimer <= 0) {
    const ok = spawnChuteCoin(); if (ok) S.pendingCoins--;
    dispenseTimer = ok ? Math.max(dispenseTimer + 0.1, 0.03) : 0.02;
  }
  // 池子滿了（物理上限）就先留在倒幣口排隊，等金幣被推出去騰出空間再倒
  if (S.dumpCoins > 0) {
    for (const sp of SPOUTS) {
      sp.timer -= dt;
      if (sp.timer <= 0 && S.dumpCoins > 0) {
        const n = spawnPourBurst(sp, Math.min(Math.max(12, Math.ceil(S.dumpCoins / 6)), 48, S.dumpCoins)); S.dumpCoins -= n;
        sp.timer = n ? 0.36 : 0.15; if (n >= 4) sfx.pour(sp.sx, n);
      }
    }
  }
}

// ====================== 彩券 ======================
// 仿真實機台兌換彩券：奶油色紙張＋紅橘印刷、每張之間有虛線撕孔、兩側半圓打孔缺口，
// 以 canvas 畫一張彩券貼圖（只畫一次），連續紙帶用重複背景；出票時紙帶從出票口往下送，
// 太長就撕下來折疊掉到旁邊的彩券堆。
const TK_W = 74, TK_H = 30;
function makeTicketTile() {
  const k = 2, c = document.createElement('canvas'); c.width = TK_W * k; c.height = TK_H * k;
  const g = c.getContext('2d'); g.scale(k, k);
  g.fillStyle = '#f4e7c5'; g.fillRect(0, 0, TK_W, TK_H); // 奶油色紙
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,90,40' : '255,255,255'},${Math.random() * 0.08})`; g.fillRect(Math.random() * TK_W, Math.random() * TK_H, 1, 1); } // 紙纖維
  g.strokeStyle = '#c8321e'; g.lineWidth = 1.2; g.strokeRect(5, 3.5, TK_W - 10, TK_H - 7); // 紅橘外框
  g.fillStyle = '#c8321e'; g.fillRect(5, 3.5, 15, TK_H - 7); // 左側色塊
  g.fillStyle = '#ffc000'; g.font = '700 13px "Barlow Condensed",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1', 12.5, TK_H / 2 + 0.5);
  g.fillStyle = '#1a1a1a'; g.font = '700 7.5px "Noto Sans TC",sans-serif'; g.fillText('幸運推金幣', 44, 10.5);
  g.fillStyle = '#c8321e'; g.font = '700 9px "Barlow Condensed",sans-serif'; g.fillText('1 TICKET', 44, 20.5);
  g.fillStyle = 'rgba(0,0,0,.28)'; for (let x = 1; x < TK_W; x += 3) g.fillRect(x, TK_H - 0.6, 1.4, 1.2); // 撕孔虛線（跨在兩張之間）
  g.globalCompositeOperation = 'destination-out'; // 兩側半圓打孔缺口（在撕孔線上）
  for (const y of [0, TK_H]) for (const x of [0, TK_W]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(TK_W / 2, TK_H - 0.2, 1.3, 0, Math.PI * 2); g.fill(); // 中間小孔
  return c.toDataURL();
}
const setTicketTile = () => document.documentElement.style.setProperty('--ticket', `url(${makeTicketTile()})`);
setTicketTile(); if (document.fonts) document.fonts.ready.then(setTicketTile); // 字型載入後重畫一次
let printQueue = 0, printTimer = 0, stripTarget = 0, stripCur = 0, stripShown = -1, printLamp = false;
let pileCount = 0, pileLayers = -1;
const stripEl = $('ticketStrip'), pileCv = $('ticketPile'), slotEl = document.querySelector('.tmSlot');
function addTickets(n, x, y) {
  S.tickets += n; printQueue += n;
  if (x !== undefined) popup(`+${n} 彩券`, x, y, 'ticket');
}
// 彩券堆：側面看的 Z 字折疊紙堆，張數越多越高（只有層數變化時才重畫）
function drawPile() {
  const layers = pileCount ? Math.min(16, Math.ceil(Math.log2(1 + pileCount) * 1.7)) : 0;
  if (layers === pileLayers) return; pileLayers = layers;
  const k = 2, W = 44, H = 46; if (pileCv.width !== W * k) { pileCv.width = W * k; pileCv.height = H * k; }
  const g = pileCv.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, W, H);
  for (let i = 0; i < layers; i++) {
    const y = H - 3 - i * 2.6, off = (i % 2 ? 1.5 : -1.5) + Math.sin(i * 1.7) * 1.2;
    g.fillStyle = i % 2 ? '#e9d9b2' : '#f4e7c5'; g.fillRect(5 + off, y - 2.2, W - 10, 2.4);
    g.fillStyle = '#c8321e'; g.fillRect(5 + off, y - 2.2, 3, 2.4); g.fillRect(W - 8 + off, y - 2.2, 3, 2.4);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(5 + off, y + 0.2, W - 10, 0.5);
    g.beginPath(); g.fillStyle = i % 2 ? '#f4e7c5' : '#e9d9b2'; // 折疊處的圓弧
    const fx = i % 2 ? W - 5 + off : 5 + off; g.arc(fx, y - 1, 1.3, 0, Math.PI * 2); g.fill();
  }
}
function tearStrip(n) {
  const t = document.createElement('div'); t.className = 'torn';
  t.style.height = n * TK_H + 'px'; t.style.top = (35 + stripCur - n * TK_H) + 'px';
  $('ticketMachine').appendChild(t);
  requestAnimationFrame(() => { t.classList.add('fall'); });
  setTimeout(() => { t.remove(); pileCount += n; drawPile(); }, 650);
  stripTarget -= n * TK_H; stripCur -= n * TK_H;
}
function updateTickets(dt) {
  printTimer -= dt;
  const rate = printQueue > 60 ? 0.012 : printQueue > 15 ? 0.03 : 0.07;
  let printed = 0;
  while (printQueue > 0 && printTimer <= 0) { printQueue--; printTimer += rate; printed++; stripTarget += TK_H; }
  if (printQueue <= 0 && printTimer < 0) printTimer = 0;
  if (printed) { sfx.ticket(); }
  // 紙帶平滑送出（出票越快送越快）
  if (stripCur < stripTarget) stripCur = Math.min(stripTarget, stripCur + dt * Math.max(140, TK_H / rate * 1.2));
  // 垂下超過 3 張就撕下（保留最新的 1 張）
  if (stripCur >= stripTarget && stripTarget >= TK_H * 4) tearStrip(Math.floor(stripTarget / TK_H) - 1);
  else if (stripTarget > TK_H * 9) tearStrip(Math.floor(stripCur / TK_H) - 1); // 大量出票時邊送邊撕
  const h = Math.round(stripCur);
  if (h !== stripShown) { stripShown = h; stripEl.style.height = h + 'px'; }
  const busy = stripCur < stripTarget || printQueue > 0;
  if (busy !== printLamp) { printLamp = busy; slotEl.classList.toggle('printing', busy); }
}
// ====================== 金蛋 ======================
function flyEgg(x, y) {
  const el = document.createElement('div'); el.className = 'flyEgg';
  el.style.left = x + 'px'; el.style.top = y + 'px'; $('hud').appendChild(el);
  const slots = document.querySelectorAll('#eggSlots .egg');
  const target = stageRect(slots[Math.min(S.eggs, 2)]);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.left = target.left + 2 + 'px'; el.style.top = target.top + 2 + 'px'; el.style.transform = 'rotate(360deg)'; }));
  setTimeout(() => { el.remove(); addEgg(); }, 850);
}
function addEgg() {
  S.eggs++; sfx.egg(); updateHUD();
  if (S.eggs >= 3) { S.eggs -= 3; eggQueue++; setTimeout(updateHUD, 600); }
}
function openEggs(done) {
  // 直接在右上三個金蛋指示器上開獎（不彈出面板、不擋射擊）
  const slots = [...document.querySelectorAll('#eggSlots .egg')];
  const rowEl = $('eggSlots').parentElement; rowEl.classList.add('opening');
  const results = [];
  slots.forEach((el, i) => {
    const r = Math.random();
    let res;
    if (r < 0.25) res = { type: 'coin', n: randi(1, 50) };
    else if (r < 0.5) res = { type: 'miss' };
    else if (r < 0.75) res = { type: 'ball' };
    else res = { type: 'spin' };
    results.push(res);
    const txt = res.type === 'coin' ? `+${res.n} 金幣` : res.type === 'miss' ? '落空' : res.type === 'ball' ? '紅球' : '轉盤 +1';
    el.querySelector('.eggRes')?.remove();
    const tag = document.createElement('div'); tag.className = `eggRes ${res.type}`; tag.textContent = txt;
    tag.style.top = (i % 2 ? 26 : -20) + 'px';
    el.appendChild(tag); el.classList.add('opening');
    setTimeout(() => el.classList.add('shake'), 150 + i * 450);
    setTimeout(() => {
      el.classList.remove('shake'); el.classList.add('cracked'); sfx.crack(); setTimeout(() => (res.type === 'miss' ? sfx.lose() : sfx.win()), 180);
      if (res.type === 'coin') addPrizeCoins(res.n, 'egg');
      else if (res.type === 'ball') addBall(rand(-POOL.xHalf + 1, POOL.xHalf - 1), 5, rand(-1, POOL.front - 2));
      else if (res.type === 'spin') S.spins++;
      updateHUD();
    }, 550 + i * 450);
  });
  setTimeout(() => {
    for (const el of slots) { el.classList.remove('opening', 'shake', 'cracked'); el.querySelector('.eggRes')?.remove(); }
    rowEl.classList.remove('opening'); updateHUD(); done();
  }, 550 + 2 * 450 + 2200);
}
let eggQueue = 0, eggOpen = false;
function updateEggs() {
  if (!eggOpen && eggQueue > 0 && !minigameActive()) { eggQueue--; eggOpen = true; openEggs(() => { eggOpen = false; }); }
}

// ====================== 轉盤 ======================
const WHEEL = [
  { t: 'coin', v: 10, c: '#000000' }, { t: 'diamond', c: '#ffc000' }, { t: 'coin', v: 20, c: '#202020' }, { t: 'dart', c: '#ffc000' },
  { t: 'coin', v: 50, c: '#000000' }, { t: 'hat', c: '#ffc000' }, { t: 'coin', v: 100, c: '#202020' }, { t: 'diamond', c: '#ffc000' },
  { t: 'coin', v: 200, c: '#000000' }, { t: 'dart', c: '#ffc000' },
];
const SYM = { diamond: '💎', dart: '🎯', hat: '🎩' };
const NAME = { diamond: '鑽石', dart: '飛鏢', hat: '魔術帽' };
const wheelCv = $('wheel'), wg = wheelCv.getContext('2d');
const SEG = (Math.PI * 2) / WHEEL.length;
const wheel = { rot: 0, spinning: false, from: 0, to: 0, t: 0, dur: 3.4, target: 0, lastSeg: -1, flash: 0 };
// 單色向量圖示（取代彩色 emoji）
function drawSym(g, t, x, y, sz, col) {
  g.save(); g.translate(x, y); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = sz * 0.12; g.lineJoin = 'miter';
  if (t === 'diamond') { g.beginPath(); g.moveTo(-sz * .5, -sz * .15); g.lineTo(-sz * .25, -sz * .45); g.lineTo(sz * .25, -sz * .45); g.lineTo(sz * .5, -sz * .15); g.lineTo(0, sz * .5); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.0)'; }
  else if (t === 'dart') { for (const r of [.48, .3, .12]) { g.beginPath(); g.arc(0, 0, sz * r, 0, 7); r === .12 ? g.fill() : g.stroke(); } }
  else if (t === 'hat') { g.fillRect(-sz * .3, -sz * .45, sz * .6, sz * .62); g.fillRect(-sz * .52, sz * .17, sz * 1.04, sz * .14); }
  g.restore();
}
function drawWheel() {
  const W = wheelCv.width, cx = W / 2, R = W / 2 - 14;
  wg.clearRect(0, 0, W, W);
  wg.save(); wg.translate(cx, cx);
  // 外圈：黑色＋白／金指示燈
  wg.fillStyle = '#000'; wg.beginPath(); wg.arc(0, 0, R + 13, 0, 7); wg.fill();
  wg.strokeStyle = 'rgba(255,255,255,.5)'; wg.lineWidth = 1.5; wg.beginPath(); wg.arc(0, 0, R + 12, 0, 7); wg.stroke();
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2; const on = (Math.floor(performance.now() / 180) + i) % 2 === 0 || wheel.spinning && i % 2 === 0;
    wg.fillStyle = on ? '#ffc000' : '#494949'; wg.fillRect(Math.cos(a) * (R + 6) - 2.5, Math.sin(a) * (R + 6) - 2.5, 5, 5);
  }
  wg.rotate(wheel.rot);
  WHEEL.forEach((s, i) => {
    const a0 = -Math.PI / 2 + i * SEG, a1 = a0 + SEG;
    wg.fillStyle = s.c; wg.beginPath(); wg.moveTo(0, 0); wg.arc(0, 0, R, a0, a1); wg.closePath(); wg.fill();
    wg.strokeStyle = 'rgba(255,255,255,.35)'; wg.lineWidth = 1.5; wg.stroke();
    wg.save(); wg.rotate(a0 + SEG / 2 + Math.PI / 2);
    wg.textAlign = 'center'; wg.textBaseline = 'middle';
    if (s.t === 'coin') { wg.fillStyle = '#fff'; wg.font = '600 34px "Barlow Condensed",sans-serif'; wg.fillText(s.v, 0, -R * 0.7); wg.fillStyle = '#969696'; wg.font = '500 12px "Noto Sans TC",sans-serif'; wg.fillText('金幣', 0, -R * 0.47); }
    else { drawSym(wg, s.t, 0, -R * 0.68, 30, '#000'); wg.fillStyle = '#000'; wg.font = '700 12px "Noto Sans TC",sans-serif'; wg.fillText(NAME[s.t], 0, -R * 0.42); }
    wg.restore();
  });
  wg.restore();
  hexPathCtx(wg, cx, cx, 27); wg.fillStyle = '#000'; wg.fill(); wg.strokeStyle = '#ffc000'; wg.lineWidth = 3; wg.stroke();
  wg.fillStyle = '#fff'; wg.font = '600 15px "Barlow Condensed",sans-serif'; wg.textAlign = 'center'; wg.textBaseline = 'middle'; wg.fillText('SPIN', cx, cx + 1);
  if (wheel.flash > 0) { wg.fillStyle = `rgba(255,255,255,${wheel.flash * 0.4})`; wg.beginPath(); wg.arc(cx, cx, R, 0, 7); wg.fill(); }
}
function hexPathCtx(g, x, y, r) { hexPath(g, x, y, r, 0); }
const segAt = (rot) => Math.floor((((-rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / SEG);
function startSpin() {
  S.spins--; wheel.spinning = true;
  const k = randi(0, WHEEL.length - 1);
  const targetMod = (((-(k * SEG + SEG * rand(0.2, 0.8))) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const curMod = ((wheel.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  wheel.from = wheel.rot; wheel.to = wheel.rot + Math.PI * 2 * 4 + ((targetMod - curMod + Math.PI * 2) % (Math.PI * 2));
  wheel.t = 0; wheel.target = k; updateHUD();
}
function updateWheel(dt) {
  if (!wheel.spinning && S.spins > 0 && !modalOpen() && !minigameActive()) startSpin();
  if (wheel.spinning) {
    wheel.t += dt; const u = Math.min(1, wheel.t / wheel.dur);
    const e = 1 - Math.pow(1 - u, 3.2);
    wheel.rot = wheel.from + (wheel.to - wheel.from) * e;
    const sg = segAt(wheel.rot); if (sg !== wheel.lastSeg) { wheel.lastSeg = sg; sfx.tick(); }
    if (u >= 1) { wheel.spinning = false; wheel.flash = 1; onWheelResult(WHEEL[segAt(wheel.rot)]); }
  }
  wheel.flash = Math.max(0, wheel.flash - dt * 1.5);
  drawWheel();
}
function onWheelResult(s) {
  const r = stageRect(wheelCv); const x = r.left + r.width / 2, y = r.bottom + 40;
  if (s.t === 'coin') { popup(`轉盤 +${s.v} 金幣`, x, y, 'big'); addPrizeCoins(s.v, 'wheel'); sfx.win(); }
  else {
    S.collect[s.t]++; popup(`獲得 ${NAME[s.t]}`, x, y, 'big'); sfx.big();
    const el = $({ diamond: 'colDiamond', dart: 'colDart', hat: 'colHat' }[s.t]); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    checkCollect();
  }
  updateHUD();
}
const GAME_OF = { diamond: 'plinko', dart: 'darts', hat: 'hats' };
const pendingGames = new Set();
function checkCollect() {
  for (const k of ['diamond', 'dart', 'hat']) {
    if (S.collect[k] >= 3 && !pendingGames.has(k)) { pendingGames.add(k); modalQueue.push({ type: 'minigame', key: k }); }
  }
}

// ====================== 彈窗佇列（開蛋 / 小遊戲） ======================
const modalQueue = []; let currentModal = null;
const modalOpen = () => !!currentModal;
function updateModals() {
  if (currentModal || !modalQueue.length || wheel.spinning) return;
  const m = modalQueue.shift(); currentModal = m;
  charging = false;
  const done = () => { currentModal = null; };
  if (m.type === 'eggs') openEggs(done);
  else if (m.type === 'minigame') {
    toast({ plinko: '連連看 小遊戲！', darts: '飛鏢 小遊戲！', hats: '魔術帽 小遊戲！' }[GAME_OF[m.key]]);
    setTimeout(() => {
      startMinigame(GAME_OF[m.key], (total) => {
        S.collect[m.key] = Math.max(0, S.collect[m.key] - 3); pendingGames.delete(m.key);
        if (total > 0) { addPrizeCoins(total, 'minigame'); popup(`小遊戲獎勵 +${total} 金幣`, SW / 2, SH / 2, 'big'); sfx.big(); }
        updateHUD(); checkCollect(); done();
      });
    }, 900);
  }
}

// ====================== HUD / 彈出文字 ======================
const popLayer = $('popups');
function popup(text, x, y, cls = '') {
  const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px'; popLayer.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }
const _v = new THREE.Vector3();
function toScreen(p, cam = camera) {
  _v.copy(p).project(cam);
  const x = (_v.x * 0.5 + 0.5) * SW;
  return cam === camera ? { x, y: (-_v.y * 0.5 + 0.5) * SPLIT } : { x, y: SPLIT + (-_v.y * 0.5 + 0.5) * (SH - SPLIT) };
}
function stageRect(el) { const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect(); return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height, bottom: r.bottom - s.top }; }
function setPips(id, n) {
  const el = $(id); el.querySelectorAll('.pips i').forEach((p, i) => p.classList.toggle('on', i < n));
  el.querySelector('.cnt').textContent = `${Math.min(n, 3)}/3`;
}
function updateHUD() {
  $('bullets').textContent = S.bullets; $('inserted').textContent = S.inserted;
  setPips('colDiamond', S.collect.diamond); setPips('colDart', S.collect.dart); setPips('colHat', S.collect.hat);
  document.querySelectorAll('#eggSlots .egg').forEach((e, i) => e.classList.toggle('on', i < S.eggs));
  $('spinsLeft').querySelector('b').textContent = S.spins + (wheel.spinning ? 1 : 0);
  $('spinsLeft').classList.toggle('active', S.spins > 0 || wheel.spinning);
  $('dispQueue').textContent = S.pendingCoins; $('dumpQueue').textContent = S.dumpCoins; $('poolCount').textContent = coins.length;
  $('ticketLed').textContent = String(S.tickets).padStart(5, '0');
  $('ticketTip').querySelector('b').textContent = S.tickets;
}
function updateBuffs() {
  const t = now();
  const f = S.freeUntil - t, p = S.powerUntil - t;
  $('buffFree').classList.toggle('hidden', f <= 0); $('buffPower').classList.toggle('hidden', p <= 0);
  if (f > 0) { $('buffFree').querySelector('.btime').textContent = Math.ceil(f); $('buffFree').querySelector('i').style.width = clamp(f / FREE_DUR, 0, 1) * 100 + '%'; }
  if (p > 0) { $('buffPower').querySelector('.btime').textContent = Math.ceil(p); $('buffPower').querySelector('i').style.width = clamp(p / POWER_DUR, 0, 1) * 100 + '%'; }
  const ch = $('crosshair'); ch.classList.toggle('free', f > 0); ch.classList.toggle('power', p > 0);
}

// ====================== 輸入 ======================
const cv = renderer.domElement;
let aimInside = false;
function setAim(e) {
  const r = stage.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  aimInside = py >= 0 && py <= SPLIT && px >= 0 && px <= SW;
  const cy = Math.min(py, SPLIT - 2);
  mousePx.x = px; mousePx.y = cy;
  mouse.set((px / SW) * 2 - 1, -(cy / SPLIT) * 2 + 1);
  return aimInside;
}
cv.addEventListener('pointermove', (e) => { const inside = setAim(e); if (!inside && !charging) aimInside = false; });
cv.addEventListener('pointerleave', () => { if (!charging) aimInside = false; });
cv.addEventListener('pointerdown', (e) => {
  initAudio();
  if (e.button !== 0 || !canShoot()) return;
  if (!setAim(e)) return; // 只在上方射擊區瞄準
  e.preventDefault();
  charging = true; chargeStart = now(); charge = 0;
  try { cv.setPointerCapture(e.pointerId); } catch (_) { }
});
const endCharge = (e) => {
  if (!charging || e.button > 0) return;
  charging = false;
  if (canShoot()) fire(charge);
  charge = 0;
};
window.addEventListener('pointerup', endCharge);
window.addEventListener('pointercancel', () => { charging = false; charge = 0; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
function insertCoin() { initAudio(); S.bullets += 10; S.inserted++; sfx.insert(); { const r = stageRect($('insertBtn')); popup('+10 子彈', r.left + r.width / 2, r.bottom + 18, 'info'); } updateHUD(); }
$('insertBtn').addEventListener('click', insertCoin);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (!minigameActive()) insertCoin(); }
  if (DEBUG) debugKey(e.key);
});
$('muteBtn').addEventListener('click', () => { setMuted(!isMuted()); $('muteBtn').textContent = isMuted() ? '音效 OFF' : '音效 ON'; });
$('ticketMachine').addEventListener('mouseenter', () => updateHUD());
let tipT = 0;
$('ticketMachine').addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; updateHUD(); $('ticketMachine').classList.add('show'); clearTimeout(tipT); tipT = setTimeout(() => $('ticketMachine').classList.remove('show'), 2000); });
$('helpBtn').addEventListener('click', () => $('helpPanel').classList.remove('hidden'));
$('helpOk').addEventListener('click', () => { initAudio(); $('helpPanel').classList.add('hidden'); });
if (!DEBUG && !params.has('nohelp')) $('helpPanel').classList.remove('hidden');

// ====================== 主迴圈 ======================
let shadowTick = 0;
function renderViews() {
  if (renderer.shadowMap.enabled && (shadowTick++ % (MOBILE ? 3 : 2)) === 0) renderer.shadowMap.needsUpdate = true;
  renderer.setScissorTest(true);
  renderer.setViewport(0, SH - SPLIT, SW, SPLIT); renderer.setScissor(0, SH - SPLIT, SW, SPLIT);
  renderer.render(scene, camera);
  renderer.setViewport(0, 0, SW, SH - SPLIT); renderer.setScissor(0, 0, SW, SH - SPLIT);
  renderer.render(scene, poolCam);
  renderer.setScissorTest(false);
}
const FIXED = 1 / 60;
const TUNE = {}; // 測試用開關
let frameNo = 0, physMs = 0, acc = 0, simTime = 0, last = performance.now(), hudTimer = 0;
const dummy = new THREE.Object3D();
// 推板防穿透：睡眠中的金幣在 cannon 求解器裡等同靜止物體，推板在折返（速度很低）時不會叫醒它們，
// 於是慢慢壓進金幣裡，之後金幣就卡在推板體積內「穿透」。每一步：叫醒推板前緣附近的金幣，
// 並把任何已經陷進推板體積的金幣移到推板前方（靠近前緣）或推板頂面（陷得很深）。
let pusherFixes = 0;
let awakeEst = 0;
function guardPusher(pf) {
  const top = POOL.pusherH, back = pf - POOL.pusherHalfD * 2, v = pusherVel(simTime);
  let aw = 0;
  for (const c of coins) {
    const b = c.body, p = b.position;
    if (b.sleepState === 0) aw++;
    if (c.spill || p.y > top + 0.2) continue;
    if (b.sleepState !== 0 && ((p.z > pf - 0.7 && p.z < pf + 0.55) || (v > 0.15 && p.z > pf && p.z < pf + (TUNE.band || 9) && p.y < (TUNE.bandY || 9)))) b.wakeUp(); // 推板前進時喚醒前方底層金幣（上層靠接觸連鎖喚醒），讓推力真實傳遞
    if (p.y < top - 0.015 && p.z < pf + 0.02 && p.z > back - 0.3 && Math.abs(p.x) < POOL.xHalf + 0.05) {
      if (pf - p.z < 0.6) { p.z = pf + 0.3; if (b.velocity.z < v) b.velocity.z = Math.max(v, 0); }
      else { p.y = top + 0.07; b.velocity.y = 0; }
      b.wakeUp(); pusherFixes++;
    }
  }
  awakeEst = aw;
}
function stepPhysics(dt) {
  acc += Math.min(dt, 0.1); let n = 0;
  while (acc >= FIXED && n < 2) {
    // 沒有正在飛/滾的金幣時（整池都是平躺金幣），改用一步 1/30 秒取代兩步 1/60 秒，物理成本減半
    const h = !TUNE.noBig && fastFree === 0 && acc >= FIXED * 2 && n === 0 ? FIXED * 2 : FIXED;
    const pz = pusherFront(simTime) - POOL.pusherHalfD;
    pusherBody.position.set(0, POOL.pusherH / 2, pz);
    pusherBody.velocity.set(0, 0, pusherVel(simTime));
    guardPusher(pz + POOL.pusherHalfD);
    world.solver.iterations = TUNE.it || 6; // 迭代多一點反而讓金幣堆更快穩定入睡，推力也傳得更遠（實測更省） // 求解器迭代：平常 4 次，大量金幣同時在動時 3 次
    const _t0 = performance.now(); world.step(h); physMs = physMs * 0.95 + (performance.now() - _t0) * 0.05;
    simTime += h; acc -= h; n += h > FIXED ? 2 : 1;
  }
  if (n >= 2) acc = 0;
}
function syncPool() {
  const pf = pusherFront(simTime), pv = pusherVel(simTime);
  pusherMesh.position.set(0, POOL.pusherH / 2, pf - POOL.pusherHalfD);
  // 出幣口落點保持淨空：坡底附近疊高的金幣往池中央推開
  for (const c of coins) {
    if (c.edge || c.spill) continue;
    const b = c.body, p = b.position;
    if (p.y > POOL.pusherH + 0.1 && p.x < RAMP_DEF.x1 + 1.1 && Math.abs(p.z - RAMP_DEF.z) < 0.8) {
      b.wakeUp(); if (b.velocity.x < 1.2) b.velocity.x += 0.25;
    }
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const b = coins[i].body, p = b.position;
    if (!b.fixedRotation && b.allowSleep && p.z > POOL.front - 0.05) { b.allowSleep = false; b.wakeUp(); }
    if (b.fixedRotation && p.z > POOL.front - 0.05) { b.fixedRotation = false; b.allowSleep = false; b.updateMassProperties(); b.wakeUp(); b.angularVelocity.set(1.5, 0, 0); }
    if (p.y < -1.0 || Math.abs(p.x) > POOL.xHalf + 1 || p.z > POOL.front + 2.5) {
      if (p.z > POOL.front - 0.3) { const s = toScreen(new THREE.Vector3(p.x, 0, POOL.front), poolCam); addTickets(1, s.x, s.y); sfx.hole(); }
      if (coins[i].free) { freeCount--; b.removeEventListener('collide', onCoinCollide); }
      world.removeBody(b); coins[i] = coins[coins.length - 1]; coins[i].dirty = true; coins.pop();
    }
  }
  ensureCoinCap(coins.length);
  let upd = 0;
  for (let i = 0; i < coins.length; i++) {
    const c = coins[i], b = c.body;
    // 睡眠中的金幣位置不變：只更新移動中或索引剛變動的金幣
    if (b.sleepState === 2 && !c.dirty) continue;
    c.dirty = false; upd++;
    dummy.position.set(b.position.x, b.position.y, b.position.z);
    dummy.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    dummy.updateMatrix(); coinMesh.setMatrixAt(i, dummy.matrix);
  }
  coinMesh.count = coins.length; if (upd) coinMesh.instanceMatrix.needsUpdate = true;
  for (let i = balls.length - 1; i >= 0; i--) {
    const { body: b, mesh } = balls[i];
    if (b.position.y < -1.0 || Math.abs(b.position.x) > POOL.xHalf + 1) {
      if (b.position.z > POOL.front - 0.4) { const s = toScreen(new THREE.Vector3(b.position.x, 0, POOL.front), poolCam); addTickets(20, s.x, s.y); popup('紅球 +20 彩券！', s.x, s.y - 30, 'big'); sfx.win(); }
      world.removeBody(b); scene.remove(mesh); balls.splice(i, 1); continue;
    }
    mesh.position.copy(b.position); mesh.quaternion.copy(b.quaternion);
  }
}
let lastBlink = -1, lastCharge = -1, lastChDisp = '', lastMx = -1, lastMy = -1; const chargeFill = $('chargeBar').querySelector('i'), chargeRingEl = $('chargeRing'), crossEl = $('crosshair');
let frameMs = 0, renderMs = 0, frames = 0, lastFrame = 0, lastInput = performance.now(), hiddenPaused = false;
['pointerdown', 'pointermove', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, () => { lastInput = performance.now(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  // 分頁隱藏時完全停止（不跑物理也不渲染），回來時不補算時間
  if (document.hidden) { hiddenPaused = true; sfx.suspend && sfx.suspend(); }
  else { hiddenPaused = false; last = lastFrame = performance.now(); acc = 0; sfx.resume && sfx.resume(); requestAnimationFrame(loop); }
});
function isBusy() { return freeCount > 0 || S.dumpCoins > 0 || S.pendingCoins > 0 || wheel.spinning || charging || falling.length > 0 || performance.now() - lastInput < 12000; }
function loop() {
  if (hiddenPaused) return;
  requestAnimationFrame(loop);
  const t0 = performance.now();
  // 幀率上限：最高 60fps（高刷螢幕不多算），手機閒置時降到 30fps
  const cap = MOBILE && !isBusy() ? 30 : 60;
  if (t0 - lastFrame < 1000 / cap - 2) return;
  lastFrame = t0;
  const t = t0; frames++; const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const ts = t / 1000;
  stepPhysics(dt); updateFreeCoins(simTime); syncPool(); updateSparkles(dt);
  updateItems(dt, ts); updateIcons(dt); updateProjectiles(dt);
  updateDispense(dt); updateTickets(dt); updateWheel(dt); updateEggs(); updateModals();
  if (charging) charge = Math.min(1, (now() - chargeStart) / CHARGE_TIME);
  if (charge !== lastCharge) { chargeFill.style.width = charge * 100 + '%'; chargeRingEl.style.strokeDashoffset = 188.5 * (1 - charge); lastCharge = charge; }
  const chDisp = (modalOpen() || minigameActive() || !aimInside) ? 'none' : 'block';
  if (chDisp !== lastChDisp) { crossEl.style.display = chDisp; lastChDisp = chDisp; }
  if (chDisp === 'block' && (mousePx.x !== lastMx || mousePx.y !== lastMy)) { crossEl.style.transform = `translate(${mousePx.x}px, ${mousePx.y}px) translate(-50%, -50%)`; lastMx = mousePx.x; lastMy = mousePx.y; }
  const blinkPhase = Math.floor(ts * 4); if (blinkPhase !== lastBlink) { lastBlink = blinkPhase; for (const b of blinkers) b.material.color.setHex(((blinkPhase + b.userData.blink) % 2) ? 0xffc000 : 0x494949); }
  hudTimer -= dt; if (hudTimer <= 0) { updateHUD(); updateBuffs(); hudTimer = 0.1; }
  // 小遊戲進行中，背景 3D 降頻渲染以節省效能
  const _r0 = performance.now();
  if (!minigameActive() || (frameNo++ % 15) === 0) renderViews();
  const _t1 = performance.now(); renderMs = renderMs * 0.95 + (_t1 - _r0) * 0.05; frameMs = frameMs * 0.95 + (_t1 - t) * 0.05;
}

// ====================== 除錯掛鉤 ======================
function debugKey(k) {
  const map = { '1': 'plinko', '2': 'darts', '3': 'hats', e: 'egg', w: 'spin', c: 'coins', f: 'free', p: 'power', b: 'break', o: 'eggs3' };
  if (map[k]) debugAction(map[k]);
}
function debugAction(a) {
  switch (a) {
    case 'egg': flyEgg(SW / 2, SPLIT / 2); break;
    case 'eggs3': eggQueue++; break;
    case 'spin': S.spins++; break;
    case 'plinko': S.collect.diamond = 3; checkCollect(); break;
    case 'darts': S.collect.dart = 3; checkCollect(); break;
    case 'hats': S.collect.hat = 3; checkCollect(); break;
    case 'coins': addPrizeCoins(600, 'debug'); break;
    case 'free': activateBuff('free'); break;
    case 'power': activateBuff('power'); break;
    case 'break': { const it = items.find((i) => i.state === 'hang' && Math.abs(i.x) < 6); if (it) breakItem(it); break; }
    case 'icon': spawnIcon(); break;
  }
  updateHUD();
}
if (DEBUG) {
  $('debugPanel').classList.remove('hidden');
  $('debugPanel').addEventListener('click', (e) => { const d = e.target.dataset.d; if (d) debugAction(d); });
}
window.__game = {
  S, debugAction, coins, balls, items, wheel, sparkPts, sparks, world, TUNE, pf: () => pusherFront(simTime),
  addCoins(n) { addPrizeCoins(n, 'debug'); },
  addTk(n) { addTickets(n); },
  fillFlat(n) { // 測試用：直接鋪 n 枚平躺金幣（分層），用來做固定條件的效能測試
    const p0 = pusherFront(simTime); let k = 0;
    for (let layer = 0; k < n && layer < 40; layer++) for (let x = -POOL.xHalf + 0.3; x <= POOL.xHalf - 0.28 && k < n; x += 0.5) for (let z = p0 + 0.3; z <= POOL.front - 0.3 && k < n; z += 0.5) {
      const o = layer % 2 ? 0.25 : 0; if (Math.abs(x + o) > POOL.xHalf - 0.25) continue;
      addCoin(x + o, 0.04 + layer * 0.075, z + o * 0.5, 0, 0, 0); k++;
    }
    return k;
  },
  awake: () => coins.reduce((a, c) => a + (c.body.sleepState === 0 ? 1 : 0), 0),
  ff(sec, fps = 30) { const d = 1 / fps; for (let i = 0; i < sec * fps; i++) { stepPhysics(d); updateFreeCoins(simTime); syncPool(); updateDispense(d); updateTickets(d); } },
  shootAt(nx, ny, c = 0.5) { mouse.set(nx, ny); fire(c); },
  itemScreen(i) { const it = items[i]; const v = new THREE.Vector3(); it.model.getWorldPosition(v); return { ...toScreen(v), row: it.rowIdx, value: it.value, state: it.state }; },
  perf: () => ({ frameMs: +frameMs.toFixed(2), renderMs: +renderMs.toFixed(2), physMs: +physMs.toFixed(2), frames, coins: coins.length, free: freeCount, pr: renderer.getPixelRatio() }),
  stats: () => ({ fixes: pusherFixes, onTop: coins.filter(c => !c.free && c.body.position.y > POOL.pusherH - 0.02 && c.body.position.z < pusherFront(simTime) - 0.05).length, nearExit: coins.filter(c => !c.free && c.body.position.x < RAMP_DEF.x1 + 0.8 && c.body.position.z < POOL.wallZ + 1.2 && c.body.position.y > 0.4).length, inside: coins.filter(c => c.body.position.y < POOL.pusherH - 0.015 && c.body.position.z < pusherFront(simTime) - 0.05).length, sim: +simTime.toFixed(1), free: freeCount, dump: S.dumpCoins, pending: S.pendingCoins, physMs: +physMs.toFixed(2), coins: coins.length, balls: balls.length, tickets: S.tickets, bullets: S.bullets, spins: S.spins, eggs: S.eggs, collect: { ...S.collect }, modal: currentModal && currentModal.type, minigame: minigameActive() }),
};

// ====================== 啟動 ======================
resize();
initPool();
for (let i = 0; i < 90; i++) { pusherBody.position.set(0, POOL.pusherH / 2, pusherFront(0) - POOL.pusherHalfD); pusherBody.velocity.set(0, 0, 0); world.step(FIXED); }
// 預熱時掉落的不計入彩券
for (let i = coins.length - 1; i >= 0; i--) if (coins[i].body.position.y < -0.5) { world.removeBody(coins[i].body); coins.splice(i, 1); }
syncPool(); updateHUD();
setTimeout(() => { const l = $('loading'); l.style.opacity = '0'; setTimeout(() => l.remove(), 500); }, 200);
setTimeout(() => spawnIcon('free'), 2500);
loop();
