import {
  AdditiveBlending,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  type Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
} from 'three';
import { DUST_FRAGMENT, DUST_VERTEX } from '../shaders';
import { GAP_AHEAD, GAP_BEHIND, MOON, ORBIT, PLANET, RING } from './config';
import { additive, dustGeometry } from './geometry';
import { glowTexture, type Maps, withRepeat } from './textures';

export type Mark = {
  system: Group;
  orbit: Group;
  halo: Sprite;
  key: DirectionalLight;
  dustUniforms: {
    uTime: { value: number };
    uMoon: { value: number };
    uPower: { value: number };
    uPixelRatio: { value: number };
    uScale: { value: number };
  };
};

// The Zilar mark: silver planet, tilted orbit and gold moon, with orbit dust and the key light.
export function createMark(root: Scene, silver: Maps, pixelRatio: number, narrow: boolean): Mark {
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
  const halo = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  );
  halo.position.copy(moon.position);
  halo.scale.setScalar(MOON * 5);
  orbit.add(halo);

  const dustUniforms = {
    uTime: { value: 0 },
    uMoon: { value: 0 },
    uPower: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uScale: { value: 1 },
  };
  const dust = new Points(
    dustGeometry(narrow ? 1100 : 2600),
    additive(DUST_VERTEX, DUST_FRAGMENT, dustUniforms),
  );
  // positions are computed in the vertex shader, so the bounds never match the buffer
  dust.frustumCulled = false;
  tilt.add(dust);
  root.add(system);

  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(-3, 4, 6);
  root.add(key);

  return { system, orbit, halo, key, dustUniforms };
}
