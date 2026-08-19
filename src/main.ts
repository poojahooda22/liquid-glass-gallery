import './style.css';
import { CARDS } from './content';
import { DISPERSION_SAMPLES, DPR_CAP, DRAG, GLASS, GRID, INTRO_GAP, INTRO_SPRING } from './config';
import { computeLayout, type Layout } from './layout';
import { clamp, composeTRS, lookAtOrigin, perspectiveMat, quatFromZ, rotateInverse, wrap } from './math';
import { Spring } from './spring';
import { buildPlane, spectralWeights, type Plane } from './gl/plane';
import { makeProgram, uniformMap } from './gl/program';
import { buildLabelCanvases, uploadLabels } from './gl/textures';
import { ANIM_BUDGET, createSceneBank, generateEnvTexture, type SceneBank } from './gl/scenegen';
import { assignCards } from './assign';
import { GLASS_FRAG, GLASS_VERT } from './shaders/glass';

/**
 * The frame loop.
 *
 * One program, one geometry, two draw calls per card. There is no render
 * target, no post pass and no second view of the scene — the "glass" is
 * entirely a fragment-stage construction, which is what lets the grid stay
 * cheap however many panes are on screen.
 *
 * The layout is a flat torus bent onto a sphere: grid coordinates wrap into
 * a fixed period, and the wrapped coordinate is then read as an arc length
 * and mapped onto a sphere of radius R whose front pole sits at the origin.
 * Dragging moves the wrap offset, so the gallery is infinite while the mesh
 * count stays constant.
 */

const el = document.getElementById('gl');
if (!(el instanceof HTMLCanvasElement)) throw new Error('#gl canvas not found');
const canvas = el;

const context = canvas.getContext('webgl2', {
  alpha: true,
  premultipliedAlpha: true,
  /* No MSAA: the card edge is an SDF cut with fwidth, so it is already
     antialiased at whatever scale the sphere puts it, and a multisampled
     default framebuffer would cost fill rate for nothing. */
  antialias: false,
  /* No depth buffer. Cards never intersect and are drawn strictly
     back-to-front, so a depth test could only ever reject fragments that are
     already drawn last — it would cost a buffer and reject nothing. */
  depth: false,
  powerPreference: 'high-performance',
});
if (!context) throw new Error('WebGL2 is required and is not available in this browser');
/* Re-bound after the guard so the narrowed type survives into every closure
   below; TypeScript will not carry a module-level narrowing into a callback. */
const gl = context;

const UNIFORMS = [
  'uProj', 'uView', 'uModel', 'uPlaneSize', 'uSphereR',
  'uTex', 'uEnv', 'uCoverScale', 'uCoverOffset', 'uCamLocal', 'uRot',
  'uCornerR', 'uBevelW', 'uBevelPow', 'uBevelMaxSlope', 'uThickness',
  'uIor', 'uRefractStrength', 'uDispersion', 'uFresnelF0',
  'uEnvIntensity', 'uEnvMaxMix', 'uEnvRot', 'uEnvRotX',
  'uRimWidth', 'uRimIntensity', 'uOpacity',
  'uRimColor', 'uRimColorTop', 'uTint', 'uSamples', 'uFlat', 'uSW', 'uSO', 'uEnvScale',
] as const;

const labelCanvases = buildLabelCanvases();
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let program!: WebGLProgram;
let u!: Record<string, WebGLUniformLocation | null>;
let plane!: Plane;
let sceneBank!: SceneBank;
let labelTextures!: WebGLTexture[];
let envTexture!: WebGLTexture;
let layout!: Layout;

