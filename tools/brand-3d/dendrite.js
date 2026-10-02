import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": a single native-silver dendrite (branches of stacked
// octahedra, as real silver grows) on the black key.
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
const key = new THREE.Mesh(
  smoothExtrude(roundedSquare(824, 190), 60, 30),
  new THREE.MeshPhysicalMaterial({
    color: 0x1a1a1d,
    metalness: 0.9,
    roughness: 0.5,
    envMapIntensity: 0.15,
    clearcoat: 0.3,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- native silver: a dendrite, branches built from stacked octahedra ----------
const silver = new THREE.MeshStandardMaterial({
  color: 0xe4e7ec,
  metalness: 1,
  roughness: 0.28,
  flatShading: true,
  envMapIntensity: 2,
});
const rnd = rand(5);
const dendrite = new THREE.Group();
const Z = new THREE.Vector3(0, 0, 1);
const unit = new THREE.OctahedronGeometry(1, 0);

function rotateAround(dir, axis, angle) {
  return dir.clone().applyAxisAngle(axis, angle).normalize();
}
function branch(start, dir, size, steps, depth) {
  const pos = start.clone();
  let heading = dir.clone();
  for (let i = 0; i < steps; i++) {
    const length = size * (1.5 + rnd() * 0.4);
    const mesh = new THREE.Mesh(unit, silver);
    mesh.scale.set(size * 0.8, size * 0.8, length * 0.7);
    mesh.quaternion.setFromUnitVectors(Z, heading);
    mesh.rotateZ(rnd() * Math.PI);
    mesh.position.copy(pos).addScaledVector(heading, length * 0.5);
    mesh.castShadow = true;
    dendrite.add(mesh);
    pos.addScaledVector(heading, length * 0.8);
    const roll = new THREE.Vector3().crossVectors(heading, new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    heading = rotateAround(heading, roll, (rnd() - 0.5) * 0.28);
    size *= 0.93;
    if (depth > 0 && i >= 1 && i < steps - 1) {
      const side = new THREE.Vector3().crossVectors(heading, new THREE.Vector3(0, 0, 1)).normalize();
      for (const sign of [-1, 1]) {
        const spin = rotateAround(side, heading, (rnd() - 0.5) * 0.5);
        const out = rotateAround(heading, spin, sign * (Math.PI / 3 + (rnd() - 0.5) * 0.3));
        branch(pos, out, size * 0.86, Math.max(3, Math.round(steps * 0.62)), depth - 1);
      }
    }
  }
}
branch(new THREE.Vector3(-3.4, -4, 0), new THREE.Vector3(0.42, 0.9, 0.1).normalize(), 0.95, 9, 2);

const bounds = new THREE.Box3().setFromObject(dendrite);
const extent = bounds.getSize(new THREE.Vector3());
const fit = 600 / Math.max(extent.x, extent.y);
dendrite.scale.setScalar(fit);
dendrite.position.copy(bounds.getCenter(new THREE.Vector3()).multiplyScalar(-fit));
const holder = new THREE.Group();
holder.add(dendrite);
holder.rotation.set(-0.35, -0.3, 0.05);
holder.position.set(0, 0, 200);
scene.add(holder);

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
