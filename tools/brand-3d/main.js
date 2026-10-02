import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Zilar icon in 3D: a brushed-silver speech bubble set on a black anodized key.
// `?render=1` draws one transparent front-facing frame for the PNG export
// (see render.sh); without it the scene is interactive.

const params = new URLSearchParams(location.search);
const RENDER = params.get('render') === '1';
const SIZE = RENDER ? 1024 : Math.min(innerWidth, innerHeight);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(RENDER ? devicePixelRatio : Math.min(devicePixelRatio, 2));
renderer.setSize(RENDER ? SIZE : innerWidth, RENDER ? SIZE : innerHeight);
renderer.setClearColor(0x000000, RENDER ? 0 : 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
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
const FOV = (2 * Math.atan(512 / DIST) * 180) / Math.PI; // plane z=0 spans 1024 units
const camera = new THREE.PerspectiveCamera(FOV, RENDER ? 1 : innerWidth / innerHeight, 100, 10000);
camera.position.set(0, 0, DIST);

// ---------- studio environment: softboxes seen in the metal ----------
function buildEnvironment() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0a0b0d);
  const panel = (w, h, x, y, z, color, power) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(power),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(22, 9, -7, 10, 12, '#ffffff', 10); // large soft key light, upper left
  panel(3, 18, 13, 1, 8, '#cfe0ff', 5); // cool strip on the right
  panel(18, 3, 0, -10, 10, '#ffe2bd', 2.4); // warm fill from below
  panel(10, 10, -12, -4, 6, '#8fa6c4', 1.2); // dim blue bounce on the left
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ color: 0x15171a, side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  return target.texture;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 1.0;

// ---------- procedural textures ----------
function canvasTexture(size, draw, { srgb = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function rand(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// brushed roughness: long horizontal streaks of varying roughness
const brushRough = canvasTexture(2048, (ctx, size) => {
  const r = rand(11);
  ctx.fillStyle = 'rgb(96,96,96)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const y = r() * size;
    const x = r() * size;
    const len = 80 + r() * 700;
    const g = 40 + r() * 120;
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.1 + r() * 0.35})`;
    ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (r() - 0.5) * 1.2);
    ctx.stroke();
  }
});
brushRough.repeat.set(1 / 1600, 1 / 1600);
brushRough.offset.set(0.5, 0.5);

// the same streaks as a faint bump, so the light breaks along the grain
const brushBump = canvasTexture(1024, (ctx, size) => {
  const r = rand(29);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const y = r() * size;
    const x = r() * size;
    const g = 90 + r() * 90;
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.15 + r() * 0.3})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 60 + r() * 400, y);
    ctx.stroke();
  }
});
brushBump.repeat.set(1 / 1400, 1 / 1400);
brushBump.offset.set(0.5, 0.5);

// a soft dome: normals fan out from the middle so the flat face has a reflection gradient
const BUBBLE = { w: 564, h: 444, cy: 32 };
const domeNormal = canvasTexture(512, (ctx, size) => {
  const image = ctx.createImageData(size, size);
  const k = 0.85;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px / (size - 1)) * 2 - 1;
      const v = 1 - (py / (size - 1)) * 2;
      let nx = 4 * u * u * u * k;
      let ny = 4 * v * v * v * k;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (py * size + px) * 4;
      image.data[i] = (nx * 0.5 + 0.5) * 255;
      image.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
});
domeNormal.wrapS = domeNormal.wrapT = THREE.ClampToEdgeWrapping;
domeNormal.repeat.set(1 / BUBBLE.w, 1 / BUBBLE.h);
domeNormal.offset.set(0.5, 0.5 - BUBBLE.cy / BUBBLE.h);

// anodized grain for the key
const keyGrain = canvasTexture(512, (ctx, size) => {
  const r = rand(5);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const g = 105 + r() * 70;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = g;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
});
keyGrain.repeat.set(1 / 1400, 1 / 1400);
keyGrain.offset.set(0.5, 0.5);

// ---------- geometry (units are the 1024-px icon canvas, y up) ----------
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

function bubbleShape() {
  // the SVG outline, re-centred on the canvas and flipped to y-up
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

function bevelled(shape, depth, bevel, segments) {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: segments,
    curveSegments: 72,
  });
  // share vertices so the bevel and the curved corners shade smoothly
  raw.deleteAttribute('normal');
  const smooth = mergeVertices(raw, 0.01);
  smooth.computeVertexNormals();
  return smooth;
}

// ---------- the key ----------
const KEY_DEPTH = 60;
const KEY_BEVEL = 30;
const key = new THREE.Mesh(
  bevelled(roundedSquare(824, 190), KEY_DEPTH, KEY_BEVEL, 16),
  new THREE.MeshPhysicalMaterial({
    color: 0x242427,
    metalness: 0.9,
    roughness: 0.5,
    roughnessMap: keyGrain,
    bumpMap: keyGrain,
    bumpScale: 0.6,
    envMapIntensity: 1.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
  }),
);
key.castShadow = true;
key.receiveShadow = true;
scene.add(key);
const KEY_TOP = KEY_DEPTH + KEY_BEVEL;

// ---------- the silver bubble ----------
const BUBBLE_DEPTH = 34;
const BUBBLE_BEVEL = 18;
const bubble = new THREE.Mesh(
  bevelled(bubbleShape(), BUBBLE_DEPTH, BUBBLE_BEVEL, 14),
  new THREE.MeshPhysicalMaterial({
    color: 0xdfe4ea,
    metalness: 1,
    roughness: 0.95,
    roughnessMap: brushRough,
    normalMap: domeNormal,
    normalScale: new THREE.Vector2(1, 1),
    bumpMap: brushBump,
    bumpScale: 0.9,
    anisotropy: 0.7,
    anisotropyRotation: 0,
    envMapIntensity: 1.25,
  }),
);
bubble.position.z = KEY_TOP - 6;
bubble.castShadow = true;
bubble.receiveShadow = true;
scene.add(bubble);

// ---------- lights and shadows ----------
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-700, 900, 1400);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -700;
sun.shadow.camera.right = 700;
sun.shadow.camera.top = 700;
sun.shadow.camera.bottom = -700;
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 4000;
sun.shadow.radius = 9;
sun.shadow.blurSamples = 25;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8890a0, 0.18));

// ---------- controls and loop ----------
if (RENDER) {
  renderer.render(scene, camera);
  document.title = 'rendered';
} else {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 40);
  controls.minDistance = 1200;
  controls.maxDistance = 6000;
  addEventListener('dblclick', () => {
    camera.position.set(0, 0, DIST);
    controls.target.set(0, 0, 40);
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
