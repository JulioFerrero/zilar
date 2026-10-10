import {
  HalfFloatType,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FINISH_FRAGMENT, FINISH_VERTEX } from '../shaders';

export type FinishUniforms = {
  tDiffuse: { value: null };
  uTime: { value: number };
  uResolution: { value: Vector2 };
};

export type Post = { composer: EffectComposer; finishUniforms: FinishUniforms };

// A half-float target keeps highlights above 1 until the output pass tone-maps them. There is
// no multisampling: at retina sizes it cost more than everything else together, and FXAA
// smooths the silhouettes for a fraction of that.
export function createPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  pixelRatio: number,
): Post {
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(1, 1, { type: HalfFloatType }),
  );
  composer.setPixelRatio(pixelRatio);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  composer.addPass(new FXAAPass());
  const finishUniforms: FinishUniforms = {
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
  return { composer, finishUniforms };
}
