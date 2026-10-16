import {
  MathUtils,
  type PerspectiveCamera,
  type Scene,
  Timer,
  Vector2,
  type WebGLRenderer,
} from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Backdrop, Stars } from './backdrop';
import {
  INTRO_SECONDS,
  MIN_PIXEL_RATIO,
  NEBULA_SCALE,
  ORBIT,
  ORBIT_SPEED,
  SLOW_FRAME_SECONDS,
} from './config';
import type { Mark } from './mark';
import type { FinishUniforms } from './post';
import { createStations } from './stations';
import { easeOutCubic } from './textures';

export type SceneOptions = { reducedMotion: boolean };

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
  const stationAt = createStations();

  // Where the mark is now, in station units: eased towards the scroll target every frame.
  const current = { cx: 0, cy: 0, size: 0.7, o: 0 };
  let positioned = false;

  // ---------- layout ----------
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
  let orbitAngle = 0;
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
      orbitAngle += dt * ORBIT_SPEED;
      backdrop.uniforms.uLight.value.lerp(lightTarget, 0.05);
    }
    // the moon also travels with the scroll, so uMoon and the gold dust trail follow
    mark.orbit.rotation.z = orbitAngle + window.scrollY * 0.0012;
    backdrop.uniforms.uTime.value = time;
    stars.uniforms.uTime.value = time;
    mark.dustUniforms.uTime.value = time;
    mark.dustUniforms.uMoon.value = mark.orbit.rotation.z;
    finishUniforms.uTime.value = time;

    // the mark glides between stations as you scroll; the canvas fades with the station's opacity
    const target = stationAt(window.scrollY, camera.aspect);
    const ease = 1 - 0.0008 ** dt;
    if (!positioned) {
      current.cx = target.cx;
      current.cy = target.cy;
      current.size = target.size;
      positioned = true;
    }
    current.cx += (target.cx - current.cx) * ease;
    current.cy += (target.cy - current.cy) * ease;
    current.size += (target.size - current.size) * ease;
    current.o += (target.o * intro - current.o) * ease;
    canvas.style.opacity = current.o.toFixed(3);
    if (current.o < 0.01) return;

    // the station's fractions are of the viewport: convert to the world plane the camera sees
    const halfHeight = camera.position.z * Math.tan((camera.fov * Math.PI) / 180 / 2);
    const halfWidth = halfHeight * camera.aspect;
    mark.system.position.set(current.cx * halfWidth, current.cy * halfHeight, 0);
    const scale = (current.size * halfHeight) / ORBIT;
    mark.system.scale.setScalar(scale);
    mark.dustUniforms.uScale.value = scale;

    // the pointer tilts the mark a little
    const tiltAmount = options.reducedMotion ? 0 : 0.14;
    mark.system.rotation.x = MathUtils.lerp(mark.system.rotation.x, pointer.y * tiltAmount, 0.06);
    mark.system.rotation.y = MathUtils.lerp(mark.system.rotation.y, pointer.x * tiltAmount, 0.06);
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
  });
}
