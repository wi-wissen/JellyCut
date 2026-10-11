// Transition indices must match the order of TRANSITION_TYPES in core/render/types.ts.

export const VERTEX_QUAD = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/** Straight-alpha source (video frame, image, canvas) written as premultiplied colour. */
export const FRAGMENT_FRAME = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  o = vec4(c.rgb * c.a, c.a);
}`

/**
 * Straight-alpha source with a colour grade (core/filters Grade: out = matrix * rgb + offset, row-major,
 * one row per uniform). Written premultiplied like FRAGMENT_FRAME, so it blends the same way.
 */
export const FRAGMENT_GRADED_FRAME = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec3 u_row0;
uniform vec3 u_row1;
uniform vec3 u_row2;
uniform vec3 u_offset;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = vec3(dot(u_row0, c.rgb), dot(u_row1, c.rgb), dot(u_row2, c.rgb)) + u_offset;
  rgb = clamp(rgb, 0.0, 1.0);
  o = vec4(rgb * c.a, c.a);
}`

/** Premultiplied texture copied unchanged (render targets, pre-premultiplied text). */
export const FRAGMENT_COPY = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() {
  o = texture(u_tex, v_uv);
}`

/** Text bitmap (premultiplied) scaled by the layer alpha. */
export const FRAGMENT_TEXT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_alpha;
in vec2 v_uv;
out vec4 o;
void main() {
  o = texture(u_tex, v_uv) * u_alpha;
}`

/** Separable Gaussian; u_step is the texel step in uv space for one axis. */
export const FRAGMENT_BLUR = `#version 300 es
precision highp float;
const int MAX_RADIUS = 64;
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform float u_sigma;
uniform int u_radius;
uniform float u_gain;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -MAX_RADIUS; i <= MAX_RADIUS; i++) {
    if (abs(i) > u_radius) continue;
    float x = float(i);
    float w = exp(-0.5 * x * x / (u_sigma * u_sigma));
    sum += w * texture(u_tex, v_uv + u_step * x);
    wsum += w;
  }
  o = sum / wsum * u_gain;
}`

/** Transition between page A ('from') and page B ('to'). Output is opaque. */
export const FRAGMENT_MIX = `#version 300 es
precision highp float;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform int u_type;
uniform float u_p;
uniform vec2 u_res;
in vec2 v_uv;
out vec4 o;

const float S = 0.02; // soft edge of wipes, in uv units

vec4 blurredA(vec2 uv) {
  // 5x5 box, spacing grows to 1% of the height per unit progress
  float sx = u_p * 0.01 * u_res.y / u_res.x;
  float sy = u_p * 0.01;
  vec4 sum = vec4(0.0);
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      sum += texture(u_a, uv + vec2(float(i) * sx, float(j) * sy));
    }
  }
  return sum / 25.0;
}

void main() {
  vec2 uv = v_uv;
  float p = u_p;
  vec4 c;
  if (u_type == 1) { // wipeLeft: B enters from the right
    float e = (1.0 + S) - p * (1.0 + 2.0 * S);
    c = mix(texture(u_a, uv), texture(u_b, uv), smoothstep(e - S, e + S, uv.x));
  } else if (u_type == 2) { // wipeRight: B enters from the left
    float e = -S + p * (1.0 + 2.0 * S);
    c = mix(texture(u_a, uv), texture(u_b, uv), 1.0 - smoothstep(e - S, e + S, uv.x));
  } else if (u_type == 3) { // wipeUp: B enters from the bottom (uv.y grows upwards)
    float e = -S + p * (1.0 + 2.0 * S);
    c = mix(texture(u_a, uv), texture(u_b, uv), 1.0 - smoothstep(e - S, e + S, uv.y));
  } else if (u_type == 4) { // wipeDown: B enters from the top
    float e = (1.0 + S) - p * (1.0 + 2.0 * S);
    c = mix(texture(u_a, uv), texture(u_b, uv), smoothstep(e - S, e + S, uv.y));
  } else if (u_type == 5) { // slideLeft: B pushes A out to the left
    c = uv.x < 1.0 - p
      ? texture(u_a, vec2(uv.x + p, uv.y))
      : texture(u_b, vec2(uv.x - 1.0 + p, uv.y));
  } else if (u_type == 6) { // slideRight: B pushes A out to the right
    c = uv.x < p
      ? texture(u_b, vec2(uv.x + 1.0 - p, uv.y))
      : texture(u_a, vec2(uv.x - p, uv.y));
  } else if (u_type == 7) { // zoomIn: A grows while fading out
    c = mix(texture(u_a, 0.5 + (uv - 0.5) / (1.0 + p)), texture(u_b, uv), p);
  } else if (u_type == 8) { // zoomOut: B shrinks from large into place while fading in
    c = mix(texture(u_a, uv), texture(u_b, 0.5 + (uv - 0.5) / (2.0 - p)), p);
  } else if (u_type == 9) { // blur: A blurs while fading out
    c = mix(blurredA(uv), texture(u_b, uv), p);
  } else { // fade and unknown types
    c = mix(texture(u_a, uv), texture(u_b, uv), p);
  }
  o = vec4(c.rgb, 1.0);
}`

