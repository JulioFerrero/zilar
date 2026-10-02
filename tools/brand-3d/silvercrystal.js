import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon, variant "native silver": a single native-silver crystal (a truncated octahedron,
// like the magnetite mark) on the black key.
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
    envMapIntensity: 0.4,
    clearcoat: 0.3,
  }),
);
key.position.z = -60;
key.receiveShadow = true;
scene.add(key);

// ---------- one silver crystal: a truncated octahedron with mirror facets ----------
function crystalGeometry() {
  const points = [];
  const base = [0, 1, 2];
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of perms) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          points.push(new THREE.Vector3(base[p[0]] * sx, base[p[1]] * sy, base[p[2]] * sz));
        }
      }
    }
  }
  const unique = points.filter((p, i) => points.findIndex((q) => q.equals(p)) === i);
  return new THREE.BufferGeometry().copy(new ConvexGeometry(unique));
}
const silver = new THREE.MeshStandardMaterial({
  color: 0xf4f6f9,
  metalness: 1,
  roughness: 0.1,
  flatShading: true,
  envMapIntensity: 2.4,
});
const crystal = new THREE.Mesh(crystalGeometry(), silver);
crystal.scale.setScalar(108);
crystal.rotation.set(0.62, 0.52, 0.18);
crystal.position.set(0, 10, 260);
crystal.castShadow = true;
scene.add(crystal);

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
