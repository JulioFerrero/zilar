import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial } from 'three';
import { ORBIT } from './config';

// A small seeded generator, so the sky is the same on every visit.
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function floats(count: number, fill: (index: number) => number): BufferAttribute {
  return new BufferAttribute(
    Float32Array.from({ length: count }, (_, index) => fill(index)),
    1,
  );
}

export function additive(
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

type PointsSpec = {
  seed: number;
  position?: (count: number, random: () => number) => Float32Array;
  attributes: Record<string, (random: () => number) => number>;
};

// One BufferGeometry builder: a seeded position buffer plus the per-point attributes the vertex
// shaders read. `starGeometry` and `dustGeometry` are the same construction with different specs.
function pointsGeometry(spec: PointsSpec, count: number): BufferGeometry {
  const random = seeded(spec.seed);
  const geometry = new BufferGeometry();
  const positions = spec.position ? spec.position(count, random) : new Float32Array(count * 3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  for (const [name, fill] of Object.entries(spec.attributes)) {
    geometry.setAttribute(
      name,
      floats(count, () => fill(random)),
    );
  }
  return geometry;
}

// Most stars are faint and small; a few are bright enough to stand out.
export function starGeometry(count: number): BufferGeometry {
  return pointsGeometry(
    {
      seed: 7,
      position: (count, random) => {
        const positions = new Float32Array(count * 3);
        for (let index = 0; index < count; index++) {
          positions[index * 3] = (random() - 0.5) * 18;
          positions[index * 3 + 1] = (random() - 0.5) * 11;
          positions[index * 3 + 2] = -1.5 - random() * 4;
        }
        return positions;
      },
      attributes: {
        aSize: (random) => 0.7 + 2.4 * random() ** 3,
        aPhase: (random) => random(),
        aBright: (random) => 0.08 + 1.2 * random() ** 4,
      },
    },
    count,
  );
}

// Dust in the orbit plane: a soft band around the ring, slower than the moon so it overtakes it.
export function dustGeometry(count: number): BufferGeometry {
  const spread = (random: () => number) => (random() + random() + random() - 1.5) / 1.5;
  return pointsGeometry(
    {
      seed: 19,
      attributes: {
        aAngle: (random) => random() * Math.PI * 2,
        aRadius: (random) => ORBIT + spread(random) * 0.32,
        aHeight: (random) => spread(random) * 0.09,
        aSize: (random) => 0.6 + 2.2 * random() ** 2,
        aPhase: (random) => random(),
        aSpeed: (random) => 0.02 + random() * 0.09,
      },
    },
    count,
  );
}
