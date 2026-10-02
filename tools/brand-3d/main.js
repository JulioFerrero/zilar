import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon in 3D: a silver planet crossed by a polished rod, with a small gold moon at the rod's end,
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
const rodMaterial = new THREE.MeshStandardMaterial({
  ...(await silverMaps([2, 8])),
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
    '#include <project_vertex>\n  gl_Position.z += 0.0008 * gl_Position.w;',
  );
};
const HALO = 11; // the white gap that separates the parts in the monochrome mark
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
const PLANET_RADIUS = 215;
const MOON_RADIUS = 52;
const ROD_RADIUS = 15;
// the rod and the moon float in front of the planet, so nothing ever intersects the planet
const ROD_Z = PLANET_RADIUS + 45;
const ROD_START = new THREE.Vector3(-262, -218, ROD_Z);
const MOON_AT = new THREE.Vector3(262, 244, ROD_Z);
// the rod stops short of the moon, so the two never touch
const ROD_END = MOON_AT.clone().sub(
  new THREE.Vector3().subVectors(MOON_AT, ROD_START).setLength(MOON_RADIUS + 26),
);

function cylinderBetween(from, to, radius, material) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 64),
    material,
  );
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}
const rod = cylinderBetween(ROD_START, ROD_END, ROD_RADIUS, MONO ? INK : rodMaterial);
rod.castShadow = true;
if (!ONLY_MOON) system.add(rod);
if (MONO && !ONLY_MOON) {
  const halo = cylinderBetween(ROD_START, ROD_END, ROD_RADIUS + HALO, PAPER);
  system.add(halo);
}
ball(rodMaterial, ROD_RADIUS, ROD_START, system);
ball(rodMaterial, ROD_RADIUS, ROD_END, system);
ball(moonMaterial, MOON_RADIUS, MOON_AT, system, 'moon');
ball(planetMaterial, PLANET_RADIUS, new THREE.Vector3(0, 0, 0), system);
system.position.set(-4, -6, 250);
system.scale.setScalar(LAYER === 'foreground' || MONO ? 0.84 : 0.92);
if (LAYER !== 'background') scene.add(system);

// ---------- light and ground ----------
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-220, 330, 1700);
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
