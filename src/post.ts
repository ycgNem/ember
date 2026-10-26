// WebGL2 post-processing. The 2D world canvas is composited over a procedural
// nebula and parallax starfield, refracted through shockwaves and black holes,
// darkened for the Abyss, then bloomed, aberrated, vignetted and grained.

import type { Rgb } from './sectors';

export interface PostParams {
  time: number;
  /** CSS pixels; every position below is in CSS pixels with y pointing down. */
  width: number;
  height: number;
  palette: readonly [Rgb, Rgb, Rgb];
  player: { x: number; y: number };
  shake: { x: number; y: number };
  shocks: { x: number; y: number; r: number; strength: number }[];
  lenses: { x: number; y: number; mass: number }[];
  dark: number;
  lights: { x: number; y: number; r: number }[];
  warp: number;
  aberration: number;
  hurt: number;
  flash: number;
  /** Zoom punch: 0 is none, 0.1 is a 10% push in toward `zoomAt`. */
  zoom: number;
  zoomAt: { x: number; y: number };
  /** Blood Moon sky tint, 0..1. */
  blood: number;
  /** FEVER intensity, 0..1: saturation and a rainbow edge glow. */
  fever: number;
}

const MAX_SHOCKS = 8;
const MAX_LENSES = 4;
const MAX_LIGHTS = 16;

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

const SCENE_FS = COMMON + `
uniform sampler2D uWorld;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uPal0;
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec2 uPlayer;
uniform vec2 uShake;
uniform vec4 uShocks[${MAX_SHOCKS}];
uniform int uShockCount;
uniform vec3 uLenses[${MAX_LENSES}];
uniform int uLensCount;
uniform float uDark;
uniform vec3 uLights[${MAX_LIGHTS}];
uniform int uLightCount;
uniform float uWarp;
uniform float uZoom;
uniform vec2 uZoomC;
uniform float uBlood;

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 starLayer(vec2 p, float cell, float density, float seed) {
  vec2 id = floor(p / cell);
  vec2 f = fract(p / cell);
  float h = hash(id + seed);
  if (h > density) return vec3(0.0);
  vec2 pos = vec2(hash(id + seed + 7.1), hash(id + seed + 3.7)) * 0.8 + 0.1;
  float d = length(f - pos) * cell;
  float size = mix(0.6, 1.9, hash(id + seed + 1.3));
  float b = exp(-d * d / (size * size));
  float tw = 0.65 + 0.35 * sin(uTime * (0.8 + h * 4.0) + h * 60.0);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.82, 0.65), hash(id + seed + 9.0));
  return tint * b * tw;
}

vec3 stars(vec2 p, vec2 par) {
  vec3 s = starLayer(p + par * 0.02, 18.0, 0.08, 0.0) * 0.5;
  s += starLayer(p + par * 0.05, 34.0, 0.10, 11.0) * 0.8;
  s += starLayer(p + par * 0.1, 70.0, 0.12, 23.0) * 1.3;
  return s;
}

void main() {
  vec2 px = vUv * uRes;
  px = uZoomC + (px - uZoomC) / (1.0 + uZoom) + uShake;

  // refraction: shockwave rings push the image outward, masses bend it around themselves
  vec2 offs = vec2(0.0);
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    if (i >= uShockCount) break;
    vec4 s = uShocks[i];
    vec2 dv = px - s.xy;
    float d = length(dv);
    float band = smoothstep(46.0, 0.0, abs(d - s.z));
    if (d > 0.5) offs -= dv / d * band * s.w;
  }
  for (int i = 0; i < ${MAX_LENSES}; i++) {
    if (i >= uLensCount) break;
    vec3 L = uLenses[i];
    vec2 dv = px - L.xy;
    float d = max(length(dv), 1.0);
    float ang = L.z / d * 0.6;
    vec2 tw = vec2(cos(ang) * dv.x - sin(ang) * dv.y, sin(ang) * dv.x + cos(ang) * dv.y);
    offs += normalize(tw) * min(L.z * L.z / d, d * 1.5) + (tw - dv) * 0.3;
  }
  vec2 sp = px + offs;
  vec2 par = uPlayer - 0.5 * uRes;

  // nebula
  vec2 q = sp * 0.0018 - par * 0.00006;
  float n = fbm(q + vec2(uTime * 0.012, -uTime * 0.008));
  float n2 = fbm(q * 2.6 + vec2(n * 1.8, -n) + vec2(-uTime * 0.02, uTime * 0.015));
  float n3 = fbm(q * 0.6 - vec2(n2, n) * 0.5);
  vec3 neb = uPal0;
  neb += uPal1 * smoothstep(0.38, 0.9, n) * 0.55;
  neb += uPal2 * pow(smoothstep(0.3, 0.95, n2), 2.0) * 0.5;
  neb *= 0.7 + 0.6 * n3;
  neb *= 1.0 - smoothstep(0.55, 0.75, fbm(q * 3.5 + 4.0)) * 0.4;
  neb = mix(neb, neb * vec3(1.7, 0.25, 0.3) + vec3(0.07, 0.0, 0.01), uBlood);

  // stars, smeared into streaks while warping
  vec3 st;
  if (uWarp > 0.01) {
    vec2 dir = normalize(sp - 0.5 * uRes + 0.001);
    st = vec3(0.0);
    for (int k = 0; k < 8; k++) st += stars(sp - dir * float(k) * uWarp * 16.0, par);
    st *= 0.3 + uWarp;
  } else {
    st = stars(sp, par);
  }
  vec3 bg = neb + st + uPal1 * uWarp * 0.25;

  vec4 w = texture(uWorld, sp / uRes);
  vec3 col = bg * (1.0 - clamp(w.a, 0.0, 1.0)) + w.rgb;

  if (uDark > 0.001) {
    float light = 0.0;
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec3 L = uLights[i];
      light = max(light, smoothstep(L.z, L.z * 0.2, length(px - L.xy)));
    }
    col *= mix(1.0, 0.035 + 0.965 * light, uDark);
  }
  outColor = vec4(col, 1.0);
}`;

