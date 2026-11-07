// GPU ball layer: draws all balls of a frame in one instanced point draw call (WebGL2).
// Profiling showed Canvas 2D drawImage costs ~60 ms for 10,000 balls on an Intel UHD iGPU; this layer
// uploads the session's packed arrays as-is and lets the GPU shade the spheres.
import { W, H } from '../core/constants.js';
import { BALL_R, PALETTE, GOLD_RGB, MAX_BALLS } from '../sim/config.js';
import { POS_SCALE } from '../sim/session.js';

const VS = `#version 300 es
in vec2 aPos; in float aCol; in float aAge;
uniform vec2 uView; uniform float uScale; uniform float uSize; uniform float uQ;
uniform vec3 uPalette[16];
out vec3 vColor; out float vFlash;
void main() {
  vec2 p = aPos / uQ;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  float k = aAge < 10.0 ? 1.0 + (1.0 - aAge / 10.0) * 0.9 : 1.0;
  gl_PointSize = uSize * k * uScale;
  vColor = uPalette[int(aCol)];
  vFlash = aAge < 5.0 ? 1.0 : 0.0;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vColor; in float vFlash; out vec4 o;
uniform float uSize; uniform float uR; uniform float uScale;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * uSize;         // sprite-local logical px
  float d = length(c);
  float r = uR;
  float half_ = uSize * 0.5;
  float glow = clamp(1.0 - (d - r * 0.6) / (half_ - r * 0.6), 0.0, 1.0) * (vFlash > 0.5 ? 0.55 : 0.28);
  vec3 col = vColor;
  vec3 mid = vFlash > 0.5 ? mix(col, vec3(1.0), 0.5) : col;
  vec3 hi = mix(col, vec3(1.0), vFlash > 0.5 ? 0.85 : 0.55);
  vec3 lo = col * 0.65;
  float hd = length(c - vec2(-0.38 * r, -0.42 * r)) / r;
  vec3 sph = hd < 0.45 ? mix(hi, mid, hd / 0.45) : mix(mid, lo, clamp((hd - 0.45) / 0.85, 0.0, 1.0));
  float aa = 1.0 / max(uScale, 0.25);
  float a = clamp((r - d) / aa + 0.5, 0.0, 1.0);
  o = vec4(sph * a + col * glow * (1.0 - a), a + glow * (1.0 - a));   // premultiplied
}`;

export class BallLayerGL {
  static create(scale, opts) {
    try { return new BallLayerGL(scale, opts); } catch (e) { console.warn('WebGL2 ball layer unavailable:', e.message); return null; }
  }

  /** opts: { ballR, palette (array of [r,g,b], last = gold), maxBalls } — defaults are split-chamber@1 */
  constructor(scale, { ballR = BALL_R, palette = [...PALETTE, GOLD_RGB], maxBalls = MAX_BALLS } = {}) {
    this.canvas = new OffscreenCanvas(Math.round(W * scale), Math.round(H * scale));
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    const loc = (n) => gl.getAttribLocation(prog, n);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const mk = (name, bytes, size, type) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
      const l = loc(name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, type, false, 0, 0);
      return b;
    };
    this.bPos = mk('aPos', maxBalls * 4, 2, gl.UNSIGNED_SHORT);
    this.bCol = mk('aCol', maxBalls, 1, gl.UNSIGNED_BYTE);
    this.bAge = mk('aAge', maxBalls, 1, gl.UNSIGNED_BYTE);
    const u = (n) => gl.getUniformLocation(prog, n);
    this.uScale = u('uScale');
    gl.uniform2f(u('uView'), W, H);
    gl.uniform1f(u('uSize'), ballR * 2 + 10);
    gl.uniform1f(u('uR'), ballR);
    gl.uniform1f(u('uQ'), POS_SCALE);
    const pal = new Float32Array(16 * 3);
    palette.slice(0, 16).forEach((c, i) => { pal[i * 3] = c[0] / 255; pal[i * 3 + 1] = c[1] / 255; pal[i * 3 + 2] = c[2] / 255; });
    gl.uniform3fv(u('uPalette'), pal);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPoint = range ? range[1] : 64;
    this.setScale(scale);
  }

  setScale(scale) {
    this.scale = scale;
    const w = Math.round(W * scale), h = Math.round(H * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uScale, scale);
  }

  draw(fr) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (fr.n === 0) return this.canvas;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, fr.xy);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, fr.col);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bAge); gl.bufferSubData(gl.ARRAY_BUFFER, 0, fr.age);
    gl.drawArrays(gl.POINTS, 0, fr.n);
    return this.canvas;
  }
}