/**
 * Picture-in-picture box: a texture cropped to fill the box, with rounded corners and an optional border
 * inside the edge. Output is premultiplied, like the other overlay programs.
 */
export const FRAGMENT_MEDIA = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_alpha;
uniform vec2 u_size;
uniform float u_radius;
uniform float u_border;
uniform vec3 u_border_color;
uniform vec4 u_crop;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 p = (v_uv - 0.5) * u_size;
  vec2 hb = u_size * 0.5;
  vec2 q = abs(p) - (hb - u_radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  float edge = 1.0 - smoothstep(-0.5, 0.5, d);
  float inner = 1.0 - smoothstep(-0.5, 0.5, d + u_border);
  vec4 c = texture(u_tex, mix(u_crop.xy, u_crop.zw, v_uv));
  vec3 rgb = mix(u_border_color, c.rgb, inner);
  float a = edge * mix(1.0, c.a, inner) * u_alpha;
  o = vec4(rgb * a, a);
}`

/**
 * Blur or pixelate area. Works on the composed picture below it: inside the mask (rectangle or ellipse,
 * rotated like the item) the picture is replaced by its blurred copy or by mosaic cells; outside it is unchanged.
 * Output is opaque, because the picture it reads is opaque.
 */
export const FRAGMENT_REGION = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform vec2 u_res;
uniform vec2 u_center;
uniform vec2 u_half;
uniform vec2 u_rot;
uniform int u_ellipse;
uniform int u_pixelate;
uniform float u_cell;
uniform float u_radius;
uniform float u_alpha;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 d = frag - u_center;
  vec2 l = vec2(u_rot.x * d.x + u_rot.y * d.y, -u_rot.y * d.x + u_rot.x * d.y);
  float sd;
  if (u_ellipse == 1) {
    sd = (length(l / u_half) - 1.0) * min(u_half.x, u_half.y);
  } else {
    // Rounded rectangle SDF in pixels; a zero radius is the plain rectangle.
    float r = u_radius;
    vec2 q = abs(l) - u_half + r;
    sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float m = (1.0 - smoothstep(-0.5, 0.5, sd)) * u_alpha;
  vec4 src = texture(u_src, v_uv);
  vec3 fx;
  if (u_pixelate == 1) {
    // Each mosaic cell shows the mean of a 4 x 4 grid of samples inside it, so fine detail does not leak through.
    vec2 origin = floor(frag / u_cell) * u_cell;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 4; j++) {
        vec2 p = origin + (vec2(float(i), float(j)) + 0.5) * (u_cell / 4.0);
        acc += texture(u_src, vec2(p.x / u_res.x, 1.0 - p.y / u_res.y)).rgb;
      }
    }
    fx = acc / 16.0;
  } else {
    fx = texture(u_blur, v_uv).rgb;
  }
  o = vec4(mix(src.rgb, fx, m), 1.0);
}`
