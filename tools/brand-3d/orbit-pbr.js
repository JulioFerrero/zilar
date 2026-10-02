import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": a big silver sphere with a small one on a tilted orbit (the earth and its moon),
// modern PBR: scanned ambientCG metals and a Poly Haven studio HDRI on the black key.
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

// real studio lighting: a Poly Haven HDRI (CC0) instead of hand-placed softboxes
const HDRI = params.get('hdri') ?? 'studio_small_09_2k.hdr';
const hdr = await new RGBELoader().loadAsync(`./textures/${HDRI}`);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(hdr).texture;
pmrem.dispose();
hdr.dispose();

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
// ambientCG PBR sets (CC0): colour, roughness, metalness and normal maps from scanned metal
const loader = new THREE.TextureLoader();
async function pbr(name, repeat) {
  const load = async (suffix, srgb) => {
    const texture = await loader.loadAsync(`./textures/${name}/${name}_2K-JPG_${suffix}.jpg`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const [map, roughnessMap, metalnessMap, normalMap] = await Promise.all([
    load('Color', true),
    load('Roughness', false),
    load('Metalness', false),
    load('NormalGL', false),
  ]);
  return { map, roughnessMap, metalnessMap, normalMap };
}

const keyShape = roundedSquare(824, 190);
const key = new THREE.Mesh(
  smoothExtrude(keyShape, 60, 30),
  new THREE.MeshPhysicalMaterial({
    ...(await pbr('Metal009', [1 / 700, 1 / 700])),
    color: 0x2a2a30,
    metalness: 1,
    roughness: 1,
    envMapIntensity: 0.9,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- a big silver sphere and a small one in orbit, like the earth and the moon ----------
const silverMaps = (repeat) => pbr('Metal011', repeat);
const planetMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([3, 2])),
  color: 0xffffff,
  metalness: 1,
  roughness: 0.55,
  envMapIntensity: 2.4,
});
const moonMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([1.5, 1])),
  color: 0xffffff,
  metalness: 1,
  roughness: 0.3,
  envMapIntensity: 2.6,
});
const ringMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([14, 2])),
  color: 0xffffff,
  metalness: 1,
  roughness: 0.5,
  envMapIntensity: 2.4,
});
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
const MOON_RADIUS = 60;
const RING_TUBE = 15;
// the ring stops short of the moon on both sides, so the two never intersect
const GAP = (MOON_RADIUS + RING_TUBE + 16) / ORBIT;
const orbitRing = new THREE.Mesh(
  new THREE.TorusGeometry(ORBIT, RING_TUBE, 32, 360, Math.PI * 2 - 2 * GAP),
  ringMaterial,
);
orbitRing.rotation.z = MOON_AT + GAP;
orbitRing.castShadow = true;
tilt.add(orbitRing);
for (const end of [MOON_AT + GAP, MOON_AT - GAP]) {
  ball(ringMaterial, RING_TUBE, new THREE.Vector3(Math.cos(end) * ORBIT, Math.sin(end) * ORBIT, 0), tilt);
}
ball(moonMaterial, MOON_RADIUS, new THREE.Vector3(Math.cos(MOON_AT) * ORBIT, Math.sin(MOON_AT) * ORBIT, 0), tilt);
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
