// Kimo agent identity: liquid orb (board 23, options B and D).
// WebGL 1.0 / GLSL ES 1.00 fragment shader for a pen.dev `shader` fill.
// Slow domain-warped fluid in the agent palette, sphere shading, rim light,
// specular highlight and a soft circular alpha mask.
//
// Motion states (set via uniforms, see board 23):
//   idle      u_speed 0.25  u_turbulence 0.6
//   thinking  u_speed 0.6   u_turbulence 1.0
//   working   u_speed 1.2   u_turbulence 1.6
//   done/err  ease u_speed back to 0.25 over ~600ms; no shader change needed
// Respect prefers-reduced-motion: freeze u_time (static frame) in the app.

#ifdef GL_ES
precision highp float;
#endif

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Speed
 * @range 0, 3
 * @default 0.25
 */
uniform float u_speed;

/**
 * @label Turbulence
 * @range 0, 2.5
 * @default 0.6
 */
uniform float u_turbulence;

/**
 * @label Gloss
 * @range 0, 1
 * @default 0.8
 */
uniform float u_gloss;

/**
 * @label Edge softness (px)
 * @range 0, 4
 * @default 1
 */
uniform float u_soft;

/**
 * @label Deep ink
 * @color
 * @default #0B1E3A
 */
uniform vec3 u_c1;

/**
 * @label Blue
 * @color
 * @default #3860BE
 */
uniform vec3 u_c2;

/**
 * @label Teal
 * @color
 * @default #0093A3
 */
uniform vec3 u_c3;

/**
 * @label Aqua
 * @color
 * @default #7FE7EF
 */
uniform vec3 u_c4;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  float s = min(u_resolution.x, u_resolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / s; // -0.5..0.5
  float r = length(uv);
  float t = u_time * u_speed;

  // gentle swirl: rotate more near the centre
  float ang = (0.55 - r) * (0.8 + u_turbulence) * sin(t * 0.35);
  float ca = cos(ang);
  float sa = sin(ang);
  vec2 p = mat2(ca, -sa, sa, ca) * uv * 2.4;

  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.6)), fbm(p + vec2(5.2, 1.3) - t * 0.5));
  vec2 w = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.3),
                fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.25));
  float f = fbm(p + u_turbulence * 2.0 * w);

  vec3 col = mix(u_c1, u_c3, smoothstep(0.12, 0.5, f));
  col = mix(col, u_c2, smoothstep(0.45, 0.85, q.y) * 0.7);
  col = mix(col, u_c4, smoothstep(0.5, 0.9, f * w.y * 1.9) * 0.9);

  // sphere shading: 1 at centre, 0 at rim
  float z = sqrt(max(0.0, 0.25 - r * r)) * 2.0;
  col *= mix(0.68, 1.05, z);
  // fresnel rim light in aqua
  col += u_c4 * pow(1.0 - z, 3.0) * 0.35;

  // specular highlight, upper-left
  vec2 hl = (uv - vec2(-0.15, 0.2)) * vec2(1.0, 1.7);
  float spec = exp(-dot(hl, hl) * 55.0);
  col += vec3(spec) * 0.7 * u_gloss;

  // soft circular mask (premultiplied alpha)
  float edge = max(u_soft, 0.5) / s;
  float a = 1.0 - smoothstep(0.5 - edge * 1.5, 0.5, r);
  gl_FragColor = vec4(col * a, a);
}
