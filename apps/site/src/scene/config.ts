// The hero: the Zilar mark (silver planet, tilted orbit, gold moon) live in WebGL in deep space.
// A nebula haze and twinkling stars sit behind it, dust drifts along the orbit and glows gold
// where the moon has just passed, and the frame gets a warm halo on the moon, lens fringing and grain.
// Proportions match the icon in tools/brand-3d: planet 1, orbit 1.82, ring tube 0.14, moon 0.44.
export const PLANET = 1;
export const ORBIT = 1.82;
export const RING = 0.142;
export const MOON = 0.44;
export const GAP_AHEAD = 0.9;
export const GAP_BEHIND = 0.75;
export const ORBIT_SPEED = 0.14; // radians per second: one orbit in about 45 s
export const INTRO_SECONDS = 2.2;
// the nebula is soft haze, so it is computed at half the CSS resolution: a sixteenth of the pixels
// of a retina frame, and indistinguishable once upscaled
export const NEBULA_SCALE = 0.5;
// when frames run slower than this, the pixel ratio steps down until they keep up
export const SLOW_FRAME_SECONDS = 1 / 50;
export const MIN_PIXEL_RATIO = 1;
