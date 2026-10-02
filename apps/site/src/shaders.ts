// GLSL for the hero. All colours written by these shaders are linear: the scene renders into a
// floating-point target and the output pass applies tone mapping and sRGB once, for everything.

const NOISE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
      sum += amp * valueNoise(p);
      p = turn * p * 2.03 + 11.7;
      amp *= 0.5;
    }
    return sum;
  }
`;

export const BACKDROP_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Deep space behind the mark: a slow, domain-warped silver haze, brighter around the light that
// falls on the planet, with a faint warm cast near it. Kept far below the stars and the metal.
export const BACKDROP_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uLight;
  uniform float uPower;
  uniform float uAspect;
  uniform float uTime;
  ${NOISE}

  void main() {
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    vec2 light = vec2((uLight.x - 0.5) * uAspect, uLight.y - 0.5);
    float t = uTime * 0.012;
    vec2 warp = vec2(fbm(q * 1.6 + t), fbm(q * 1.6 - t + 4.2));
    float haze = fbm(q * 2.2 + warp * 1.3 + vec2(t * 2.0, 0.0));
    haze = smoothstep(0.35, 0.95, haze);
    vec2 d = q - light;
    float glow = exp(-dot(d, d) * 1.4);
    float halo = exp(-dot(d, d) * 6.0);
    // a second, larger layer carves dark lanes through the haze
    float lanes = smoothstep(0.25, 0.75, fbm(q * 0.9 - warp * 0.6 + 7.3));
    vec3 cool = vec3(0.26, 0.32, 0.46);
    vec3 silver = vec3(0.62, 0.63, 0.68);
    vec3 warm = vec3(1.0, 0.66, 0.30);
    vec3 col = vec3(0.0004, 0.00045, 0.0006);
    col += mix(cool, silver, haze) * haze * lanes * (0.02 + glow * 0.08);
    col += warm * halo * haze * 0.045;
    col += silver * halo * 0.008;
    col *= smoothstep(1.35, 0.1, length(q * vec2(0.7, 1.05)));
    gl_FragColor = vec4(col * uPower, 1.0);
  }
`;

// Stars: round soft points that twinkle at their own pace; size shrinks with distance.
export const STARS_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aBright;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vLight;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    float twinkle = 0.6 + 0.4 * sin(uTime * (0.5 + aPhase * 1.6) + aPhase * 40.0);
    vLight = aBright * twinkle;
    gl_PointSize = max(1.5, aSize * uPixelRatio * (30.0 / -view.z));
  }
`;

export const STARS_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uPower;
  varying float vLight;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vec3(0.82, 0.86, 1.0) * a * vLight * uPower, 1.0);
  }
`;

// Orbit dust: particles drifting along the orbit plane, each at its own speed. Dust the moon has
// just passed through glows gold and larger, so the moon leaves a trail as it travels.
export const DUST_VERTEX = /* glsl */ `
  attribute float aAngle;
  attribute float aRadius;
  attribute float aHeight;
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  uniform float uTime;
  uniform float uMoon;
  uniform float uPixelRatio;
  uniform float uScale;
  varying float vTrail;
  varying float vLight;
  void main() {
    float angle = aAngle + uTime * aSpeed;
    vec3 p = vec3(cos(angle) * aRadius, sin(angle) * aRadius, aHeight);
    float behind = mod(uMoon - angle, 6.2831853);
    vTrail = exp(-behind * 1.1) * smoothstep(0.0, 0.12, behind);
    vLight = 0.6 + 0.4 * sin(uTime * (0.8 + aPhase * 2.2) + aPhase * 31.0);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = max(2.0, aSize * uPixelRatio * uScale * (1.0 + vTrail * 1.4) * (44.0 / -view.z));
  }
`;

export const DUST_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uPower;
  varying float vTrail;
  varying float vLight;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    vec3 silver = vec3(0.75, 0.78, 0.86);
    vec3 gold = vec3(1.0, 0.62, 0.2);
    vec3 col = mix(silver * 0.7, gold * 2.4, vTrail);
    gl_FragColor = vec4(col * a * vLight * uPower, 1.0);
  }
`;

// The finish, in display space after tone mapping: a hint of lens fringing towards the edges and
// fine animated film grain, so the dark areas read as a photograph rather than a flat fill.
export const FINISH_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 fromCentre = vUv - 0.5;
    float fringe = 0.0025 * dot(fromCentre, fromCentre) * 4.0;
    vec3 col;
    col.r = texture2D(tDiffuse, vUv + fromCentre * fringe).r;
    col.g = texture2D(tDiffuse, vUv).g;
    col.b = texture2D(tDiffuse, vUv - fromCentre * fringe).b;
    float grain = hash12(vUv * uResolution + fract(uTime * 7.31) * 911.0) - 0.5;
    col += grain * 0.028;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const FINISH_VERTEX = BACKDROP_VERTEX;
