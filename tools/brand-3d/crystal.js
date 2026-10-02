import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": the chat bubble grown from silver
// crystals (octahedra, cubes, needles) with a few silver wires, on the black key.
// `?render=1` draws one transparent front-facing frame, like main.js.

const params = new URLSearchParams(location.search);
const RENDER = params.get('render') === '1';
const SIZE = RENDER ? 1024 : Math.min(innerWidth, innerHeight);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(RENDER ? devicePixelRatio : Math.min(devicePixelRatio, 2));
renderer.setSize(RENDER ? SIZE : innerWidth, RENDER ? SIZE : innerHeight);
renderer.setClearColor(0x000000, RENDER ? 0 : 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

if (RENDER) {
  document.getElementById('hint')?.remove();
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

const scene = new THREE.Scene();
const DIST = 3000;
const FOV = (2 * Math.atan(512 / DIST) * 180) / Math.PI;
const camera = new THREE.PerspectiveCamera(FOV, RENDER ? 1 : innerWidth / innerHeight, 100, 10000);
camera.position.set(0, 0, DIST);

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// studio environment: softboxes that the facets mirror
function buildEnvironment() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x07080a);
  const panel = (w, h, x, y, z, color, power) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(14, 8, -8, 10, 12, '#ffffff', 12);
  panel(4, 16, 13, 2, 8, '#cfe0ff', 6);
  panel(16, 3, 2, -10, 10, '#ffe2bd', 3);
  panel(8, 8, -13, -3, 5, '#8fa6c4', 2);
  panel(6, 6, 6, 12, -4, '#ffffff', 5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  return target.texture;
}
scene.environment = buildEnvironment();

// ---------- the black key ----------
function roundedSquare(size, radius) {
  const h = size / 2;
  const k = 0.5523 * radius;
  const s = new THREE.Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h);
  s.bezierCurveTo(h - radius + k, -h, h, -h + radius - k, h, -h + radius);
  s.lineTo(h, h - radius);
  s.bezierCurveTo(h, h - radius + k, h - radius + k, h, h - radius, h);
  s.lineTo(-h + radius, h);
  s.bezierCurveTo(-h + radius - k, h, -h, h - radius + k, -h, h - radius);
  s.lineTo(-h, -h + radius);
  s.bezierCurveTo(-h, -h + radius - k, -h + radius - k, -h, -h + radius, -h);
  return s;
}
function smoothExtrude(shape, depth, bevel, offset = 0) {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: offset,
    bevelSegments: 16,
    curveSegments: 72,
  });
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 0.01);
  geo.computeVertexNormals();
  return geo;
}
const key = new THREE.Mesh(
  smoothExtrude(roundedSquare(824, 190), 60, 30),
  new THREE.MeshPhysicalMaterial({
    color: 0x242427,
    metalness: 0.9,
    roughness: 0.5,
    envMapIntensity: 1.5,
    clearcoat: 0.3,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- bubble outline (same proportions as the flat logo) ----------
function bubblePath() {
  const P = (x, y) => [x - 512, 512 - y];
  const s = new THREE.Shape();
  const k = 0.5523 * 126;
  s.moveTo(...P(356, 258));
  s.lineTo(...P(668, 258));
  s.bezierCurveTo(...P(668 + k, 258), ...P(794, 384 - k), ...P(794, 384));
  s.lineTo(...P(794, 576));
  s.bezierCurveTo(...P(794, 576 + k), ...P(668 + k, 702), ...P(668, 702));
  s.lineTo(...P(478, 702));
  s.lineTo(...P(340, 792));
  s.lineTo(...P(372, 702));
  s.lineTo(...P(356, 702));
  s.bezierCurveTo(...P(356 - k, 702), ...P(230, 576 + k), ...P(230, 576));
  s.lineTo(...P(230, 384));
  s.bezierCurveTo(...P(230, 384 - k), ...P(356 - k, 258), ...P(356, 258));
  return s;
}
const outline = bubblePath().getPoints(24);

function inside(x, y, margin) {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const c = outline[j];
    if (a.y > y !== c.y > y && x < ((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x) hit = !hit;
  }
  if (!hit) return false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const c = outline[j];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - (a.x + u * dx), y - (a.y + u * dy)) < margin) return false;
  }
  return true;
}

// dark base so the gaps between crystals read as depth, not as the key
const base = new THREE.Mesh(
  smoothExtrude(bubblePath(), 20, 6, -6),
  new THREE.MeshStandardMaterial({ color: 0x0e0e10, metalness: 1, roughness: 0.35 }),
);
base.position.z = 0;
base.castShadow = true;
scene.add(base);

// ---------- crystals ----------
const silver = new THREE.MeshStandardMaterial({
  color: 0xf2f4f7,
  metalness: 1,
  roughness: 0.3,
  flatShading: true,
  envMapIntensity: 2.2,
});
const shapes = [
  () => new THREE.OctahedronGeometry(1, 0),
  () => new THREE.BoxGeometry(1.25, 1.25, 1.25),
  () => new THREE.OctahedronGeometry(1, 0).scale(0.5, 0.5, 2.1), // needle
  () => new THREE.IcosahedronGeometry(1, 0),
];
const rnd = rand(7);
const placed = [];
function grow(radius, tries, count) {
  let made = 0;
  for (let n = 0; n < tries && made < count; n++) {
    const x = (rnd() * 2 - 1) * 290;
    const y = -190 + rnd() * 500;
    if (!inside(x, y, radius * 0.3)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < (p.r + radius) * 0.36)) continue;
    placed.push({ x, y, r: radius });
    made++;
    const geo = shapes[Math.floor(rnd() * shapes.length)]();
    const mesh = new THREE.Mesh(geo, silver);
    mesh.scale.set(1, 1, 0.55).multiplyScalar(radius * (0.85 + rnd() * 0.3));
    mesh.position.set(x, y, 8 + rnd() * 14);
    mesh.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
grow(54, 6000, 40);
grow(36, 9000, 120);
grow(22, 15000, 260);
grow(13, 30000, 700);
grow(8, 40000, 900);

// ---------- silver wires curling along the edge ----------
function wire(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, radius, 10, false), silver);
  mesh.castShadow = true;
  scene.add(mesh);
}
const wr = rand(91);
const rim = bubblePath().getSpacedPoints(120);
for (let i = 0; i < 7; i++) {
  const from = Math.floor(wr() * rim.length);
  const pts = [];
  for (let k = 0; k < 14; k++) {
    const p = rim[(from + k * 3) % rim.length];
    const n = (wr() - 0.5) * 16;
    pts.push(new THREE.Vector3(p.x + n, p.y + n, 36 + Math.sin(k * 1.1 + i) * 10));
  }
  wire(pts, 3 + wr() * 2.5);
}

// ---------- light and ground ----------
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-500, 700, 1600);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -700;
sun.shadow.camera.right = 700;
sun.shadow.camera.top = 700;
sun.shadow.camera.bottom = -700;
sun.shadow.camera.far = 4000;
sun.shadow.radius = 5;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

if (RENDER) {
  renderer.render(scene, camera);
} else {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  addEventListener('dblclick', () => {
    camera.position.set(0, 0, DIST);
    controls.target.set(0, 0, 0);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}