const BRIGHT_FS = COMMON + `
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.35, l), 1.0);
}`;

// 9-tap gaussian done in 5 fetches by leaning on linear filtering
const BLUR_FS = COMMON + `
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += texture(uTex, vUv + uStep * 1.3846154).rgb * 0.3162162;
  c += texture(uTex, vUv - uStep * 1.3846154).rgb * 0.3162162;
  c += texture(uTex, vUv + uStep * 3.2307692).rgb * 0.0702703;
  c += texture(uTex, vUv - uStep * 3.2307692).rgb * 0.0702703;
  outColor = vec4(c, 1.0);
}`;

const FINAL_FS = COMMON + `
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform vec2 uRes;
uniform float uTime;
uniform float uAberration;
uniform float uHurt;
uniform float uFlash;
uniform float uFever;
vec3 rainbow(float h) {
  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  vec2 dir = vUv - 0.5;
  float ab = uAberration * dot(dir, dir) * 2.0;
  vec3 col;
  col.r = texture(uScene, vUv - dir * ab).r;
  col.g = texture(uScene, vUv).g;
  col.b = texture(uScene, vUv + dir * ab).b;
  col += (texture(uBloomA, vUv).rgb * 0.55 + texture(uBloomB, vUv).rgb * 0.75) * (1.0 + uFever * 0.6);
  float vig = smoothstep(1.05, 0.25, length(dir * vec2(1.0, 0.85)) * 1.25);
  col *= mix(0.45, 1.0, vig);
  if (uFever > 0.001) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 1.0 + 0.6 * uFever);
    col += rainbow(uTime * 0.4 + atan(dir.y, dir.x) / 6.2831853) * (1.0 - vig) * 0.4 * uFever;
  }
  col = mix(col, vec3(0.55, 0.0, 0.04), uHurt * (1.0 - vig) * 0.85);
  col += uFlash * vec3(1.0, 0.92, 0.8);
  col += (hash(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * 0.04;
  outColor = vec4(col, 1.0);
}`;

