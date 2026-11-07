// Persephone's chateau (2026-11-06): a real-time 3D salon drawn with Three.js (vendored in vendor/three, so the
// page's strict content policy stays 'self' only). A long hall in the manner of Le Vrai: a mirror-polished
// black-and-ivory marble floor, white marble columns with gilded capitals, crimson velvet drapes, crystal
// chandeliers, tall windows with the Matrix's green code falling behind them, and one gaming table per casino
// site: green felt, a gold rail, a tower of chips as tall as its SC balance, a glowing ring when its bonus is
// ready, and a floating placard with its name, balance and next time.
// It talks to persephone-ui.js through window events:
//   in:  'ps:data' {run}      the live Bonus Run (sites); tables are built or updated to match
//        'ps:focus' {siteId}  glide to a table (null = the whole room)
//        'ps:quality' {level} 'high' | 'low'
//   out: 'ps:select' {siteId} a table was clicked
import * as THREE from './vendor/three/three.module.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from './vendor/three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from './vendor/three/addons/environments/RoomEnvironment.js';
import { Reflector } from './vendor/three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from './vendor/three/addons/geometries/RoundedBoxGeometry.js';

const canvas = document.getElementById('ps-scene');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let quality = localStorage.getItem('watson.persephone.quality') || 'high';

// ── Renderer, with a graceful fallback when WebGL isn't available ──
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('ps-no3d');
  document.getElementById('ps-veil')?.remove();
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07030a);
scene.fog = new THREE.FogExp2(0x0b0408, 0.018);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);

// ── Procedural textures (drawn once on canvases; nothing is downloaded) ──
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, aniso = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (aniso) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// Seeded noise so the marble looks the same every visit.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function veins(g, w, h, color, n, width) {
  g.strokeStyle = color; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    g.lineWidth = width * (0.3 + rnd());
    g.globalAlpha = 0.15 + rnd() * 0.35;
    g.beginPath();
    let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
    g.moveTo(x, y);
    for (let s = 0; s < 40; s++) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * w / 40; y += Math.sin(a) * h / 40; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
}
const marbleFloor = canvasTex(1024, 1024, (g, w, h) => {
  const n = 4, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const dark = (i + j) % 2 === 0;
    const grad = g.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s);
    grad.addColorStop(0, dark ? '#0c0a0c' : '#efe9de'); grad.addColorStop(1, dark ? '#171217' : '#ddd4c4');
    g.fillStyle = grad; g.fillRect(i * s, j * s, s, s);
    g.save(); g.beginPath(); g.rect(i * s, j * s, s, s); g.clip();
    veins(g, w, h, dark ? '#6d6470' : '#8f8676', 6, 3);
    veins(g, w, h, dark ? '#c8b98a' : '#b9a983', 2, 1.2);
    g.restore();
  }
  g.strokeStyle = 'rgba(201,162,74,.55)'; g.lineWidth = 3;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
}, { repeat: [7, 16] });
const marbleWhite = canvasTex(512, 1024, (g, w, h) => {
  g.fillStyle = '#f1ece2'; g.fillRect(0, 0, w, h);
  veins(g, w, h, '#9a9180', 14, 2.5); veins(g, w, h, '#c7b68a', 4, 1);
});
const damask = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4a0d18'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5c1222';
  const motif = (cx, cy, r) => {
    g.beginPath();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.42, r * 0.16, a, 0, Math.PI * 2);
    }
    g.fill();
    g.beginPath(); g.arc(cx, cy, r * 0.22, 0, Math.PI * 2); g.fillStyle = '#6e1828'; g.fill(); g.fillStyle = '#5c1222';
  };
  motif(w / 2, h / 2, w * 0.38); motif(0, 0, w * 0.38); motif(w, 0, w * 0.38); motif(0, h, w * 0.38); motif(w, h, w * 0.38);
}, { repeat: [10, 3] });
const feltTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#0a3b24'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const v = (rnd() - 0.5) * 18; img.data[i] += v * 0.3; img.data[i + 1] += v; img.data[i + 2] += v * 0.5; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(233,217,166,.35)'; g.lineWidth = 5;
  g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2); g.stroke();
  g.font = `bold ${w * 0.11}px Georgia, serif`; g.fillStyle = 'rgba(233,217,166,.28)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('P', w / 2, h / 2);
});

