import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": a big silver sphere with a small one on a tilted orbit (the earth and its moon) on the black key.
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
  env.background = new THREE.Color(0x30343a);
  const panel = (w, h, x, y, z, color, power) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(40, 14, -4, 16, 14, '#ffffff', 6); // big overhead softbox
  panel(14, 40, -16, 2, 10, '#ffffff', 3.5); // tall left box
  panel(8, 34, 16, 0, 8, '#cfe0ff', 3); // cool strip on the right
  panel(36, 8, 0, -14, 12, '#ffe2bd', 2); // warm fill from below
  panel(22, 22, 0, 0, 18, '#9aa8bc', 1.6); // grey card behind the camera
  panel(10, 10, 12, 12, -6, '#ffffff', 4);
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
// machined-metal textures drawn on a canvas: `lines` are 1px streaks (horizontal in texture space), `noise` is fine grain
function metalTexture({ width, height, seed, lines, noise, base = 128, spread = 40, repeat = [1, 1] }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const r = rand(seed);
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = base + (r() - 0.5) * noise;
    image.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < lines; i++) {
    const y = r() * height;
    const v = base + (r() - 0.5) * spread * 2;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.5})`;
    ctx.lineWidth = 0.7 + r() * 1.3;
    const x = r() * width;
    const len = width * (0.3 + r() * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - len, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - len + width, y);
    ctx.lineTo(x + len + width, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.repeat.set(...repeat);
  return texture;
}
const keyShape = roundedSquare(824, 190);
const keyGrain = metalTexture({ width: 1024, height: 1024, seed: 3, lines: 5200, noise: 60, spread: 70, repeat: [1 / 520, 1 / 520] });
const key = new THREE.Mesh(
  smoothExtrude(keyShape, 60, 30),
  new THREE.MeshPhysicalMaterial({
    color: 0x131316,
    metalness: 0.9,
    roughness: 1,
    roughnessMap: keyGrain,
    envMapIntensity: 0.45,
    bumpMap: keyGrain,
    bumpScale: 1.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- a big silver sphere and a small one in orbit, like the earth and the moon ----------
const mirror = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0.12, envMapIntensity: 2.2 });
// lathe-turned planet: fine latitude grooves; polished chrome moon
const turned = metalTexture({ width: 64, height: 1024, seed: 8, lines: 900, noise: 14, base: 70, spread: 45 });
const planetMaterial = new THREE.MeshStandardMaterial({
  color: 0xe9ecf1,
  metalness: 1,
  roughness: 1,
  roughnessMap: turned,
  bumpMap: turned,
  bumpScale: 0.8,
  envMapIntensity: 2.4,
});
const moonMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f6f9, metalness: 1, roughness: 0.2, envMapIntensity: 3 });
const system = new THREE.Group();
function ball(material, radius, position, parent) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  parent.add(mesh);
}
const ORBIT = 310;
const MOON_AT = 0.2 * Math.PI; // angle of the moon on its orbit
const tilt = new THREE.Group();
tilt.rotation.set(1.2, 0, 0.5);
const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(ORBIT, 15, 32, 360), mirror);
orbitRing.castShadow = true;
tilt.add(orbitRing);
ball(moonMaterial, 60, new THREE.Vector3(Math.cos(MOON_AT) * ORBIT, Math.sin(MOON_AT) * ORBIT, 0), tilt);
system.add(tilt);
ball(planetMaterial, 200, new THREE.Vector3(0, 0, 0), system);
system.position.set(-6, -8, 400);
system.scale.setScalar(0.88);
scene.add(system);

// ---------- light and ground ----------
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-300, 450, 1700);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -700;
sun.shadow.camera.right = 700;
sun.shadow.camera.top = 700;
sun.shadow.camera.bottom = -700;
sun.shadow.camera.far = 4000;
sun.shadow.radius = 9;
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
