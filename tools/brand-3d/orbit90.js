import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": a mirror-chrome sphere with a small one on a tilted orbit, raytracer style on the black key.
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

// 90s raytracer look: the mirror reflects a sunset sky over an endless checkerboard floor
function buildEnvironment() {
  const env = new THREE.Scene();
  const sky = document.createElement('canvas');
  sky.width = 8;
  sky.height = 512;
  const g = sky.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#071436');
  gradient.addColorStop(0.35, '#2f5fd0');
  gradient.addColorStop(0.5, '#ffd9a3');
  gradient.addColorStop(0.5, '#ffd9a3');
  gradient.addColorStop(1, '#2a1f1c');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 8, 512);
  const skyTexture = new THREE.CanvasTexture(sky);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(70, 64, 32),
      new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, color: new THREE.Color(1.6, 1.6, 1.6) }),
    ),
  );
  const checker = document.createElement('canvas');
  checker.width = checker.height = 128;
  const c = checker.getContext('2d');
  c.fillStyle = '#f4f4f4';
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = '#16161a';
  c.fillRect(0, 0, 64, 64);
  c.fillRect(64, 64, 64, 64);
  const checkerTexture = new THREE.CanvasTexture(checker);
  checkerTexture.colorSpace = THREE.SRGBColorSpace;
  checkerTexture.wrapS = checkerTexture.wrapT = THREE.RepeatWrapping;
  checkerTexture.repeat.set(14, 14);
  checkerTexture.anisotropy = 8;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshBasicMaterial({ map: checkerTexture, color: new THREE.Color(1.5, 1.5, 1.5) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  env.add(floor);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 11, 7) }));
  sun.position.set(-22, 18, 38);
  env.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0);
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
const keyShape = roundedSquare(824, 190);
const key = new THREE.Mesh(
  smoothExtrude(keyShape, 60, 30),
  new THREE.MeshPhysicalMaterial({
    color: 0x0a1030,
    metalness: 0.2,
    roughness: 0.2,
    envMapIntensity: 0.12,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- a big silver sphere and a small one in orbit, like the earth and the moon ----------
const mirror = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0, envMapIntensity: 1.1 });
const planetMaterial = mirror;
const moonMaterial = mirror;

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