// The code that falls behind the windows: a glyph atlas and a shader that scrolls columns of it.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789';
const atlas = canvasTex(1024, 1024, (g, w) => {
  const n = 8, s = w / n;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
  g.font = `${s * 0.78}px "MS Gothic", "Yu Gothic", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  for (let i = 0; i < 64; i++) g.fillText(GLYPHS[i % GLYPHS.length], (i % n + 0.5) * s, (Math.floor(i / n) + 0.5) * s);
}, { srgb: false, aniso: false });
atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
const rainUniforms = { uTime: { value: 0 }, uAtlas: { value: atlas } };
const rainMat = new THREE.ShaderMaterial({
  uniforms: rainUniforms, fog: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform float uTime; uniform sampler2D uAtlas; varying vec2 vUv;
    float h(float n){ return fract(sin(n*127.1)*43758.5453); }
    void main(){
      vec2 grid = vec2(26.0, 48.0);
      vec2 cell = floor(vUv*grid); vec2 f = fract(vUv*grid);
      float speed = 0.6 + h(cell.x)*1.4;
      float head = fract(h(cell.x*3.7) - uTime*speed*0.08);
      float y = 1.0 - vUv.y;
      float d = fract(head - y + 1.0);
      float trail = smoothstep(0.55, 0.0, d);
      float g = floor(h(cell.x*13.1 + cell.y*7.7 + floor(uTime*(2.0+h(cell.y)*3.0))) * 64.0);
      vec2 a = (vec2(mod(g,8.0), floor(g/8.0)) + f) / 8.0;
      float glyph = texture2D(uAtlas, vec2(a.x, 1.0 - a.y)).r;
      float lead = smoothstep(0.03, 0.0, d);
      vec3 col = vec3(0.0, 1.0, 0.25) * glyph * trail * 0.9 + vec3(0.75, 1.0, 0.8) * glyph * lead;
      col += vec3(0.0, 0.05, 0.015);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// ── Materials ──
const M = {
  gold: new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.22, clearcoat: 0.4, envMapIntensity: 1.4 }),
  goldDark: new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 1, roughness: 0.38 }),
  marble: new THREE.MeshPhysicalMaterial({ map: marbleWhite, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
  floor: new THREE.MeshPhysicalMaterial({ map: marbleFloor, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.86 }),
  wall: new THREE.MeshStandardMaterial({ map: damask, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x1b0d08, roughness: 0.45, metalness: 0.1 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0x120709, roughness: 0.7 }),
  velvet: new THREE.MeshPhysicalMaterial({ color: 0x5a0614, roughness: 0.9, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(0xff5a6e), side: THREE.DoubleSide }),
  felt: new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 }),
  crystal: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 0, clearcoat: 1, emissive: 0xffe6b0, emissiveIntensity: 0.9, envMapIntensity: 2 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffd38a }),
  readyRing: new THREE.MeshBasicMaterial({ color: 0x00ff55, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  waitRing: new THREE.MeshBasicMaterial({ color: 0xc9a24a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
};
const CHIP_COLORS = [0xf2ead8, 0x8e0f22, 0xc9a24a, 0x0e5a34, 0x1a1418];
const chipMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.25 }); // each chip's color is per instance

// ── The hall (rebuilt when the number of tables changes, so it's always long enough) ──
const hall = new THREE.Group(); scene.add(hall);
const W = 26, H = 14, ROW_GAP = 8.5;
let L = 60, mirror = null;
const lights = [];

function clearGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse?.((o) => { if (o.geometry) o.geometry.dispose(); if (o.dispose && o !== c) o.dispose(); });
    if (c.dispose) c.dispose();
  }
}

function fold(geo, depth, waves) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, Math.sin(x * waves) * depth * (0.75 + 0.25 * Math.sin(y * 0.6)) + Math.cos(x * waves * 2.3) * depth * 0.2);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildHall(rows) {
  clearGroup(hall);
  for (const l of lights) scene.remove(l);
  lights.length = 0;
  L = Math.max(46, rows * ROW_GAP + 26);
  const z0 = 8, zEnd = z0 - L;

  // Floor: a true mirror under translucent polished marble, so the room reflects in it.
  if (quality === 'high') {
    mirror = new Reflector(new THREE.PlaneGeometry(W, L), { textureWidth: 1024, textureHeight: 1024, color: 0x7a7a7a, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.set(0, -0.01, z0 - L / 2);
    hall.add(mirror);
  } else mirror = null;
  marbleFloor.repeat.set(W / 3.6, L / 3.6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), quality === 'high' ? M.floor : Object.assign(M.floor.clone(), { transparent: false, opacity: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, z0 - L / 2); floor.receiveShadow = true;
  hall.add(floor);

  // Walls: damask above dark wood wainscoting with a gold rail.
  damask.repeat.set(L / 4, 3);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), M.wall);
    wall.position.set(side * W / 2, H / 2, z0 - L / 2); wall.rotation.y = -side * Math.PI / 2; wall.receiveShadow = true;
    hall.add(wall);
    const wains = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, L), M.wood);
    wains.position.set(side * (W / 2 - 0.15), 1.3, z0 - L / 2); hall.add(wains);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, L), M.gold);
    rail.position.set(side * (W / 2 - 0.2), 2.66, z0 - L / 2); hall.add(rail);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, L), M.gold);
    crown.position.set(side * (W / 2 - 0.3), H - 0.15, z0 - L / 2); hall.add(crown);
  }
  // The far wall: a great arched window of falling code, framed in gold, with velvet drapes.
  const far = new THREE.Mesh(new THREE.PlaneGeometry(W, H), M.wall);
  far.position.set(0, H / 2, zEnd); hall.add(far);
  const bigWin = new THREE.Mesh(new THREE.PlaneGeometry(9, 10.5), rainMat);
  bigWin.position.set(0, 6.2, zEnd + 0.05); hall.add(bigWin);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.18, 12, 64, Math.PI), M.gold);
  arch.position.set(0, 11.45, zEnd + 0.12); hall.add(arch);
  for (const sx of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 10.5, 0.3), M.gold);
    jamb.position.set(sx * 4.5, 6.2, zEnd + 0.12); hall.add(jamb);
    const drape = new THREE.Mesh(fold(new THREE.PlaneGeometry(3.4, 12.5, 48, 8), 0.22, 5.2), M.velvet);
    drape.position.set(sx * 6.2, 6.4, zEnd + 0.5); hall.add(drape);
    drape.castShadow = true;
  }
  // The emblem over the window: a gilded P in a laurel ring, glowing faintly green at its heart.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 16, 96), M.gold);
  ring.position.set(0, 12.6, zEnd + 0.4); hall.add(ring);
  const heart = new THREE.Mesh(new THREE.CircleGeometry(1.05, 64), new THREE.MeshBasicMaterial({ color: 0x00ff55, transparent: true, opacity: 0.12 }));
  heart.position.set(0, 12.6, zEnd + 0.38); hall.add(heart);

  // Side windows (code behind glass) between the columns, each with its own drapes.
  const bays = Math.floor(L / ROW_GAP);
  for (let b = 0; b < bays; b++) {
    const z = z0 - 4 - b * ROW_GAP;
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.5), rainMat);
      win.position.set(side * (W / 2 - 0.02), 6.8, z - ROW_GAP / 2); win.rotation.y = -side * Math.PI / 2; hall.add(win);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.07, 8, 32, Math.PI), M.gold);
      frame.position.set(side * (W / 2 - 0.05), 10.05, z - ROW_GAP / 2); frame.rotation.y = -side * Math.PI / 2; hall.add(frame);
      for (const d of [-1, 1]) {
        const dr = new THREE.Mesh(fold(new THREE.PlaneGeometry(1.5, 8.6, 24, 6), 0.12, 7), M.velvet);
        dr.position.set(side * (W / 2 - 0.35), 6.6, z - ROW_GAP / 2 + d * 2.25); dr.rotation.y = -side * Math.PI / 2; hall.add(dr);
      }
    }
  }

  // Columns: white marble shafts with gilded bases and capitals (instanced, so a long hall stays fast).
  const cols = []; for (let b = 0; b <= bays; b++) for (const side of [-1, 1]) cols.push(new THREE.Vector3(side * (W / 2 - 1.6), 0, z0 - 4 - b * ROW_GAP));
  const shaftGeo = new THREE.CylinderGeometry(0.55, 0.62, H - 1.6, 32, 1);
  const shafts = new THREE.InstancedMesh(shaftGeo, M.marble, cols.length);
  const baseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.5, 32), capGeo = new THREE.CylinderGeometry(1.0, 0.6, 0.7, 32);
  const bases = new THREE.InstancedMesh(baseGeo, M.gold, cols.length), caps = new THREE.InstancedMesh(capGeo, M.gold, cols.length);
  const m4 = new THREE.Matrix4();
  cols.forEach((p, i) => {
    shafts.setMatrixAt(i, m4.makeTranslation(p.x, (H - 1.6) / 2 + 0.5, p.z));
    bases.setMatrixAt(i, m4.makeTranslation(p.x, 0.25, p.z));
    caps.setMatrixAt(i, m4.makeTranslation(p.x, H - 0.75, p.z));
  });
  for (const im of [shafts, bases, caps]) { im.castShadow = true; im.receiveShadow = true; hall.add(im); }

  // A coffered ceiling with gold ribs.
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, L), M.ceiling);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, z0 - L / 2); hall.add(ceil);
  const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(W, 0.25, 0.25), M.goldDark, bays + 1);
  for (let b = 0; b <= bays; b++) ribs.setMatrixAt(b, m4.makeTranslation(0, H - 0.13, z0 - 4 - b * ROW_GAP));
  hall.add(ribs);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, L), M.goldDark); spine.position.set(0, H - 0.13, z0 - L / 2); hall.add(spine);

  // A runner of crimson carpet down the middle aisle, with gold edges.
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(3.2, L - 4), new THREE.MeshStandardMaterial({ color: 0x3d0610, roughness: 1 }));
  runner.rotation.x = -Math.PI / 2; runner.position.set(0, 0.012, z0 - L / 2 - 1); runner.receiveShadow = true; hall.add(runner);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.12, L - 4), M.gold); e.rotation.x = -Math.PI / 2; e.position.set(sx * 1.66, 0.014, z0 - L / 2 - 1); hall.add(e); }

  // Chandeliers down the aisle: gilded rings of candles and crystal drops, each with a warm light.
  const nCh = Math.max(2, Math.ceil(L / 16));
  for (let c = 0; c < nCh; c++) {
    const z = z0 - 6 - c * ((L - 10) / Math.max(1, nCh - 1));
    hall.add(chandelier(new THREE.Vector3(0, H - 3.4, z)));
    const pl = new THREE.PointLight(0xffc98a, quality === 'high' ? 38 : 30, 26, 1.6);
    pl.position.set(0, H - 4.0, z);
    if (c === 0 && quality === 'high') { pl.castShadow = true; pl.shadow.mapSize.set(1024, 1024); pl.shadow.bias = -0.002; }
    scene.add(pl); lights.push(pl);
  }
  // A cool green wash from the code windows, and a soft warm fill.
  const hemi = new THREE.HemisphereLight(0x5a2a1a, 0x050203, 0.5); scene.add(hemi); lights.push(hemi);
  const green = new THREE.PointLight(0x00ff66, 22, 30, 1.8); green.position.set(0, 6, zEnd + 3); scene.add(green); lights.push(green);
}

function chandelier(pos) {
  const g = new THREE.Group(); g.position.copy(pos);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), M.goldDark); chain.position.y = 1.7; g.add(chain);
  for (const [r, y] of [[1.6, 0], [1.05, 0.55], [0.55, 1.0]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 10, 64), M.gold); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
  }
  // Candles with small flames (they bloom).
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cd = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.6 }));
    cd.position.set(Math.cos(a) * 1.6, 0.18, Math.sin(a) * 1.6); g.add(cd);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), M.flame); fl.scale.y = 1.8; fl.position.set(cd.position.x, 0.4, cd.position.z); g.add(fl);
  }
  // Crystal drops hanging in tiers.
  const drops = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.07, 0), M.crystal, 96);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 2.2, 1);
  for (let i = 0; i < 96; i++) {
    const tier = i % 3, r = [1.6, 1.05, 0.55][tier], a = (i / 96) * Math.PI * 2 * 3 + tier;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, [-0.35, 0.2, 0.65][tier] - (i % 2) * 0.18, Math.sin(a) * r), q, s);
    drops.setMatrixAt(i, m4);
  }
  g.add(drops);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), M.gold); finial.position.y = -0.6; g.add(finial);
  return g;
}

// ── The tables: one per site ──
const tablesGroup = new THREE.Group(); scene.add(tablesGroup);
const tables = new Map(); // siteId -> { group, chips, ring, placard, data, pos }
let order = [];

function tablePos(i) {
  const row = Math.floor(i / 2), side = i % 2 === 0 ? -1 : 1;
  return new THREE.Vector3(side * 5.6, 0, 2 - row * ROW_GAP - (side > 0 ? ROW_GAP / 2 : 0));
}

function placardTexture(s) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 512);
  // A black lacquer card with a double gold border.
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, 'rgba(18,6,10,.92)'); grad.addColorStop(1, 'rgba(6,2,4,.92)');
  g.fillStyle = grad; roundRect(g, 8, 8, 1008, 496, 36); g.fill();
  g.strokeStyle = '#c9a24a'; g.lineWidth = 6; roundRect(g, 8, 8, 1008, 496, 36); g.stroke();
  g.strokeStyle = 'rgba(201,162,74,.5)'; g.lineWidth = 2; roundRect(g, 26, 26, 972, 460, 26); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f2e3b3'; g.font = `600 ${fit(g, s.name, 860, 92)}px Georgia, "Times New Roman", serif`;
  g.shadowColor = 'rgba(233,200,120,.6)'; g.shadowBlur = 18; g.fillText(s.name, 512, 120); g.shadowBlur = 0;
  const bal = s.scSaved != null ? `${s.scEstimated ? '~' : ''}${fmt(s.scSaved)} SC` : 'balance not set';
  g.font = '700 110px Georgia, serif'; g.fillStyle = s.scSaved != null ? '#ffffff' : 'rgba(255,255,255,.45)'; g.fillText(bal, 512, 262);
  const ready = s.ready;
  g.font = '600 54px "Segoe UI", Arial, sans-serif';
  g.fillStyle = ready ? '#38ff7a' : '#c9a24a';
  if (ready) { g.shadowColor = '#00ff55'; g.shadowBlur = 24; }
  g.fillText(ready ? (s.streakAtRisk ? 'READY · STREAK ON THE LINE' : 'READY TO COLLECT') : s.claimedToday && !s.readyAt ? 'COLLECTED' : `NEXT ${nextText(s.readyAt)}`, 512, 380);
  g.shadowBlur = 0;
  if (s.alertTimes?.length) { g.font = '40px "Segoe UI", Arial, sans-serif'; g.fillStyle = 'rgba(242,227,179,.7)'; g.fillText('🔔 ' + s.alertTimes.map(clock).join(' · '), 512, 448); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fit(g, text, max, size) { g.font = `600 ${size}px Georgia, serif`; while (g.measureText(text).width > max && size > 40) { size -= 4; g.font = `600 ${size}px Georgia, serif`; } return size; }
const fmt = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const clock = (t) => { const h = Number(t.slice(0, 2)), m = t.slice(3); return `${(h % 12) || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`; };
function nextText(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'ANY MOMENT';
  const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
  return h >= 20 ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).toUpperCase() : h ? `IN ${h}H ${m % 60}M` : `IN ${m}M`;
}

const tableTop = new THREE.CylinderGeometry(2.0, 2.0, 0.16, 64);
const railGeo = new THREE.TorusGeometry(2.05, 0.11, 16, 96);
const stemGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.0, 24);
const footGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.12, 48);
const chipGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 28);
const ringGeo = new THREE.RingGeometry(2.25, 2.55, 96);
const placardGeo = new THREE.PlaneGeometry(2.6, 1.3);

function makeTable(s, i) {
  const g = new THREE.Group(); g.userData.siteId = s.id;
  const pos = tablePos(i); g.position.copy(pos);
  const top = new THREE.Mesh(tableTop, M.felt); top.position.y = 1.1; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const rail = new THREE.Mesh(railGeo, M.gold); rail.rotation.x = Math.PI / 2; rail.position.y = 1.18; rail.castShadow = true; g.add(rail);
  const stem = new THREE.Mesh(stemGeo, M.goldDark); stem.position.y = 0.55; stem.castShadow = true; g.add(stem);
  const foot = new THREE.Mesh(footGeo, M.gold); foot.position.y = 0.06; g.add(foot);
  const ring = new THREE.Mesh(ringGeo, M.waitRing.clone()); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  // Up to 4 chip towers on the felt; their total height tracks the SC balance.
  const chips = new THREE.InstancedMesh(chipGeo, chipMat, 160);
  chips.castShadow = true; chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); g.add(chips);
  const pmat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const placard = new THREE.Mesh(placardGeo, pmat); placard.position.set(0, 3.25, 0); g.add(placard);
  // Two chairs of crimson velvet facing the table.
  for (const a of [Math.PI * 0.75, Math.PI * 1.25]) g.add(chair(a));
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 4.2, 16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 2; hit.userData.siteId = s.id; g.add(hit);
  tablesGroup.add(g);
  const t = { group: g, chips, ring, placard, hit, pos, data: null, key: '' };
  tables.set(s.id, t);
  return t;
}
function chair(angle) {
  const c = new THREE.Group();
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.18, 0.9, 3, 0.06), M.velvet); seat.position.y = 0.75; c.add(seat);
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.1, 0.14, 3, 0.06), M.velvet); back.position.set(0, 1.35, 0.42); c.add(back);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.03, 8, 32, Math.PI), M.gold); frame.position.set(0, 1.9, 0.42); c.add(frame);
  for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.7, 8), M.gold); leg.position.set(x, 0.35, z); c.add(leg);
  }
  c.position.set(Math.sin(angle) * 3.0, 0, Math.cos(angle) * 3.0); c.rotation.y = angle;
  c.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return c;
}

function updateTable(t, s) {
  // Countdowns redraw once a minute; everything else only when it changes.
  const key = JSON.stringify([s.name, s.scSaved, s.scEstimated, s.ready, s.readyAt, s.claimedToday, s.streakAtRisk, s.alertTimes, s.ready ? 0 : Math.floor(Date.now() / 60000)]);
  t.data = s;
  if (key === t.key) return;
  t.key = key;
  if (t.placard.material.map) t.placard.material.map.dispose();
  t.placard.material.map = placardTexture(s); t.placard.material.needsUpdate = true;
  t.ring.material.dispose(); t.ring.material = s.ready ? M.readyRing.clone() : M.waitRing.clone();
  // Chips: one per SC up to 40, then half as many per SC beyond, in up to 4 stacks, colors by denomination.
  const sc = Math.max(0, s.scSaved || 0);
  const n = Math.min(160, Math.round(sc <= 40 ? sc : 40 + (sc - 40) / 2));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const stacks = [[-0.55, -0.35], [0.1, -0.6], [0.6, 0.1], [-0.2, 0.45]];
  for (let k = 0; k < 160; k++) {
    if (k < n) {
      const st = stacks[k % 4], lvl = Math.floor(k / 4);
      const jitter = ((k * 37) % 7 - 3) * 0.006;
      m4.compose(new THREE.Vector3(st[0] + jitter, 1.215 + lvl * 0.052, st[1] - jitter), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 0.7), one);
    } else m4.makeScale(0, 0, 0);
    t.chips.setMatrixAt(k, m4);
    t.chips.setColorAt(k, new THREE.Color(CHIP_COLORS[(Math.floor(k / 4) + (k % 4)) % CHIP_COLORS.length]));
  }
  t.chips.count = 160;
  t.chips.instanceMatrix.needsUpdate = true;
  if (t.chips.instanceColor) t.chips.instanceColor.needsUpdate = true;
}

let builtRows = -1;
function setData(run) {
  const sites = run?.sites || [];
  const rows = Math.ceil(sites.length / 2);
  if (rows !== builtRows) { buildHall(rows); builtRows = rows; }
  const ids = new Set(sites.map((s) => s.id));
  for (const [id, t] of tables) if (!ids.has(id)) { tablesGroup.remove(t.group); tables.delete(id); }
  order = sites.map((s) => s.id);
  sites.forEach((s, i) => {
    const t = tables.get(s.id) || makeTable(s, i);
    const p = tablePos(i); t.pos = p; t.group.position.copy(p);
    updateTable(t, s);
  });
  hideVeil();
}

// ── Particles: gold dust in the candlelight ──
const dustN = 900;
const dustGeo = new THREE.BufferGeometry();
const dp = new Float32Array(dustN * 3), ds = new Float32Array(dustN);
for (let i = 0; i < dustN; i++) { dp[i * 3] = (rnd() - 0.5) * W; dp[i * 3 + 1] = rnd() * H; dp[i * 3 + 2] = 8 - rnd() * 120; ds[i] = rnd(); }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.05, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(dust);

// ── Post-processing: bloom for the candles, crystals and code; SMAA for clean edges ──
let composer, bloom, smaa;
function buildComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.55, 0.78);
  composer.addPass(bloom);
  if (quality === 'high') { smaa = new SMAAPass(); composer.addPass(smaa); } else smaa = null;
  composer.addPass(new OutputPass());
  resize();
}

// ── Camera: walk the aisle, look around, glide to a table ──
const cam = { z: 12, yaw: 0, pitch: -0.06, target: null, pos: new THREE.Vector3(0, 3.4, 12), look: new THREE.Vector3(0, 2.6, -10) };
const goal = { pos: new THREE.Vector3(0, 3.4, 12), look: new THREE.Vector3(0, 2.6, -10) };
let focusId = null;
function overview() {
  focusId = null;
  goal.pos.set(0, 3.6 + Math.sin(cam.yaw) * 0, cam.z);
  goal.look.set(Math.sin(cam.yaw) * 10, 2.4 + cam.pitch * 10, cam.z - Math.cos(cam.yaw) * 14);
}
function focusTable(id) {
  const t = tables.get(id); if (!t) return overview();
  focusId = id;
  // Stand back across the aisle, a little above, and look just past the table so it sits left of the drawer.
  const side = Math.sign(t.pos.x) || 1;
  goal.pos.set(t.pos.x - side * 4.2, 4.8, t.pos.z + 8.4);
  goal.look.set(t.pos.x + 1.1, 2.0, t.pos.z - 0.6);
  cam.z = t.pos.z + 8;
}
overview();

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false }; });
window.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved && e.target === canvas) pick(e);
  drag = null;
});
window.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  cam.yaw = Math.max(-1.1, Math.min(1.1, drag.yaw + dx * 0.004));
  cam.pitch = Math.max(-0.35, Math.min(0.3, drag.pitch - dy * 0.003));
  overview();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.z = Math.max(8 - L + 14, Math.min(14, cam.z - e.deltaY * 0.02));
  overview();
}, { passive: false });

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(9, 9);
function pick(e) {
  const v = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(v, camera);
  const hits = ray.intersectObjects([...tables.values()].map((t) => t.hit), false);
  if (hits.length) {
    const id = hits[0].object.userData.siteId;
    focusTable(id);
    window.dispatchEvent(new CustomEvent('ps:select', { detail: { siteId: id } }));
  }
}

window.addEventListener('ps:data', (e) => setData(e.detail.run));
window.addEventListener('ps:focus', (e) => { if (e.detail?.siteId) focusTable(e.detail.siteId); else overview(); });
window.addEventListener('ps:step', (e) => {
  if (!order.length) return;
  const i = focusId ? order.indexOf(focusId) : -1;
  const id = order[(i + e.detail.dir + order.length) % order.length];
  focusTable(id);
  window.dispatchEvent(new CustomEvent('ps:select', { detail: { siteId: id } }));
});
window.addEventListener('ps:quality', (e) => {
  quality = e.detail.level === 'low' ? 'low' : 'high';
  localStorage.setItem('watson.persephone.quality', quality);
  applyQuality();
});
function applyQuality() {
  renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 2) : 1);
  renderer.shadowMap.enabled = quality === 'high';
  builtRows = -1;
  const run = lastRun; if (run) setData(run); else buildHall(0);
  buildComposer();
}
let lastRun = null;
window.addEventListener('ps:data', (e) => { lastRun = e.detail.run; });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
  bloom?.resolution.set(w, h);
}
window.addEventListener('resize', resize);

let veilGone = false;
function hideVeil() { if (veilGone) return; veilGone = true; const v = document.getElementById('ps-veil'); if (v) { v.classList.add('gone'); setTimeout(() => v.remove(), 1600); } }
setTimeout(hideVeil, 6000); // even if the app is slow to answer, open the doors

// ── The loop ──
const clock3 = new THREE.Timer();
let slowFrames = 0;
function frame() {
  clock3.update();
  const dt = Math.min(0.05, clock3.getDelta()), t = clock3.getElapsed();
  rainUniforms.uTime.value = t;
  const ease = 1 - Math.pow(0.0015, dt);
  // A slow, living breath to the camera (none with reduced motion).
  const sway = reduced ? 0 : Math.sin(t * 0.25) * 0.08;
  cam.pos.lerp(goal.pos, ease); cam.look.lerp(goal.look, ease);
  camera.position.set(cam.pos.x + sway + mouse.x * 0.25, cam.pos.y + Math.sin(t * 0.33) * 0.04 + mouse.y * 0.12, cam.pos.z);
  camera.lookAt(cam.look);
  for (const tb of tables.values()) {
    tb.placard.quaternion.copy(camera.quaternion);
    tb.placard.position.y = 3.25 + (reduced ? 0 : Math.sin(t * 1.2 + tb.pos.z) * 0.06);
    if (tb.data?.ready) tb.ring.material.opacity = 0.55 + 0.4 * Math.sin(t * 2.6 + tb.pos.x);
    tb.group.scale.setScalar(tb.group.userData.siteId === focusId ? 1.02 : 1);
  }
  if (!reduced) {
    const p = dust.geometry.attributes.position;
    for (let i = 0; i < dustN; i++) { let y = p.getY(i) + dt * (0.05 + ds[i] * 0.08); if (y > H) y = 0; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05); }
    p.needsUpdate = true;
  }
  composer.render(dt);
  // If the PC is struggling, step the picture down once rather than stutter.
  if (quality === 'high' && dt > 0.04) { if (++slowFrames > 90) { slowFrames = 0; window.dispatchEvent(new CustomEvent('ps:quality', { detail: { level: 'low', auto: true } })); window.dispatchEvent(new CustomEvent('ps:quality-auto')); } }
  else slowFrames = Math.max(0, slowFrames - 1);
  requestAnimationFrame(frame);
}

renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 2) : 1);
renderer.shadowMap.enabled = quality === 'high';
buildHall(2); builtRows = 2;
buildComposer();
requestAnimationFrame(frame);
window.dispatchEvent(new CustomEvent('ps:scene-ready'));
