// Kimo agent identity: AgentMark body (board 23 option D, finalised on board 24).
// WebGL 1.0 / GLSL ES 1.00 fragment shader for a pen.dev `shader` fill.
// v2 "flat": a flat circle filled with a calm, slowly drifting soft gradient.
// No fbm/smoke, no sphere shading, no specular, no rim, no gloss: just three
// large smooth colour areas drifting on slow paths plus one gentle low-frequency
// bend (u_turbulence), and a crisp anti-aliased edge.
// Previous smoky version kept at ./agent-liquid-v0-smoke.glsl (before/after).
//
// Motion states (uniforms, see board 24 "AgentMark"):
//   idle       u_speed 0.12  u_turbulence 0.15
//   listening  u_speed 0.12  u_turbulence 0.15   (eyes carry the change)
//   thinking   u_speed 0.30  u_turbulence 0.30
//   working    u_speed 0.55  u_turbulence 0.45   (max; never reads as smoke)
//   done       ease u_speed back to 0.12 over ~600ms
//   error      u_speed 0 (frozen), u_turbulence 0.10
// <=12px and prefers-reduced-motion: freeze u_time / use the static flat
// mesh-gradient fallback. u_gloss is kept only for file compatibility (unused).

#ifdef GL_ES
precision highp float;
#endif

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Speed
 * @range 0, 1.5
 * @default 0.12
 */
uniform float u_speed;

/**
 * @label Turbulence (flow bend)
 * @range 0, 1
 * @default 0.15
 */
uniform float u_turbulence;

/**
 * @label Gloss (unused in v2 flat)
 * @range 0, 1
 * @default 0
 */
uniform float u_gloss;

/**
 * @label Edge softness (px)
 * @range 0, 4
 * @default 0.6
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

float blob(vec2 p, vec2 c, float rad) {
  vec2 d = p - c;
  return exp(-dot(d, d) / (rad * rad));
}

void main() {
  float s = min(u_resolution.x, u_resolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / s; // -0.5..0.5, y up
  float r = length(uv);
  float t = u_time * u_speed;

  // one gentle low-frequency bend: large-scale only, no filaments
  vec2 p = uv + u_turbulence * 0.1 * vec2(sin(uv.y * 4.0 + t * 1.3), cos(uv.x * 4.0 - t * 1.1));

  // three large soft colour areas drifting slowly
  vec2 b1 = vec2(0.16 * cos(t * 0.9) - 0.06, 0.14 * sin(t * 0.7) + 0.06);
  vec2 b2 = vec2(-0.18 * sin(t * 0.6 + 1.7) + 0.08, 0.16 * cos(t * 0.8 + 0.6) - 0.04);
  vec2 b3 = vec2(0.12 * sin(t * 0.5 + 3.1), -0.18 * cos(t * 0.65 + 2.2));
  float f1 = blob(p, b1, 0.40);
  float f2 = blob(p, b2, 0.30);
  float f3 = blob(p, b3, 0.24);

  // flat colour: no lighting terms at all
  vec3 col = mix(u_c2, u_c1, smoothstep(0.1, -0.7, p.y - p.x * 0.3) * 0.55);
  col = mix(col, u_c3, smoothstep(0.12, 0.75, f1));
  col = mix(col, u_c2, smoothstep(0.3, 0.9, f2) * 0.6);
  col = mix(col, u_c4, smoothstep(0.45, 0.95, f3) * 0.35);

  // crisp circular edge (premultiplied alpha)
  float edge = max(u_soft, 0.35) / s;
  float a = 1.0 - smoothstep(0.5 - edge, 0.5, r);
  gl_FragColor = vec4(col * a, a);
}
