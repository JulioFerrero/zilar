import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  HalfFloatType,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
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
  WebGLRenderTarget,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  BACKDROP_FRAGMENT,
  BACKDROP_VERTEX,
  DUST_FRAGMENT,
  DUST_VERTEX,
  FINISH_FRAGMENT,
  FINISH_VERTEX,
  STARS_FRAGMENT,
  STARS_VERTEX,
} from './shaders';

// The hero: the Zilar mark (silver planet, tilted orbit, gold moon) live in WebGL in deep space.
// A nebula haze and twinkling stars sit behind it, dust drifts along the orbit and glows gold
// where the moon has just passed, and the frame goes through bloom, lens fringing and film grain.
// Proportions match the icon in tools/brand-3d: planet 1, orbit 1.82, ring tube 0.14, moon 0.44.
const PLANET = 1;
const ORBIT = 1.82;
const RING = 0.142;
const MOON = 0.44;
const GAP_AHEAD = 0.9;
const GAP_BEHIND = 0.75;
const ORBIT_SPEED = 0.14; // radians per second: one orbit in about 45 s
const INTRO_SECONDS = 2.2;
const BACKDROP_DEPTH = 6;

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

// A small seeded generator, so the sky is the same on every visit.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function floats(count: number, fill: (index: number) => number): BufferAttribute {
  return new BufferAttribute(
    Float32Array.from({ length: count }, (_, index) => fill(index)),
    1,
  );
}

function additive(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, { value: unknown }>,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
}

// Most stars are faint and small; a few are bright enough to catch the bloom.
function starGeometry(count: number): BufferGeometry {
  const random = seeded(7);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    positions[index * 3] = (random() - 0.5) * 18;
    positions[index * 3 + 1] = (random() - 0.5) * 11;
    positions[index * 3 + 2] = -1.5 - random() * 4;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute(
    'aSize',
    floats(count, () => 0.7 + 2.4 * random() ** 3),
  );
  geometry.setAttribute(
    'aPhase',
    floats(count, () => random()),
  );
  geometry.setAttribute(
    'aBright',
    floats(count, () => 0.08 + 1.2 * random() ** 4),
  );
  return geometry;
}

// Dust in the orbit plane: a soft band around the ring, slower than the moon so it overtakes it.
function dustGeometry(count: number): BufferGeometry {
  const random = seeded(19);
  const spread = () => (random() + random() + random() - 1.5) / 1.5;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute(
    'aAngle',
    floats(count, () => random() * Math.PI * 2),
  );
  geometry.setAttribute(
    'aRadius',
    floats(count, () => ORBIT + spread() * 0.32),
  );
  geometry.setAttribute(
    'aHeight',
    floats(count, () => spread() * 0.09),
  );
  geometry.setAttribute(
    'aSize',
    floats(count, () => 0.6 + 2.2 * random() ** 2),
  );
  geometry.setAttribute(
    'aPhase',
    floats(count, () => random()),
  );
  geometry.setAttribute(
    'aSpeed',
    floats(count, () => 0.02 + random() * 0.09),
  );
  return geometry;
}

export type SceneOptions = { reducedMotion: boolean; onFirstFrame: () => void };

export async function startScene(canvas: HTMLCanvasElement, options: SceneOptions): Promise<void> {
  // phones get fewer particles and a lower pixel ratio: the post-processing runs per pixel
  const narrowAtStart = canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.85;
  const pixelRatio = Math.min(window.devicePixelRatio, narrowAtStart ? 1.5 : 1.75);
  const renderer = new WebGLRenderer({ canvas, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

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
  backdrop.position.z = -BACKDROP_DEPTH;
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  // ---------- stars ----------
  const starUniforms = {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uPixelRatio: { value: pixelRatio },
  };
  const stars = new Points(
    starGeometry(narrowAtStart ? 420 : 900),
    additive(STARS_VERTEX, STARS_FRAGMENT, starUniforms),
  );
  scene.add(stars);

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

  const dustUniforms = {
    uTime: { value: 0 },
    uMoon: { value: 0 },
    uPower: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uScale: { value: 1 },
  };
  const dust = new Points(
    dustGeometry(narrowAtStart ? 1100 : 2600),
    additive(DUST_VERTEX, DUST_FRAGMENT, dustUniforms),
  );
  // positions are computed in the vertex shader, so the bounds never match the buffer
  dust.frustumCulled = false;
  tilt.add(dust);
  scene.add(system);

  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(-3, 4, 6);
  scene.add(key);

  // ---------- post-processing ----------
  // a multisampled half-float target keeps edges smooth and highlights above 1 for the bloom,
  // whose threshold sits above 1 so only real highlights glow, never the whole metal
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
  );
  composer.setPixelRatio(pixelRatio);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.28, 0.35, 1.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finishUniforms = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  };
  // a material, not a shader object: ShaderPass would clone the uniforms of a plain object
  composer.addPass(
    new ShaderPass(
      new ShaderMaterial({
        uniforms: finishUniforms,
        vertexShader: FINISH_VERTEX,
        fragmentShader: FINISH_FRAGMENT,
      }),
    ),
  );

  // ---------- layout ----------
  const home = new Vector3();
  let homeScale = 1;
  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    finishUniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const narrow = camera.aspect < 0.85;
    // the mark sits to the right of the copy on wide screens and above it on phones
    home.set(narrow ? 0.1 : 2.15, narrow ? 0.95 : 0.05, 0);
    homeScale = narrow ? 0.46 : 0.64;
    dustUniforms.uScale.value = homeScale;
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

    // one orchestrated moment: space and its light come up while the camera settles
    backdropUniforms.uPower.value = intro;
    starUniforms.uPower.value = intro;
    dustUniforms.uPower.value = intro;
    scene.environmentIntensity = 0.72 * intro;
    key.intensity = 1.1 * intro;
    camera.position.z = options.reducedMotion ? 9 : MathUtils.lerp(11, 9, intro);

    // with reduced motion the frame is still: no orbit, no drift, no twinkle, no moving grain
    const time = options.reducedMotion ? 0 : elapsed;
    if (!options.reducedMotion) {
      orbit.rotation.z += dt * ORBIT_SPEED;
      backdropUniforms.uLight.value.lerp(lightTarget, 0.05);
    }
    backdropUniforms.uTime.value = time;
    starUniforms.uTime.value = time;
    dustUniforms.uTime.value = time;
    dustUniforms.uMoon.value = orbit.rotation.z;
    finishUniforms.uTime.value = time;

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
    // the stars sit far behind the mark, so they slide the other way: a little parallax
    stars.position.x = MathUtils.lerp(stars.position.x, -pointer.x * tiltAmount, 0.04);
    stars.position.y = MathUtils.lerp(stars.position.y, pointer.y * tiltAmount * 0.7, 0.04);

    composer.render(dt);
    if (first) {
      first = false;
      options.onFirstFrame();
    }
  });
}
