/**
 * A glossy 3D ball avatar: one hue per seed, the light direction from the
 * seed and a soft rim light on the back side, as a scalable SVG. No
 * dependencies, so it runs in a browser and in react-native-svg alike.
 */

/** FNV-1a 32-bit hash of a seed. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A xorshift32 PRNG: every call returns the next value in [0, 1). */
function makeRandom(seed: number): () => number {
  let state = seed === 0 ? 0x9e3779b9 : seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** Rounds to two decimals, so the SVG stays short but keeps its direction. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The explicit look of a ball avatar, all in the units `ballSvg` expects. */
export interface BallParams {
  /** Body hue in degrees. */
  hue: number;
  /** Rim-light hue in degrees. */
  rim: number;
  /** Light direction in radians. */
  angle: number;
  /** Light distance from the centre, 0–1. */
  distance: number;
}

/** The named look of a ball avatar, derived from a seed. */
export function ballParams(seed: string): BallParams {
  const random = makeRandom(hashSeed(seed));

  const hue = random() * 360;
  const rim = (hue + 30 + random() * 120) % 360;
  const angle = random() * Math.PI * 2;
  const distance = 0.18 + random() * 0.14;

  return { hue, rim, angle, distance };
}

/** Wraps a hue into 0–360 degrees, so the same colour stays the same colour. */
function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

/** Keeps the light distance inside the 0–0.4 range the markup supports. */
function clampDistance(distance: number): number {
  return Math.min(0.4, Math.max(0, distance));
}

/**
 * The glossy ball avatar for explicit params: a deterministic SVG with a
 * `viewBox` and no `width`/`height`, so it scales to any box. Two inline SVGs
 * never clash because `idSeed` gives every gradient id a short hash.
 */
export function ballSvg(params: BallParams, idSeed: string): string {
  const hue = wrapHue(params.hue);
  const rim = wrapHue(params.rim);
  const distance = clampDistance(params.distance);
  const { angle } = params;

  const lightX = round(50 + Math.cos(angle) * distance * 100);
  const lightY = round(50 + Math.sin(angle) * distance * 100);
  const backX = round(50 - Math.cos(angle) * 28);
  const backY = round(50 - Math.sin(angle) * 28);

  const id = `b${hashSeed(idSeed).toString(36).slice(0, 5)}`;
  const hueDeg = Math.round(hue);
  const hue2Deg = Math.round(rim);
  const body = `hsl(${hueDeg} 85% 72%)`;
  const bodyMid = `hsl(${hueDeg} 75% 46%)`;
  const bodyEdge = `hsl(${hueDeg} 80% 16%)`;
  const rimColor = `hsl(${hue2Deg} 90% 70%)`;

  return (
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<radialGradient id="${id}-body" cx="${lightX}%" cy="${lightY}%" r="75%">` +
    `<stop offset="0" stop-color="${body}"/>` +
    `<stop offset="0.55" stop-color="${bodyMid}"/>` +
    `<stop offset="1" stop-color="${bodyEdge}"/>` +
    `</radialGradient>` +
    `<radialGradient id="${id}-rim" cx="${backX}%" cy="${backY}%" r="55%">` +
    `<stop offset="0.6" stop-color="${rimColor}" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="${rimColor}" stop-opacity="0.55"/>` +
    `</radialGradient>` +
    `<radialGradient id="${id}-gloss" cx="${lightX}%" cy="${lightY}%" r="18%">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0.95"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<circle cx="50" cy="50" r="50" fill="url(#${id}-body)"/>` +
    `<circle cx="50" cy="50" r="50" fill="url(#${id}-rim)"/>` +
    `<circle cx="50" cy="50" r="50" fill="url(#${id}-gloss)"/>` +
    `</svg>`
  );
}

/**
 * The glossy ball avatar for a seed: `ballSvg` with the seed's params and the
 * seed as the gradient-id hash, so its output never changes.
 */
export function ballAvatarSvg(seed: string): string {
  return ballSvg(ballParams(seed), seed);
}