/** Everything that dies with the GL context, so a restore can rebuild it. */
function buildResources(): void {
  program = makeProgram(gl, GLASS_VERT, GLASS_FRAG);
  u = uniformMap(gl, program, UNIFORMS);
  plane = buildPlane(gl, program);
  sceneBank = createSceneBank(gl);
  labelTextures = uploadLabels(gl, labelCanvases);
  const env = generateEnvTexture(gl);
  envTexture = env.texture;
  /* The generators render into their own framebuffers at their own sizes and
     leave the viewport behind them. Without this the whole grid draws into a
     1024x512 corner of the canvas. */
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(program);
  gl.uniform1i(u.uTex ?? null, 0);
  gl.uniform1i(u.uEnv ?? null, 1);
  gl.uniform2f(u.uCoverScale ?? null, 1, 1);
  gl.uniform2f(u.uCoverOffset ?? null, 0, 0);
  gl.uniform1f(u.uBevelPow ?? null, GLASS.bevelPower);
  gl.uniform1f(u.uBevelMaxSlope ?? null, GLASS.bevelMaxSlope);
  gl.uniform1f(u.uIor ?? null, GLASS.ior);
  gl.uniform1f(u.uRefractStrength ?? null, GLASS.refractStrength);
  gl.uniform1f(u.uDispersion ?? null, GLASS.dispersion);
  gl.uniform1f(u.uFresnelF0 ?? null, GLASS.fresnelF0);
  gl.uniform1f(u.uEnvIntensity ?? null, GLASS.envIntensity);
  gl.uniform1f(u.uEnvMaxMix ?? null, GLASS.envMaxMix);
  gl.uniform1f(u.uEnvRot ?? null, GLASS.envRotation);
  gl.uniform1f(u.uEnvRotX ?? null, GLASS.envRotationX);
  gl.uniform1f(u.uRimIntensity ?? null, GLASS.rimIntensity);
  gl.uniform3fv(u.uRimColor ?? null, GLASS.rimColor as unknown as number[]);
  gl.uniform3fv(u.uRimColorTop ?? null, GLASS.rimColorTop as unknown as number[]);
  gl.uniform3fv(u.uTint ?? null, GLASS.tint as unknown as number[]);
  gl.uniform1i(u.uSamples ?? null, DISPERSION_SAMPLES);

  const spectral = spectralWeights(DISPERSION_SAMPLES);
  gl.uniform3fv(u.uSW ?? null, spectral.weights);
  gl.uniform1fv(u.uSO ?? null, spectral.offsets);

  gl.disable(gl.DEPTH_TEST);
  /* The material is single-sided, matching the reference. Everything past the
     sphere's limb is dropped on the CPU anyway, so this only guards the few
     cards tilted hard enough to turn away mid-frame. */
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  /* Straight alpha in, premultiplied out — which is exactly what a canvas
     declared premultipliedAlpha:true expects to composite over the page. */
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, envTexture);
  gl.activeTexture(gl.TEXTURE0);

  applyLayoutUniforms();
}

let viewW = 0;
let viewH = 0;
let cardOf: Int32Array | null = null;
let assignedCols = -1;
let assignedRows = -1;

function resize(): void {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  viewW = w;
  viewH = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  layout = computeLayout(w, h);
  /* The assignment is a pure function of the torus shape, so it only needs
     recomputing when the solver changes it. */
  if (cardOf === null || assignedCols !== layout.cols || assignedRows !== layout.rows) {
    assignedCols = layout.cols;
    assignedRows = layout.rows;
    cardOf = assignCards(layout.cols, layout.rows, CARDS.length);
  }
  if (program) applyLayoutUniforms();
}

/** Shader constants denominated in card pixels; they move when the card does. */
function applyLayoutUniforms(): void {
  gl.useProgram(program);
  gl.uniform2f(u.uPlaneSize ?? null, layout.planeW, layout.planeH);
  gl.uniform1f(u.uSphereR ?? null, layout.R);
  gl.uniform1f(u.uCornerR ?? null, GLASS.cornerRadius * layout.planeW);
  gl.uniform1f(u.uBevelW ?? null, GLASS.bevelWidth * layout.planeW);
  gl.uniform1f(u.uThickness ?? null, GLASS.thickness * layout.cardScale);
  gl.uniform1f(u.uRimWidth ?? null, GLASS.rimWidth * layout.cardScale);
}

/* ---- input ------------------------------------------------------------ */

/** Horizontal only. The grid covers the viewport vertically and stays there. */
const scrollX = new Spring(0, DRAG.spring);
/** Drag speed in px/s, smoothed, driving the camera dolly. */
const magnitude = new Spring(0, DRAG.magnitudeSpring);
/** Cell gap: starts scattered, springs closed. This is the whole intro. */
const gap = new Spring(reduced ? GRID.gapRatio : INTRO_GAP, INTRO_SPRING);
gap.target = GRID.gapRatio;

/** Pointer parallax, softer and heavier than the drag springs. */
const PARALLAX_SPRING = { stiffness: 80, damping: 18, mass: 0.8 };
const parallaxX = new Spring(0, PARALLAX_SPRING);
const parallaxY = new Spring(0, PARALLAX_SPRING);

let dragging = false;
let lastPointerX = 0;
let flingX = 0;

