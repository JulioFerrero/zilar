import {
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { BACKDROP_FRAGMENT, NEBULA_VERTEX, STARS_FRAGMENT, STARS_VERTEX } from '../shaders';
import { additive, starGeometry } from './geometry';

export type Backdrop = {
  uniforms: {
    uLight: { value: Vector2 };
    uPower: { value: number };
    uAspect: { value: number };
    uTime: { value: number };
  };
  target: WebGLRenderTarget;
  scene: Scene;
  camera: OrthographicCamera;
};

export type Stars = {
  uniforms: {
    uTime: { value: number };
    uPower: { value: number };
    uPixelRatio: { value: number };
  };
  points: Points;
};

// The nebula, rendered small and shown as the scene background.
export function createBackdrop(root: Scene): Backdrop {
  const uniforms = {
    uLight: { value: new Vector2(0.74, 0.55) },
    uPower: { value: 0 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  };
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const nebula = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      uniforms,
      vertexShader: NEBULA_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    }),
  );
  nebula.frustumCulled = false;
  scene.add(nebula);
  root.background = target.texture;
  return { uniforms, target, scene, camera };
}

// Twinkling stars behind the mark. Phones get fewer of them.
export function createStars(root: Scene, pixelRatio: number, narrow: boolean): Stars {
  const uniforms = {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uPixelRatio: { value: pixelRatio },
  };
  const points = new Points(
    starGeometry(narrow ? 420 : 900),
    additive(STARS_VERTEX, STARS_FRAGMENT, uniforms),
  );
  root.add(points);
  return { uniforms, points };
}
