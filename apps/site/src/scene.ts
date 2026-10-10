import {
  ACESFilmicToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { createBackdrop, createStars } from './scene/backdrop';
import { startLoop, type SceneOptions } from './scene/loop';
import { createMark } from './scene/mark';
import { createPost } from './scene/post';
import { loadSilver } from './scene/textures';

export type { SceneOptions };

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

  const backdrop = createBackdrop(scene);
  const stars = createStars(scene, pixelRatio, narrowAtStart);
  const mark = createMark(scene, silver, pixelRatio, narrowAtStart);
  const { composer, finishUniforms } = createPost(renderer, scene, camera, pixelRatio);

  startLoop({
    canvas,
    renderer,
    composer,
    camera,
    scene,
    options,
    pixelRatio,
    backdrop,
    stars,
    mark,
    finishUniforms,
  });
}