window.addEventListener('pointermove', (e) => {
  if (reduced) return;
  parallaxX.target = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
  parallaxY.target = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
});

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPointerX = e.clientX;
  flingX = 0;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointerX;
  lastPointerX = e.clientX;
  scrollX.target += dx * DRAG.multiplier;
  /* Exponential carry rather than a raw last-delta: a single 120Hz sample is
     mostly noise, and the release would fling on whichever frame happened to
     be last. */
  flingX = flingX * 0.7 + dx * 0.3;
});

function endDrag(e: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (reduced) return;
  /* Inertia as extra target distance, not as a velocity injection: the spring
     stays the only thing deciding how the grid gets there, so a fling lands
     with the same easing as a drag. */
  scrollX.target += flingX * DRAG.fling * 60;
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* A trackpad's horizontal axis drives the same rail. Vertical is deliberately
   ignored rather than mapped onto it: a two-axis wheel on a one-axis gallery
   makes every diagonal gesture feel like a fight. */
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    scrollX.target -= e.deltaX * DRAG.multiplier * 0.6;
  },
  { passive: false },
);

/* ---- frame ------------------------------------------------------------ */

const proj = new Float32Array(16);
const view = new Float32Array(16);
const model = new Float32Array(16);
const rot3 = new Float32Array(9);
const quat = new Float32Array(4);
const camLocal = new Float32Array(3);

const MAX_MESH = GRID.maxCols * GRID.maxRows;
const mPx = new Float32Array(MAX_MESH);
const mPy = new Float32Array(MAX_MESH);
const mPz = new Float32Array(MAX_MESH);
const mDx = new Float32Array(MAX_MESH);
const mDy = new Float32Array(MAX_MESH);
const mDz = new Float32Array(MAX_MESH);
const mDepth = new Float32Array(MAX_MESH);
const mCard = new Int32Array(MAX_MESH);
const order: number[] = [];

/* Which cards are on screen this frame, and where the animation budget got
   to last frame, so every visible card takes its turn. */
const cardSeen = new Int32Array(CARDS.length).fill(-1);
const visibleCards: number[] = [];
const animQueue: number[] = [];
let animCursor = 0;
let frameId = 0;

/**
 * Drag speed to camera pull-back. The tanh saturates, so a hard fling dollies
 * out decisively but never launches the camera into the next county.
 */
function dollyFor(speed: number, maxZoomZ: number): number {
  if (maxZoomZ <= 0) return 0;
  const range = 3 * maxZoomZ;
  return range * Math.tanh((0.04 * speed) / range);
}

let running = true;
let lastTime = performance.now();

