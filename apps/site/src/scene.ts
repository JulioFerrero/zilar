import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Timer,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// The hero: the Zilar mark (silver planet, tilted orbit, gold moon) live in WebGL, lit in a dark
// photo studio whose key light drifts a little with the pointer. Proportions match the icon
// in tools/brand-3d: planet 1, orbit 1.82, ring tube 0.14, moon 0.44.
const PLANET = 1;
const ORBIT = 1.82;
const RING = 0.142;
const MOON = 0.44;
const GAP_AHEAD = 0.9;
const GAP_BEHIND = 0.75;
const ORBIT_SPEED = 0.14; // radians per second: one orbit in about 45 s
const INTRO_SECONDS = 2.2;

const BACKDROP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A seamless photo-studio sweep: a soft pool of key light behind the mark, a faint band where the
// floor curves up into the wall, and darkness everywhere else. No texture, only light.
const BACKDROP_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uLight;
  uniform float uPower;
  uniform float uAspect;
  uniform float uTime;

  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    vec2 light = vec2((uLight.x - 0.5) * uAspect, uLight.y - 0.5);
    vec2 d = q - light;
    float pool = exp(-dot(d, d) * 2.2);
    float core = exp(-dot(d, d) * 9.0);
    float sweep = exp(-pow((q.y + 0.24) * 5.5, 2.0)) * exp(-d.x * d.x * 0.9);
    vec3 col = vec3(0.006, 0.006, 0.008);
    col += vec3(0.060, 0.062, 0.069) * pool;
    col += vec3(0.040, 0.041, 0.045) * core;
    col += vec3(0.022, 0.022, 0.025) * sweep;
    col *= smoothstep(1.25, 0.15, length(q * vec2(0.8, 1.1)));
    col *= uPower;
    col += (hash2(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

type Maps = { map: Texture; roughnessMap: Texture; normalMap: Texture };

function withRepeat(maps: Maps, x: number, y: number): Maps {
  const copy = (texture: Texture) => {
    const clone = texture.clone();
    clone.wrapS = RepeatWrapping;
    clone.wrapT = RepeatWrapping;
    clone.repeat.set(x, y);
    clone.needsUpdate = true;
    return clone;
  };
  return {
    map: copy(maps.map),
    roughnessMap: copy(maps.roughnessMap),
    normalMap: copy(maps.normalMap),
  };
}

async function loadSilver(loader: TextureLoader): Promise<Maps> {
  const [map, roughnessMap, normalMap] = await Promise.all([
    loader.loadAsync('/textures/silver-color.jpg'),
    loader.loadAsync('/textures/silver-roughness.jpg'),
    loader.loadAsync('/textures/silver-normal.jpg'),
  ]);
  map.colorSpace = SRGBColorSpace;
  return { map, roughnessMap, normalMap };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export type SceneOptions = { reducedMotion: boolean; onFirstFrame: () => void };

export async function startScene(canvas: HTMLCanvasElement, options: SceneOptions): Promise<void> {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);

  const [silver, hdr] = await Promise.all([
    loadSilver(new TextureLoader()),
    new HDRLoader().loadAsync('/textures/studio.hdr'),
  ]);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  hdr.dispose();

  // ---------- backdrop ----------
  const backdropUniforms = {
    uLight: { value: new Vector2(0.74, 0.55) },
    uPower: { value: 0 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  };
  const backdrop = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({
      uniforms: backdropUniforms,
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
    }),
  );
  const BACKDROP_DEPTH = 6;
  backdrop.position.z = -BACKDROP_DEPTH;
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  // ---------- the mark ----------
  const planetMaterial = new MeshStandardMaterial({
    ...withRepeat(silver, 3, 2),
    color: 0xffffff,
    metalness: 1,
    roughness: 0.55,
    envMapIntensity: 2.4,
  });
  const ringMaterial = new MeshStandardMaterial({
    ...withRepeat(silver, 14, 2),
    color: 0xffffff,
    metalness: 1,
    roughness: 0.5,
    envMapIntensity: 2.4,
  });
  const moonMaterial = new MeshStandardMaterial({
    ...withRepeat(silver, 1.5, 1),
    color: 0xf0b445,
    metalness: 1,
    roughness: 0.3,
    envMapIntensity: 2.6,
  });

  const system = new Group();
  const spin = new Group();
  spin.rotation.z = 0.72;
  const tilt = new Group();
  tilt.rotation.x = 1.15;
  const orbit = new Group();
  tilt.add(orbit);
  spin.add(tilt);
  system.add(spin);
  system.add(new Mesh(new SphereGeometry(PLANET, 128, 96), planetMaterial));

  const ring = new Mesh(
    new TorusGeometry(ORBIT, RING, 48, 360, Math.PI * 2 - GAP_AHEAD - GAP_BEHIND),
    ringMaterial,
  );
  ring.rotation.z = GAP_AHEAD;
  orbit.add(ring);
  for (const end of [GAP_AHEAD, -GAP_BEHIND]) {
    const cap = new Mesh(new SphereGeometry(RING, 32, 24), ringMaterial);
    cap.position.set(Math.cos(end) * ORBIT, Math.sin(end) * ORBIT, 0);
    orbit.add(cap);
  }
  const moon = new Mesh(new SphereGeometry(MOON, 96, 64), moonMaterial);
  moon.position.set(ORBIT, 0, 0);
  orbit.add(moon);
  scene.add(system);

  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(-3, 4, 6);
  scene.add(key);

  // ---------- layout ----------
  const home = new Vector3();
  let homeScale = 1;
  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const narrow = camera.aspect < 0.85;
    // the mark sits to the right of the copy on wide screens and above it on phones
    home.set(narrow ? 0.1 : 2.15, narrow ? 0.95 : 0.05, 0);
    homeScale = narrow ? 0.46 : 0.64;
    const viewHeight =
      2 * Math.tan(MathUtils.degToRad(camera.fov / 2)) * (camera.position.z + BACKDROP_DEPTH);
    backdrop.scale.set(viewHeight * camera.aspect * 1.2, viewHeight * 1.2, 1);
    backdropUniforms.uAspect.value = camera.aspect;
  }

  // ---------- input ----------
  const pointer = new Vector2(0, 0);
  const lightTarget = new Vector2(0.74, 0.55);
  window.addEventListener(
    'pointermove',
    (event) => {
      pointer.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        (event.clientY / window.innerHeight) * 2 - 1,
      );
      lightTarget.set(0.74 + pointer.x * 0.06, 0.55 - pointer.y * 0.05);
    },
    { passive: true },
  );

  // ---------- loop ----------
  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(canvas);

  const timer = new Timer();
  let elapsed = 0;
  let first = true;
  camera.position.set(0, 0, options.reducedMotion ? 9 : 11);
  resize();
  window.addEventListener('resize', resize);

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    if (!visible || document.hidden) return;
    elapsed += dt;
    const intro = options.reducedMotion ? 1 : easeOutCubic(Math.min(1, elapsed / INTRO_SECONDS));

    // one orchestrated moment: the studio lights come up while the camera settles
    backdropUniforms.uPower.value = intro;
    scene.environmentIntensity = intro;
    key.intensity = 1.1 * intro;
    camera.position.z = options.reducedMotion ? 9 : MathUtils.lerp(11, 9, intro);

    if (!options.reducedMotion) {
      orbit.rotation.z += dt * ORBIT_SPEED;
      backdropUniforms.uLight.value.lerp(lightTarget, 0.05);
    }
    backdropUniforms.uTime.value = elapsed;

    // the pointer tilts the mark a little; scrolling lifts it out of the hero
    const scroll = Math.min(1, window.scrollY / Math.max(1, canvas.clientHeight));
    const tiltAmount = options.reducedMotion ? 0 : 0.14;
    system.rotation.x = MathUtils.lerp(
      system.rotation.x,
      pointer.y * tiltAmount + scroll * 0.35,
      0.06,
    );
    system.rotation.y = MathUtils.lerp(system.rotation.y, pointer.x * tiltAmount, 0.06);
    system.position.set(home.x, home.y + scroll * 1.6, home.z);
    system.scale.setScalar(homeScale);

    renderer.render(scene, camera);
    if (first) {
      first = false;
      options.onFirstFrame();
    }
  });
}
