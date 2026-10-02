import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon in 3D: a silver planet with a tilted orbit ring and a small gold moon on it,
// on a black brushed-metal key. Physically based: scanned ambientCG metals and a Poly Haven studio HDRI.
// `?render=1` draws one transparent front-facing frame for render.sh; without it the scene is interactive.

const params = new URLSearchParams(location.search);
const RENDER = params.get('render') === '1';
// full: the icon with its drop shadow; bleed: key fills the canvas (stores, maskable); foreground / background:
// the two Android adaptive layers; mono: flat black on white with knock-out gaps, to trace into an SVG
const LAYER = params.get('layer') ?? 'full';
const MONO = LAYER.startsWith('mono');
// mono-moon / mono-rest split the mark in two, so the favicon can colour the moon
const ONLY_MOON = LAYER === 'mono-moon';
const NO_MOON = LAYER === 'mono-rest';
const BLEED = LAYER === 'bleed' || LAYER === 'background';
const SIZE = RENDER ? 1024 : Math.min(innerWidth, innerHeight);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(RENDER ? devicePixelRatio : Math.min(devicePixelRatio, 2));
renderer.setSize(RENDER ? SIZE : innerWidth, RENDER ? SIZE : innerHeight);
renderer.setClearColor(MONO ? 0xffffff : 0x000000, RENDER && !MONO ? 0 : 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = MONO ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
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
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
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

const keyShape = BLEED ? roundedSquare(1500, 1) : roundedSquare(824, 190);
const key = new THREE.Mesh(
  smoothExtrude(keyShape, 60, 30),
  new THREE.MeshPhysicalMaterial({
    ...(await pbr('Metal009', [1 / 700, 1 / 700])),
    color: 0x1c1c21,
    metalness: 1,
    roughness: 1,
    envMapIntensity: 0.9,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
if (LAYER !== 'foreground' && !MONO) scene.add(key);

// ---------- a big silver sphere and a small one in orbit, like the earth and the moon ----------
const silverMaps = (repeat) => pbr('Metal011', repeat);
const planetMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([3, 2])),
  color: 0xffffff,
  metalness: 1,
  roughness: 0.55,
  envMapIntensity: 2.4,
});
// the moon is warm gold, so it stands apart from the silver planet even at small sizes
const moonMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([1.5, 1])),
  color: 0xf0b445,
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
const INK = new THREE.MeshBasicMaterial({ color: 0x000000 });
// halos are pushed back in depth, so each one cuts a gap into what lies behind its part but never covers the part itself
const PAPER = new THREE.MeshBasicMaterial({ color: 0xffffff });
PAPER.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    '#include <project_vertex>\n  gl_Position.z += 0.0018 * gl_Position.w;',
  );
};
const HALO = 15; // the white gap that separates the parts in the monochrome mark
function ball(material, radius, position, parent, part = 'body') {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), MONO ? INK : material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  const hidden = (ONLY_MOON && part !== 'moon') || (NO_MOON && part === 'moon');
  if (!hidden) parent.add(mesh);
  if (MONO && !ONLY_MOON) {
    const halo = new THREE.Mesh(new THREE.SphereGeometry(radius + HALO, 128, 96), PAPER);
    halo.position.copy(position);
    parent.add(halo);
  }
}
const PLANET_RADIUS = 190;
const ORBIT = 345;
const MOON_AT = 0; // angle of the moon on its orbit: upper right, where the ring runs across the screen so the gap around the moon stays visible
const tilt = new THREE.Group();
tilt.rotation.x = 1.15; // lays the circle down into a thin ellipse
const spin = new THREE.Group();
spin.rotation.z = 0.72; // and turns that ellipse onto the diagonal
const MOON_RADIUS = 84;
const RING_TUBE = 27;
// the ring stops short of the moon on both sides. The orbit is tilted, so a gap in the ring plane
// shrinks to about half on screen: this angle leaves a clear gap there, not just in 3D
const GAP_AHEAD = 0.9; // angle left free on the upper-left side of the moon
const GAP_BEHIND = 0.75; // and on the lower-right side
const orbitRing = new THREE.Mesh(
  new THREE.TorusGeometry(ORBIT, RING_TUBE, 32, 360, Math.PI * 2 - GAP_AHEAD - GAP_BEHIND),
  ringMaterial,
);
orbitRing.rotation.z = MOON_AT + GAP_AHEAD;
orbitRing.castShadow = true;
if (MONO) {
  orbitRing.material = INK;
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(ORBIT, RING_TUBE + HALO, 32, 360, Math.PI * 2 - GAP_AHEAD - GAP_BEHIND),
    PAPER,
  );
  halo.rotation.z = orbitRing.rotation.z;
  if (!ONLY_MOON) tilt.add(halo);
}
if (!ONLY_MOON) tilt.add(orbitRing);
for (const end of [MOON_AT + GAP_AHEAD, MOON_AT - GAP_BEHIND]) {
  ball(
    ringMaterial,
    RING_TUBE,
    new THREE.Vector3(Math.cos(end) * ORBIT, Math.sin(end) * ORBIT, 0),
    tilt,
  );
}
ball(
  moonMaterial,
  MOON_RADIUS,
  new THREE.Vector3(Math.cos(MOON_AT) * ORBIT, Math.sin(MOON_AT) * ORBIT, 0),
  tilt,
  'moon',
);
spin.add(tilt);
system.add(spin);
ball(planetMaterial, PLANET_RADIUS, new THREE.Vector3(0, 0, 0), system);
system.position.set(-4, -6, 390);
system.scale.setScalar(LAYER === 'foreground' || MONO ? 0.8 : 0.88);
if (LAYER !== 'background') scene.add(system);

// ---------- light and ground ----------
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-170, 250, 1700);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -700;
sun.shadow.camera.right = 700;
sun.shadow.camera.top = 700;
sun.shadow.camera.bottom = -700;
sun.shadow.camera.far = 4000;
sun.shadow.radius = 14;
sun.shadow.intensity = 0.55;
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
