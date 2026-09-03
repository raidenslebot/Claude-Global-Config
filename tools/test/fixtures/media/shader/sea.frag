// A raymarched swell with a graded, dithered finish.
// Fixture: a plausible fragment shader that exercises the GPU vocabulary.
#version 300 es
precision highp float;

uniform float u_time;
uniform vec2  u_mouse;
uniform float u_seed;
uniform vec2  u_resolution;
uniform sampler2D u_lut;
uniform sampler2D u_framebuffer;   // the previous frame, for the trail
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + u_seed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// Fractal brownian motion: layered noise at halving amplitude.
float fbm(vec2 p) {
  float a = 0.5, sum = 0.0;
  const int octaves = 5;
  for (int i = 0; i < octaves; i++) { sum += a * valueNoise(p); p *= 2.02; a *= 0.5; }
  return sum;
}

// Domain warping — noise displacing the coordinates of noise, which is the step
// from "procedural texture" to something that looks made.
float warpedField(vec2 p) {
  vec2 warp = vec2(fbm(p + 1.7), fbm(p + 9.2));
  return fbm(p + 4.0 * warp);
}

// Signed distance to the water body: exact edges at any resolution.
float sdfSurface(vec3 pos) {
  float h = warpedField(pos.xz * 0.6 + u_time * 0.05) * 0.55;
  return pos.y - h;
}

vec3 rayMarch(vec3 ro, vec3 rayDirection) {
  float t = 0.0;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rayDirection * t;
    float d = sdfSurface(p);
    if (d < 0.001 || t > 30.0) break;
    t += d * 0.7;
  }
  return ro + rayDirection * t;
}

// The ordered dither that keeps a wide gradient from banding on an 8-bit target.
float bayer(vec2 uv) {
  vec2 p = floor(mod(uv, 4.0));
  return fract(dot(p, vec2(0.0625, 0.25)) * 4.0);
}

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
  vec3 ro = vec3(0.0, 1.4 + u_mouse.y * 0.4, -3.0);
  vec3 hit = rayMarch(ro, normalize(vec3(uv, 1.6)));

  float depth = clamp(hit.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.12, 0.16, 0.27), vec3(0.93, 0.91, 0.86), depth);

  // Chromatic aberration: a lens rather than a filter.
  float aberration = 0.004 * length(uv);
  col.r = mix(col.r, texture(u_framebuffer, uv * 0.5 + 0.5 + aberration).r, 0.25);
  col.b = mix(col.b, texture(u_framebuffer, uv * 0.5 + 0.5 - aberration).b, 0.25);

  // Grade through the LUT, tonemap, then dither before quantising.
  col = mix(col, texture(u_lut, vec2(depth, 0.5)).rgb, 0.35);
  col = acesFilm(col);
  col += (bayer(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