function frame(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  frameId++;

  const g = gap.step(dt);
  const sx = scrollX.step(dt);
  /* The spring's own velocity is the honest measure of how fast the grid is
     moving: it covers the drag, the fling and the settle with one number,
     where a pointer-derived speed reads zero the instant a finger lifts. */
  magnitude.target = Math.abs(scrollX.v);
  const speed = magnitude.step(dt);
  const px = parallaxX.step(dt);
  const py = parallaxY.step(dt);

  const { F, R, planeW, planeH, cols, rows, maxZoomZ } = layout;
  const cards = cardOf;
  if (!cards) return;

  /* Parallax orbits the camera on a sphere of radius F, always facing the
     grid's centre. Moving the camera rather than shifting the layers is what
     makes it real parallax: near cards separate from far ones because they
     genuinely are at different depths on the sphere. */
  const yaw = -0.05 * px;
  const pitch = 0.05 * py;
  const cosPitch = Math.cos(pitch);
  const camX = Math.sin(yaw) * cosPitch * F;
  const camY = Math.sin(pitch) * F;
  const camZ = Math.cos(yaw) * cosPitch * F + dollyFor(speed, maxZoomZ);

  const near = Math.max(1, F * 0.01);
  const far = Math.hypot(camX, camY, camZ) + 2 * R + planeW * 2;
  perspectiveMat(proj, 2 * Math.atan(viewH / 2 / F), viewW / viewH, near, far);
  lookAtOrigin(view, camX, camY, camZ);

  const cellW = planeW * (1 + g);
  const cellH = planeH * (1 + g);
  const periodX = cols * cellW;
  const periodY = rows * cellH;
  /* A point on the sphere faces the camera while its outward normal projects
     past R onto the camera offset. The half-diagonal keeps a card whose
     centre has just crossed, but whose near edge has not. */
  const limb = R - Math.hypot(planeW, planeH) * 0.5;
  const dCamX = camX;
  const dCamY = camY;
  const dCamZ = camZ + R;

  let count = 0;
  visibleCards.length = 0;

  for (let row = 0; row < rows; row++) {
    const stagger = (row & 1) * cellW * 0.5;
    for (let col = 0; col < cols; col++) {
      const x = wrap((col - (cols - 1) / 2) * cellW + sx + stagger, periodX);
      const y = wrap(-(row - (rows - 1) / 2) * cellH, periodY);
      const ax = x / R;
      const ay = y / R;
      const cay = Math.cos(ay);
      const dx = Math.sin(ax) * cay;
      const dy = Math.sin(ay);
      const dz = Math.cos(ax) * cay;
      if (dx * dCamX + dy * dCamY + dz * dCamZ < limb) continue;

      const wx = dx * R;
      const wy = dy * R;
      const wz = dz * R - R;
      const depth = -(view[2] * wx + view[6] * wy + view[10] * wz + view[14]);
      if (depth <= near) continue;

      const vx = view[0] * wx + view[4] * wy + view[8] * wz + view[12];
      const vy = view[1] * wx + view[5] * wy + view[9] * wz + view[13];
      if (Math.abs(proj[0] * vx) > depth + proj[0] * planeW * 0.7) continue;
      if (Math.abs(proj[5] * vy) > depth + proj[5] * planeH * 0.7) continue;

      const card = cards[row * cols + col];
      mPx[count] = wx;
      mPy[count] = wy;
      mPz[count] = wz;
      mDx[count] = dx;
      mDy[count] = dy;
      mDz[count] = dz;
      mDepth[count] = depth;
      mCard[count] = card;
      count++;

      if (cardSeen[card] !== frameId) {
        cardSeen[card] = frameId;
        visibleCards.push(card);
      }
    }
  }

  /* Only what is on screen gets repainted, and only a few per frame. At a
     six-card budget against roughly a dozen visible, every card refreshes
     about every other frame, which is well past the rate at which drifting
     cloud and flickering neon read as continuous. */
  if (visibleCards.length > 0) {
    animQueue.length = 0;
    const take = Math.min(ANIM_BUDGET, visibleCards.length);
    for (let i = 0; i < take; i++) {
      animQueue.push(visibleCards[(animCursor + i) % visibleCards.length]);
    }
    animCursor = (animCursor + take) % visibleCards.length;
    sceneBank.render(animQueue, now / 1000);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  order.length = count;
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => mDepth[b] - mDepth[a]);

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindVertexArray(plane.vao);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);

  const settled = clamp((INTRO_GAP - g) / (INTRO_GAP - GRID.gapRatio), 0, 1);
  const dollyNorm = maxZoomZ > 0 ? clamp(dollyFor(speed, maxZoomZ) / (3 * maxZoomZ), 0, 1) : 0;
  /* Type arrives late and steps back while the grid is moving fast: a label
     smearing past at fling speed is noise, not information. */
  const labelAlpha = settled * settled * settled * (1 - 0.7 * dollyNorm);

  for (let i = 0; i < count; i++) {
    const k = order[i];
    quatFromZ(quat, mDx[k], mDy[k], mDz[k]);
    composeTRS(model, rot3, mPx[k], mPy[k], mPz[k], quat, planeW, planeH, 1);
    rotateInverse(camLocal, rot3, camX - mPx[k], camY - mPy[k], camZ - mPz[k]);

    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniformMatrix3fv(u.uRot, false, rot3);
    gl.uniform3f(u.uCamLocal, camLocal[0] / planeW, camLocal[1] / planeH, camLocal[2]);

    const card = mCard[k];
    gl.uniform1i(u.uFlat, 0);
    gl.uniform1f(u.uOpacity, 1);
    gl.bindTexture(gl.TEXTURE_2D, sceneBank.textures[card]);
    gl.drawElements(gl.TRIANGLES, plane.indexCount, gl.UNSIGNED_SHORT, 0);

    if (labelAlpha > 0.004) {
      gl.uniform1i(u.uFlat, 1);
      gl.uniform1f(u.uOpacity, labelAlpha);
      gl.bindTexture(gl.TEXTURE_2D, labelTextures[card]);
      gl.drawElements(gl.TRIANGLES, plane.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  gl.bindVertexArray(null);
  requestAnimationFrame(frame);
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  running = false;
});

canvas.addEventListener('webglcontextrestored', () => {
  /* The label canvases survive context loss, so a restore is a relink plus a
     re-upload and a repaint of the scene bank. Nothing the user waits for. */
  buildResources();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);
});

window.addEventListener('resize', resize);

resize();
buildResources();
requestAnimationFrame(frame);
