import {
  MathUtils,
  type PerspectiveCamera,
  type Scene,
  Timer,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Backdrop, Stars } from './backdrop';
import {
  INTRO_SECONDS,
  MIN_PIXEL_RATIO,
  NEBULA_SCALE,
  ORBIT_SPEED,
  SLOW_FRAME_SECONDS,
} from './config';
import type { Mark } from './mark';
import type { FinishUniforms } from './post';
import { easeOutCubic } from './textures';

export type SceneOptions = { reducedMotion: boolean; onFirstFrame: () => void };

export type LoopContext = {
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  composer: EffectComposer;
  camera: PerspectiveCamera;
  scene: Scene;
  options: SceneOptions;
  pixelRatio: number;
  backdrop: Backdrop;
  stars: Stars;
  mark: Mark;
  finishUniforms: FinishUniforms;
};

// Layout, input and the animation loop: everything that keeps ticking after setup.
export function startLoop(context: LoopContext): void {
  const {
    canvas,
    renderer,
    composer,
    camera,
    scene,
    options,
    backdrop,
    stars,
    mark,
    finishUniforms,
  } = context;
  let pixelRatio = context.pixelRatio;

  // ---------- layout ----------
  const home = new Vector3();
  let homeScale = 1;
  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    backdrop.target.setSize(
      Math.max(1, Math.round(width * NEBULA_SCALE)),
      Math.max(1, Math.round(height * NEBULA_SCALE)),
    );
    finishUniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const narrow = camera.aspect < 0.85;
    // the mark sits to the right of the copy on wide screens and above it on phones
    home.set(narrow ? 0.1 : 2.15, narrow ? 0.95 : 0.05, 0);
    homeScale = narrow ? 0.46 : 0.64;
    mark.dustUniforms.uScale.value = homeScale;
    backdrop.uniforms.uAspect.value = camera.aspect;
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

  // a machine that cannot keep up gets fewer pixels, one step at a time, never more effects cut
  let slowFrames = 0;
  let measuredFrames = 0;
  function adapt(frameSeconds: number): void {
    if (pixelRatio <= MIN_PIXEL_RATIO || frameSeconds > 0.25) return;
    measuredFrames += 1;
    if (frameSeconds > SLOW_FRAME_SECONDS) slowFrames += 1;
    if (measuredFrames < 90) return;
    if (slowFrames > measuredFrames / 2) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      stars.uniforms.uPixelRatio.value = pixelRatio;
      mark.dustUniforms.uPixelRatio.value = pixelRatio;
      resize();
    }
    slowFrames = 0;
    measuredFrames = 0;
  }

  renderer.setAnimationLoop(() => {
    timer.update();
    const frameSeconds = timer.getDelta();
    const dt = Math.min(frameSeconds, 0.05);
    if (!visible || document.hidden) return;
    elapsed += dt;
    if (elapsed > INTRO_SECONDS) adapt(frameSeconds);
    const intro = options.reducedMotion ? 1 : easeOutCubic(Math.min(1, elapsed / INTRO_SECONDS));

    // one orchestrated moment: space and its light come up while the camera settles
    backdrop.uniforms.uPower.value = intro;
    stars.uniforms.uPower.value = intro;
    mark.dustUniforms.uPower.value = intro;
    mark.halo.material.opacity = 0.22 * intro;
    scene.environmentIntensity = 0.72 * intro;
    mark.key.intensity = 1.1 * intro;
    camera.position.z = options.reducedMotion ? 9 : MathUtils.lerp(11, 9, intro);

    // with reduced motion the frame is still: no orbit, no drift, no twinkle, no moving grain
    const time = options.reducedMotion ? 0 : elapsed;
    if (!options.reducedMotion) {
      mark.orbit.rotation.z += dt * ORBIT_SPEED;
      backdrop.uniforms.uLight.value.lerp(lightTarget, 0.05);
    }
    backdrop.uniforms.uTime.value = time;
    stars.uniforms.uTime.value = time;
    mark.dustUniforms.uTime.value = time;
    mark.dustUniforms.uMoon.value = mark.orbit.rotation.z;
    finishUniforms.uTime.value = time;

    // the pointer tilts the mark a little; scrolling lifts it out of the hero
    const scroll = Math.min(1, window.scrollY / Math.max(1, canvas.clientHeight));
    const tiltAmount = options.reducedMotion ? 0 : 0.14;
    mark.system.rotation.x = MathUtils.lerp(
      mark.system.rotation.x,
      pointer.y * tiltAmount + scroll * 0.35,
      0.06,
    );
    mark.system.rotation.y = MathUtils.lerp(mark.system.rotation.y, pointer.x * tiltAmount, 0.06);
    mark.system.position.set(home.x, home.y + scroll * 1.6, home.z);
    mark.system.scale.setScalar(homeScale);
    // the stars sit far behind the mark, so they slide the other way: a little parallax
    stars.points.position.x = MathUtils.lerp(
      stars.points.position.x,
      -pointer.x * tiltAmount,
      0.04,
    );
    stars.points.position.y = MathUtils.lerp(
      stars.points.position.y,
      pointer.y * tiltAmount * 0.7,
      0.04,
    );

    renderer.setRenderTarget(backdrop.target);
    renderer.render(backdrop.scene, backdrop.camera);
    renderer.setRenderTarget(null);
    composer.render(dt);
    if (first) {
      first = false;
      options.onFirstFrame();
    }
  });
}
