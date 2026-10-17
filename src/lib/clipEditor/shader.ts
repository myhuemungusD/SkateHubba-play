import type { LookParams, ColorMatrix } from "./looks";

/** Fullscreen quad vertex shader; flips Y for video textures. */
export const VERTEX_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
}
`;

/**
 * One-pass look shader: barrel (same atan curve as FisheyeRenderer, so the
 * editor's VX look matches the camera's), chroma bleed, cheap 5-tap blur,
 * color matrix, scanlines, grain, vignette, 4:3 pillarbox, then the caption
 * layer composited on top.
 */
export const FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_overlay;
uniform vec2 u_texel;
uniform float u_barrel;
uniform float u_vignette;
uniform float u_grain;
uniform float u_chroma;
uniform float u_scan;
uniform float u_blur;
uniform float u_pillar;
uniform float u_time;
uniform float u_hasOverlay;
uniform mat4 u_cm;
uniform vec4 u_cb;
uniform vec2 u_size;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_time * 61.0) * 43758.5453); }

vec2 barrel(vec2 uv) {
  if (u_barrel < 0.001) return uv;
  vec2 c = uv * 2.0 - 1.0;
  float r = length(c);
  float th = atan(r * u_barrel) / atan(u_barrel);
  return (c * (th / max(r, 0.001))) * 0.5 + 0.5;
}

vec3 tap(vec2 uv) {
  vec3 col = texture2D(u_video, uv).rgb;
  if (u_chroma > 0.0) {
    col.r = texture2D(u_video, uv + vec2(u_texel.x * u_chroma, 0.0)).r;
    col.b = texture2D(u_video, uv - vec2(u_texel.x * u_chroma, 0.0)).b;
  }
  return col;
}

void main() {
  vec2 uv = v_uv;
  if (u_pillar > 0.0) {
    float x = (uv.x - 0.5) / (1.0 - u_pillar) + 0.5;
    if (x < 0.0 || x > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    uv.x = x;
  }
  vec2 suv = barrel(uv);
  vec3 col = tap(suv);
  if (u_blur > 0.0) {
    vec2 o = u_texel * (1.0 + u_blur * 2.5);
    col = col * 0.4 + 0.15 * (tap(suv + vec2(o.x, 0.0)) + tap(suv - vec2(o.x, 0.0)) + tap(suv + vec2(0.0, o.y)) + tap(suv - vec2(0.0, o.y)));
  }
  col = clamp((u_cm * vec4(col, 1.0)).rgb + u_cb.rgb, 0.0, 1.0);
  if (u_scan > 0.0) col *= 1.0 - u_scan * 0.5 * (0.5 + 0.5 * sin(v_uv.y * u_size.y * 1.5708));
  if (u_grain > 0.0) col += (hash(v_uv * u_size) - 0.5) * u_grain * 0.35;
  if (u_vignette > 0.0) col *= 1.0 - u_vignette * smoothstep(0.35, 1.05, length(uv * 2.0 - 1.0));
  if (u_hasOverlay > 0.5) {
    vec4 ov = texture2D(u_overlay, v_uv);
    col = mix(col, ov.rgb, ov.a);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Split a 4x5 color matrix into the mat4 (column-major) + bias the shader wants. */
export function colorMatrixUniforms(m: ColorMatrix): { mat: Float32Array; bias: Float32Array } {
  const mat = new Float32Array(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) mat[col * 4 + row] = m[row * 5 + col];
  return { mat, bias: new Float32Array([m[4], m[9], m[14], m[19]]) };
}

/** Pillarbox fraction for a 4:3 frame inside the output aspect (0 when not needed). */
export function pillarFor(look: LookParams, width: number, height: number): number {
  if (!look.fourByThree || height <= 0) return 0;
  const aspect = width / height;
  return aspect > 4 / 3 ? 1 - 4 / 3 / aspect : 0;
}