class Program {
  readonly prog: WebGLProgram;
  private readonly locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, fs: string) {
    const prog = gl.createProgram();
    if (!prog) throw new Error('program alloc failed');
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader alloc failed');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
    this.prog = prog;
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }

  use() { this.gl.useProgram(this.prog); return this; }
  int(name: string, v: number) { this.gl.uniform1i(this.loc(name), v); return this; }
  num(name: string, v: number) { this.gl.uniform1f(this.loc(name), v); return this; }
  vec2(name: string, x: number, y: number) { this.gl.uniform2f(this.loc(name), x, y); return this; }
  vec3(name: string, v: Rgb) { this.gl.uniform3f(this.loc(name), v[0], v[1], v[2]); return this; }
  arr3(name: string, data: Float32Array) { this.gl.uniform3fv(this.loc(name), data); return this; }
  arr4(name: string, data: Float32Array) { this.gl.uniform4fv(this.loc(name), data); return this; }
}

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class Post {
  private readonly scene: Program;
  private readonly bright: Program;
  private readonly blur: Program;
  private readonly final: Program;
  private readonly worldTex: WebGLTexture;
  private targets: { scene: Target; a1: Target; a2: Target; b1: Target; b2: Target } | null = null;
  private readonly shockData = new Float32Array(MAX_SHOCKS * 4);
  private readonly lensData = new Float32Array(MAX_LENSES * 3);
  private readonly lightData = new Float32Array(MAX_LIGHTS * 3);

  static create(canvas: HTMLCanvasElement): Post | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, desynchronized: true, powerPreference: 'high-performance',
    });
    if (!gl) return null;
    try {
      return new Post(gl);
    } catch (err) {
      console.warn('post-processing disabled:', err);
      return null;
    }
  }

  private constructor(private readonly gl: WebGL2RenderingContext) {
    this.scene = new Program(gl, SCENE_FS);
    this.bright = new Program(gl, BRIGHT_FS);
    this.blur = new Program(gl, BLUR_FS);
    this.final = new Program(gl, FINAL_FS);
    // one oversized triangle covers the screen
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.worldTex = this.makeTexture();
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('texture alloc failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('framebuffer alloc failed');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  /** Size in device pixels. */
  resize(w: number, h: number) {
    const gl = this.gl;
    if (this.targets) {
      for (const t of Object.values(this.targets)) {
        gl.deleteFramebuffer(t.fb);
        gl.deleteTexture(t.tex);
      }
    }
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2);
    const qh = Math.max(1, h >> 2);
    this.targets = {
      scene: this.makeTarget(w, h),
      a1: this.makeTarget(hw, hh),
      a2: this.makeTarget(hw, hh),
      b1: this.makeTarget(qw, qh),
      b2: this.makeTarget(qw, qh),
    };
  }

  private pass(target: Target | null, input: WebGLTexture | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : gl.drawingBufferWidth, target ? target.h : gl.drawingBufferHeight);
    if (input) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
    }
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  render(world: HTMLCanvasElement, p: PostParams) {
    const gl = this.gl;
    const t = this.targets;
    if (!t) return;
    const H = p.height;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.worldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, world);

    const shocks = p.shocks.slice(0, MAX_SHOCKS);
    shocks.forEach((s, i) => this.shockData.set([s.x, H - s.y, s.r, s.strength], i * 4));
    const lenses = p.lenses.slice(0, MAX_LENSES);
    lenses.forEach((l, i) => this.lensData.set([l.x, H - l.y, l.mass], i * 3));
    const lights = p.lights.slice(0, MAX_LIGHTS);
    lights.forEach((l, i) => this.lightData.set([l.x, H - l.y, l.r], i * 3));

    this.pass(t.scene, this.worldTex);
    this.scene.use()
      .int('uWorld', 0)
      .vec2('uRes', p.width, p.height)
      .num('uTime', p.time)
      .vec3('uPal0', p.palette[0])
      .vec3('uPal1', p.palette[1])
      .vec3('uPal2', p.palette[2])
      .vec2('uPlayer', p.player.x, H - p.player.y)
      .vec2('uShake', p.shake.x, -p.shake.y)
      .arr4('uShocks', this.shockData)
      .int('uShockCount', shocks.length)
      .arr3('uLenses', this.lensData)
      .int('uLensCount', lenses.length)
      .num('uDark', p.dark)
      .arr3('uLights', this.lightData)
      .int('uLightCount', lights.length)
      .num('uWarp', p.warp)
      .num('uZoom', p.zoom)
      .vec2('uZoomC', p.zoomAt.x, H - p.zoomAt.y)
      .num('uBlood', p.blood);
    this.draw();

    this.pass(t.a1, t.scene.tex);
    this.bright.use().int('uTex', 0).num('uThreshold', 0.5);
    this.draw();

    this.blur.use().int('uTex', 0);
    this.pass(t.a2, t.a1.tex);
    this.blur.vec2('uStep', 1 / t.a1.w, 0);
    this.draw();
    this.pass(t.a1, t.a2.tex);
    this.blur.vec2('uStep', 0, 1 / t.a2.h);
    this.draw();
    this.pass(t.b1, t.a1.tex);
    this.blur.vec2('uStep', 2 / t.a1.w, 0);
    this.draw();
    this.pass(t.b2, t.b1.tex);
    this.blur.vec2('uStep', 0, 1.5 / t.b1.h);
    this.draw();

    this.pass(null, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.a1.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t.b2.tex);
    this.final.use()
      .int('uScene', 0)
      .int('uBloomA', 1)
      .int('uBloomB', 2)
      .vec2('uRes', p.width, p.height)
      .num('uTime', p.time)
      .num('uAberration', p.aberration)
      .num('uHurt', p.hurt)
      .num('uFlash', p.flash)
      .num('uFever', p.fever);
    this.draw();
    gl.activeTexture(gl.TEXTURE0);
  }
}
